// xlsx codec helpers.

import { describe, expect, test } from "bun:test";

import ExcelJS from "exceljs";

import { hexFromArgb } from "./colors";
import { b64FromBytes, b64FromText, bytesFromB64, fillFromCsvRows } from "./xlsx";

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
