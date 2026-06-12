// Recently OPENED notes (in-memory MRU) — the ⌘K palette's "Recent" group.
// UI state only; the panes store touches it whenever a note lands in a tab.

import { create } from "zustand";

const MRU_CAP = 24;

interface MruState {
  ids: string[];
}

export const useMruStore = create<MruState>(() => ({ ids: [] }));

export function touchMru(noteId: string): void {
  if (!noteId) return;
  useMruStore.setState((s) => ({
    ids: [noteId, ...s.ids.filter((id) => id !== noteId)].slice(0, MRU_CAP),
  }));
}
