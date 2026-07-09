// Pure spreadsheet-EDIT logic behind the editable sheet surface (SheetEditor).
// exceljs (MIT) is the write engine — it round-trips values + fonts + fills +
// multi-sheet, which SheetJS CE cannot (style-writing is SheetJS Pro; scout
// 2026-07-01). sheets.ts stays the READ-ONLY fast path. This module only uses
// exceljs TYPES, so it adds nothing to any bundle; the runtime library rides
// the lazy SheetEditor chunk (and the tests import it themselves).
//
// Colors travel as exceljs ARGB strings ("FFRRGGBB"). The "#rrggbb" form only
// exists at the <input type=color> boundary and is always built at runtime —
// never a hex literal in source (check:hex).

import type {
  Alignment,
  Border,
  Borders,
  Cell,
  CellValue,
  Column,
  Fill,
  Font,
  Workbook,
  Worksheet,
} from "exceljs";
import { csvCell } from "./sheets";

export type CellAlign = "left" | "center" | "right";
/** Which of a cell's four edges carry a (thin) border. */
export interface BorderSides {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** The style knobs rotli edits — a Sheets/Excel-style bar (Seth, 2026-07-08).
 * Colors are ARGB; null/false = unset. exceljs round-trips every one of these. */
export interface CellStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string | null;
  bg: string | null;
  fontName: string | null;
  fontSize: number | null;
  wrap: boolean;
  align: CellAlign | null;
  border: BorderSides | null;
}

export interface EditCell {
  v: string;
  style: CellStyle | null;
  /** Formula cells display the cached result and are read-only in v1. */
  formula: boolean;
}

export interface EditSheet {
  name: string;
  rows: EditCell[][];
}

/** Grid caps — a huge workbook must not lock the UI (same spirit as
 * parseWorkbook's row cap). Files denser than this refuse to edit upstream. */
export const MAX_EDIT_ROWS = 2000;
export const MAX_EDIT_COLS = 256;

/** The byte gate for edit mode — matches Rust corpus_file_bytes' default read
 * cap (8 MB). FileSurface probes stat.len against it before mounting the
 * editor, and the editor re-guards its own reads with it: a capped (truncated)
 * read must NEVER be written back over the real file. */
export const SHEET_EDIT_MAX_BYTES = 8_000_000;

// ── color codecs ─────────────────────────────────────────────────────────────

/** "#rrggbb" (an input[type=color] value) → exceljs ARGB "FFRRGGBB"; null when malformed. */
export function argbFromHex(hex: string): string | null {
  const rgb = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())?.[1];
  return rgb ? `FF${rgb.toUpperCase()}` : null;
}

/** ARGB "AARRGGBB"/"RRGGBB" → "#rrggbb" for a color input; null when malformed. */
export function hexFromArgb(argb: string | null | undefined): string | null {
  if (!argb) return null;
  const rgb = /^(?:[0-9a-fA-F]{2})?([0-9a-fA-F]{6})$/.exec(argb.trim())?.[1];
  return rgb ? `#${rgb.toLowerCase()}` : null;
}

// ── cell value rendering + coercion ──────────────────────────────────────────

/** Spreadsheet column label: 0 → A, 25 → Z, 26 → AA, … */
export function colLabel(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** True when the cell's value carries a formula (plain or shared). */
export function isFormulaValue(v: CellValue): boolean {
  return typeof v === "object" && v !== null && ("formula" in v || "sharedFormula" in v);
}

/** Render ANY exceljs cell value as display text: formulas show their cached
 * result, rich text flattens, dates print ISO (date-only when midnight UTC). */
export function valueText(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      return "result" in v ? valueText(v.result as CellValue) : "";
    }
    if ("error" in v) return String(v.error);
    if ("text" in v) return valueText(v.text as CellValue);
    return "";
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** What a committed edit writes: "" clears, a clean finite number stays a
 * number (so Excel/Numbers keep treating it as one), anything else is text. */
export function coerceInput(text: string): number | string | null {
  if (text === "") return null;
  const t = text.trim();
  if (t !== "" && !Number.isNaN(Number(t)) && Number.isFinite(Number(t))) return Number(t);
  return text;
}

// ── style read/apply ─────────────────────────────────────────────────────────

/** The rotli-visible style of a cell (bold / text color / solid bg); null when plain. */
/** Which edges of an exceljs border carry a real (styled) line. */
function bordersOf(b: Partial<Borders> | undefined): BorderSides | null {
  const has = (s: Partial<Border> | undefined) => !!s?.style;
  const sides = { top: has(b?.top), right: has(b?.right), bottom: has(b?.bottom), left: has(b?.left) };
  return sides.top || sides.right || sides.bottom || sides.left ? sides : null;
}

export function styleOfCell(cell: Cell): CellStyle | null {
  const f = cell.font;
  const bold = !!f?.bold;
  const italic = !!f?.italic;
  // exceljs underline is `boolean | 'none' | 'single' | …` — a string "none" is
  // falsy-in-intent but truthy-as-a-string, so exclude it explicitly.
  const underline = !!f?.underline && f.underline !== "none";
  const color = f?.color?.argb ?? null;
  const fontName = f?.name ?? null;
  const fontSize = typeof f?.size === "number" ? f.size : null;
  const fill = cell.fill;
  const bg =
    fill && fill.type === "pattern" && fill.pattern === "solid" ? (fill.fgColor?.argb ?? null) : null;
  const h = cell.alignment?.horizontal;
  const align: CellAlign | null = h === "left" || h === "center" || h === "right" ? h : null;
  const wrap = !!cell.alignment?.wrapText;
  const border = bordersOf(cell.border);
  return bold || italic || underline || color || bg || fontName || fontSize !== null || wrap || align || border
    ? { bold, italic, underline, color, bg, fontName, fontSize, wrap, align, border }
    : null;
}

/** Cell and Column both expose font/fill/alignment/border this way — one apply
 * for either. */
interface Styleable {
  font?: Partial<Font>;
  fill?: Fill;
  alignment?: Partial<Alignment>;
  border?: Partial<Borders>;
}

function applyStyle(target: Styleable, patch: Partial<CellStyle>): void {
  if (
    patch.bold !== undefined ||
    patch.italic !== undefined ||
    patch.underline !== undefined ||
    patch.color !== undefined ||
    patch.fontName !== undefined ||
    patch.fontSize !== undefined
  ) {
    const font: Partial<Font> = { ...target.font };
    if (patch.bold !== undefined) font.bold = patch.bold;
    if (patch.italic !== undefined) font.italic = patch.italic;
    if (patch.underline !== undefined) font.underline = patch.underline;
    if (patch.color !== undefined) {
      if (patch.color === null) delete font.color;
      else font.color = { argb: patch.color };
    }
    if (patch.fontName !== undefined) {
      if (patch.fontName === null) delete font.name;
      else font.name = patch.fontName;
    }
    if (patch.fontSize !== undefined) {
      if (patch.fontSize === null) delete font.size;
      else font.size = patch.fontSize;
    }
    target.font = font;
  }
  if (patch.bg !== undefined) {
    target.fill =
      patch.bg === null
        ? { type: "pattern", pattern: "none" }
        : { type: "pattern", pattern: "solid", fgColor: { argb: patch.bg } };
  }
  if (patch.wrap !== undefined || patch.align !== undefined) {
    const al: Partial<Alignment> = { ...target.alignment };
    if (patch.wrap !== undefined) al.wrapText = patch.wrap;
    if (patch.align !== undefined) {
      if (patch.align === null) delete al.horizontal;
      else al.horizontal = patch.align;
    }
    target.alignment = al;
  }
  if (patch.border !== undefined) {
    if (patch.border === null) {
      target.border = {};
    } else {
      // assign a FRESH border object with only the on-sides — this replaces the
      // whole border, so a preset (e.g. Bottom) also clears the sides it omits.
      const b = patch.border;
      const line: Partial<Border> = { style: "thin" };
      target.border = {
        ...(b.top ? { top: line } : {}),
        ...(b.right ? { right: line } : {}),
        ...(b.bottom ? { bottom: line } : {}),
        ...(b.left ? { left: line } : {}),
      };
    }
  }
}

/** Apply a style patch to ONE cell (1-based row/col, exceljs convention). */
export function setCellStyle(ws: Worksheet, row: number, col: number, patch: Partial<CellStyle>): void {
  applyStyle(ws.getRow(row).getCell(col), patch);
}

/** Apply a style patch to a whole COLUMN: the xlsx column style (so new cells
 * inherit) AND every existing cell in range, so other apps render identically
 * (scout risk 4 — column-only styling diverges in Excel). */
export function setColumnStyle(
  ws: Worksheet,
  col: number,
  patch: Partial<CellStyle>,
  rowCount: number,
): void {
  applyStyle(ws.getColumn(col) as Column, patch);
  for (let r = 1; r <= rowCount; r++) {
    applyStyle(ws.getRow(r).getCell(col), patch);
  }
}

/** Commit an edited cell VALUE. Refuses formula cells (read-only in v1 — an
 * edit must never silently vaporize a formula). Returns the new display text. */
export function setCellValue(ws: Worksheet, row: number, col: number, text: string): string {
  const cell = ws.getRow(row).getCell(col);
  if (isFormulaValue(cell.value)) {
    throw new Error("formula cells are read-only in rotli");
  }
  // The formula trap (audit 2026-07-09): "=SUM(A1:A10)" used to be SILENTLY
  // stored as literal text — corruption of the user's intent. Refuse loudly
  // until the real formula engine (Univer) lands; nothing is written.
  if (/^=\S/.test(text.trim())) {
    throw new Error("formulas aren't supported here yet — nothing was saved (a full formula engine is coming)");
  }
  cell.value = coerceInput(text);
  return valueText(cell.value);
}

// ── structural edits: insert / delete rows + columns ─────────────────────────
// exceljs splice* shifts existing cells (and their styles) for us; the caller
// re-derives the grid from the workbook afterwards so the two never diverge.

/** Insert `count` blank rows BEFORE 1-based row `at`. */
export function insertRows(ws: Worksheet, at: number, count: number): void {
  ws.spliceRows(at, 0, ...Array.from({ length: count }, () => [] as CellValue[]));
}
/** Delete `count` rows starting at 1-based row `at`. */
export function deleteRows(ws: Worksheet, at: number, count: number): void {
  ws.spliceRows(at, count);
}
/** Insert `count` blank columns BEFORE 1-based column `at`. */
export function insertCols(ws: Worksheet, at: number, count: number): void {
  ws.spliceColumns(at, 0, ...Array.from({ length: count }, () => [] as CellValue[]));
}
/** Delete `count` columns starting at 1-based column `at`. */
export function deleteCols(ws: Worksheet, at: number, count: number): void {
  ws.spliceColumns(at, count);
}

// ── workbook ⇄ grid ──────────────────────────────────────────────────────────

/** Extract the render/edit grid from a loaded workbook (values + styles +
 * formula flags), capped so a monster sheet can't lock the UI. */
export function gridFromWorkbook(wb: Workbook, maxRows = MAX_EDIT_ROWS): EditSheet[] {
  return wb.worksheets.map((ws) => {
    const rowCount = Math.min(ws.rowCount, maxRows);
    const colCount = Math.min(ws.columnCount, MAX_EDIT_COLS);
    const rows: EditCell[][] = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const cells: EditCell[] = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        cells.push({
          v: valueText(cell.value),
          style: styleOfCell(cell),
          formula: isFormulaValue(cell.value),
        });
      }
      rows.push(cells);
    }
    return { name: ws.name, rows };
  });
}

/** Drop trailing columns that are empty AND unstyled AND non-formula in EVERY
 * row. exceljs leaves a phantom trailing column after a `spliceColumns` delete
 * (its columnCount goes stale). The editor applies this ONLY after a column
 * delete — never on every read, so a freshly INSERTED trailing column survives
 * (it would otherwise be trimmed the same tick it's created). Pure. */
export function trimTrailingEmptyCols(rows: EditCell[][]): EditCell[][] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  let w = width;
  const emptyAt = (col: number) =>
    rows.every((row) => {
      const cell = row[col - 1];
      return !cell || (cell.v === "" && !cell.style && !cell.formula);
    });
  while (w > 0 && emptyAt(w)) w--;
  return w < width ? rows.map((row) => row.slice(0, w)) : rows;
}

/** Was the sheet truncated by the caps? A truncated grid must never save. */
export function exceedsEditCaps(wb: Workbook): boolean {
  return wb.worksheets.some((ws) => ws.rowCount > MAX_EDIT_ROWS || ws.columnCount > MAX_EDIT_COLS);
}

/** Fill an EMPTY workbook from plain string rows — the csv → xlsx convert.
 * The caller news up the Workbook (this module has no runtime exceljs). */
export function fillWorkbookFromRows(wb: Workbook, sheetName: string, rows: string[][]): Workbook {
  const ws = wb.addWorksheet(sheetName || "Sheet1");
  for (const row of rows) {
    ws.addRow(row.map((v) => coerceInput(v)));
  }
  return wb;
}

// ── csv ──────────────────────────────────────────────────────────────────────

/** Serialize edited rows back to CSV text — values only, a csv can't hold
 * styles (the file stays the truth). Trailing newline, POSIX-friendly. */
export function csvTextFromRows(rows: string[][]): string {
  if (rows.length === 0) return "";
  return `${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

// ── base64 ⇄ bytes (the invoke boundary carries base64) ──────────────────────

export function b64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000; // String.fromCharCode arg-spread limit
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

/** UTF-8 text → base64 (the csv save path rides the same bytes command). */
export function b64FromText(text: string): string {
  return b64FromBytes(new TextEncoder().encode(text));
}
