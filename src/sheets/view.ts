// Read-only spreadsheet viewing + chat CSV-ify — SheetJS (Apache-2.0).

import * as XLSX from "xlsx";
import { csvCell } from "./csv";

export interface SheetTable {
  name: string;
  rows: string[][];
  /** True when the sheet had MORE rows than the cap — the viewer must say so. */
  truncated: boolean;
}

/** Parse a workbook from CSV/TSV text OR base64 into plain string tables. */
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
    if (!ws) return { name, rows: [], truncated: false };
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];
    const rows = raw
      .slice(0, maxRows)
      .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
    return { name, rows, truncated: raw.length > maxRows };
  });
}

/** A workbook as plain CSV text — what the chat reads to answer questions. */
export function workbookToCsv(input: { csv: string } | { base64: string }): string {
  const tables = parseWorkbook(input, 5000);
  return tables
    .map((t) => {
      const csv = t.rows.map((r) => r.map(csvCell).join(",")).join("\n");
      const note = t.truncated ? `\n… truncated — showing the first ${t.rows.length} rows` : "";
      return `### ${t.name}\n${csv}${note}`;
    })
    .join("\n\n");
}
