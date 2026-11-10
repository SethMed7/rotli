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
// Quit has two phases, driven by Rust (src-tauri/src/quit_flush.rs), and
// nothing is ever made read-only (ninth review of pull request 267: a lock on
// the editors could strand a window for good):
// 1. "rotli:flush-before-quit": every flusher runs; the window answers
//    flushed, or refused with the reasons (`quit_flush_done`).
// 2. "rotli:quit-check", only when every window flushed: the window answers at
//    once, from its buffers' state with no flushing, whether anything is
//    unsaved or outstanding (`onQuitCheck`, `quit_check_done`). Any yes refuses
//    the quit; all no, and Rust exits at once. A note whose flush finished
//    early could keep taking typing while another window was still saving;
//    that typing is now caught by the question asked after every flush.
// Each attempt ends with "rotli:save-attempt-ended" to every window it asked.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

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

/** Phase 2's answer, computed now from the buffers' state with no flushing:
 * what is unsaved or outstanding, in words, or null when nothing is. */
export function quitCheckNow(): string | null {
  const reasons = [...checks].map((check) => check()).filter((reason): reason is string => !!reason);
  return reasons.length > 0 ? reasons.join("; ") : null;
}

/** How one window answers each phase (the listeners below, and the save-state
 * explorer, which plays the coordinator's part). */
export const answerFlush = (): Promise<void> => runQuitFlushers();
export const answerCheck = (): string | null => quitCheckNow();

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
          await answerFlush();
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
  // phase 2: answered at once, synchronously, from the buffers' state
  void listen<QuitFlushPayload>(
    "rotli:quit-check",
    (event) => {
      const reasons = answerCheck();
      void invoke("quit_check_done", {
        attemptId: event.payload.attemptId,
        clean: reasons === null,
        reasons,
      }).catch(() => {});
    },
    { target: currentWindowLabel() },
  );
  void listen<string>(
    "rotli:quit-flush-failed",
    (event) => {
      for (const subscriber of failureSubscribers) subscriber(event.payload);
    },
    { target: currentWindowLabel() },
  );
  // the attempt is over (finished or refused): nothing here was ever locked,
  // so there is nothing to restore; heard so every window acknowledges it
  void listen<{ attemptId: number; finished: boolean }>("rotli:save-attempt-ended", () => {}, {
    target: currentWindowLabel(),
  });
}
