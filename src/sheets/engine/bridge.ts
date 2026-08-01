// exceljs ⇄ SheetModel bridge — pure in both directions; NO engine runtime.
//
//   load:  workbookToModel(wb)           exceljs Workbook → SheetModel
//   save:  applyModelToWorkbook(wb, m)  SheetModel → MUTATE retained Workbook
//
// Mutate-don't-regenerate preserves unmodeled workbook features (pivots, charts…).

import type { Borders, Cell, CellValue, Workbook, Worksheet } from "exceljs";

import { hexFromArgb } from "../codec/colors";
import type {
  SheetBorderSide,
  SheetModel,
  SheetModelCell,
  SheetModelMerge,
  SheetModelStyle,
  SheetModelTab,
} from "./types";

export type { SheetModel } from "./types";

// ── unit + enum maps ──────────────────────────────────────────────────────────

/** exceljs column width is in CHARACTERS; Univer's is px. One factor both ways
 * so round-trips never drift. */
const PX_PER_CHAR = 7.5;
/** exceljs row height is in POINTS; Univer's is px (96dpi: 1pt = 4/3 px). */
const PX_PER_PT = 4 / 3;

/** Excel's date epoch (the 1900 system): serial 0 = 1899-12-30 UTC. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function dateToSerial(d: Date): number {
  return (d.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
}

const BORDER_TO_U: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
const BORDER_FROM_U: Record<number, string> = Object.fromEntries(
  Object.entries(BORDER_TO_U).map(([k, v]) => [v, k]),
);

const HT_TO_U: Record<string, 1 | 2 | 3> = { left: 1, center: 2, right: 3 };
const HT_FROM_U: Record<number, "left" | "center" | "right"> = { 1: "left", 2: "center", 3: "right" };
const VT_TO_U: Record<string, 1 | 2 | 3> = { top: 1, middle: 2, bottom: 3 };
const VT_FROM_U: Record<number, "top" | "middle" | "bottom"> = { 1: "top", 2: "middle", 3: "bottom" };

/** "#rrggbb" from an exceljs ARGB, for Univer color objects. */
function rgbOf(argb: string | undefined): { rgb: string } | undefined {
  const hex = hexFromArgb(argb ?? null);
  return hex ? { rgb: hex } : undefined;
}
/** exceljs ARGB from a Univer "#rrggbb" (tolerates missing "#"). */
function argbOf(rgb: string | undefined): string | undefined {
  if (!rgb) return undefined;
  const m = /^#?([0-9a-fA-F]{6})/.exec(rgb.trim());
  return m?.[1] ? `FF${m[1].toUpperCase()}` : undefined;
}

// ── load: exceljs → snapshot ─────────────────────────────────────────────────

function borderSideToU(side: Partial<Borders>[keyof Borders] | undefined): SheetBorderSide | undefined {
  if (!side?.style) return undefined;
  const s = BORDER_TO_U[side.style] ?? 1;
  const cl = rgbOf(side.color?.argb);
  return { s, ...(cl ? { cl } : {}) };
}

/** The full modeled style of one exceljs cell as an inline Univer style. */
function styleToU(cell: Cell): SheetModelStyle | null {
  const st: SheetModelStyle = {};
  const f = cell.font;
  if (f?.bold) st.bl = 1;
  if (f?.italic) st.it = 1;
  if (f?.underline && f.underline !== "none") st.ul = { s: 1 };
  // the workbook-default font (Calibri 11) is NOISE, not information — xlsx
  // materializes it onto any cell with a partial style (e.g. numFmt-only), so
  // carrying it would break apply∘load identity and bloat every snapshot
  if (typeof f?.size === "number" && f.size !== 11) st.fs = f.size;
  if (f?.name && f.name !== "Calibri") st.ff = f.name;
  const cl = rgbOf(f?.color?.argb);
  if (cl) st.cl = cl;
  const fill = cell.fill;
  if (fill && fill.type === "pattern" && fill.pattern === "solid") {
    const bg = rgbOf(fill.fgColor?.argb);
    if (bg) st.bg = bg;
  }
  const al = cell.alignment;
  const ht = al?.horizontal ? HT_TO_U[al.horizontal] : undefined;
  if (ht) st.ht = ht;
  const vt = al?.vertical ? VT_TO_U[al.vertical] : undefined;
  if (vt) st.vt = vt;
  if (al?.wrapText) st.tb = 3;
  const b = cell.border;
  if (b) {
    const bd: NonNullable<SheetModelStyle["bd"]> = {};
    const t = borderSideToU(b.top);
    const bo = borderSideToU(b.bottom);
    const l = borderSideToU(b.left);
    const r = borderSideToU(b.right);
    if (t) bd.t = t;
    if (bo) bd.b = bo;
    if (l) bd.l = l;
    if (r) bd.r = r;
    if (Object.keys(bd).length > 0) st.bd = bd;
  }
  if (cell.numFmt) st.n = { pattern: cell.numFmt };
  return Object.keys(st).length > 0 ? st : null;
}

/** One Univer cell from an exceljs value. Dates become Excel SERIALS (+ a date
 * numFmt if the cell has none) so they stay real dates in both worlds. Formula
 * cells carry the formula AND the cached result. */
function valueToU(cell: Cell): SheetModelCell | null {
  const v = cell.value as CellValue;
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return { v };
  if (typeof v === "string") return v === "" ? null : { v };
  if (v instanceof Date) return { v: dateToSerial(v) };
  if (typeof v === "object") {
    if ("richText" in v) return { v: v.richText.map((r) => r.text).join("") };
    if ("formula" in v || "sharedFormula" in v) {
      const f = "formula" in v && v.formula ? `=${v.formula}` : undefined;
      const res = "result" in v && v.result !== undefined && v.result !== null ? v.result : undefined;
      const rv =
        res instanceof Date
          ? dateToSerial(res)
          : typeof res === "number" || typeof res === "string" || typeof res === "boolean"
            ? res
            : undefined;
      if (!f && rv === undefined) return null;
      return { ...(f ? { f } : {}), ...(rv !== undefined ? { v: rv } : {}) };
    }
    if ("error" in v) return { v: String(v.error) };
    if ("text" in v) return { v: String((v as { text: unknown }).text) };
  }
  return { v: String(v) };
}

/** exceljs Workbook → a Univer workbook snapshot (the modeled subset). Sheet
 * ids are positional ("sheet-<i>") — applyModelToWorkbook keys off them. */
export function workbookToModel(wb: Workbook, name: string): SheetModel {
  const sheets: Record<string, SheetModelTab> = {};
  const sheetOrder: string[] = [];
  wb.worksheets.forEach((ws, i) => {
    const id = `sheet-${i}`;
    sheetOrder.push(id);
    const cellData: Record<number, Record<number, SheetModelCell>> = {};
    ws.eachRow({ includeEmpty: false }, (row, r) => {
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const val = valueToU(cell);
        const style = styleToU(cell);
        // a date value needs a date format to READ as a date in Univer
        const withFmt =
          cell.value instanceof Date && !style?.n
            ? { ...(style ?? {}), n: { pattern: "yyyy-mm-dd" } }
            : style;
        if (val || withFmt) {
          (cellData[r - 1] ??= {})[c - 1] = { ...(val ?? {}), ...(withFmt ? { s: withFmt } : {}) };
        }
      });
    });
    const columnData: Record<number, { w?: number }> = {};
    ws.columns?.forEach((col, c) => {
      if (col?.width) columnData[c] = { w: Math.round(col.width * PX_PER_CHAR) };
    });
    const rowData: Record<number, { h?: number }> = {};
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      if (row.height) rowData[r - 1] = { h: Math.round(row.height * PX_PER_PT) };
    });
    const mergeData: SheetModelMerge[] = [];
    for (const ref of (ws.model?.merges ?? []) as string[]) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
      if (!m || !m[1] || !m[2] || !m[3] || !m[4]) continue;
      mergeData.push({
        startRow: Number(m[2]) - 1,
        startColumn: colIndex(m[1]),
        endRow: Number(m[4]) - 1,
        endColumn: colIndex(m[3]),
      });
    }
    // pad just enough to add a few rows/cols — the old floor of 100×26 left a
    // small sheet swimming in empty grid (Seth, 2026-07-09). Used extent from
    // cellData, not exceljs's rowCount (which can inflate past real content).
    const usedRows = extentOf(cellData, "row");
    const usedCols = extentOf(cellData, "col");
    const view = ws.views?.[0];
    sheets[id] = {
      id,
      name: ws.name,
      cellData,
      ...(Object.keys(columnData).length ? { columnData } : {}),
      ...(Object.keys(rowData).length ? { rowData } : {}),
      ...(mergeData.length ? { mergeData } : {}),
      rowCount: Math.max(usedRows + GRID_ROW_PAD, usedRows > 0 ? usedRows + 1 : EMPTY_ROWS),
      columnCount: Math.max(usedCols + GRID_COL_PAD, usedCols > 0 ? usedCols + 1 : EMPTY_COLS),
      ...(view?.state === "frozen"
        ? {
            freeze: {
              xSplit: view.xSplit ?? 0,
              ySplit: view.ySplit ?? 0,
              startRow: -1,
              startColumn: -1,
            },
          }
        : {}),
    };
  });
  return { id: `rotli-${name}`, name, sheetOrder, sheets, styles: {} };
}

/** How many empty rows/cols to leave past the last used cell — room to type,
 * not a second spreadsheet of void. */
const GRID_ROW_PAD = 8;
const GRID_COL_PAD = 3;
/** Floor only when the sheet is empty (a brand-new workbook). */
const EMPTY_ROWS = 20;
const EMPTY_COLS = 8;

/** 1-based count of used rows or cols from a sparse cellData map (0 when empty). */
function extentOf(cellData: Record<number, Record<number, SheetModelCell>>, axis: "row" | "col"): number {
  let max = -1;
  for (const rk of Object.keys(cellData)) {
    const r = Number(rk);
    if (axis === "row") {
      if (r > max) max = r;
      continue;
    }
    const row = cellData[r];
    if (!row) continue;
    for (const ck of Object.keys(row)) {
      const c = Number(ck);
      if (c > max) max = c;
    }
  }
  return max + 1;
}

/** Pull the first sheet's values out of a Univer snapshot as plain string rows
 * — the csv SAVE path. Trailing empty rows/cols are trimmed so the pad we add
 * for editing never lands in the file. Styles/formulas are ignored (a csv
 * can't hold them); a formula cell contributes its cached result. */
export function csvRowsFromSnapshot(snap: SheetModel): string[][] {
  const id = snap.sheetOrder[0];
  if (!id) return [];
  const sh = snap.sheets[id];
  if (!sh?.cellData) return [];
  const usedRows = extentOf(sh.cellData, "row");
  const usedCols = extentOf(sh.cellData, "col");
  if (usedRows === 0 || usedCols === 0) return [];
  const rows: string[][] = [];
  for (let r = 0; r < usedRows; r++) {
    const row: string[] = [];
    const src = sh.cellData[r];
    for (let c = 0; c < usedCols; c++) {
      const cell = src?.[c];
      row.push(cellValueText(cell));
    }
    rows.push(row);
  }
  // drop trailing all-empty rows (Univer may keep cleared cells as {v:""})
  while (rows.length > 0 && rows[rows.length - 1]?.every((v) => v === "")) rows.pop();
  // drop trailing all-empty cols
  while (rows.length > 0 && rows.every((r) => r[r.length - 1] === "")) {
    for (const r of rows) r.pop();
  }
  return rows;
}

function cellValueText(cell: SheetModelCell | undefined): string {
  if (!cell) return "";
  const v = cell.v;
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

/** "A"→0, "Z"→25, "AA"→26 … */
export function colIndex(label: string): number {
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ── save: snapshot → the retained exceljs Workbook ───────────────────────────

/** Resolve a cell's style: an id into snapshot.styles, an inline object, or none. */
function resolveStyle(
  cell: SheetModelCell,
  styles: Record<string, SheetModelStyle> | undefined,
): SheetModelStyle | null {
  if (!cell.s) return null;
  if (typeof cell.s === "string") return styles?.[cell.s] ?? null;
  return cell.s;
}

function borderSideFromU(
  side: SheetBorderSide | undefined,
): { style: string; color?: { argb: string } } | undefined {
  if (!side) return undefined;
  const style = BORDER_FROM_U[side.s] ?? "thin";
  const argb = argbOf(side.cl?.rgb);
  return { style, ...(argb ? { color: { argb } } : {}) };
}

/** Write one snapshot cell (value + style) onto an exceljs cell. */
function applyCell(cell: Cell, u: SheetModelCell, styles: Record<string, SheetModelStyle> | undefined): void {
  // value: formulas carry the cached result; plain values write typed
  if (u.f) {
    const formula = u.f.replace(/^=/, "");
    const result = u.v;
    cell.value = result === undefined ? ({ formula } as CellValue) : ({ formula, result } as CellValue);
  } else if (u.v !== undefined) {
    cell.value = u.v;
  } else {
    cell.value = null;
  }

  const st = resolveStyle(u, styles);
  if (!st) {
    // a cell with no snapshot style sheds any modeled style it had
    cell.style = {};
    return;
  }
  cell.style = {}; // start clean — the snapshot is the whole modeled truth
  const font: Record<string, unknown> = {};
  if (st.bl === 1) font.bold = true;
  if (st.it === 1) font.italic = true;
  if (st.ul?.s === 1) font.underline = true;
  if (typeof st.fs === "number") font.size = st.fs;
  if (st.ff) font.name = st.ff;
  const clArgb = argbOf(st.cl?.rgb);
  if (clArgb) font.color = { argb: clArgb };
  if (Object.keys(font).length > 0) cell.font = font as Cell["font"];

  const bgArgb = argbOf(st.bg?.rgb);
  if (bgArgb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };

  const alignment: Record<string, unknown> = {};
  if (st.ht && HT_FROM_U[st.ht]) alignment.horizontal = HT_FROM_U[st.ht];
  if (st.vt && VT_FROM_U[st.vt]) alignment.vertical = VT_FROM_U[st.vt];
  if (st.tb === 3) alignment.wrapText = true;
  if (Object.keys(alignment).length > 0) cell.alignment = alignment as Cell["alignment"];

  if (st.bd) {
    const border: Record<string, unknown> = {};
    const t = borderSideFromU(st.bd.t);
    const b = borderSideFromU(st.bd.b);
    const l = borderSideFromU(st.bd.l);
    const r = borderSideFromU(st.bd.r);
    if (t) border.top = t;
    if (b) border.bottom = b;
    if (l) border.left = l;
    if (r) border.right = r;
    if (Object.keys(border).length > 0) cell.border = border as Cell["border"];
  }

  if (st.n?.pattern) cell.numFmt = st.n.pattern;
}

/** The persistent univer-sheet-id → exceljs worksheet-id registry a LIVE edit
 * session must thread through repeated saves: positional "sheet-<i>" ids stop
 * matching the workbook's order the moment a save removes a sheet, so the
 * SECOND save would write onto the wrong worksheet. Build it at load time. */
export function buildSheetIdMap(wb: Workbook, snap: SheetModel): Map<string, number> {
  const map = new Map<string, number>();
  snap.sheetOrder.forEach((id, i) => {
    const ws = wb.worksheets[i];
    if (ws) map.set(id, ws.id);
  });
  return map;
}

/** Apply a Univer snapshot back onto the RETAINED exceljs Workbook — mutate,
 * never regenerate, so unmodeled workbook features survive. Handles: cell
 * values/formulas/styles (incl. clearing cells the snapshot no longer has),
 * merges, column widths / row heights, freeze, sheet renames, sheets ADDED in
 * Univer, and sheets REMOVED in Univer. `idMap` (from buildSheetIdMap) keeps
 * repeated saves in one session correct through sheet adds/removes; it is
 * UPDATED in place. Without it, resolution falls back to positional ids
 * (correct for the first apply after a fresh load). */
export function applyModelToWorkbook(wb: Workbook, snap: SheetModel, idMap?: Map<string, number>): void {
  // STRUCTURAL GUARD before anything mutates (reviewer B2): the whole file's
  // fate hangs on this snapshot — a null/empty/inconsistent one (a failed
  // fwb.save(), a truncated park) must refuse loudly, never delete sheets.
  if (!snap || !Array.isArray(snap.sheetOrder) || snap.sheetOrder.length === 0 || !snap.sheets) {
    throw new Error("refusing to apply an empty or malformed snapshot — the file was not touched");
  }
  for (const id of snap.sheetOrder) {
    if (!snap.sheets[id]) {
      throw new Error(
        `refusing to apply: snapshot references a missing sheet (${id}) — the file was not touched`,
      );
    }
  }

  const originals = [...wb.worksheets]; // capture BEFORE adds/removes
  const claimed = new Set<Worksheet>();
  const resolve = (id: string, name: string): Worksheet => {
    // 1. the live-session registry (survives structural changes)
    const mapped = idMap?.get(id);
    if (mapped !== undefined) {
      const ws = originals.find((w) => w.id === mapped);
      if (ws) {
        claimed.add(ws);
        return ws;
      }
    }
    // 2. positional fallback — a fresh load's "sheet-<i>" convention
    if (!idMap) {
      const m = /^sheet-(\d+)$/.exec(id);
      if (m) {
        const ws = originals[Number(m[1])];
        if (ws) {
          claimed.add(ws);
          return ws;
        }
      }
    }
    // 3. Univer-created sheet — add (suffix on a name collision, exceljs throws)
    let ws: Worksheet;
    try {
      ws = wb.addWorksheet(name);
    } catch {
      ws = wb.addWorksheet(`${name} (2)`);
    }
    claimed.add(ws);
    idMap?.set(id, ws.id);
    return ws;
  };

  // — resolve every sheet FIRST, then rename in TWO PASSES (reviewer S3):
  //   exceljs's duplicate-name check is case-insensitive and includes the sheet
  //   itself, so a case-only rename ("sheet1"→"Sheet1") or a two-sheet name
  //   swap threw and made the whole session unsaveable. Pass 1 parks every
  //   to-be-renamed sheet on a unique temp name; pass 2 lands the real names.
  const resolved: { ws: Worksheet; usheet: SheetModelTab }[] = [];
  for (const id of snap.sheetOrder) {
    const usheet = snap.sheets[id];
    if (!usheet) continue; // unreachable after the guard; belt + braces
    resolved.push({ ws: resolve(id, usheet.name), usheet });
  }
  let tmp = 0;
  for (const { ws, usheet } of resolved) {
    if (ws.name !== usheet.name) ws.name = `~rotli-rename-${tmp++}~`;
  }
  for (const { ws, usheet } of resolved) {
    if (ws.name !== usheet.name) ws.name = usheet.name;
  }

  for (const { ws, usheet } of resolved) {
    // — merges: clear all, re-apply the snapshot's set
    for (const ref of [...((ws.model?.merges ?? []) as string[])]) {
      try {
        ws.unMergeCells(ref);
      } catch {
        /* an already-gone merge is fine */
      }
    }

    // — cells: write every snapshot cell; then CLEAR previously-occupied cells
    //   the snapshot no longer mentions (deleted content must actually delete)
    const priorRows = ws.rowCount;
    const priorCols = ws.columnCount;
    const cellData = usheet.cellData ?? {};
    for (const [rk, rowCells] of Object.entries(cellData)) {
      const r = Number(rk);
      for (const [ck, u] of Object.entries(rowCells)) {
        applyCell(ws.getRow(r + 1).getCell(Number(ck) + 1), u, snap.styles);
      }
    }
    for (let r = 1; r <= priorRows; r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= priorCols; c++) {
        if (cellData[r - 1]?.[c - 1]) continue;
        const cell = row.getCell(c);
        if (cell.value !== null && cell.value !== undefined) cell.value = null;
        if (cell.style && Object.keys(cell.style).length > 0) cell.style = {};
      }
    }

    // — merges (after cell writes so merged regions exist)
    for (const mg of usheet.mergeData ?? []) {
      try {
        ws.mergeCells(mg.startRow + 1, mg.startColumn + 1, mg.endRow + 1, mg.endColumn + 1);
      } catch {
        /* overlapping/stale merge specs must never kill the save */
      }
    }

    // — column widths / row heights
    for (const [ck, cd] of Object.entries(usheet.columnData ?? {})) {
      if (cd?.w) ws.getColumn(Number(ck) + 1).width = cd.w / PX_PER_CHAR;
    }
    for (const [rk, rd] of Object.entries(usheet.rowData ?? {})) {
      if (rd?.h) ws.getRow(Number(rk) + 1).height = rd.h / PX_PER_PT;
    }

    // — freeze panes
    const fz = usheet.freeze;
    if (fz && (fz.xSplit > 0 || fz.ySplit > 0)) {
      ws.views = [{ state: "frozen", xSplit: fz.xSplit, ySplit: fz.ySplit }];
    } else if (ws.views?.[0]?.state === "frozen") {
      ws.views = [];
    }
  }

  // — sheets deleted in Univer: an original worksheet no snapshot id claimed
  for (const ws of originals) {
    if (!claimed.has(ws)) {
      wb.removeWorksheet(ws.id);
      if (idMap) {
        for (const [uid, wid] of idMap) if (wid === ws.id) idMap.delete(uid);
      }
    }
  }
}
