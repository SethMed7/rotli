// The Chat window's native seam (1.3.0): show/hide the pre-declared "chat"
// window, and the messages the two shell windows pass each other. Every call is
// a no-op outside the Mac app — Rotli Web has one window, and a second browser
// tab would be a second writer with no revision coordination between them.
//
// ONE event name with a discriminated payload keeps the rotli:* registry small
// (docs/architecture/window-events.md). Frontend `emit` reaches every webview;
// each side ignores the kinds that are not addressed to it.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

import type { MainNode } from "../services/mainTree";
import type { ChatTabRef } from "../state/chatWindowTabs";
import { isTauri } from "./tauri";

export type ChatWindowMessage =
  /** main → chat: open these chats (pop-out, or a chat opened in main while
   * Chat lives in its window). A ref with no slug is a fresh, unsent chat. */
  | { kind: "open"; refs: ChatTabRef[] }
  /** chat → main: the chats open in the window right now. Main records them in
   * its saved layout — main is the one writer. */
  | { kind: "tabs"; refs: ChatTabRef[] }
  /** main → chat: hand everything back (the regroup icon in main). */
  | { kind: "regroup" }
  /** chat → main: here they are; the window has hidden itself. */
  | { kind: "regrouped"; refs: ChatTabRef[] }
  /** any window that is not main → main: file these into Main. A window that is
   * not main never hydrates Main, so any tree it computes is purely additions
   * (a chat's artifact under its folder); main merges them into the real tree. */
  | { kind: "file-into-main"; tree: MainNode[] };

export function sendChatWindow(message: ChatWindowMessage): void {
  if (isTauri()) void emit("rotli:chat-window", message);
}

export function onChatWindow(cb: (message: ChatWindowMessage) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<ChatWindowMessage>("rotli:chat-window", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}

/** Rust → the chat webview: the window was just shown. */
export function onChatWindowShown(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:chat-window-show", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → the chat webview: its close button was pressed. Closing hands the
 * chats back to main instead of stranding them in a hidden window. */
export function onChatWindowCloseRequest(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen("rotli:chat-window-regroup", () => cb());
  return () => void unlisten.then((fn) => fn());
}

export async function showChatWindow(): Promise<void> {
  if (isTauri()) await invoke("show_chat_window");
}

export async function hideChatWindow(): Promise<void> {
  if (isTauri()) await invoke("hide_chat_window");
}
