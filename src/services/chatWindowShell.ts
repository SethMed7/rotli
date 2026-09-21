// What presentation needs from the Chat window's native side, behind a service
// (components never reach for lib/tauri): whether this build offers the window,
// bringing it forward, and the chat shell's own listeners.

import { showChatWindow } from "../lib/chatWindowBridge";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import {
  isTauri,
  onCorpusChanged,
  onNativeCloseTab,
  onSummonChat,
  startWindowDrag,
  toggleMaximize,
} from "../lib/tauri";
import { invalidateMemex } from "../memex/useMemex";
import { invalidateChatFolders } from "./chatFolders";
import { summonChat } from "./chatSummon";
import { invalidateNotes } from "./hooks";

/** The Mac app only (lib/featurePolicy.ts chatWindow). */
export function chatWindowSupported(): boolean {
  return LAUNCH_FEATURES.chatWindow && isTauri();
}

export function focusChatWindow(): void {
  void showChatWindow();
}

/** The chat shell's title strip: drag to move, double-click to zoom. */
export function dragChatWindow(): void {
  void startWindowDrag();
}
export function zoomChatWindow(): void {
  void toggleMaximize();
}

/** Attach the chat shell's listeners; returns the teardown.
 *  - the vault changed on disk → re-read chats, chat folders, and notes. A
 *    shell that never hears this shows a stale chat, then fails its next save
 *    on the revision gate.
 *  - File → Close Tab (Rust routes it to the focused shell window).
 *  - ⌥A while Chat lives in this window: the SAME summon policy as main —
 *    return to the chat already here, else the newest, else a fresh one. */
export function attachChatShell(on: { closeTab: () => void }): () => void {
  const offs = [
    onCorpusChanged(() => {
      void invalidateMemex();
      void invalidateChatFolders();
      void invalidateNotes();
    }),
    onNativeCloseTab(on.closeTab),
    onSummonChat(() => void summonChat({ here: true })),
  ];
  return () => offs.forEach((off) => off());
}
