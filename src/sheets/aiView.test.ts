import { expect, test } from "bun:test";

import { columnName, sheetModelForAi } from "./aiView";
import type { SheetModel } from "./engine/types";

type Cells = NonNullable<SheetModel["sheets"][string]["cellData"]>;

const model = (cellData: Cells): SheetModel => ({
  id: "budget.xlsx",
  name: "budget.xlsx",
  sheetOrder: ["sheet-0"],
  sheets: { "sheet-0": { id: "sheet-0", name: "Budget", cellData } },
});

test("columns are named like Excel's", () => {
  expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
});

test("every cell by its address, real row numbers kept, formulas with their results", () => {
  const text = sheetModelForAi(
    model({
      0: { 0: { v: "Item" }, 1: { v: "Cost" } },
      // row 2 is blank: row 3 still reads as row 3
      2: { 0: { v: "Rent" }, 1: { v: 1200 } },
      3: { 0: { v: "Total" }, 1: { f: "=SUM(B1:B3)", v: 1200 } },
      4: { 0: { s: "bold-only" } },
    }),
  );
  expect(text).toBe(
    [
      '## Sheet "Budget" (4 rows × 2 columns used)',
      'A1 "Item" | B1 "Cost"',
      'A3 "Rent" | B3 1200',
      'A4 "Total" | B4 =SUM(B1:B3) → 1200',
    ].join("\n"),
  );
});

test("a cap says where it stopped; an empty sheet says so", () => {
  const big = model(Object.fromEntries(Array.from({ length: 10 }, (_, r) => [r, { 0: { v: r } }])));
  expect(sheetModelForAi(big, 3)).toContain("… stopped at row 4: the rest of this sheet isn't shown");
  expect(sheetModelForAi(model({}))).toBe('## Sheet "Budget" (empty)');
});

test("a date cell reads as its date, by its own format or a shared style", () => {
  const dated: SheetModel = {
    ...model({
      0: { 0: { v: 45306, s: { n: { pattern: "yyyy-mm-dd" } } }, 1: { v: 45306.5, s: "stamp" } },
      1: {
        0: { v: 45306, s: { n: { pattern: "#,##0.00" } } },
        1: { v: 0.25, s: { n: { pattern: '0.0"d"' } } },
      },
    }),
    styles: { stamp: { n: { pattern: "m/d/yy h:mm" } } },
  };
  expect(sheetModelForAi(dated)).toBe(
    [
      '## Sheet "Budget" (2 rows × 2 columns used)',
      "A1 2024-01-15 | B1 2024-01-15 12:00",
      "A2 45306 | B2 0.25",
    ].join("\n"),
  );
});

test("the cap holds across sheets: each says its real size, and later sheets are counted, not listed", () => {
  const sheet = (name: string, rows: number, cols: number) => ({
    id: name,
    name,
    cellData: Object.fromEntries(
      Array.from({ length: rows }, (_, r) => [
        r,
        Object.fromEntries(Array.from({ length: cols }, (_, c) => [c, { v: 1 }])),
      ]),
    ),
  });
  const book: SheetModel = {
    id: "b.xlsx",
    name: "b.xlsx",
    sheetOrder: ["One", "Two", "Three", "Four"],
    sheets: {
      One: sheet("One", 2, 3),
      Two: sheet("Two", 5, 4),
      Three: sheet("Three", 1, 1),
      Four: sheet("Four", 1, 1),
    },
  };
  const text = sheetModelForAi(book, 8);
  expect(text).toContain('## Sheet "One" (2 rows × 3 columns used)');
  // a wide row is cut at the cap, never past it
  expect(text).toContain(
    '## Sheet "Two" (5 rows × 4 columns used)\nA1 1 | B1 1 | … (row cut short)\n… stopped at row 2',
  );
  expect(text).toEndWith("… 2 more sheets not shown");
  expect(text).not.toContain("Three");
});
