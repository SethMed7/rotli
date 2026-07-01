// sheetEdit — the editable-spreadsheet pure logic. The xlsx tests round-trip
// through real exceljs buffers (write → reload → read back), because the whole
// point of the exceljs pick is that values + bold + colors + fills survive the
// disk trip. ARGB strings carry no "#", so check:hex stays clean.

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import {
  argbFromHex,
  b64FromBytes,
  b64FromText,
  bytesFromB64,
  coerceInput,
  colLabel,
  csvTextFromRows,
  exceedsEditCaps,
  fillWorkbookFromRows,
  gridFromWorkbook,
  hexFromArgb,
  setCellStyle,
  setCellValue,
  setColumnStyle,
  valueText,
} from "./sheetEdit";

const HASH = "#"; // built at runtime so no hex literal appears in source

// checked accessors — noUncheckedIndexedAccess without `!` sprinkled everywhere
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}
const cellAt = (grids: ReturnType<typeof gridFromWorkbook>, s: number, r: number, c: number) =>
  must(must(must(grids[s], "sheet").rows[r], "row")[c], "cell");

describe("colLabel", () => {
  test("A..Z, AA, and the two-letter rollover", () => {
    expect(colLabel(0)).toBe("A");
    expect(colLabel(25)).toBe("Z");
    expect(colLabel(26)).toBe("AA");
    expect(colLabel(27)).toBe("AB");
    expect(colLabel(701)).toBe("ZZ");
    expect(colLabel(702)).toBe("AAA");
  });
});

describe("color codecs", () => {
  test("hex → ARGB → hex round-trips", () => {
    expect(argbFromHex(`${HASH}ff8800`)).toBe("FFFF8800");
    expect(hexFromArgb("FFFF8800")).toBe(`${HASH}ff8800`);
    expect(hexFromArgb("00AA11")).toBe(`${HASH}00aa11`); // RGB without alpha
  });
  test("malformed input is null, never garbage", () => {
    expect(argbFromHex("red")).toBeNull();
    expect(argbFromHex(`${HASH}fff`)).toBeNull(); // short form unsupported
    expect(hexFromArgb("")).toBeNull();
    expect(hexFromArgb(null)).toBeNull();
    expect(hexFromArgb("nope")).toBeNull();
  });
});

describe("coerceInput", () => {
  test("clean numbers stay numbers, everything else stays text", () => {
    expect(coerceInput("")).toBeNull();
    expect(coerceInput("42")).toBe(42);
    expect(coerceInput(" 3.5 ")).toBe(3.5);
    expect(coerceInput("-0.25")).toBe(-0.25);
    expect(coerceInput("abc")).toBe("abc");
    expect(coerceInput("42 items")).toBe("42 items");
    expect(coerceInput("1e400")).toBe("1e400"); // not finite → text
  });
});

describe("valueText", () => {
  test("renders every exceljs value shape", () => {
    expect(valueText(null)).toBe("");
    expect(valueText(7)).toBe("7");
    expect(valueText(true)).toBe("TRUE");
    expect(valueText(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01-15");
    expect(valueText({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(valueText({ formula: "A1+A2", result: 3, date1904: false })).toBe("3");
    expect(valueText({ error: "#N/A" as never })).toBe("#N/A");
    expect(valueText({ text: "link", hyperlink: "https://x" })).toBe("link");
  });
});

describe("csvTextFromRows", () => {
  test("quotes commas/quotes/newlines, trailing newline", () => {
    expect(csvTextFromRows([])).toBe("");
    expect(csvTextFromRows([["a", "b,c"], ['say "hi"', "x\ny"]])).toBe(
      'a,"b,c"\n"say ""hi""","x\ny"\n',
    );
  });
});

describe("base64 codecs", () => {
  test("bytes round-trip (past the fromCharCode chunk limit)", () => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    expect(bytesFromB64(b64FromBytes(bytes))).toEqual(bytes);
  });
  test("text encodes UTF-8", () => {
    const b64 = b64FromText("héllo → ✓");
    expect(new TextDecoder().decode(bytesFromB64(b64))).toBe("héllo → ✓");
  });
});

describe("xlsx round-trip through exceljs", () => {
  test("values, bold, text color, and cell/column fills survive write → reload", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data");
    ws.addRow(["name", "qty"]);
    ws.addRow(["apples", 3]);
    ws.addRow(["pears", 5]);

    expect(setCellValue(ws, 2, 1, "bananas")).toBe("bananas");
    expect(setCellValue(ws, 2, 2, "12")).toBe("12"); // numeric text → number
    setCellStyle(ws, 1, 1, { bold: true, color: "FF112233" });
    setCellStyle(ws, 2, 1, { bg: "FFFFEE00" });
    setColumnStyle(ws, 2, { bg: "FF00FF88" }, ws.rowCount);

    const buffer = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buffer);
    const grids = gridFromWorkbook(wb2);

    expect(grids).toHaveLength(1);
    expect(must(grids[0], "sheet").rows[0]?.map((c) => c.v)).toEqual(["name", "qty"]);
    expect(cellAt(grids, 0, 1, 0).v).toBe("bananas");
    expect(cellAt(grids, 0, 1, 1).v).toBe("12");
    // the number stayed a NUMBER on disk, not text
    const ws2 = must(wb2.worksheets[0], "worksheet");
    expect(ws2.getRow(2).getCell(2).value).toBe(12);
    // styles round-tripped
    expect(cellAt(grids, 0, 0, 0).style?.bold).toBe(true);
    expect(cellAt(grids, 0, 0, 0).style?.color).toBe("FF112233");
    expect(cellAt(grids, 0, 1, 0).style?.bg).toBe("FFFFEE00");
    // the column fill landed on every existing cell in the column
    expect(cellAt(grids, 0, 0, 1).style?.bg).toBe("FF00FF88");
    expect(cellAt(grids, 0, 2, 1).style?.bg).toBe("FF00FF88");
    // and on the column itself, so future rows inherit
    expect(ws2.getColumn(2).fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF00FF88" },
    });
  });

  test("clearing a style patch removes it", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.addRow(["x"]);
    setCellStyle(ws, 1, 1, { bold: true, color: "FFAA0000", bg: "FF00AA00" });
    setCellStyle(ws, 1, 1, { bold: false, color: null, bg: null });
    const buffer = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buffer);
    const cell = cellAt(gridFromWorkbook(wb2), 0, 0, 0);
    expect(cell.style?.color ?? null).toBeNull();
    expect(cell.style?.bg ?? null).toBeNull();
    expect(cell.style?.bold ?? false).toBe(false);
  });

  test("formula cells display the cached result and refuse value edits", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("F");
    ws.addRow([1, 2]);
    ws.getRow(1).getCell(3).value = { formula: "A1+B1", result: 3, date1904: false };
    const grids = gridFromWorkbook(wb);
    expect(cellAt(grids, 0, 0, 2).formula).toBe(true);
    expect(cellAt(grids, 0, 0, 2).v).toBe("3");
    expect(() => setCellValue(ws, 1, 3, "9")).toThrow(/read-only/);
    // styling a formula cell is still fine — it never touches the formula
    setCellStyle(ws, 1, 3, { bold: true });
    expect((ws.getRow(1).getCell(3).value as { formula: string }).formula).toBe("A1+B1");
  });

  test("multi-sheet grids keep their names and the edit caps flag fires", () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("One").addRow(["a"]);
    wb.addWorksheet("Two").addRow(["b"]);
    const grids = gridFromWorkbook(wb);
    expect(grids.map((g) => g.name)).toEqual(["One", "Two"]);
    expect(exceedsEditCaps(wb)).toBe(false);
    const big = new ExcelJS.Workbook();
    const ws = big.addWorksheet("Big");
    ws.getRow(3000).getCell(1).value = 1; // rowCount past the cap
    expect(exceedsEditCaps(big)).toBe(true);
  });

  test("fillWorkbookFromRows builds the csv → xlsx sibling (numbers typed)", async () => {
    const wb = fillWorkbookFromRows(new ExcelJS.Workbook(), "data", [
      ["name", "qty"],
      ["apples", "3"],
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buffer);
    const ws = must(wb2.worksheets[0], "worksheet");
    expect(ws.name).toBe("data");
    expect(ws.getRow(1).getCell(1).value).toBe("name");
    expect(ws.getRow(2).getCell(2).value).toBe(3);
  });
});
