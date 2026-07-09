// The exceljs ⇄ Univer bridge (Phase 1 of the engine adoption, 2026-07-09).
//
// rotli's law: THE FILE ON DISK IS THE TRUTH, and exceljs is the disk codec.
// Univer (the free Apache-2.0 preset) is only the interaction surface — it gets
// a JSON model (IWorkbookData) on load and hands back a snapshot on save. This
// module is that boundary, pure in both directions:
//
//   load:  workbookToUniverData(wb)          exceljs Workbook → snapshot JSON
//   save:  applySnapshotToWorkbook(wb, snap) snapshot JSON → MUTATE the retained
//                                            Workbook (never regenerate), then
//                                            the caller writeBuffer()s it.
//
// Mutate-don't-regenerate is the fidelity trick: workbook-level features the
// bridge doesn't model (pivots, charts, defined names, properties) survive
// untouched because exceljs preserves what we don't touch. Cell-level content
// is rewritten from the snapshot (values, formulas, styles, merges, sizes,
// freeze, number formats — the modeled subset).
//
// The types below are STRUCTURAL mirrors of Univer's wire shapes (IWorkbookData
// / IStyleData enums), kept local so this module + its tests never import the
// Univer runtime and can't drift with its 0.x type churn; UniverSpike casts at
// the createUniver boundary. Known P1 limits: cell comments/hyperlinks aren't
// modeled (cleared cells lose them), rich text flattens to plain text, and
// structural row/col moves rewrite content by position.

import type { Borders, Cell, CellValue, Workbook, Worksheet } from "exceljs";
import { hexFromArgb } from "./sheetEdit";

// ── Univer wire shapes (structural) ───────────────────────────────────────────

export interface UBorderSide {
  s: number; // BorderStyleTypes
  cl?: { rgb: string };
}
export interface UStyle {
  bl?: 0 | 1; // bold
  it?: 0 | 1; // italic
  ul?: { s: 0 | 1 }; // underline
  fs?: number; // font size (pt)
  ff?: string; // font family
  cl?: { rgb: string } | null; // text color
  bg?: { rgb: string } | null; // fill
  ht?: 0 | 1 | 2 | 3; // horizontal: 1 left · 2 center · 3 right
  vt?: 0 | 1 | 2 | 3; // vertical: 1 top · 2 middle · 3 bottom
  tb?: 1 | 2 | 3; // wrap strategy: 3 = wrap
  bd?: { t?: UBorderSide; b?: UBorderSide; l?: UBorderSide; r?: UBorderSide };
  n?: { pattern: string }; // number format
}
export interface UCell {
  v?: string | number | boolean;
  f?: string; // formula WITH the leading "="
  s?: string | UStyle | null; // style id (into snapshot.styles) or inline
  t?: number; // CellValueType (1 string · 2 number · 3 boolean)
}
export interface UMerge {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}
export interface USheet {
  id: string;
  name: string;
  cellData?: Record<number, Record<number, UCell>>;
  rowCount?: number;
  columnCount?: number;
  columnData?: Record<number, { w?: number }>;
  rowData?: Record<number, { h?: number }>;
  mergeData?: UMerge[];
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number };
}
export interface USnapshot {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, USheet>;
  styles?: Record<string, UStyle>;
  locale?: string;
}

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

function borderSideToU(side: Partial<Borders>[keyof Borders] | undefined): UBorderSide | undefined {
  if (!side?.style) return undefined;
  const s = BORDER_TO_U[side.style] ?? 1;
  const cl = rgbOf(side.color?.argb);
  return { s, ...(cl ? { cl } : {}) };
}

/** The full modeled style of one exceljs cell as an inline Univer style. */
function styleToU(cell: Cell): UStyle | null {
  const st: UStyle = {};
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
    const bd: NonNullable<UStyle["bd"]> = {};
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
function valueToU(cell: Cell): UCell | null {
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
 * ids are positional ("sheet-<i>") — applySnapshotToWorkbook keys off them. */
export function workbookToUniverData(wb: Workbook, name: string): USnapshot {
  const sheets: Record<string, USheet> = {};
  const sheetOrder: string[] = [];
  wb.worksheets.forEach((ws, i) => {
    const id = `sheet-${i}`;
    sheetOrder.push(id);
    const cellData: Record<number, Record<number, UCell>> = {};
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
    const mergeData: UMerge[] = [];
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
    const view = ws.views?.[0];
    sheets[id] = {
      id,
      name: ws.name,
      cellData,
      ...(Object.keys(columnData).length ? { columnData } : {}),
      ...(Object.keys(rowData).length ? { rowData } : {}),
      ...(mergeData.length ? { mergeData } : {}),
      rowCount: Math.max(ws.rowCount + 40, 100),
      columnCount: Math.max(ws.columnCount + 8, 26),
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

/** "A"→0, "Z"→25, "AA"→26 … (inverse of sheetEdit's colLabel). */
export function colIndex(label: string): number {
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ── save: snapshot → the retained exceljs Workbook ───────────────────────────

/** Resolve a cell's style: an id into snapshot.styles, an inline object, or none. */
function resolveStyle(cell: UCell, styles: Record<string, UStyle> | undefined): UStyle | null {
  if (!cell.s) return null;
  if (typeof cell.s === "string") return styles?.[cell.s] ?? null;
  return cell.s;
}

function borderSideFromU(side: UBorderSide | undefined):
  | { style: string; color?: { argb: string } }
  | undefined {
  if (!side) return undefined;
  const style = BORDER_FROM_U[side.s] ?? "thin";
  const argb = argbOf(side.cl?.rgb);
  return { style, ...(argb ? { color: { argb } } : {}) };
}

/** Write one snapshot cell (value + style) onto an exceljs cell. */
function applyCell(cell: Cell, u: UCell, styles: Record<string, UStyle> | undefined): void {
  // value: formulas carry the cached result; plain values write typed
  if (u.f) {
    const formula = u.f.replace(/^=/, "");
    const result = u.v;
    cell.value =
      result === undefined
        ? ({ formula } as CellValue)
        : ({ formula, result } as CellValue);
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
export function buildSheetIdMap(wb: Workbook, snap: USnapshot): Map<string, number> {
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
export function applySnapshotToWorkbook(
  wb: Workbook,
  snap: USnapshot,
  idMap?: Map<string, number>,
): void {
  // STRUCTURAL GUARD before anything mutates (reviewer B2): the whole file's
  // fate hangs on this snapshot — a null/empty/inconsistent one (a failed
  // fwb.save(), a truncated park) must refuse loudly, never delete sheets.
  if (!snap || !Array.isArray(snap.sheetOrder) || snap.sheetOrder.length === 0 || !snap.sheets) {
    throw new Error("refusing to apply an empty or malformed snapshot — the file was not touched");
  }
  for (const id of snap.sheetOrder) {
    if (!snap.sheets[id]) {
      throw new Error(`refusing to apply: snapshot references a missing sheet (${id}) — the file was not touched`);
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
  const resolved: { ws: Worksheet; usheet: USheet }[] = [];
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
