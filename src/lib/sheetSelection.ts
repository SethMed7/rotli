// Pure selection model for the editable spreadsheet grid (SheetEditor, Phase B).
// A selection is a rectangle (anchor→focus) plus ⌘-added discontiguous `extra`
// cells, or a whole column. IO-free, so it unit-tests directly.

export interface CellRef {
  r: number;
  c: number;
}

/** A rectangle (anchor→focus) + ⌘-added discontiguous `extra` cells − ⌘-removed
 * in-rectangle `holes`, or a whole column. A single cell is a range where
 * anchor === focus. `holes` lets ⌘-click punch a cell OUT of the rectangle
 * (polish, 2026-07-08 — the Phase-B model couldn't deselect inside the rect). */
export type Sel =
  | { kind: "range"; anchor: CellRef; focus: CellRef; extra: CellRef[]; holes: CellRef[] }
  | { kind: "col"; c: number };

/** A one-cell range — the default click / collapse selection. */
export const cellSel = (r: number, c: number): Sel => ({
  kind: "range",
  anchor: { r, c },
  focus: { r, c },
  extra: [],
  holes: [],
});

/** The active cell (where typing/editing lands) — a range's focus. */
export function activeCell(sel: Sel | null): CellRef | null {
  return sel?.kind === "range" ? sel.focus : null;
}

/** Normalized rectangle bounds of anchor→focus (inclusive). */
export function rangeBounds(a: CellRef, b: CellRef) {
  return {
    r1: Math.min(a.r, b.r),
    r2: Math.max(a.r, b.r),
    c1: Math.min(a.c, b.c),
    c2: Math.max(a.c, b.c),
  };
}

const at = (list: CellRef[], r: number, c: number) => list.some((e) => e.r === r && e.c === c);

/** Is (r,c) inside the selection — (rectangle − holes) ∪ extra, or the column? */
export function selHas(sel: Sel | null, r: number, c: number): boolean {
  if (!sel) return false;
  if (sel.kind === "col") return sel.c === c;
  const { r1, r2, c1, c2 } = rangeBounds(sel.anchor, sel.focus);
  if (r >= r1 && r <= r2 && c >= c1 && c <= c2) return !at(sel.holes, r, c);
  return at(sel.extra, r, c);
}

/** Every distinct cell of a RANGE selection ((rectangle − holes) ∪ extra). */
export function rangeCells(sel: Extract<Sel, { kind: "range" }>): CellRef[] {
  const { r1, r2, c1, c2 } = rangeBounds(sel.anchor, sel.focus);
  const out: CellRef[] = [];
  for (let r = r1; r <= r2; r++)
    for (let c = c1; c <= c2; c++) if (!at(sel.holes, r, c)) out.push({ r, c });
  for (const e of sel.extra) {
    if (!(e.r >= r1 && e.r <= r2 && e.c >= c1 && e.c <= c2)) out.push(e);
  }
  return out;
}

/** ⌘-click: toggle one cell's membership. Inside the rectangle it toggles a
 * hole; outside it toggles an `extra` — and either branch SCRUBS the cell from
 * the opposite list, so a stale hole can never silently undo a later re-add
 * after the rectangle moved over it (reviewer, polish pass). Pure. */
export function toggleCell(sel: Extract<Sel, { kind: "range" }>, r: number, c: number): Sel {
  const { r1, r2, c1, c2 } = rangeBounds(sel.anchor, sel.focus);
  const inRect = r >= r1 && r <= r2 && c >= c1 && c <= c2;
  const strip = (list: CellRef[]) => list.filter((e) => !(e.r === r && e.c === c));
  if (inRect) {
    return {
      ...sel,
      holes: at(sel.holes, r, c) ? strip(sel.holes) : [...strip(sel.holes), { r, c }],
      extra: strip(sel.extra),
    };
  }
  return {
    ...sel,
    extra: at(sel.extra, r, c) ? strip(sel.extra) : [...strip(sel.extra), { r, c }],
    holes: strip(sel.holes),
  };
}
