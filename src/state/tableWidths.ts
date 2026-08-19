// Per-table COLUMN WIDTHS + ROW HEIGHTS (the maintainer, 2026-07-30/31: "resize the
// sections via a click and drag" — rows joined columns 2026-07-31). View
// state, never content: the .md never carries sizes — they live in
// .rotli/settings.json via persist.ts like the per-note Aa layer, keyed by
// note id + a position-independent table signature, and pruned when the note
// dies. Deleting the sidecar simply returns tables to auto layout.

import { create } from "zustand";

/** noteId ⊕ table signature. The signature is the header row plus an
 * occurrence counter, so the key survives the table MOVING within the note and
 * duplicate-header tables stay distinct. */
export function tableWidthKey(noteId: string, signature: string): string {
  return `${noteId}\u0000${signature}`;
}

export function noteIdOfWidthKey(key: string): string {
  const cut = key.indexOf("\u0000");
  return cut < 0 ? key : key.slice(0, cut);
}

export const MIN_TABLE_COL_PX = 56;
export const MIN_TABLE_ROW_PX = 26;

interface TableWidthsState {
  widths: Record<string, number[]>;
  /** Per-table row heights, same key + rules as widths: index 0 is the header
   * row when the table has one, then the body rows in order. */
  heights: Record<string, number[]>;
  /** null clears back to auto layout. Values clamp to the column minimum. */
  setTableWidths: (key: string, cols: number[] | null) => void;
  setTableHeights: (key: string, rows: number[] | null) => void;
}

export const useTableWidthsStore = create<TableWidthsState>((set) => ({
  widths: {},
  heights: {},
  setTableWidths: (key, cols) =>
    set((state) => {
      const widths = { ...state.widths };
      if (cols === null) delete widths[key];
      else widths[key] = cols.map((w) => Math.max(MIN_TABLE_COL_PX, Math.round(w)));
      return { widths };
    }),
  setTableHeights: (key, rows) =>
    set((state) => {
      const heights = { ...state.heights };
      if (rows === null) delete heights[key];
      else heights[key] = rows.map((h) => Math.max(MIN_TABLE_ROW_PX, Math.round(h)));
      return { heights };
    }),
}));
