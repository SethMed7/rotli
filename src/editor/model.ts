// The shared document buffer — ONE buffer per noteId across all tabs/panes
// (the r2 structural lock #4). The document is the note's markdown string,
// split into lines. Edits mutate this map synchronously (typing never waits
// on a store round-trip) and flow to NotesService.update on a debounce, so
// updatedAt moves and the list/snippets refresh. Tabs hold only view state.

import { useCallback, useSyncExternalStore } from "react";

import { onQuitFlush } from "../lib/quitFlush";
import { applyNoteWrite } from "../services/hooks";
import { markNoteDraftChanged, markNoteDraftSaved } from "../services/noteDrafts";
import { notesService } from "../services/notes";
import { keepTabsFor } from "../state/panes";
import type { Note } from "../types";
import { threeWayMerge } from "./merge";
import { bumpGeneration, editGeneration, forgetEdits, hasUnsavedEdits, recordSaved } from "./saveGenerations";
import { dirtyNoteIds, documentSaveError, isDirty, setDirty, setSaveError } from "./saveStatus";
import { taskSignature } from "./taskState";
import { draftsOf, forgetProtection, setDocumentProtection, type UnsavedDraft } from "./unsavedDrafts";

export { documentSaveError, useDocumentDirty, useDocumentSaveError } from "./saveStatus";

const SYNC_DEBOUNCE_MS = 400;
// a failed write retries on its own — waiting for the next keystroke would
// leave a note that's done being typed in unsaved forever
const RETRY_DELAY_MS = 5000;

const docs = new Map<string, string[]>();
const revisions = new Map<string, string>();
// The editor body that produced `revisions[noteId]`. Rotli-managed moves and
// metadata writes change the complete-file revision without changing this
// prose; keeping the body baseline lets us distinguish that safe case from a
// genuine concurrent body edit.
const persistedBodies = new Map<string, string>();
// A Command-T note can be edited before its durable file exists. Pending
// buffers are real shared editor documents, but they deliberately have no save
// timer until creation hands them a stable note id + disk revision.
const pendingDocuments = new Set<string>();
const subs = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
// The save queue (fifth review of pull request 267): ONE write out per note at
// a time (`inflight`), and at most one more waiting for it (`queued`), which
// saves the newest buffer against the revision the first write produced. Two
// writes on the same base revision lost the newest typing (a revision
// conflict nobody noticed), in 1.9.1 and 1.8.0 (both checked). `retrying` names
// the notes whose timer is a retry after a failed save rather than new typing.
const inflight = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();
const retrying = new Set<string>();
/** The save dot and the recovery journal follow the derived rule (saveGenerations.ts). */
function refreshDirty(noteId: string): void {
  setDirty(noteId, docs.has(noteId) && hasUnsavedEdits(noteId));
}

function bump(noteId: string): void {
  bumpGeneration(noteId);
  refreshDirty(noteId);
}

function markClean(noteId: string): void {
  recordSaved(noteId);
  refreshDirty(noteId);
}

// The one write funnel syncNow uses — swappable so tests can simulate the disk
// failing (the in-memory test service can't fail any other way).
let writeNoteBody: (
  noteId: string,
  body: string,
  expectedRevision: string,
  expectedBody: string,
) => Promise<Note | void> = (noteId, body, expectedRevision, expectedBody) =>
  notesService.updateNote(noteId, body, expectedRevision, expectedBody);

export function setWriteNoteBodyForTests(fn: typeof writeNoteBody | null): void {
  writeNoteBody =
    fn ??
    ((noteId, body, expectedRevision, expectedBody) =>
      notesService.updateNote(noteId, body, expectedRevision, expectedBody));
}

// checkbox signature (taskState.ts): a body sync invalidates the Tasks
// projection only when the note's checkbox lines changed (perf audit 2026-07-30).
const taskSigs = new Map<string, string>();

/** Every buffer the dimmed save dot is showing, read synchronously (an
 * unloading page can't await): the recovery journal (unsavedDrafts.ts). */
export const unsavedDrafts = (): UnsavedDraft[] =>
  draftsOf((noteId) => ({
    lines: docs.get(noteId),
    pending: pendingDocuments.has(noteId),
    revision: revisions.get(noteId),
    persisted: persistedBodies.get(noteId),
  }));

/** Seed the buffer from the service body. No-op if the note is already open
 * somewhere — the live buffer is the truth, never the (possibly stale) query. */
export function ensureDocument(
  noteId: string,
  body: string,
  revision: string,
  note?: Pick<Note, "secure" | "locked">,
): void {
  if (note) setDocumentProtection(noteId, note);
  if (docs.has(noteId)) return;
  const lines = body.split("\n");
  docs.set(noteId, lines);
  revisions.set(noteId, revision);
  persistedBodies.set(noteId, body);
  taskSigs.set(noteId, taskSignature(lines));
  markClean(noteId);
  if (!subs.get(noteId)?.size) scheduleRelease(noteId); // a seed nobody opened
}

/** Stable session id for the editable surface shown before Command-T's file
 * creation returns. It is never sent to the corpus or persisted in viewstate. */
export function pendingNoteDocumentId(tabId: string): string {
  return `rotli-pending-note:${tabId}`;
}

/** Seed the first-paint Command-T editor. No revision exists yet, so edits stay
 * in this shared buffer until `adoptPendingDocument` binds them to disk. */
export function ensurePendingDocument(noteId: string, body = ""): void {
  if (docs.has(noteId)) return;
  const lines = body.split("\n");
  docs.set(noteId, lines);
  persistedBodies.set(noteId, body);
  pendingDocuments.add(noteId);
  taskSigs.set(noteId, taskSignature(lines));
}

/** Move an optimistic editor buffer onto the newly-created durable note before
 * the tab retargets. The CodeMirror remount therefore sees the exact live text,
 * and a typed draft starts its first ordinary revision-protected save. */
export function adoptPendingDocument(pendingId: string, note: Note): boolean {
  const lines = [...(docs.get(pendingId) ?? note.body.split("\n"))];
  const body = lines.join("\n");
  const changed = body !== note.body;

  const pendingTimer = timers.get(pendingId);
  if (pendingTimer !== undefined) clearTimeout(pendingTimer);
  timers.delete(pendingId);
  docs.delete(pendingId);
  revisions.delete(pendingId);
  persistedBodies.delete(pendingId);
  pendingDocuments.delete(pendingId);
  forgetProtection(pendingId);
  taskSigs.delete(pendingId);
  forgetEdits(pendingId);
  setDirty(pendingId, false);
  setSaveError(pendingId, null);

  docs.set(note.id, lines);
  setDocumentProtection(note.id, note);
  revisions.set(note.id, note.revision);
  persistedBodies.set(note.id, note.body);
  taskSigs.set(note.id, taskSignature(note.body.split("\n")));
  setSaveError(note.id, null);
  markClean(note.id);
  if (changed) {
    markNoteDraftChanged(note.id);
    bump(note.id);
    scheduleSync(note.id);
  }
  const set = subs.get(note.id);
  if (set) for (const fn of set) fn();
  return changed;
}

/** Replace a CLEAN buffer with disk truth (external edit / agent write). No-op
 * when the note has unsaved local edits — those win until flush. Seeds when
 * the buffer doesn't exist yet. */
export function reloadDocumentIfClean(noteId: string, body: string, revision: string): void {
  if (!docs.has(noteId)) {
    ensureDocument(noteId, body, revision);
    return;
  }
  if (isDirty(noteId)) {
    // Disk changed under unsaved edits. Metadata-only writes (the Librarian)
    // keep the prose, so the new revision is simply a safe base. When the
    // PROSE changed too — a task ticked from the Tasks view, a chat edit,
    // another app — fold both edits together when they touched different
    // lines; only overlapping edits stay a visible conflict (2026-09-03).
    const base = persistedBodies.get(noteId);
    if (base !== body) {
      const mine = (docs.get(noteId) ?? []).join("\n");
      const merged = base === undefined ? null : threeWayMerge(base, mine, body);
      if (!merged?.ok) return;
      const lines = merged.merged.split("\n");
      docs.set(noteId, lines);
      taskSigs.set(noteId, taskSignature(lines));
      bump(noteId);
      const set = subs.get(noteId);
      if (set) for (const fn of set) fn();
    }
    const changedRevision = revisions.get(noteId) !== revision;
    revisions.set(noteId, revision);
    persistedBodies.set(noteId, body);
    if (changedRevision) {
      if (documentSaveError(noteId)?.startsWith("revision conflict")) setSaveError(noteId, null);
      scheduleSync(noteId);
    }
    return;
  }
  const next = body.split("\n");
  const cur = docs.get(noteId);
  // A same-body move still changes the complete-file hash. Adopt revision and
  // baseline before the visual no-op check so the next edit does not present a
  // stale pre-move revision.
  revisions.set(noteId, revision);
  persistedBodies.set(noteId, body);
  if (cur && cur.length === next.length && cur.every((l, i) => l === next[i])) return;
  docs.set(noteId, next);
  taskSigs.set(noteId, taskSignature(next));
  bump(noteId);
  markClean(noteId);
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** Drop a note's buffer + pending sync. The hook for the future delete path,
 * and the unknown-note sync failure — a dead buffer must never keep shadowing
 * (or writing over) service state. */
export function evictDocument(noteId: string): void {
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  clearTimeout(releaseTimers.get(noteId));
  releaseTimers.delete(noteId);
  timers.delete(noteId);
  retrying.delete(noteId);
  docs.delete(noteId);
  revisions.delete(noteId);
  persistedBodies.delete(noteId);
  pendingDocuments.delete(noteId);
  forgetProtection(noteId);
  taskSigs.delete(noteId);
  forgetEdits(noteId);
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
  // and an edited PREVIEW tab becomes a kept tab (the maintainer, 2026-07-28)
  if (!pendingDocuments.has(noteId)) {
    markNoteDraftChanged(noteId);
    keepTabsFor(noteId);
  }
  docs.set(noteId, edit(current));
  bump(noteId);
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
  scheduleSync(noteId);
}

/** Save the note's newest buffer. With a write already out, wait for it and
 * then save once more, from the newest buffer, on the revision that write
 * produced, unless it failed (its retry or conflict handling takes over) or
 * left nothing unsaved. Never two writes on one base revision. */
function syncNow(noteId: string): Promise<void> {
  const running = inflight.get(noteId);
  if (running) {
    let next = queued.get(noteId);
    if (!next) {
      const after = () => {
        queued.delete(noteId);
        if (!docs.has(noteId) || !hasUnsavedEdits(noteId) || documentSaveError(noteId)) return;
        return syncNow(noteId);
      };
      next = running.then(after, after);
      queued.set(noteId, next);
    }
    return next;
  }
  const write = writeNow(noteId);
  inflight.set(noteId, write);
  const settle = () => inflight.get(noteId) === write && inflight.delete(noteId);
  void write.then(settle, settle);
  return write;
}

function writeNow(noteId: string): Promise<void> {
  const lines = docs.get(noteId);
  if (!lines) return Promise.resolve();
  const generation = editGeneration(noteId);
  const expectedRevision = revisions.get(noteId);
  if (!expectedRevision) {
    setSaveError(noteId, "This note has no save revision. Reload it before editing.");
    return Promise.resolve();
  }
  const expectedBody = persistedBodies.get(noteId);
  if (expectedBody === undefined) {
    setSaveError(noteId, "This note has no saved-body baseline. Reload it before editing.");
    return Promise.resolve();
  }
  const body = lines.join("\n");
  return writeNoteBody(noteId, body, expectedRevision, expectedBody)
    .then((note) => {
      setSaveError(noteId, null);
      if (note) {
        revisions.set(noteId, note.revision);
        persistedBodies.set(noteId, body);
      }
      // what this write carried is on disk; typing since keeps the note dirty
      recordSaved(noteId, generation);
      refreshDirty(noteId);
      if (!note) return; // test stub — no cache to patch
      // SCOPED refresh (audit 2026-07-30, #1): patch the fresh note into the
      // caches instead of invalidating ["notes"] — that fanned into ~9
      // main-thread corpus walks per 400ms typing tick. Tasks re-derive only
      // when the checkbox lines changed.
      const sig = taskSignature(lines);
      const tasksChanged = taskSigs.get(noteId) !== sig;
      taskSigs.set(noteId, sig);
      const applied = applyNoteWrite(note, { tasksChanged });
      // A blank session draft is intentionally absent from Main. The fresh
      // note is already patched into the query cache synchronously above, so
      // its first durable non-empty save can now reveal a correctly titled
      // row without an intermediate "Untitled" frame.
      markNoteDraftSaved(noteId, body);
      return applied;
    })
    .catch((err: unknown) => {
      // Any failure (missing/renamed note, read-only volume, permissions, disk full) keeps the
      // buffer AND says so: the note stays dirty, the editor shows the error,
      // and a retry timer keeps the sync alive even with no further keystroke.
      // The retry rides the timers map, so quit-flush picks it up too.
      setSaveError(noteId, err instanceof Error ? err.message : String(err));
      refreshDirty(noteId); // unsaved, by the derived rule: never cleared here
      // A conflict never retries blindly: the live buffer stays intact and
      // dirty. It does get ONE honest attempt at self-resolution — read the
      // disk version and fold it in (reloadDocumentIfClean merges when the
      // two edits touched different lines and queues the save that lands).
      if (err instanceof Error && err.message.startsWith("revision conflict")) {
        void reconcileFromDisk(noteId);
        return;
      }
      if (err instanceof Error && err.message.startsWith("unknown note")) return;
      scheduleRetry(noteId);
    });
}

let readNote: (noteId: string) => Promise<Note | null> = (noteId) => notesService.getNote(noteId);

export function setReadNoteForTests(fn: typeof readNote | null): void {
  readNote = fn ?? ((noteId) => notesService.getNote(noteId));
}

async function reconcileFromDisk(noteId: string): Promise<void> {
  const note = await readNote(noteId).catch(() => null);
  if (!note || !isDirty(noteId)) return;
  reloadDocumentIfClean(noteId, note.body, note.revision);
}

/** Quit must never be held hostage by a conflict. The unsaved buffer becomes
 * a sibling note (same folder, title suffixed) so nothing is lost, and the
 * open note adopts the disk version. Returns the ids it copied. */
async function keepConflictCopies(): Promise<string[]> {
  const kept: string[] = [];
  for (const noteId of [...dirtyNoteIds()]) {
    if (!documentSaveError(noteId)?.startsWith("revision conflict")) continue;
    const mine = docs.get(noteId)?.join("\n");
    const note = await readNote(noteId).catch(() => null);
    if (mine === undefined || !note) continue;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const body = mine.startsWith("# ")
      ? mine.replace(/^# (.*)$/m, `# $1 (unsaved edits ${stamp})`)
      : `# Unsaved edits ${stamp}\n\n${mine}`;
    try {
      await notesService.createNote(note.folderId, body, {
        secure: note.secure === true,
        locked: note.locked === true,
      });
    } catch {
      continue; // still dirty: the flush reports it honestly below
    }
    const lines = note.body.split("\n");
    docs.set(noteId, lines);
    taskSigs.set(noteId, taskSignature(lines));
    revisions.set(noteId, note.revision);
    persistedBodies.set(noteId, note.body);
    setSaveError(noteId, null);
    bump(noteId);
    markClean(noteId);
    const set = subs.get(noteId);
    if (set) for (const fn of set) fn();
    kept.push(noteId);
  }
  return kept;
}

function scheduleRetry(noteId: string): void {
  if (timers.has(noteId)) return; // newer keystrokes already queued a sync
  retrying.add(noteId);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      retrying.delete(noteId);
      void syncNow(noteId);
    }, RETRY_DELAY_MS),
  );
}

function scheduleSync(noteId: string): void {
  refreshDirty(noteId);
  if (pendingDocuments.has(noteId)) return;
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  retrying.delete(noteId);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      void syncNow(noteId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** What a caller hears while a note is still being saved. */
export const STILL_SAVING = "Still saving. Try again in a moment.";
/** How long a flush waits for writes before it gives up (the writes go on). */
const FLUSH_LIMIT_MS = 10_000;

/** Flush ONE note. Resolves only when the buffer is saved by the derived rule
 * (everything typed has landed). Rejects with a failed save's own error (its
 * retry stays on the timer), and with STILL_SAVING when typing keeps ahead of
 * the saves or a write doesn't settle within `limitMs`; the saves are never
 * cancelled. What every read for a model waits on first, and the tab-switch
 * path (fourth and fifth reviews of pull request 267). */
export async function flushNote(noteId: string, limitMs = FLUSH_LIMIT_MS): Promise<void> {
  const deadline = Date.now() + limitMs;
  for (let round = 0; round < 8; round += 1) {
    const pending = timers.get(noteId);
    // new typing is saved now; a retry after a failed save is left to its timer
    if (pending !== undefined && !retrying.has(noteId)) {
      clearTimeout(pending);
      timers.delete(noteId);
      void syncNow(noteId);
    }
    const work = queued.get(noteId) ?? inflight.get(noteId);
    if (!work) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
    });
    const settled = await Promise.race([work.then(() => true), outOfTime]);
    clearTimeout(timer);
    if (!settled) throw new Error(STILL_SAVING);
  }
  if (!docs.has(noteId) || !hasUnsavedEdits(noteId)) return;
  throw new Error(documentSaveError(noteId) ?? STILL_SAVING);
}

/** One note's save state for savedVersion.ts: the editor's text, whether a
 * save waits or is out, and the revision it last saved. */
export const saveState = (noteId: string) => ({
  text: docs.get(noteId)?.join("\n"),
  pending: timers.has(noteId) || inflight.has(noteId) || queued.has(noteId),
  revision: revisions.get(noteId),
});

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
  retrying.clear();
  await Promise.allSettled(pending);
  // and every write already out or queued behind one (the quit handshake
  // bounds the wait in Rust, and an unfinished save aborts quit)
  while (inflight.size > 0 || queued.size > 0) {
    await Promise.allSettled([...inflight.values(), ...queued.values()]);
  }
  await keepConflictCopies();
  const unsaved = [...dirtyNoteIds()];
  if (unsaved.length > 0) {
    const detail = unsaved
      .map((noteId) => documentSaveError(noteId))
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

// A note's buffer outlived its last editor for the life of the window — two
// copies of every body ever opened (audit 2026-10-12). A CLEAN buffer nobody
// views is dropped after a grace period; reopening reseeds it from the note
// query. Unsaved, saving, failed, pending, or still-viewed buffers stay.
let releaseDelayMs = 30_000;
const releaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setReleaseDelayForTests(ms: number | null): void {
  releaseDelayMs = ms ?? 30_000;
}

function releasable(noteId: string): boolean {
  return (
    !subs.get(noteId)?.size &&
    !isDirty(noteId) &&
    !timers.has(noteId) &&
    !inflight.has(noteId) &&
    !queued.has(noteId) &&
    !pendingDocuments.has(noteId) &&
    documentSaveError(noteId) === null
  );
}

function scheduleRelease(noteId: string): void {
  clearTimeout(releaseTimers.get(noteId));
  releaseTimers.set(
    noteId,
    setTimeout(() => {
      releaseTimers.delete(noteId);
      if (!docs.has(noteId) || subs.get(noteId)?.size) return;
      // still unsaved, saving, or failed: look again later rather than keep
      // the buffer for the life of the window once it settles (review of PR 199)
      if (!releasable(noteId)) return scheduleRelease(noteId);
      docs.delete(noteId);
      revisions.delete(noteId);
      persistedBodies.delete(noteId);
      forgetProtection(noteId);
      taskSigs.delete(noteId);
      forgetEdits(noteId);
      subs.delete(noteId);
    }, releaseDelayMs),
  );
}

function subscribeDocument(noteId: string, fn: () => void): () => void {
  let set = subs.get(noteId);
  if (!set) {
    set = new Set();
    subs.set(noteId, set);
  }
  set.add(fn);
  clearTimeout(releaseTimers.get(noteId));
  releaseTimers.delete(noteId);
  return () => {
    set.delete(fn);
    if (set.size === 0) scheduleRelease(noteId);
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
