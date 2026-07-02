// GFM table detection (Seth, 2026-06-27) — finds markdown tables so the editor can
// render them beautified (tableRender.ts) and livePreview can leave their lines
// alone, exactly the way fenced code blocks work (fences.ts). A table is a header
// row of `|`-separated cells, a delimiter row (`---`/`:--`/`--:`/`:-:`), then zero
// or more data rows — ending at a blank line or any non-`|` line.

import type { Text } from "@codemirror/state";
import { lineInFence, scanFences } from "./fences";

export type Align = "left" | "right" | "center" | "";

export interface TableBlock {
  from: number; // doc offset of the table's first char
  to: number; // doc offset of the last cell row's line end
  header: string[];
  align: Align[];
  rows: string[][];
}

const looksLikeRow = (s: string) => s.includes("|") && s.trim().length > 0;

/** A delimiter row: each cell is dashes with optional leading/trailing colons. */
function parseDelimiter(s: string): Align[] | null {
  const t = s.trim();
  if (!/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t)) return null;
  const cells = splitRow(t);
  if (cells.length === 0) return null;
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/** Split a `| a | b |` row into trimmed cells, dropping the empty edges that the
 * optional leading/trailing pipes produce. */
export function splitRow(s: string): string[] {
  const cells = s.trim().split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** All GFM tables in the doc, in order. Fenced code is OPAQUE: a pipe-table
 * example inside ANY ``` fence is the user's code, never a live widget whose
 * chips would rewrite it (#13, audit 2026-07) — so a header line inside a
 * fence can't start a table. */
export function scanTables(doc: Text): TableBlock[] {
  const out: TableBlock[] = [];
  const fences = scanFences(doc);
  const total = doc.lines;
  let n = 1;
  while (n < total) {
    const headLine = doc.line(n);
    const delimLine = doc.line(n + 1);
    if (looksLikeRow(headLine.text) && !lineInFence(headLine.from, fences)) {
      const align = parseDelimiter(delimLine.text);
      const header = splitRow(headLine.text);
      if (align && header.length > 0) {
        // gather data rows until a blank / non-row line
        const rows: string[][] = [];
        let last = n + 1;
        let r = n + 2;
        while (r <= total) {
          const t = doc.line(r).text;
          if (!looksLikeRow(t)) break;
          rows.push(splitRow(t));
          last = r;
          r++;
        }
        out.push({
          from: headLine.from,
          to: doc.line(last).to,
          header,
          align,
          rows,
        });
        n = last + 1;
        continue;
      }
    }
    n++;
  }
  return out;
}

/** True when a line (by its `from` offset) sits inside any detected table. */
export function lineInTable(lineFrom: number, tables: TableBlock[]): boolean {
  return tables.some((t) => lineFrom >= t.from && lineFrom <= t.to);
}

// ─── structured table ops (Seth, 2026-07-01) ────────────────────────────────
// Pure transforms over the parsed shape — the widget's row/col menus, the slash
// menu's insert, and the Tab-appends-a-row keymap all funnel through these, and
// the caller dispatches ONE text transaction over [t.from, t.to]. Serialization
// pads cells to equal width so raw mode stays readable — a deliberate content
// edit via these ops only, never a background reformat.

/** The offset-free part of a TableBlock (what the transforms operate on). */
export interface TableShape {
  header: string[];
  align: Align[];
  rows: string[][];
}

/** A cell's content span (trimmed) as char offsets WITHIN its source line —
 * cell indices match splitRow's. Empty cells get a caret slot after their pipe. */
export interface CellSpan {
  start: number;
  end: number;
}

export function cellSpansOf(line: string): CellSpan[] {
  // walk the raw line splitting on `|` (splitRow's grammar) but keeping offsets
  const segs: { s: number; e: number }[] = [];
  let start = 0;
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === "|") {
      segs.push({ s: start, e: i });
      start = i + 1;
    }
  }
  const blank = (g: { s: number; e: number }) => line.slice(g.s, g.e).trim() === "";
  // drop the empty edge segments the optional leading/trailing pipes produce
  if (segs.length > 0 && blank(segs[0]!)) segs.shift();
  if (segs.length > 0 && blank(segs[segs.length - 1]!)) segs.pop();
  return segs.map(({ s, e }) => {
    const raw = line.slice(s, e);
    const trimmed = raw.trim();
    if (trimmed === "") {
      const pos = s + Math.min(1, raw.length); // just past "| " in an empty cell
      return { start: pos, end: pos };
    }
    const lead = raw.length - raw.trimStart().length;
    return { start: s + lead, end: s + lead + trimmed.length };
  });
}

function delimCell(a: Align, w: number): string {
  const dashes = (n: number) => "-".repeat(Math.max(3, n));
  if (a === "center") return `:${dashes(w - 2)}:`;
  if (a === "right") return `${dashes(w - 1)}:`;
  if (a === "left") return `:${dashes(w - 1)}`;
  return dashes(w);
}

/** Serialize a shape back to markdown (no trailing newline). Rows are normalized
 * to the header's column count; columns pad to their widest cell. */
export function tableToText(t: TableShape): string {
  const cols = Math.max(1, t.header.length);
  const norm = (r: string[]) => Array.from({ length: cols }, (_, i) => r[i] ?? "");
  const header = norm(t.header);
  const rows = t.rows.map(norm);
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.max(3, header[i]?.length ?? 0, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 3)).join(" | ")} |`;
  const delim = `| ${widths.map((w, i) => delimCell(t.align[i] ?? "", w)).join(" | ")} |`;
  return [line(header), delim, ...rows.map(line)].join("\n");
}

/** A fresh `cols`×`rows` scaffold (empty cells) — the slash menu's Table. */
export function insertTableText(cols = 3, rows = 2): string {
  const empty = Array.from({ length: cols }, () => "");
  return tableToText({
    header: [...empty],
    align: Array.from({ length: cols }, () => "" as Align),
    rows: Array.from({ length: rows }, () => [...empty]),
  });
}

const emptyRow = (cols: number) => Array.from({ length: cols }, () => "");

/** Insert an empty data row below data row `i` (i = -1 → first data row). */
export function addRowBelow(t: TableShape, i: number): TableShape {
  const rows = [...t.rows];
  const at = Math.max(0, Math.min(rows.length, i + 1));
  rows.splice(at, 0, emptyRow(t.header.length));
  return { ...t, rows };
}

/** Delete data row `i`; null when it doesn't exist (header can't be deleted). */
export function deleteRow(t: TableShape, i: number): TableShape | null {
  if (i < 0 || i >= t.rows.length) return null;
  return { ...t, rows: t.rows.filter((_, r) => r !== i) };
}

/** Swap data row `i` with its neighbour; null at the edges. */
export function moveRow(t: TableShape, i: number, dir: -1 | 1): TableShape | null {
  const j = i + dir;
  if (i < 0 || i >= t.rows.length || j < 0 || j >= t.rows.length) return null;
  const rows = [...t.rows];
  const a = rows[i]!;
  rows[i] = rows[j]!;
  rows[j] = a;
  return { ...t, rows };
}

/** Insert an empty column right of column `i` (i = -1 → leftmost). */
export function addColRight(t: TableShape, i: number): TableShape {
  const at = Math.max(0, Math.min(t.header.length, i + 1));
  const ins = <T,>(arr: T[], v: T): T[] => [...arr.slice(0, at), v, ...arr.slice(at)];
  return {
    header: ins(t.header, ""),
    align: ins(t.align, "" as Align),
    rows: t.rows.map((r) => ins(r, "")),
  };
}

/** Delete column `i`; null when it's the only column (that would kill the table). */
export function deleteCol(t: TableShape, i: number): TableShape | null {
  if (i < 0 || i >= t.header.length || t.header.length <= 1) return null;
  const cut = <T,>(arr: T[]): T[] => arr.filter((_, c) => c !== i);
  return { header: cut(t.header), align: cut(t.align), rows: t.rows.map(cut) };
}

/** Swap column `i` with its neighbour; null at the edges. */
export function moveCol(t: TableShape, i: number, dir: -1 | 1): TableShape | null {
  const j = i + dir;
  if (i < 0 || i >= t.header.length || j < 0 || j >= t.header.length) return null;
  const swap = <T,>(arr: T[]): T[] => {
    const out = [...arr];
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
    return out;
  };
  return {
    header: swap(t.header),
    align: swap(t.align),
    rows: t.rows.map((r) => swap(Array.from({ length: t.header.length }, (_, c) => r[c] ?? ""))),
  };
}

/** Set column `i`'s alignment (rewrites the delimiter cell on serialize). */
export function setColAlign(t: TableShape, i: number, align: Align): TableShape {
  const a = Array.from({ length: t.header.length }, (_, c) => t.align[c] ?? "");
  if (i < 0 || i >= a.length) return t;
  a[i] = align;
  return { ...t, align: a };
}

// ─── cell navigation (Tab / ⇧Tab / Enter hop cells; cmKeymap drives this) ────

/** A cell address: row -1 = the header row, 0.. = data rows. */
export interface CellRef {
  row: number;
  col: number;
}

/** The next/previous cell in reading order, or null past either end (Tab past
 * the last cell appends a row — the caller's job, via addRowBelow). */
export function nextCell(t: TableShape, ref: CellRef, dir: 1 | -1): CellRef | null {
  const cols = Math.max(1, t.header.length);
  const idx = (ref.row + 1) * cols + Math.min(ref.col, cols - 1) + dir;
  if (idx < 0 || idx >= (t.rows.length + 1) * cols) return null;
  return { row: Math.floor(idx / cols) - 1, col: idx % cols };
}
