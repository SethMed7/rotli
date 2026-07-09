// Read-only SheetJS path — truncation must never be silent.

import { describe, expect, test } from "bun:test";
import { parseWorkbook, workbookToCsv } from "./view";

describe("parseWorkbook truncation flag", () => {
  const csvRows = (n: number) => `a,b\n${Array.from({ length: n }, (_, i) => `x${i},y${i}`).join("\n")}\n`;

  test("under the cap → truncated false, all rows kept", () => {
    const [t] = parseWorkbook({ csv: csvRows(10) });
    expect(t?.rows.length).toBe(11);
    expect(t?.truncated).toBe(false);
  });

  test("over the cap → sliced to maxRows and flagged", () => {
    const [t] = parseWorkbook({ csv: csvRows(30) }, 20);
    expect(t?.rows.length).toBe(20);
    expect(t?.truncated).toBe(true);
  });

  test("exactly at the cap is NOT truncated", () => {
    const [t] = parseWorkbook({ csv: csvRows(19) }, 20);
    expect(t?.rows.length).toBe(20);
    expect(t?.truncated).toBe(false);
  });

  test("workbookToCsv marks a truncated sheet for the model", () => {
    const big = csvRows(6000);
    expect(workbookToCsv({ csv: big })).toContain("… truncated — showing the first 5000 rows");
    expect(workbookToCsv({ csv: csvRows(3) })).not.toContain("truncated");
  });
});
