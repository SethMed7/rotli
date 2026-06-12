// The shared document buffer — ONE buffer per noteId across all tabs/panes
// (the r2 structural lock #4). The document is the note's markdown string,
// split into lines. Edits mutate this map synchronously (typing never waits
// on a store round-trip) and flow to NotesService.update on a debounce, so
// updatedAt moves and the list/snippets refresh. Tabs hold only view state.

import { useCallback, useSyncExternalStore } from "react";
import { invalidateNotes } from "../services/hooks";
import { notesService } from "../services/notes";

const SYNC_DEBOUNCE_MS = 400;

const docs = new Map<string, string[]>();
const subs = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// ——— the olive-dot grammar: muted while a debounced sync is pending or in
// flight, olive once the service confirmed the write. NO spinners, ever. ———

const dirtyIds = new Set<string>();
const dirtySubs = new Set<() => void>();

function setDirty(noteId: string, value: boolean): void {
  if (dirtyIds.has(noteId) === value) return;
  if (value) dirtyIds.add(noteId);
  else dirtyIds.delete(noteId);
  for (const fn of dirtySubs) fn();
}

/** True while the note has unsaved edits (pending debounce or sync in flight). */
export function useDocumentDirty(noteId: string): boolean {
  const subscribe = useCallback((fn: () => void) => {
    dirtySubs.add(fn);
    return () => {
      dirtySubs.delete(fn);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => dirtyIds.has(noteId));
}

/** Seed the buffer from the service body. No-op if the note is already open
 * somewhere — the live buffer is the truth, never the (possibly stale) query. */
export function ensureDocument(noteId: string, body: string): void {
  if (!docs.has(noteId)) docs.set(noteId, body.split("\n"));
}

/** Drop a note's buffer + pending sync. The hook for the future delete path,
 * and the unknown-note sync failure — a dead buffer must never keep shadowing
 * (or writing over) service state. */
export function evictDocument(noteId: string): void {
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  timers.delete(noteId);
  docs.delete(noteId);
  setDirty(noteId, false);
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** Apply an edit to the shared buffer: notify every pane synchronously,
 * sync to the service on the debounce. */
export function editDocument(noteId: string, edit: (lines: readonly string[]) => string[]): void {
  const current = docs.get(noteId);
  if (!current) return;
  docs.set(noteId, edit(current));
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
  scheduleSync(noteId);
}

function syncNow(noteId: string): void {
  const lines = docs.get(noteId);
  if (!lines) return;
  notesService
    .updateNote(noteId, lines.join("\n"))
    .then(() => {
      // saved — unless newer keystrokes already queued the next sync
      if (!timers.has(noteId)) setDirty(noteId, false);
      return invalidateNotes();
    })
    .catch((err: unknown) => {
      // the note is gone (deleted with a pending sync): drop the orphan buffer.
      // Any other failure keeps the buffer — it stays dirty and the next edit
      // reschedules the sync, so nothing is lost silently.
      if (err instanceof Error && err.message.startsWith("unknown note")) {
        evictDocument(noteId);
      }
    });
}

function scheduleSync(noteId: string): void {
  setDirty(noteId, true);
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      syncNow(noteId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** Flush ONE note's pending debounced sync — the note/tab-switch path.
 * The timer would still fire 400ms later, but flushing at the switch means
 * the list row and the disk are already true when the eye lands elsewhere. */
export function flushNote(noteId: string): void {
  const pending = timers.get(noteId);
  if (pending === undefined) return;
  clearTimeout(pending);
  timers.delete(noteId);
  syncNow(noteId);
}

/** Flush every pending debounced sync immediately — the quit/reload path. The
 * 400ms window must never eat the last keystrokes once the disk-backed service
 * lands (and it costs nothing to be correct now). */
export function flushSyncs(): void {
  for (const [noteId, timer] of timers) {
    clearTimeout(timer);
    syncNow(noteId);
  }
  timers.clear();
}

// Keystrokes are never lost: quit/reload (pagehide), the window hiding under
// ⌥Space / click-away (visibilitychange → hidden), and plain focus loss (blur)
// all flush the debounce window immediately.
window.addEventListener("pagehide", flushSyncs);
window.addEventListener("blur", flushSyncs);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushSyncs();
});

function subscribeDocument(noteId: string, fn: () => void): () => void {
  let set = subs.get(noteId);
  if (!set) {
    set = new Set();
    subs.set(noteId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** Live lines for a note; undefined until the buffer exists (callers fall
 * back to the query body — identical content until the first edit). */
export function useDocumentLines(noteId: string): string[] | undefined {
  const subscribe = useCallback((fn: () => void) => subscribeDocument(noteId, fn), [noteId]);
  return useSyncExternalStore(subscribe, () => docs.get(noteId));
}
