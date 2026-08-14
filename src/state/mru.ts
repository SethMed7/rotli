// Recently OPENED notes (in-memory MRU) — the ⌘K palette's "Recent" group.
// UI state only; the panes store touches it whenever a note lands in a tab.

import { create } from "zustand";

export const MRU_CAP = 24;
export const ACTIVITY_CAP = 4096;

interface MruState {
  ids: string[];
  /** UI activity only. Opening an item must not rewrite its durable file just
   * to keep an automatic-retention clock fresh. */
  itemTouchedAt: Record<string, number>;
  chatTouchedAt: Record<string, number>;
}

export const useMruStore = create<MruState>(() => ({ ids: [], itemTouchedAt: {}, chatTouchedAt: {} }));

function withTouch(values: Record<string, number>, key: string, at: number): Record<string, number> {
  const entries = Object.entries({ ...values, [key]: at });
  if (entries.length <= ACTIVITY_CAP) return Object.fromEntries(entries);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, ACTIVITY_CAP));
}

export function touchItemActivity(itemId: string, at = Date.now()): void {
  if (!itemId) return;
  useMruStore.setState((s) => ({ itemTouchedAt: withTouch(s.itemTouchedAt, itemId, at) }));
}

/** Chat keys are vault-qualified (`<instance-id>:<slug>`) so equal filenames
 * in two connected vaults never refresh one another's retention clock. */
export function touchChatActivity(chatKey: string, at = Date.now()): void {
  if (!chatKey) return;
  useMruStore.setState((s) => ({ chatTouchedAt: withTouch(s.chatTouchedAt, chatKey, at) }));
}

export function touchMru(noteId: string): void {
  if (!noteId) return;
  useMruStore.setState((s) => ({
    ids: [noteId, ...s.ids.filter((id) => id !== noteId)].slice(0, MRU_CAP),
    itemTouchedAt: withTouch(s.itemTouchedAt, noteId, Date.now()),
  }));
}
