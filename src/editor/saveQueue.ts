// A note's save queue. ONE operation per note at a time (`running`): a write,
// or a recovery step (folding in a change from disk, copying aside a conflict,
// keeping a deleted note's words). At most one more write waits (`queued`),
// and it saves the newest buffer against the revision the first produced. Two
// writes on the same base revision lost the newest typing in 1.9.1 and 1.8.0
// (fifth review of pull request 267); recovery running beside the queue lost
// it again (sixth review). Buffers are buffers.ts's; this file decides when to
// write and what a write's outcome means.

import { useSyncExternalStore } from "react";

import { applyNoteWrite } from "../services/hooks";
import { markNoteDraftSaved } from "../services/noteDrafts";
import { inboxFolderId, notesService } from "../services/notes";
import type { Note } from "../types";
import {
  adopt,
  baselineOf,
  bufferLines,
  bufferText,
  forget,
  hasBuffer,
  isPendingDocument,
  markUnsaved,
  recordLanded,
  refreshDirty,
  revisionOf,
  setTaskSignature,
  taskSignatureOf,
} from "./buffers";
import { threeWayMerge } from "./merge";
import { editGeneration, hasUnsavedEdits } from "./saveGenerations";
import { dirtyNoteIds, documentSaveError, isDirty, setSaveError } from "./saveStatus";
import { taskSignature } from "./taskState";
import { protectionOf } from "./unsavedDrafts";

const SYNC_DEBOUNCE_MS = 400;
// a failed write retries on its own — waiting for the next keystroke would
// leave a note that's done being typed in unsaved forever
const RETRY_DELAY_MS = 5000;
/** How long one write may take before the note says it didn't finish. The
 * write itself can't be cancelled; the queue moves on and checks the disk. */
let writeLimitMs = 8000;
/** What a caller hears while a note is still being saved. */
export const STILL_SAVING = "Still saving. Try again in a moment.";
/** How long a flush waits for writes before it gives up (the writes go on). */
const FLUSH_LIMIT_MS = 10_000;
/** Quit's own bound, inside Rust's 15 seconds, so the refusal names the notes. */
const QUIT_LIMIT_MS = 12_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, { kind: "write" | "recovery"; done: Promise<void> }>();
const queued = new Map<string, Promise<void>>();
// the notes whose timer is a retry after a failed save rather than new typing
const retrying = new Set<string>();
// A write that hit the bound: its body, until the retry has read the disk.
const stalled = new Map<string, string>();
// Bodies of writes that hit the bound and haven't settled: if one of them is
// what a conflict finds on disk, it's Rotli's own late write, not an outside
// edit, and the buffer (newer) wins.
const lateBodies = new Map<string, Set<string>>();
// Notes deleted while they had unsaved words, waiting for the person's choice.
const gone = new Set<string>();
const goneSubs = new Set<() => void>();

// The write lane, the read and the create — swappable so tests can drive a
// fake that follows Rust's contract, or the real Rust store (harness).
type WriteBody = (noteId: string, body: string, revision: string, base: string) => Promise<Note | void>;
type ReadNote = (noteId: string) => Promise<Note | null>;
type CreateNote = (
  folderId: string,
  body: string,
  protection: { secure: boolean; locked: boolean },
) => Promise<Note>;
const lane = {
  write: ((id, body, revision, base) => notesService.updateNote(id, body, revision, base)) as WriteBody,
  read: ((id) => notesService.getNote(id)) as ReadNote,
  create: ((folder, body, protection) => notesService.createNote(folder, body, protection)) as CreateNote,
};
const defaults = { ...lane };
export function setWriteNoteBodyForTests(fn: WriteBody | null): void {
  lane.write = fn ?? defaults.write;
}
export function setReadNoteForTests(fn: ReadNote | null): void {
  lane.read = fn ?? defaults.read;
}
export function setCreateNoteForTests(fn: CreateNote | null): void {
  lane.create = fn ?? defaults.create;
}
export function setWriteLimitForTests(ms: number | null): void {
  writeLimitMs = ms ?? 8000;
}

/** The note's name, for messages that must say which note. */
export function noteName(noteId: string): string {
  const first = bufferLines(noteId)?.find((line) => line.trim()) ?? "";
  const title = first.replace(/^#+\s*/, "").trim();
  return title ? `“${title.length > 60 ? `${title.slice(0, 59)}…` : title}”` : "An untitled note";
}

const isConflict = (error: unknown) =>
  error instanceof Error && error.message.startsWith("revision conflict");
const isGone = (error: unknown) =>
  error instanceof Error && /^(unknown note|note not found)/.test(error.message);

/** Run `op` as the note's one operation, after whatever is running or queued. */
function exclusive(noteId: string, kind: "write" | "recovery", op: () => Promise<void>): Promise<void> {
  const before = queued.get(noteId) ?? running.get(noteId)?.done;
  if (before) {
    const again = () => exclusive(noteId, kind, op);
    return before.then(again, again);
  }
  const done = op();
  const entry = { kind, done };
  running.set(noteId, entry);
  const settle = () => {
    if (running.get(noteId) === entry) running.delete(noteId);
  };
  void done.then(settle, settle);
  return done;
}

/** Save the note's newest buffer. With an operation already running, wait for
 * it and then save once more, from the newest buffer, on the revision it left,
 * unless it failed (its retry or conflict handling takes over) or left nothing
 * unsaved. Never two writes on one base revision. */
export function syncNow(noteId: string): Promise<void> {
  const current = running.get(noteId);
  if (current) {
    let next = queued.get(noteId);
    if (!next) {
      const after = () => {
        queued.delete(noteId);
        if (!hasBuffer(noteId) || !hasUnsavedEdits(noteId) || documentSaveError(noteId) || gone.has(noteId))
          return;
        return syncNow(noteId);
      };
      next = current.done.then(after, after);
      queued.set(noteId, next);
    }
    return next;
  }
  return exclusive(noteId, "write", () => writeNow(noteId));
}

async function writeNow(noteId: string): Promise<void> {
  if (gone.has(noteId)) return;
  if (stalled.has(noteId)) await checkStalled(noteId);
  const lines = bufferLines(noteId);
  const expectedRevision = revisionOf(noteId);
  const expectedBody = baselineOf(noteId);
  if (!lines) return;
  if (!expectedRevision)
    return setSaveError(noteId, "This note has no save revision. Reload it before editing.");
  if (expectedBody === undefined)
    return setSaveError(noteId, "This note has no saved-body baseline. Reload it before editing.");
  const generation = editGeneration(noteId);
  const body = lines.join("\n");
  const write = lane.write(noteId, body, expectedRevision, expectedBody);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    write.then(
      (note) => ({ landed: note }),
      (error: unknown) => ({ error }),
    ),
    new Promise<"stalled">((resolve) => {
      timer = setTimeout(() => resolve("stalled"), writeLimitMs);
    }),
  ]);
  clearTimeout(timer);
  if (result === "stalled") return onStall(noteId, body, write);
  if ("error" in result) return onFailure(noteId, result.error);
  setSaveError(noteId, null);
  const note = result.landed;
  if (note) recordLanded(noteId, body, note.revision);
  // what this write carried is on disk; typing since keeps the note unsaved
  adopt(noteId, generation, { saved: true });
  if (!note) return; // test stub — no cache to patch
  // SCOPED refresh (audit 2026-07-30, #1): patch the fresh note into the
  // caches instead of invalidating ["notes"]. Tasks re-derive only when the
  // checkbox lines changed.
  const signature = taskSignature(lines);
  const tasksChanged = taskSignatureOf(noteId) !== signature;
  setTaskSignature(noteId, signature);
  await applyNoteWrite(note, { tasksChanged });
  // A blank session draft is absent from Main until its first non-empty save.
  markNoteDraftSaved(noteId, body);
}

/** Any failure (read-only volume, permissions, disk full) keeps the buffer AND
 * says so: the note stays unsaved, the editor shows the error, and a retry
 * timer keeps the sync alive even with no further keystroke. */
async function onFailure(noteId: string, error: unknown): Promise<void> {
  if (isGone(error)) {
    gone.add(noteId);
    for (const fn of goneSubs) fn();
    setSaveError(noteId, `${noteName(noteId)} was deleted while it had unsaved words`);
    refreshDirty(noteId);
    return;
  }
  setSaveError(noteId, error instanceof Error ? error.message : String(error));
  refreshDirty(noteId);
  // A conflict never retries blindly: it gets ONE honest attempt at
  // self-resolution, inside this operation, before anything else writes.
  if (isConflict(error)) return reconcileFromDisk(noteId);
  scheduleRetry(noteId);
}

/** The write didn't finish within the bound. The note says so, by name; its
 * words stay in the buffer and the recovery copy; the retry reads the disk
 * first (did it land?) and writes against what it finds. A late landing is
 * handled when it comes, in the queue. */
function onStall(noteId: string, body: string, write: Promise<Note | void>): void {
  stalled.set(noteId, body);
  const late = lateBodies.get(noteId) ?? new Set<string>();
  late.add(body);
  lateBodies.set(noteId, late);
  setSaveError(
    noteId,
    `${noteName(noteId)} didn’t finish saving in time; Rotli checks what reached the disk before it tries again`,
  );
  refreshDirty(noteId);
  scheduleRetry(noteId);
  const settled = (landed: Note | void | null) =>
    void exclusive(noteId, "recovery", async () => {
      if (landed) adoptOwnLanding(noteId, body, landed.revision);
      lateBodies.get(noteId)?.delete(body);
    });
  write.then(settled, () => settled(null));
}

/** Rotli's own stalled write is on disk at `revision`. The buffer is the
 * person's newest words, so it wins: the baseline moves to the disk, and the
 * buffer saves again unless it already says the same. */
function adoptOwnLanding(noteId: string, body: string, revision: string): void {
  if (!hasBuffer(noteId) || revisionOf(noteId) === revision) return;
  recordLanded(noteId, body, revision);
  if (documentSaveError(noteId)) setSaveError(noteId, null);
  if (bufferText(noteId) === body) {
    adopt(noteId, editGeneration(noteId), { saved: true });
    return;
  }
  markUnsaved(noteId);
  scheduleSync(noteId);
}

/** Before a retry after a stall: read the disk. */
async function checkStalled(noteId: string): Promise<void> {
  const body = stalled.get(noteId)!;
  stalled.delete(noteId);
  const disk = await lane.read(noteId).catch(() => null);
  if (!disk) return;
  if (disk.body === body) adoptOwnLanding(noteId, body, disk.revision);
  else if (disk.revision !== revisionOf(noteId)) reloadDocument(noteId, disk.body, disk.revision);
}

async function reconcileFromDisk(noteId: string): Promise<void> {
  const note = await lane.read(noteId).catch(() => null);
  if (!note || !isDirty(noteId)) return;
  if (lateBodies.get(noteId)?.has(note.body)) return adoptOwnLanding(noteId, note.body, note.revision);
  reloadDocument(noteId, note.body, note.revision);
}

/** Disk truth for a note that has a buffer. A clean buffer takes it; one with
 * unsaved edits folds both together when they touched different lines (a
 * metadata-only change just moves the base); overlapping edits stay a
 * visible conflict. */
export function reloadDocument(noteId: string, body: string, revision: string): void {
  const generation = editGeneration(noteId);
  const disk = { body, revision };
  if (!isDirty(noteId)) {
    adopt(noteId, generation, { disk, lines: body.split("\n"), saved: true });
    return;
  }
  const base = baselineOf(noteId);
  const moved = revisionOf(noteId) !== revision;
  if (base !== body) {
    const merged = base === undefined ? null : threeWayMerge(base, bufferText(noteId) ?? "", body);
    if (!merged?.ok) return;
    adopt(noteId, generation, { disk, lines: merged.merged.split("\n"), saved: false });
  } else {
    adopt(noteId, generation, { disk, saved: false });
  }
  // a new base: the conflict is resolved, and the buffer saves on it
  if (!moved) return;
  if (documentSaveError(noteId)?.startsWith("revision conflict")) setSaveError(noteId, null);
  scheduleSync(noteId);
}

/** Quit must never be held hostage by a conflict. The unsaved buffer becomes a
 * sibling note (same folder, title suffixed, same protection) and the open
 * note adopts the disk version, unless the person typed while the copy was
 * made: then the newer words stay and the next round copies them too. */
async function keepConflictCopy(noteId: string): Promise<void> {
  if (!isDirty(noteId) || !documentSaveError(noteId)?.startsWith("revision conflict")) return;
  const generation = editGeneration(noteId);
  const mine = bufferText(noteId);
  const note = await lane.read(noteId).catch(() => null);
  if (mine === undefined || !note) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const body = mine.startsWith("# ")
    ? mine.replace(/^# (.*)$/m, `# $1 (unsaved edits ${stamp})`)
    : `# Unsaved edits ${stamp}\n\n${mine}`;
  try {
    // a read that can't say the note is unprotected counts as protected
    await lane.create(note.folderId, body, { secure: note.secure !== false, locked: note.locked === true });
  } catch {
    return; // still unsaved: quit reports it
  }
  const disk = { body: note.body, revision: note.revision };
  if (adopt(noteId, generation, { disk, lines: note.body.split("\n"), saved: true }))
    setSaveError(noteId, null);
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

export function scheduleSync(noteId: string): void {
  refreshDirty(noteId);
  if (isPendingDocument(noteId) || gone.has(noteId)) return;
  clearTimeout(timers.get(noteId));
  retrying.delete(noteId);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      void syncNow(noteId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** Forget a note's queue state (its buffer is going away). Running writes
 * finish; their outcome finds no buffer and changes nothing. */
export function forgetQueue(noteId: string): void {
  clearTimeout(timers.get(noteId));
  timers.delete(noteId);
  retrying.delete(noteId);
  stalled.delete(noteId);
  if (gone.delete(noteId)) for (const fn of goneSubs) fn();
}

/** Flush ONE note. Resolves only when the buffer is saved by the derived rule
 * (everything typed has landed). Rejects with a failed save's own error (its
 * retry stays on the timer), and with STILL_SAVING when typing keeps ahead of
 * the saves or the writes don't settle within `limitMs`; the saves are never
 * cancelled. What every read for a model waits on first. */
export async function flushNote(noteId: string, limitMs = FLUSH_LIMIT_MS): Promise<void> {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    const pending = timers.get(noteId);
    // new typing is saved now; a retry after a failed save is left to its timer
    if (pending !== undefined && !retrying.has(noteId)) {
      clearTimeout(pending);
      timers.delete(noteId);
      void syncNow(noteId);
    }
    const work = queued.get(noteId) ?? running.get(noteId)?.done;
    if (!work) break;
    if (!(await settlesBy(work, deadline))) throw new Error(STILL_SAVING);
  }
  if (!hasBuffer(noteId) || !hasUnsavedEdits(noteId)) return;
  throw new Error(documentSaveError(noteId) ?? STILL_SAVING);
}

async function settlesBy(work: Promise<unknown>, deadline: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
  });
  const settled = await Promise.race([
    work.then(
      () => true,
      () => true,
    ),
    outOfTime,
  ]);
  clearTimeout(timer);
  return settled;
}

/** One note's save state for savedVersion.ts: the editor's text, whether a
 * save waits or is out, and the revision it last saved. */
export const saveState = (noteId: string) => ({
  text: bufferText(noteId),
  pending: timers.has(noteId) || running.has(noteId) || queued.has(noteId),
  revision: revisionOf(noteId),
});

/** True while a timer, a queued write or a running operation is outstanding. */
export const queueBusy = (noteId: string): boolean =>
  timers.has(noteId) || running.has(noteId) || queued.has(noteId);

/** What is still outstanding for one note, in words for quit's refusal. */
function outstanding(noteId: string): string | null {
  const name = noteName(noteId);
  if (gone.has(noteId))
    return `${name} was deleted while it had unsaved words: keep them as a new note or discard them`;
  const work = running.get(noteId);
  if (work?.kind === "recovery") return `${name} is still being recovered`;
  if (work || queued.has(noteId)) return `${name} is still saving`;
  if (timers.has(noteId) && !retrying.has(noteId)) return `${name} has a save waiting`;
  if (isDirty(noteId)) {
    const error = documentSaveError(noteId);
    return error?.startsWith(name) ? error : `${name} has unsaved edits${error ? ` (${error})` : ""}`;
  }
  return null;
}

/** The quit and reload path: save every note now. Resolves only when no note
 * has a timer, a queued write, a running write or recovery, or unsaved edits
 * outstanding; otherwise rejects, naming each note and what is outstanding,
 * within its own bound (Rust's 15-second wait is the backstop). */
export async function flushSyncs(limitMs = QUIT_LIMIT_MS): Promise<void> {
  const deadline = Date.now() + limitMs;
  for (let round = 0; round < 6 && Date.now() < deadline; round += 1) {
    for (const [noteId, timer] of [...timers]) {
      // a retry after a failure gets one attempt per quit, not one per round
      if (round > 0 && retrying.has(noteId)) continue;
      clearTimeout(timer);
      timers.delete(noteId);
      retrying.delete(noteId);
      void syncNow(noteId);
    }
    while (running.size > 0 || queued.size > 0) {
      const work = [...running.values()].map((entry) => entry.done).concat([...queued.values()]);
      if (!(await settlesBy(Promise.allSettled(work), deadline))) break;
    }
    // conflict recovery runs in each note's own queue
    const conflicted = [...dirtyNoteIds()].filter((id) =>
      documentSaveError(id)?.startsWith("revision conflict"),
    );
    await settlesBy(
      Promise.allSettled(conflicted.map((id) => exclusive(id, "recovery", () => keepConflictCopy(id)))),
      deadline,
    );
    const typing = [...timers.keys()].some((id) => !retrying.has(id));
    if (!typing && running.size === 0 && queued.size === 0) break;
  }
  const reasons = [
    ...new Set([...dirtyNoteIds(), ...timers.keys(), ...running.keys(), ...queued.keys(), ...gone]),
  ]
    .map(outstanding)
    .filter((reason): reason is string => reason !== null);
  if (reasons.length > 0) throw new Error(reasons.join("; "));
}

// ——— a note deleted while it had unsaved words (sixth review, F3): the
// person chooses, in plain words; either choice lets quit complete. ———

export function useGoneNotes(): string[] {
  return useSyncExternalStore((fn) => {
    goneSubs.add(fn);
    return () => goneSubs.delete(fn);
  }, goneSnapshot);
}
let goneCache: string[] = [];
function goneSnapshot(): string[] {
  if (goneCache.length !== gone.size || goneCache.some((id) => !gone.has(id))) goneCache = [...gone];
  return goneCache;
}

/** Keep the words as a new note in the Inbox, protected as the deleted note
 * was (or protected, when that isn't known). */
export function keepGoneNote(noteId: string): Promise<void> {
  return exclusive(noteId, "recovery", async () => {
    const text = bufferText(noteId);
    if (!gone.has(noteId) || text === undefined) return;
    const protection = protectionOf(noteId);
    await lane.create(inboxFolderId, text, {
      secure: protection?.secure ?? true,
      locked: protection?.locked ?? false,
    });
    letGo(noteId);
  });
}

/** Let the words go. */
export function discardGoneNote(noteId: string): void {
  if (gone.has(noteId)) letGo(noteId);
}

const letGo = (noteId: string) => {
  forgetQueue(noteId);
  forget(noteId);
};
