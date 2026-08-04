// Live chat-run signals for the sidebar (Seth, 2026-08-03: "some sort of
// loading on the left sidebar for when the chat is loading and completed —
// that way I know to click on it"). One tiny in-memory store: a chat is
// `running` while its turn is in flight and `unread` when the reply settled
// while the user was looking elsewhere. Keys are the vault-scoped chatKey
// (`<instanceId>:<slug>`, or `unsaved:<paneId>` before the first save binds).
// Deliberately NOT persisted: the transcript on disk is the durable truth —
// these are session signals, and a relaunch starts quiet.

import { create } from "zustand";

export type ChatRunState = "running" | "unread";

interface ChatRunsState {
  runs: Record<string, ChatRunState>;
  /** A turn took off — the sidebar row starts its pulse. */
  markRunning: (key: string) => void;
  /** The turn settled. `seen` = the surface was still mounted (the user watched
   * the answer arrive) — clears; otherwise the row flips to `unread`. */
  settleRun: (key: string, seen: boolean) => void;
  /** The first save binds an unsaved pane key to its real slug key. */
  retargetRun: (oldKey: string, newKey: string) => void;
  /** Opening the chat spends its unread flag (a running one keeps pulsing). */
  clearUnread: (key: string) => void;
}

export const useChatRuns = create<ChatRunsState>((set, get) => ({
  runs: {},
  markRunning: (key) => {
    if (get().runs[key] === "running") return;
    set({ runs: { ...get().runs, [key]: "running" } });
  },
  settleRun: (key, seen) => {
    const runs = { ...get().runs };
    if (seen) {
      if (!(key in runs)) return;
      delete runs[key];
    } else {
      runs[key] = "unread";
    }
    set({ runs });
  },
  retargetRun: (oldKey, newKey) => {
    const state = get().runs[oldKey];
    if (state === undefined || oldKey === newKey) return;
    const runs = { ...get().runs };
    delete runs[oldKey];
    runs[newKey] = state;
    set({ runs });
  },
  clearUnread: (key) => {
    if (get().runs[key] !== "unread") return;
    const runs = { ...get().runs };
    delete runs[key];
    set({ runs });
  },
}));
