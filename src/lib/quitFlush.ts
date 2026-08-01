// The quit-flush handshake (#4 follow-up, review 2026-07). Dirty state that
// needs ASYNC work to persist (a spreadsheet serializes through exceljs before
// its bytes can ride the IPC) cannot rely on pagehide/visibilitychange alone:
// ⌘Q and tray-Quit can fire with the window still up and focused — no hide ever
// happened ("Stay open" mode makes that the common case) — and async work never
// completes during WKWebView teardown. So Rust intercepts BOTH quit paths,
// emits "rotli:flush-before-quit" to this window, and holds the exit (bounded
// — quit can never hang) until `quit_flush_done` acks. This module is the ack
// side: always loaded (persist.ts imports it), so an idle quit acks in
// milliseconds instead of riding out the Rust-side timeout.
//
// Register work with `onQuitFlush` — SheetEditor parks its dirty-sheet flush here.
// Flushers run in parallel and a throwing flusher never blocks the ack.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./tauri";

type Flusher = () => Promise<void> | void;
const flushers = new Set<Flusher>();

/** Register work that must finish before the process exits; returns the
 * unregister (the subscribeDocument idiom). Module-level registrants live for
 * the session and simply drop it. Per-mount registrants MUST call it on
 * unmount: board surfaces used to leak one closure — pinning the dead scene it
 * captured — per board opened or switched, and quit then fanned out over all of
 * them (perf audit 2026-07-30, finding 22). */
export function onQuitFlush(fn: Flusher): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

/** Run every registered flusher; resolves when ALL settle (a rejection is a
 * skipped flush, never a hung quit). Exported for tests. */
export async function runQuitFlushers(): Promise<void> {
  await Promise.allSettled([...flushers].map(async (f) => f()));
}

// The listener exists only in the Tauri shell (bun tests / browser preview
// have no IPC — and nothing to flush that survives them anyway).
if (typeof window !== "undefined" && isTauri()) {
  void listen("rotli:flush-before-quit", () => {
    void (async () => {
      try {
        await runQuitFlushers();
      } finally {
        // the ack releases the exit; a failed invoke just rides out Rust's timeout
        await invoke("quit_flush_done").catch(() => {});
      }
    })();
  });
}
