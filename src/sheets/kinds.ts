// Spreadsheet file-kind constants — single source for FileSurface, chat host, etc.

/** Binary workbook formats the read path handles via base64. */
export const SHEET_BIN = new Set(["xlsx", "xls", "xlsm", "ods"]);

/** Text tabular formats the read path handles as UTF-8. */
export const SHEET_TEXT = new Set(["csv", "tsv"]);

/** Formats rotli edits in-app (exceljs codec for xlsx; exact csv round-trip). */
export const SHEET_EDITABLE = new Set(["xlsx", "csv"]);

/** Byte gate for edit mode — matches Rust corpus_file_bytes default (8 MB). */
export const SHEET_EDIT_MAX_BYTES = 8_000_000;

export function sheetExtOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function isSheetBinary(ext: string): boolean {
  return SHEET_BIN.has(ext);
}

export function isSheetText(ext: string): boolean {
  return SHEET_TEXT.has(ext);
}

export function isSheetEditable(ext: string): boolean {
  return SHEET_EDITABLE.has(ext);
}
