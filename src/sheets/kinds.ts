// Spreadsheet file-kind constants — single source for FileSurface, chat host, etc.

import { LAUNCH_FEATURES } from "../lib/featurePolicy";

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

/** Binary workbooks need the spreadsheet capability, which stable builds
 * withhold; CSV/TSV stay a public editing surface. A withheld workbook opens to
 * the unsupported state — never a passive preview. */
export function workbookWithheld(ext: string, features: { sheets: boolean } = LAUNCH_FEATURES): boolean {
  return !features.sheets && SHEET_BIN.has(ext);
}

/** Formats this build edits in-app. */
export function sheetFormatEditable(ext: string, features: { sheets: boolean } = LAUNCH_FEATURES): boolean {
  return SHEET_EDITABLE.has(ext) && !workbookWithheld(ext, features);
}

/** A sheet file this build can edit: supported format, writable root, and
 * within the edit byte gate. */
export function sheetEditableFile(ext: string, stat: { writable: boolean; len: number } | null): boolean {
  return sheetFormatEditable(ext) && !!stat?.writable && stat.len <= SHEET_EDIT_MAX_BYTES;
}

/** Why a sheet opened read-only — every cause says so (#53, audit 2026-07). */
export function sheetReadOnlyReason(stat: { writable: boolean } | null, ext: string) {
  if (stat === null)
    return {
      label: "view only",
      title: "rotli couldn't verify this file, so it opened as a view-only table",
    };
  if (!stat.writable) return { label: "read-only", title: "This root is read-only — rotli never writes it" };
  if (!SHEET_EDITABLE.has(ext))
    return {
      label: `view only · .${ext}`,
      title: `Editing supports .xlsx and .csv — .${ext} opens as a view-only table (use Open externally to edit)`,
    };
  return {
    label: "view only · too large",
    title: "Too large to edit safely in rotli — use Open externally to edit",
  };
}
