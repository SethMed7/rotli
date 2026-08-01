// Read-only view path (exceljs codec + exact CSV parser) — truncation must
// never be silent, TSV must parse multi-column, and xlsx bytes must round-trip.

import { describe, expect, test } from "bun:test";

import ExcelJS from "exceljs";

import { b64FromBytes, saveXlsx } from "./codec/xlsx";
import { parseWorkbook, workbookToCsv } from "./view";

describe("parseWorkbook truncation flag", () => {
  const csvRows = (n: number) => `a,b\n${Array.from({ length: n }, (_, i) => `x${i},y${i}`).join("\n")}\n`;

  test("under the cap → truncated false, all rows kept", async () => {
    const [t] = await parseWorkbook({ csv: csvRows(10) });
    expect(t?.rows.length).toBe(11);
    expect(t?.truncated).toBe(false);
  });

  test("over the cap → sliced to maxRows and flagged", async () => {
    const [t] = await parseWorkbook({ csv: csvRows(30) }, 20);
    expect(t?.rows.length).toBe(20);
    expect(t?.truncated).toBe(true);
  });

  test("exactly at the cap is NOT truncated", async () => {
    const [t] = await parseWorkbook({ csv: csvRows(19) }, 20);
    expect(t?.rows.length).toBe(20);
    expect(t?.truncated).toBe(false);
  });

  test("workbookToCsv marks a truncated sheet for the model", async () => {
    const big = csvRows(6000);
    expect(await workbookToCsv({ csv: big })).toContain("… truncated — showing the first 5000 rows");
    expect(await workbookToCsv({ csv: csvRows(3) })).not.toContain("truncated");
  });
});

describe("delimiters", () => {
  test("TSV parses multi-column, not one fused column", async () => {
    const [t] = await parseWorkbook({ csv: "a\tb\tc\n1\t2\t3\n", delimiter: "\t" });
    expect(t?.rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("quoted commas survive the default CSV path", async () => {
    const [t] = await parseWorkbook({ csv: 'name,note\nx,"hello, world"\n' });
    expect(t?.rows[1]).toEqual(["x", "hello, world"]);
  });
});

describe("xlsx bytes through the exceljs codec", () => {
  async function xlsxB64(fill: (wb: ExcelJS.Workbook) => void): Promise<string> {
    const wb = new ExcelJS.Workbook();
    fill(wb);
    return b64FromBytes(await saveXlsx(wb));
  }

  test("cells come back as display strings, blank rows dropped", async () => {
    const b64 = await xlsxB64((wb) => {
      const ws = wb.addWorksheet("Data");
      ws.addRow(["name", "qty"]);
      ws.addRow(["olive oil", 2]);
      ws.addRow([]); // blank — must not appear
      ws.addRow(["butter", 1]);
    });
    const tables = await parseWorkbook({ base64: b64 });
    expect(tables.length).toBe(1);
    expect(tables[0]?.name).toBe("Data");
    expect(tables[0]?.rows).toEqual([
      ["name", "qty"],
      ["olive oil", "2"],
      ["butter", "1"],
    ]);
  });

  test("multi-sheet workbooks keep every sheet, truncation per sheet", async () => {
    const b64 = await xlsxB64((wb) => {
      const a = wb.addWorksheet("A");
      for (let i = 0; i < 30; i++) a.addRow([`r${i}`]);
      wb.addWorksheet("B").addRow(["only"]);
    });
    const tables = await parseWorkbook({ base64: b64 }, 20);
    expect(tables.map((t) => t.name)).toEqual(["A", "B"]);
    expect(tables[0]?.rows.length).toBe(20);
    expect(tables[0]?.truncated).toBe(true);
    expect(tables[1]?.truncated).toBe(false);
  });
});
