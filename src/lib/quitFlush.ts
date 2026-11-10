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
//
// Quit is a transaction (eighth review of pull request 267): from the request
// until it is refused or the process exits, the editors take no input
// (`useFinishingSaves`, "Finishing saving…"), and the acknowledgement is given
// only when a final check, after EVERY flusher has finished, finds nothing
// unsaved or outstanding (`onQuitCheck`). A note whose own flush finished
// early used to keep taking typing while another flusher (a workbook, another
// window) was still saving, and quit was acknowledged with those words unsaved.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import { currentWindowLabel, isTauri } from "./tauri";

type Flusher = () => Promise<void> | void;
const flushers = new Set<Flusher>();

/** Register work that must finish before the process exits; returns the
 * unregister (the subscribeDocument idiom). Module-level registrants live for
 * the session and simply drop it. Per-mount registrants MUST call it on
 * unmount: board surfaces used to leak one closure — pinning the dead scene it
 * captured — per board opened or switched, and quit then fanned out over all of
 * them (perf audit 2026-07-30, finding 22). */
export function onQuitFlush(fn: Flusher): () => void {
  return enrol(flushers, fn);
}

/** Add `fn` to `set`; the answer takes it out again. */
function enrol<T>(set: Set<T>, fn: T): () => void {
  set.add(fn);
  return () => {
    set.delete(fn);
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

type QuitCheck = () => string | null;
const checks = new Set<QuitCheck>();

/** Register a final check: what is still unsaved or outstanding, in words, or
 * null. Run after every flusher has finished; any answer refuses the quit. */
export function onQuitCheck(fn: QuitCheck): () => void {
  return enrol(checks, fn);
}

// While quit is being decided, the editors take no input. If the process is
// still alive this long after an acknowledgement, another window refused the
// quit (Rust waits 15 seconds), so input comes back.
const RESTORE_AFTER_MS = 20_000;
let finishing = false;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
const finishingSubs = new Set<() => void>();
function setFinishing(value: boolean): void {
  clearTimeout(restoreTimer);
  if (finishing === value) return;
  finishing = value;
  for (const fn of finishingSubs) fn();
}

/** True from a quit request until it is refused (or the process exits). */
export const finishingSaves = (): boolean => finishing;
export function useFinishingSaves(): boolean {
  return useSyncExternalStore((fn) => {
    finishingSubs.add(fn);
    return () => finishingSubs.delete(fn);
  }, finishingSaves);
}

/** The quit transaction: no input from here on, every flusher, then the final
 * checks. Resolves only when nothing is unsaved or outstanding anywhere;
 * otherwise input comes back and it rejects with every reason. */
export async function runQuitTransaction(): Promise<void> {
  setFinishing(true);
  try {
    await runQuitFlushers();
    const reasons = [...checks].map((check) => check()).filter((reason): reason is string => !!reason);
    if (reasons.length > 0) throw new Error(reasons.join("; "));
  } catch (error) {
    setFinishing(false);
    throw error;
  }
  restoreTimer = setTimeout(() => setFinishing(false), RESTORE_AFTER_MS);
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
  // own-window only: Rust asks each window once, and a bare listen() heard all
  // four requests (four flushes, four acks per window — audit 2026-10-12)
  void listen<QuitFlushPayload>(
    "rotli:flush-before-quit",
    (event) => {
      void (async () => {
        try {
          await runQuitTransaction();
          await invoke("quit_flush_done", { attemptId: event.payload.attemptId, ok: true }).catch(() => {});
        } catch (error) {
          await invoke("quit_flush_done", {
            attemptId: event.payload.attemptId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }).catch(() => {});
        }
      })();
    },
    { target: currentWindowLabel() },
  );
  void listen<string>(
    "rotli:quit-flush-failed",
    (event) => {
      setFinishing(false);
      for (const subscriber of failureSubscribers) subscriber(event.payload);
    },
    { target: currentWindowLabel() },
  );
}
