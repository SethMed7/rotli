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
// Flushers run in parallel. Any failure is reported to Rust, which aborts the
// normal quit and keeps the user's unsaved buffers alive.

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

/** Run every registered flusher and preserve all failures after every flusher
 * had a chance to save. Exported for tests. */
export async function runQuitFlushers(): Promise<void> {
  const results = await Promise.allSettled([...flushers].map(async (f) => f()));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    const first = failures[0]?.reason;
    throw new Error(
      `${failures.length} save operation${failures.length === 1 ? "" : "s"} failed: ${first instanceof Error ? first.message : String(first)}`,
    );
  }
}

type QuitFlushPayload = { attemptId: number };
const failureSubscribers = new Set<(message: string) => void>();

export function onQuitFlushFailure(fn: (message: string) => void): () => void {
  failureSubscribers.add(fn);
  return () => failureSubscribers.delete(fn);
}

// The listener exists only in the Tauri shell (bun tests / browser preview
// have no IPC — and nothing to flush that survives them anyway).
if (typeof window !== "undefined" && isTauri()) {
  void listen<QuitFlushPayload>("rotli:flush-before-quit", (event) => {
    void (async () => {
      try {
        await runQuitFlushers();
        await invoke("quit_flush_done", { attemptId: event.payload.attemptId, ok: true }).catch(() => {});
      } catch (error) {
        await invoke("quit_flush_done", {
          attemptId: event.payload.attemptId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
    })();
  });
  void listen<string>("rotli:quit-flush-failed", (event) => {
    for (const subscriber of failureSubscribers) subscriber(event.payload);
  });
}
