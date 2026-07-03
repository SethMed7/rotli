// Back / Forward navigation history over OPENED NOTES (Seth #14, 2026-07-03) —
// the Google-style trail the top-bar ‹ › buttons walk. A linear stack with a
// cursor: opening a note truncates any forward entries and pushes; Back/Forward
// move the cursor and re-open the note WITHOUT recording (the suppress flag, or
// every Back would push a new entry and forward would be unreachable).
//
// In-memory only — a session's trail, never persisted. The pure reducers below
// are exported for tests; the store + the two side-effecting helpers wrap them.

import { create } from "zustand";

/** How many hops we keep before the oldest fall off the front. */
export const NAV_CAP = 100;

/** A pure nav trail: the note ids oldest→newest, and the cursor into them
 * (-1 only while empty). */
export interface NavState {
  stack: string[];
  index: number;
}

export const EMPTY_NAV: NavState = { stack: [], index: -1 };

/** Record a newly-opened note. Reopening the note already under the cursor is a
 * no-op (returns the SAME object). Otherwise any forward entries are dropped
 * (a new branch), the id is appended, and the front is trimmed to NAV_CAP. */
export function pushNav(s: NavState, id: string): NavState {
  if (!id) return s;
  if (s.index >= 0 && s.stack[s.index] === id) return s; // already here
  const trimmed = s.stack.slice(0, s.index + 1);
  trimmed.push(id);
  const overflow = Math.max(0, trimmed.length - NAV_CAP);
  const stack = overflow ? trimmed.slice(overflow) : trimmed;
  return { stack, index: stack.length - 1 };
}

export function canBack(s: NavState): boolean {
  return s.index > 0;
}

export function canForward(s: NavState): boolean {
  return s.index >= 0 && s.index < s.stack.length - 1;
}

export function backId(s: NavState): string | null {
  return canBack(s) ? (s.stack[s.index - 1] ?? null) : null;
}

export function forwardId(s: NavState): string | null {
  return canForward(s) ? (s.stack[s.index + 1] ?? null) : null;
}

/** Move the cursor one hop; a hop past either end is a no-op (same object). */
export function stepNav(s: NavState, dir: -1 | 1): NavState {
  const next = s.index + dir;
  if (next < 0 || next >= s.stack.length) return s;
  return { ...s, index: next };
}

interface NavStore extends NavState {
  /** True while a Back/Forward re-open is in flight, so recordNav ignores the
   * openNote it triggers (that navigation must move the cursor, not push). */
  suppress: boolean;
}

export const useNavHistory = create<NavStore>(() => ({ ...EMPTY_NAV, suppress: false }));

/** Called from panes.openNote for every note that lands in a tab. A no-op while
 * a Back/Forward is replaying (the suppress flag) or when nothing changes. */
export function recordNav(id: string): void {
  const s = useNavHistory.getState();
  if (s.suppress) return;
  const next = pushNav(s, id);
  if (next !== s) useNavHistory.setState(next);
}

/** Walk one hop and re-open the note there via `open` (the panes store's
 * openNote, passed in to keep this module free of a panes import → no import
 * cycle). Suppresses the recordNav that `open` triggers so the cursor moves in
 * place instead of branching. */
export function navigate(dir: -1 | 1, open: (id: string) => void): void {
  const s = useNavHistory.getState();
  const id = dir === -1 ? backId(s) : forwardId(s);
  if (!id) return;
  useNavHistory.setState({ ...stepNav(s, dir), suppress: true });
  try {
    open(id);
  } finally {
    useNavHistory.setState({ suppress: false });
  }
}
