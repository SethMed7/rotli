// Live chat-run signals for the sidebar (the maintainer, 2026-08-03: "some sort of
// loading on the left sidebar for when the chat is loading and completed —
// that way I know to click on it"). One tiny in-memory store: a chat is
// `running` while its turn is in flight, `unread` when the reply settled while
// the user was looking elsewhere, and `done` after it has been acknowledged.
// Keys are the vault-scoped chatKey
// (`<instanceId>:<slug>`, or `unsaved:<tabId>` before the first save binds).
// Deliberately NOT persisted: the transcript on disk is the durable truth —
// these are session signals, and a relaunch starts quiet.

import { create } from "zustand";

export type ChatRunState = "running" | "unread" | "done";

interface ChatRunsState {
  runs: Record<string, ChatRunState>;
  /** Bumped once a turn's reply is on disk (2026-09-16: a surface that
   * remounted mid-run showed the user's message alone until the tab was
   * reopened — the run had settled and persisted into a closure the new
   * mount never heard from). A mounted surface that does not own the run
   * rereads the transcript when its key's count changes. */
  persisted: Record<string, number>;
  /** The reply landed on disk; returns the new count so the owning surface
   * can tell its own persist from a foreign one. */
  markPersisted: (key: string) => number;
  /** When each key last settled and last persisted (ms). A mounted surface
   * that did not own the run holds its composer between the two, so a send
   * cannot read a thread that lacks the answer (review 2026-09-16). */
  settledAt: Record<string, number>;
  persistedAt: Record<string, number>;
  /** Bumped a grace period after a settle so subscribers re-evaluate the hold
   * even when nothing else changes (a failed run never persists). */
  graceTick: number;
  /** A turn took off — the sidebar row shows its static working mark. */
  markRunning: (key: string) => void;
  /** The turn settled. `seen` = the surface was still mounted (the user watched
   * the answer arrive) — done; otherwise the row flips to `unread`. */
  settleRun: (key: string, seen: boolean) => void;
  /** The first save binds an unsaved tab key to its real slug key. */
  retargetRun: (oldKey: string, newKey: string) => void;
  /** Opening the chat acknowledges unread as done (a live run stays marked). */
  clearUnread: (key: string) => void;
}

/** How long a settled-but-unpersisted run holds a foreign composer. A reply
 * that fails is never persisted, so the hold must release on its own. */
export const REPLY_HOLD_GRACE_MS = 5_000;

/** True while a key's last settle has not been followed by a persist, within
 * the grace period. Pure over the store's state; the surface pairs it with
 * "not my own run". */
export function replyPending(
  state: Pick<ChatRunsState, "runs" | "settledAt" | "persistedAt">,
  key: string,
  now: number,
): boolean {
  const settled = state.settledAt[key];
  if (settled === undefined || state.runs[key] === "running") return false;
  if ((state.persistedAt[key] ?? 0) >= settled) return false;
  return now - settled < REPLY_HOLD_GRACE_MS;
}

export const useChatRuns = create<ChatRunsState>((set, get) => ({
  runs: {},
  persisted: {},
  settledAt: {},
  persistedAt: {},
  graceTick: 0,
  markPersisted: (key) => {
    const next = (get().persisted[key] ?? 0) + 1;
    set({
      persisted: { ...get().persisted, [key]: next },
      persistedAt: { ...get().persistedAt, [key]: Date.now() },
    });
    return next;
  },
  markRunning: (key) => {
    if (get().runs[key] === "running") return;
    set({ runs: { ...get().runs, [key]: "running" } });
  },
  settleRun: (key, seen) => {
    const runs = { ...get().runs };
    if (seen) {
      if (!(key in runs)) return;
      runs[key] = "done";
    } else {
      runs[key] = "unread";
    }
    set({ runs, settledAt: { ...get().settledAt, [key]: Date.now() } });
    setTimeout(() => set((s) => ({ graceTick: s.graceTick + 1 })), REPLY_HOLD_GRACE_MS + 50);
  },
  retargetRun: (oldKey, newKey) => {
    const state = get().runs[oldKey];
    if (state === undefined || oldKey === newKey) return;
    const runs = { ...get().runs };
    delete runs[oldKey];
    runs[newKey] = state;
    const persisted = { ...get().persisted };
    if (oldKey in persisted) {
      persisted[newKey] = (persisted[newKey] ?? 0) + (persisted[oldKey] ?? 0);
      delete persisted[oldKey];
    }
    // the timing maps move with the key too: replyPending() reads them, and a
    // hold left on the old unsaved key would release the composer early
    const moveStamp = (map: Record<string, number>): Record<string, number> => {
      if (!(oldKey in map)) return map;
      const next = { ...map };
      next[newKey] = Math.max(next[newKey] ?? 0, next[oldKey] ?? 0);
      delete next[oldKey];
      return next;
    };
    set({
      runs,
      persisted,
      settledAt: moveStamp(get().settledAt),
      persistedAt: moveStamp(get().persistedAt),
    });
  },
  clearUnread: (key) => {
    if (get().runs[key] !== "unread") return;
    const runs = { ...get().runs };
    runs[key] = "done";
    set({ runs });
  },
}));
