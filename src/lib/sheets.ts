// Spreadsheet parsing for the in-app viewer + the chat's read_file — SheetJS
// (Apache-2.0) reads .xlsx/.xls/.ods AND .csv/.tsv. Read-only: we render the
// cells as a table and CSV-ify for the model; rotli never writes the workbook.

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

/** A workbook as plain CSV text (sheets separated) — what the chat reads to
 * answer questions about a spreadsheet. */
export function workbookToCsv(input: { csv: string } | { base64: string }): string {
  const tables = parseWorkbook(input, 5000);
  return tables
    .map((t) => `### ${t.name}\n${t.rows.map((r) => r.map(csvCell).join(",")).join("\n")}`)
    .join("\n\n");
}

function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
