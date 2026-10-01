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
