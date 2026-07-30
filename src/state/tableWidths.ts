// Per-table COLUMN WIDTHS (Seth, 2026-07-30: "resize the sections via a click
// and drag"). View state, never content: the .md never carries widths — they
// live in .rotli/settings.json via persist.ts like the per-note Aa layer, keyed
// by note id + a position-independent table signature, and pruned when the
// note dies. Deleting the sidecar simply returns tables to auto layout.

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

interface TableWidthsState {
  widths: Record<string, number[]>;
  /** null clears back to auto layout. Values clamp to the column minimum. */
  setTableWidths: (key: string, cols: number[] | null) => void;
}

export const useTableWidthsStore = create<TableWidthsState>((set) => ({
  widths: {},
  setTableWidths: (key, cols) =>
    set((state) => {
      const widths = { ...state.widths };
      if (cols === null) delete widths[key];
      else widths[key] = cols.map((w) => Math.max(MIN_TABLE_COL_PX, Math.round(w)));
      return { widths };
    }),
}));
