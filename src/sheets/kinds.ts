// Spreadsheet file-kind constants — single source for FileSurface, chat host, etc.

/** Binary workbook formats the read path handles via base64 (exceljs).
 * `.xls`/`.ods` were dropped with SheetJS (2026-07): no editor, no preview —
 * the workspace-not-preview-catalog rule. */
export const SHEET_BIN = new Set(["xlsx", "xlsm"]);

/** Text tabular formats the read path handles as UTF-8. */
export const SHEET_TEXT = new Set(["csv", "tsv"]);

/** Formats rotli edits in-app (exceljs codec for xlsx; exact csv round-trip). */
export const SHEET_EDITABLE = new Set(["xlsx", "csv"]);

/** Byte gate for edit mode — matches Rust corpus_file_bytes default (8 MB). */
export const SHEET_EDIT_MAX_BYTES = 8_000_000;
