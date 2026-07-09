// xlsx disk codec — exceljs only; NO engine imports.

import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";

/** Load an xlsx from raw bytes. */
export async function loadXlsx(bytes: ArrayBuffer): Promise<Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return wb;
}

/** Serialize a workbook to xlsx bytes. */
export async function saveXlsx(wb: Workbook): Promise<Uint8Array> {
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** Fill an EMPTY workbook keeping every field as the typed STRING — csv LOAD. */
export function fillFromCsvRows(wb: Workbook, sheetName: string, rows: string[][]): Workbook {
  const ws = wb.addWorksheet(sheetName || "Sheet1");
  for (const row of rows) {
    ws.addRow(row.map((v) => (v === "" ? null : v)));
  }
  return wb;
}

export function b64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function bytesFromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64FromText(text: string): string {
  return b64FromBytes(new TextEncoder().encode(text));
}
