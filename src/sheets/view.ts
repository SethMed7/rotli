// Read-only spreadsheet viewing + chat CSV-ify — the SAME exceljs codec as the
// edit path plus the exact CSV parser; no second spreadsheet library. The
// codec is dynamic-imported so notes that never open a workbook don't pay for
// exceljs. (SheetJS was removed 2026-07: abandoned on npm, CVE-2023-30533.)

import { csvCell, parseCsvExact } from "./csv";

export interface SheetTable {
  name: string;
  rows: string[][];
  /** True when the sheet had MORE rows than the cap — the viewer must say so. */
  truncated: boolean;
}

export type WorkbookInput = { csv: string; delimiter?: string } | { base64: string };

/** Parse a workbook from CSV/TSV text OR base64 bytes into plain string tables. */
export async function parseWorkbook(input: WorkbookInput, maxRows = 2000): Promise<SheetTable[]> {
  if ("csv" in input) {
    const raw = parseCsvExact(input.csv, input.delimiter ?? ",").filter((r) => r.some((c) => c !== ""));
    return [
      {
        name: "Sheet1",
        rows: raw.slice(0, maxRows),
        truncated: raw.length > maxRows,
      },
    ];
  }
  const { bytesFromB64, tablesFromXlsx } = await import("./codec/xlsx");
  const bytes = bytesFromB64(input.base64);
  return tablesFromXlsx(bytes.buffer as ArrayBuffer, maxRows);
}

/** A workbook as plain CSV text — what the chat reads to answer questions. */
export async function workbookToCsv(input: WorkbookInput): Promise<string> {
  const tables = await parseWorkbook(input, 5000);
  return tables
    .map((t) => {
      const csv = t.rows.map((r) => r.map(csvCell).join(",")).join("\n");
      const note = t.truncated ? `\n… truncated — showing the first ${t.rows.length} rows` : "";
      return `### ${t.name}\n${csv}${note}`;
    })
    .join("\n\n");
}
