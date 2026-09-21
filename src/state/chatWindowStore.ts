// Whether Chat lives in its own window right now, and what is open there.
// Deliberately free of state/panes.ts: panes.openChat asks `chatWindowTakes`,
// and the effects (state/chatWindow.ts) drive panes — one direction, no cycle.

import { create } from "zustand";

import { sendChatWindow, showChatWindow } from "../lib/chatWindowBridge";
import { type ChatTabRef, uniqueChatRefs } from "./chatWindowTabs";

/** Which webview this is. Duplicated two-liner (state/main.ts has its twin) —
 * importing it from persist.ts would cycle. */
export function windowSurface(): string {
  if (typeof window === "undefined") return "main"; // bun tests have no window
  return new URLSearchParams(window.location.search).get("window") ?? "main";
}

interface ChatWindowState {
  /** MAIN's view of the world: Chat is popped out. Session-only — a relaunch
   * always starts regrouped (the saved layout already holds the chats). */
  detached: boolean;
  /** The saved chats open in the chat window, as it last reported them. */
  refs: ChatTabRef[];
  setDetached: (detached: boolean) => void;
  setRefs: (refs: readonly ChatTabRef[]) => void;
}

export const useChatWindowStore = create<ChatWindowState>((set) => ({
  detached: false,
  refs: [],
  setDetached: (detached) => set(detached ? { detached } : { detached, refs: [] }),
  setRefs: (refs) => set({ refs: uniqueChatRefs(refs) }),
}));

/** The ONE routing rule, asked by panes.openChat: while Chat lives in its own
 * window, a chat opened from anywhere in main (a sidebar row, ⌥A, a note's
 * chat, a link) opens THERE instead, and the window comes forward. `openHere`
 * is asked first: a chat main still holds (a tab that could not move) is shown
 * in main — one chat is never open in both windows, which would be two writers
 * on one file. */
export function chatWindowTakes(
  chatSlug: string | null,
  vaultId: string | undefined,
  openHere: () => boolean,
): boolean {
  if (windowSurface() !== "main" || !useChatWindowStore.getState().detached) return false;
  if (chatSlug !== null && openHere()) return true;
  sendChatWindow(
    chatSlug
      ? { kind: "open", refs: [{ slug: chatSlug, ...(vaultId ? { vaultId } : {}) }] }
      : { kind: "open", refs: [{ slug: null }] },
  );
  void showChatWindow();
  return true;
}
