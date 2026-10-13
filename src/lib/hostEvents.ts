// Rust → webview host events for the vault and the native menus: each
// subscription returns its unsubscribe and is a no-op outside the shell. Split
// out of lib/tauri.ts (2026-10-12); `listenHere` hears only this window's copy.

import { isTauri, listenHere } from "./tauri";

/** Rust → main window: the corpus changed UNDER the app (a folder dropped in,
 * a note edited in another editor). Debounced Rust-side; the frontend just
 * invalidates and refetches — content appears when ready, no spinners. */
export function onCorpusChanged(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  // own-window only: Rust sends one copy to main and one to chat, and a bare
  // listen() hears BOTH — every vault change refreshed each window twice
  const unlisten = listenHere("rotli:corpus-changed", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → every webview: the active vault route changed while the process and
 * native windows stayed alive. Each frontend drops vault-scoped caches and
 * rehydrates its own surface from the new default store. */
export function onVaultChanged(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere("rotli:vault-changed", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: `rotli open <id>` wrote its mailbox and activated the
 * app (the Reopen event) — consume the request NOW. Replaces the app-lifetime
 * 750ms workspaceTakeOpenRequest poll (perf audit 2026-07-30, #15). */
export function onOpenRequest(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere("rotli:open-request", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: something handed over from Finder can't open yet (a
 * folder, until folder windows ship) — say so instead of doing nothing. */
export function onOpenNotice(cb: (message: string) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere<string>("rotli:open-notice", (event) => cb(event.payload));
  return () => void unlisten.then((fn) => fn());
}

/** macOS File → Close Tab. ⌘W intentionally stays in the frontend registry so
 * it closes during the original key event instead of taking a native event
 * round trip; pointer selection of the menu item still forwards here. */
export function onNativeCloseTab(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere("rotli:close-tab", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** macOS Edit → Undo / Redo picked with the pointer (⌘Z / ⇧⌘Z reach the page as
 * key presses instead; keys/editHistoryActions.ts). */
export function onNativeEditHistory(cb: (redo: boolean) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere<string>("rotli:edit-history", (event) => cb(event.payload === "redo"));
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: the organizer daemon appended to the brain journal (a
 * new proposal or an auto-applied action) — refetch it so Activity + the
 * sidebar badge update within a beat, no polling. */
export function onBrainJournal(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere("rotli:brain-journal", () => cb());
  return () => void unlisten.then((fn) => fn());
}

/** Rust → main window: the ⌥F global chord fired — surface the window with the
 * ⌘K palette open ("find", the search twin of ⌥A's "ask"). */
export function onSummonSearch(cb: () => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listenHere("rotli:summon-search", () => cb());
  return () => void unlisten.then((fn) => fn());
}
