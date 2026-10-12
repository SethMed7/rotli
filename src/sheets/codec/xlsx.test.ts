// xlsx codec helpers.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { hexFromArgb } from "./colors";
import { b64FromBytes, b64FromText, bytesFromB64, fillFromCsvRows, loadXlsx, saveXlsx } from "./xlsx";

const HASH = "#";

function must<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`missing ${what}`);
  return v;
}

describe("hexFromArgb", () => {
  test("ARGB → #rrggbb", () => {
    expect(hexFromArgb("FFFF8800")).toBe(`${HASH}ff8800`);
    expect(hexFromArgb("ff8800")).toBe(`${HASH}ff8800`);
    expect(hexFromArgb(null)).toBeNull();
    expect(hexFromArgb("zz")).toBeNull();
  });
});

describe("base64 codecs", () => {
  test("bytes round-trip (past the fromCharCode chunk limit)", () => {
    const bytes = new Uint8Array(0x9000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    expect([...bytesFromB64(b64FromBytes(bytes))]).toEqual([...bytes]);
  });
  test("text encodes UTF-8", () => {
    expect(new TextDecoder().decode(bytesFromB64(b64FromText("café")))).toBe("café");
  });
});

describe("fillFromCsvRows", () => {
  test("keeps every field as the typed string", () => {
    const wb = fillFromCsvRows(new ExcelJS.Workbook(), "Sales", [
      ["code", "qty"],
      ["007", "3"],
    ]);
    const ws = must(wb.worksheets[0], "worksheet");
    expect(ws.getRow(2).getCell(1).value).toBe("007");
    expect(ws.getRow(2).getCell(2).value).toBe("3");
  });
});

describe("round-trip safety", () => {
  test("edits a prefixed Strict workbook and saves a package ExcelJS can reopen", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Data").getCell("A1").value = "Before";
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    if (!sheet) throw new Error("fixture has no sheet");
    zip.file(
      "xl/worksheets/sheet1.xml",
      sheet
        .replace(
          'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
          'xmlns:x="http://purl.oclc.org/ooxml/spreadsheetml/main"',
        )
        .replace(/<(\/?)((?:worksheet|sheetData|row|c|v))\b/g, "<$1x:$2")
        .replace(/\bt="s"/g, 'x:t="s"'),
    );
    const strict = await zip.generateAsync({ type: "uint8array" });
    const opened = await loadXlsx(strict.buffer as ArrayBuffer);
    expect(opened.worksheets[0]?.getCell("A1").text).toBe("Before");
    opened.worksheets[0]!.getCell("A1").value = "After";
    const saved = await saveXlsx(opened);
    const excel = new ExcelJS.Workbook();
    await excel.xlsx.load(saved.buffer as ArrayBuffer);
    expect(excel.worksheets[0]?.getCell("A1").text).toBe("After");
    const savedZip = await JSZip.loadAsync(saved.buffer as ArrayBuffer);
    const rustFixture = await JSZip.loadAsync(
      readFileSync(new URL("../../../src-tauri/fixtures/strict-roundtrip-saved.xlsx", import.meta.url)),
    );
    const savedSheet = await savedZip.file("xl/worksheets/sheet1.xml")?.async("string");
    const rustSheet = await rustFixture.file("xl/worksheets/sheet1.xml")?.async("string");
    expect(savedSheet?.match(/<c r="A1"[^>]*>[\s\S]*?<\/c>/)?.[0]).toBe(
      rustSheet?.match(/<c r="A1"[^>]*>[\s\S]*?<\/c>/)?.[0],
    );
    expect(await savedZip.file("xl/sharedStrings.xml")?.async("string")).toBe(
      await rustFixture.file("xl/sharedStrings.xml")?.async("string"),
    );
  });
  test("refuses a workbook feature ExcelJS would silently discard", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Data").getCell("A1").value = 1;
    const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
    zip.file("xl/charts/chart1.xml", '<c:chartSpace xmlns:c="chart" />');
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(loadXlsx(bytes.buffer as ArrayBuffer)).rejects.toThrow("chart");
  });
});
