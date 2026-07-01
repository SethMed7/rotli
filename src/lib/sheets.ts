// Spreadsheet parsing for the in-app viewer + the chat's read_file — SheetJS
// (Apache-2.0) reads .xlsx/.xls/.ods AND .csv/.tsv. This module stays the
// READ path (viewer table + CSV-ify for the model); the EDIT/SAVE path lives
// in sheetEdit.ts on exceljs (MIT), because SheetJS CE can't write styles.

import * as XLSX from "xlsx";

export interface SheetTable {
  name: string;
  rows: string[][];
}

/** Parse a workbook from CSV/TSV text OR base64 (xlsx/binary) into plain string
 * tables (one per sheet). Capped rows/cols so a huge workbook can't lock the UI. */
export function parseWorkbook(
  input: { csv: string } | { base64: string },
  maxRows = 2000,
): SheetTable[] {
  const wb =
    "csv" in input
      ? XLSX.read(input.csv, { type: "string" })
      : XLSX.read(input.base64, { type: "base64" });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return { name, rows: [] };
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];
    const rows = raw
      .slice(0, maxRows)
      .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
    return { name, rows };
  });
}

/** Parse CSV text EXACTLY — the sheet EDITOR's load path. Unlike parseWorkbook
 * this must round-trip byte-faithfully through csvTextFromRows: every field
 * stays the typed string ("007" and a 16+-digit card number survive — SheetJS
 * coercion rewrote them on save, corrupting UNTOUCHED cells), blank rows are
 * kept (a blank line is [""] and serializes back to a blank line — SheetJS
 * padded them to ",,"), and NOTHING is sliced — the caller refuses oversized
 * sheets instead of silently truncating (a cut grid must never save). A plain
 * RFC-4180 hand parser, NOT SheetJS: full control is the point here. The only
 * normalizations Save applies are CRLF → LF, minimal re-quoting, and a final
 * trailing newline — the one-time .bak keeps the pre-rotli bytes. */
export function parseCsvExact(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  let i = 0;
  while (i < csv.length) {
    const ch = csv.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (csv.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      endRow();
      if (csv.charAt(i + 1) === "\n") i += 1;
    } else {
      field += ch;
    }
    i += 1;
  }
  // the final record — but a trailing newline never mints a phantom empty row
  if (field !== "" || row.length > 0 || quoted) endRow();
  return rows;
}

/** A workbook as plain CSV text (sheets separated) — what the chat reads to
 * answer questions about a spreadsheet. */
export function workbookToCsv(input: { csv: string } | { base64: string }): string {
  const tables = parseWorkbook(input, 5000);
  return tables
    .map((t) => `### ${t.name}\n${t.rows.map((r) => r.map(csvCell).join(",")).join("\n")}`)
    .join("\n\n");
}

/** Quote one CSV cell — shared with the sheet editor's csv serializer. */
export function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
