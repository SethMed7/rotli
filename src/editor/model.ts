// The shared document buffer — ONE buffer per noteId across all tabs/panes
// (the r2 structural lock #4). The document is the note's markdown string,
// split into lines. Edits mutate this map synchronously (typing never waits
// on a store round-trip) and flow to NotesService.update on a debounce, so
// updatedAt moves and the list/snippets refresh. Tabs hold only view state.

import { useCallback, useSyncExternalStore } from "react";

import { onQuitFlush } from "../lib/quitFlush";
import { applyNoteWrite } from "../services/hooks";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { notesService } from "../services/notes";
import { keepTabsFor } from "../state/panes";
import type { Note } from "../types";
import { MARK } from "./taskState";

const SYNC_DEBOUNCE_MS = 400;
// a failed write retries on its own — waiting for the next keystroke would
// leave a note that's done being typed in unsaved forever
const RETRY_DELAY_MS = 5000;

const docs = new Map<string, string[]>();
const revisions = new Map<string, string>();
const subs = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

// The one write funnel syncNow uses — swappable so tests can simulate the disk
// failing (the in-memory test service can't fail any other way).
let writeNoteBody: (noteId: string, body: string, expectedRevision: string) => Promise<Note | void> = (
  noteId,
  body,
  expectedRevision,
) => notesService.updateNote(noteId, body, expectedRevision);

export function setWriteNoteBodyForTests(fn: typeof writeNoteBody | null): void {
  writeNoteBody =
    fn ?? ((noteId, body, expectedRevision) => notesService.updateNote(noteId, body, expectedRevision));
}

// ——— checkbox signature: the Tasks projection walks the corpus (corpus_tasks),
// so a body sync invalidates it ONLY when the note's checkbox lines actually
// changed — steady typing never pays that walk (perf audit 2026-07-30, #4/#5).
const TASK_LINE = new RegExp(`^\\s*(?:[-*+]|\\d+\\.)\\s+\\[${MARK}\\]`);
const taskSigs = new Map<string, string>();

function taskSignature(lines: readonly string[]): string {
  let sig = "";
  for (const line of lines) if (TASK_LINE.test(line)) sig += `${line}\n`;
  return sig;
}

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

// ——— save failures SURFACE (perf audit 2026-07-30, correctness #1): a write
// that fails for any reason keeps the buffer,
// shows itself in the editor, and retries — silence here is data loss. ———

const saveErrors = new Map<string, string>();
// per-note subscriber partitions, same shape as `subs` — note A's failure must
// not wake note B's editor (Greptile, PR #12)
const errorSubs = new Map<string, Set<() => void>>();

function setSaveError(noteId: string, message: string | null): void {
  if ((saveErrors.get(noteId) ?? null) === message) return;
  if (message === null) saveErrors.delete(noteId);
  else saveErrors.set(noteId, message);
  const set = errorSubs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** The note's last failed-write message, null when saves are healthy. */
export function documentSaveError(noteId: string): string | null {
  return saveErrors.get(noteId) ?? null;
}

export function useDocumentSaveError(noteId: string): string | null {
  const subscribe = useCallback(
    (fn: () => void) => {
      let set = errorSubs.get(noteId);
      if (!set) {
        set = new Set();
        errorSubs.set(noteId, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    [noteId],
  );
  return useSyncExternalStore(subscribe, () => documentSaveError(noteId));
}

/** Seed the buffer from the service body. No-op if the note is already open
 * somewhere — the live buffer is the truth, never the (possibly stale) query. */
export function ensureDocument(noteId: string, body: string, revision: string): void {
  if (docs.has(noteId)) return;
  const lines = body.split("\n");
  docs.set(noteId, lines);
  revisions.set(noteId, revision);
  taskSigs.set(noteId, taskSignature(lines));
}

/** Replace a CLEAN buffer with disk truth (external edit / agent write). No-op
 * when the note has unsaved local edits — those win until flush. Seeds when
 * the buffer doesn't exist yet. */
export function reloadDocumentIfClean(noteId: string, body: string, revision: string): void {
  if (dirtyIds.has(noteId)) return;
  const next = body.split("\n");
  const cur = docs.get(noteId);
  if (cur && cur.length === next.length && cur.every((l, i) => l === next[i])) return;
  docs.set(noteId, next);
  revisions.set(noteId, revision);
  taskSigs.set(noteId, taskSignature(next));
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** Drop a note's buffer + pending sync. The hook for the future delete path,
 * and the unknown-note sync failure — a dead buffer must never keep shadowing
 * (or writing over) service state. */
export function evictDocument(noteId: string): void {
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  timers.delete(noteId);
  docs.delete(noteId);
  revisions.delete(noteId);
  taskSigs.delete(noteId);
  setDirty(noteId, false);
  setSaveError(noteId, null);
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** Apply an edit to the shared buffer: notify every pane synchronously,
 * sync to the service on the debounce. */
export function editDocument(noteId: string, edit: (lines: readonly string[]) => string[]): void {
  const current = docs.get(noteId);
  if (!current) return;
  // the single funnel every real keystroke passes through — a session-created
  // note stops being an ephemeral blank draft the moment it's written into,
  // and an edited PREVIEW tab becomes a kept tab (Seth, 2026-07-28)
  markNoteDraftChanged(noteId);
  keepTabsFor(noteId);
  docs.set(noteId, edit(current));
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
  scheduleSync(noteId);
}

function syncNow(noteId: string): Promise<void> {
  const lines = docs.get(noteId);
  if (!lines) return Promise.resolve();
  const expectedRevision = revisions.get(noteId);
  if (!expectedRevision) {
    setSaveError(noteId, "This note has no save revision. Reload it before editing.");
    return Promise.resolve();
  }
  return writeNoteBody(noteId, lines.join("\n"), expectedRevision)
    .then((note) => {
      setSaveError(noteId, null);
      if (note) revisions.set(noteId, note.revision);
      // saved — unless newer keystrokes already queued the next sync
      if (!timers.has(noteId)) setDirty(noteId, false);
      if (!note) return; // test stub — no cache to patch
      // SCOPED refresh (audit 2026-07-30, #1): patch the fresh note into the
      // caches instead of invalidating ["notes"] — that fanned into ~9
      // main-thread corpus walks per 400ms typing tick. Tasks re-derive only
      // when the checkbox lines changed.
      const sig = taskSignature(lines);
      const tasksChanged = taskSigs.get(noteId) !== sig;
      taskSigs.set(noteId, sig);
      return applyNoteWrite(note, { tasksChanged });
    })
    .catch((err: unknown) => {
      // Any failure (missing/renamed note, read-only volume, permissions, disk full) keeps the
      // buffer AND says so: the note stays dirty, the editor shows the error,
      // and a retry timer keeps the sync alive even with no further keystroke.
      // The retry rides the timers map, so quit-flush picks it up too.
      setSaveError(noteId, err instanceof Error ? err.message : String(err));
      // A conflict is durable until the user resolves the two versions. Blind
      // retries would only hammer the disk and can never become safe on their
      // own; the live local buffer stays intact and visibly dirty.
      if (
        err instanceof Error &&
        (err.message.startsWith("revision conflict") || err.message.startsWith("unknown note"))
      )
        return;
      scheduleRetry(noteId);
    });
}

function scheduleRetry(noteId: string): void {
  if (timers.has(noteId)) return; // newer keystrokes already queued a sync
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      void syncNow(noteId);
    }, RETRY_DELAY_MS),
  );
}

function scheduleSync(noteId: string): void {
  setDirty(noteId, true);
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      void syncNow(noteId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** Flush ONE note's pending debounced sync — the note/tab-switch path.
 * The timer would still fire 400ms later, but flushing at the switch means
 * the list row and the disk are already true when the eye lands elsewhere. */
export function flushNote(noteId: string): Promise<void> {
  const pending = timers.get(noteId);
  if (pending === undefined) return Promise.resolve();
  clearTimeout(pending);
  timers.delete(noteId);
  return syncNow(noteId);
}

/** Flush every pending debounced sync immediately — the quit/reload path. The
 * 400ms window must never eat the last keystrokes once the disk-backed service
 * lands. Resolves when every write settles, so the quit handshake can hold the
 * exit until the IPC lands. */
export async function flushSyncs(): Promise<void> {
  const pending: Array<Promise<void>> = [];
  for (const [noteId, timer] of timers) {
    clearTimeout(timer);
    pending.push(syncNow(noteId));
  }
  timers.clear();
  await Promise.allSettled(pending);
  const unsaved = [...dirtyIds];
  if (unsaved.length > 0) {
    const detail = unsaved
      .map((noteId) => saveErrors.get(noteId))
      .filter((message): message is string => Boolean(message))[0];
    throw new Error(
      `${unsaved.length} note${unsaved.length === 1 ? "" : "s"} still has unsaved edits${detail ? `: ${detail}` : ""}`,
    );
  }
}

// Keystrokes are never lost: quit/reload (pagehide), the window hiding under
// ⌥Space / click-away (visibilitychange → hidden), and plain focus loss (blur)
// all flush the debounce window immediately. ⌘Q/tray-Quit can fire with the
// window still focused (no hide, no blur), so the quit handshake awaits the
// same flush before the process exits.
window.addEventListener("pagehide", () => void flushSyncs().catch(() => {}));
window.addEventListener("blur", () => void flushSyncs().catch(() => {}));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void flushSyncs().catch(() => {});
});
onQuitFlush(flushSyncs);

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

/** The whole buffer as one string — the CodeMirror editing surface's source of
 * truth (the editor edits this text directly, the .md never round-trips a rich
 * model). undefined until the buffer exists. */
export function getDocumentText(noteId: string): string | undefined {
  const lines = docs.get(noteId);
  return lines ? lines.join("\n") : undefined;
}

/** Replace the whole buffer from the editor (CM → model): notify every pane
 * synchronously, sync to the service on the debounce — the exact path the
 * line-level edits take, so the dirty dot + flush-on-blur are unchanged. */
export function setDocumentText(noteId: string, text: string): void {
  editDocument(noteId, () => text.split("\n"));
}

/** Subscribe to buffer changes for one note (the CM editor mirrors external
 * edits — another pane on the same note — back into its view). */
export function onDocumentChange(noteId: string, fn: () => void): () => void {
  return subscribeDocument(noteId, fn);
}
