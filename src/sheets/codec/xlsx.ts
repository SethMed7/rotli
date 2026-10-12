// xlsx disk codec — exceljs only; NO engine imports.

import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";
import JSZip from "jszip";

import { bytesFromBase64, bytesToBase64 } from "../../lib/base64Bytes";

const SPREADSHEET_NAMESPACE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const STRICT_SPREADSHEET_NAMESPACE = "http://purl.oclc.org/ooxml/spreadsheetml/main";

/** ExcelJS matches literal element names. Normalize only SpreadsheetML tags
 * before its parser sees packages produced with a prefix or Strict namespace. */
async function excelJsCompatibleBytes(zip: JSZip, original: ArrayBuffer): Promise<ArrayBuffer> {
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith("xl/") || !name.endsWith(".xml") || entry.dir) continue;
    const xml = await entry.async("string");
    const prefixes = Array.from(
      xml.matchAll(
        /xmlns:([A-Za-z_][\w.-]*)=["'](?:http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main|http:\/\/purl\.oclc\.org\/ooxml\/spreadsheetml\/main)["']/g,
      ),
      (match) => match[1],
    );
    let normalized = xml.replaceAll(STRICT_SPREADSHEET_NAMESPACE, SPREADSHEET_NAMESPACE);
    for (const prefix of prefixes) {
      if (!prefix) continue;
      normalized = normalized.replaceAll(`<${prefix}:`, "<").replaceAll(`</${prefix}:`, "</");
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      normalized = normalized.replace(new RegExp(`(\\s)${escaped}:([\\w.-]+)=`, "g"), "$1$2=");
    }
    if (normalized !== xml) {
      zip.file(name, normalized);
      changed = true;
    }
  }
  if (!changed) return original;
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer as ArrayBuffer;
}

// Surfaces never touch the vendor — the codec is the ONE exceljs seam.
export type { Workbook } from "exceljs";

/** A fresh empty workbook — so surfaces can build one without importing exceljs. */
export function newWorkbook(): Workbook {
  return new ExcelJS.Workbook();
}

/** Load an xlsx from raw bytes. */
export async function loadXlsx(bytes: ArrayBuffer): Promise<Workbook> {
  const zip = await JSZip.loadAsync(bytes).catch(() => {
    throw new Error(
      "This file isn’t a readable Excel workbook — it may be damaged, or another format saved with an .xlsx name.",
    );
  });
  const unsupported = Object.keys(zip.files).filter((name) => {
    const path = name.toLowerCase();
    return (
      path.startsWith("xl/charts/") ||
      path.startsWith("xl/pivottables/") ||
      path.startsWith("xl/pivotcache/") ||
      path.startsWith("xl/externallinks/") ||
      path.startsWith("xl/querytables/") ||
      path.startsWith("xl/slicers/") ||
      path.startsWith("xl/ctrlprops/") ||
      path.startsWith("xl/embeddings/") ||
      path.startsWith("xl/activex/") ||
      path.startsWith("xl/model/") ||
      path.startsWith("xl/threadedcomments/") ||
      path.startsWith("customxml/") ||
      path.startsWith("customui/") ||
      path.startsWith("_xmlsignatures/") ||
      path === "xl/connections.xml" ||
      path === "xl/vbaproject.bin"
    );
  });
  if (unsupported.length > 0) {
    const feature = unsupported[0] ?? "advanced workbook content";
    throw new Error(
      `This workbook contains ${feature}, which Rotli cannot preserve safely. Open it in Excel or convert a copy before editing.`,
    );
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await excelJsCompatibleBytes(zip, bytes));
  return wb;
}

/** Serialize a workbook to xlsx bytes. */
export async function saveXlsx(wb: Workbook): Promise<Uint8Array> {
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/** Plain string tables from workbook bytes — the read-only viewer + chat path.
 * `cell.text` is exceljs' display text (formula results, rich text, dates),
 * blank rows are dropped, rows past `maxRows` only count toward `truncated`. */
export async function tablesFromXlsx(
  bytes: ArrayBuffer,
  maxRows: number,
): Promise<Array<{ name: string; rows: string[][]; truncated: boolean }>> {
  const wb = await loadXlsx(bytes);
  return wb.worksheets.map((ws) => {
    const rows: string[][] = [];
    let kept = 0;
    let total = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const sparse: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        sparse[col - 1] = String(cell.text ?? "");
      });
      const vals = Array.from(sparse, (c) => c ?? "");
      if (vals.every((c) => c === "")) return;
      total += 1;
      if (kept < maxRows) {
        rows.push(vals);
        kept += 1;
      }
    });
    return { name: ws.name, rows, truncated: total > kept };
  });
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
  return bytesToBase64(bytes);
}

export function bytesFromB64(b64: string): Uint8Array {
  return bytesFromBase64(b64);
}

export function b64FromText(text: string): string {
  return b64FromBytes(new TextEncoder().encode(text));
}
