// A note's save queue. ONE operation per note at a time (`running`): a write,
// or a recovery step (folding in a change from disk, copying aside a conflict,
// keeping a deleted note's words). At most one more write waits (`queued`),
// and it saves the newest buffer against the revision the first produced. Two
// writes on the same base revision lost the newest typing in 1.9.1 and 1.8.0
// (fifth review of pull request 267); recovery running beside the queue lost
// it again (sixth review).
//
// A slow disk gets a message, never a second attempt (seventh review): every
// write and every recovery note's creation is waited for until it settles, so
// at most one change per note is ever on its way to the disk. After the bound
// the note says, by name, that it is taking longer than expected; its words
// stay in the buffer, it reads unsaved, and quit names it. Starting a second
// attempt beside an unresolved one is what let an old write land after quit
// was acknowledged. A read changes nothing, so a slow read is left behind.
//
// Buffers are buffers.ts's; saveExplorer.test.ts searches this file's schedules.

import { useSyncExternalStore } from "react";

import { titleOf } from "../services/derive";
import { applyNoteWrite, invalidateNotes } from "../services/hooks";
import { markNoteDraftSaved } from "../services/noteDrafts";
import { acceptedSince, readAgain, startRead, stampRead, takeRead, writeLanded } from "../services/noteReads";
import { useUiStore } from "../state/ui";
import type { Note } from "../types";
import {
  adopt,
  baselineOf,
  bufferLines,
  bufferText,
  forget,
  hasBuffer,
  isPendingDocument,
  recordLanded,
  refreshDirty,
  revisionOf,
  setTaskSignature,
  taskSignatureOf,
} from "./buffers";
import { threeWayMerge } from "./merge";
import { clock, type TimerHandle } from "./saveClock";
import { editGeneration, hasUnsavedEdits } from "./saveGenerations";
import { bounded, lane, type Protection, slowAfter } from "./saveLane";
import { dirtyNoteIds, documentSaveError, isDirty, setSaveError } from "./saveStatus";
import { taskSignature } from "./taskState";

const SYNC_DEBOUNCE_MS = 400;
// a failed write retries on its own — waiting for the next keystroke would
// leave a note that's done being typed in unsaved forever
const RETRY_DELAY_MS = 5000;
/** What a caller hears while a note is still being saved. */
export const STILL_SAVING = "Still saving. Try again in a moment.";
/** How long a flush waits for writes before it gives up (the writes go on). */
const FLUSH_LIMIT_MS = 10_000;
/** Quit's own bound, inside Rust's 15 seconds, so the refusal names the notes. */
const QUIT_LIMIT_MS = 12_000;

type Recovery = { id: string; revision: string; body: string };

const timers = new Map<string, TimerHandle>();
const running = new Map<string, { kind: "write" | "recovery"; done: Promise<unknown> }>();
const queued = new Map<string, Promise<void>>();
// the notes whose timer is a retry after a failed save rather than new typing
const retrying = new Set<string>();
// Notes whose one change on its way to the disk passed the bound, and what
// each one says.
const slow = new Map<string, string>();
// Bodies of this note's writes that failed without saying whether they landed
// (the answer was lost after the write): if the disk later holds one, it is
// Rotli's own, not another app's.
const unsure = new Map<string, Set<string>>();
// The words of each note's write on its way: a read showing exactly them is
// Rotli's own, landed and not yet answered (tenth explorer run).
const writing = new Map<string, string>();
// The recovery note made for each event (a conflict at one disk revision), so
// a later round updates it rather than making another; each event's id, made
// once and written into the note's metadata, so asking Rust again after an
// answer was lost gives back the note it made (never a look-up by text);
// and the title stamp the event's copy carries.
const recoveries = new Map<string, Recovery>();
const eventIds = new Map<string, string>();
const stamps = new Map<string, string>();
// Notes deleted while they had unsaved words, waiting for the person's choice.
const gone = new Set<string>();
const goneSubs = new Set<() => void>();

/** Forget every note's queue, as a fresh process would start (the save-state
 * explorer runs thousands of schedules in one process). */
export function resetSaveQueueForTests(): void {
  for (const timer of timers.values()) clock.clearTimeout(timer);
  for (const set of [timers, running, queued, retrying, slow, unsure, recoveries, eventIds, stamps, gone])
    set.clear();
  useUiStore.getState().setCopiedAside([]);
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
function exclusive<T>(noteId: string, kind: "write" | "recovery", op: () => Promise<T>): Promise<T> {
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

/** A change on its way to the disk for `noteId` (a write, or a recovery note's
 * creation). It is waited for until it settles: past the bound the note says
 * so, by name, and nothing is cancelled or started beside it. */
async function mutation<T>(noteId: string, change: () => Promise<T>): Promise<T> {
  // what the note said before (a conflict, say) comes back when the disk answers
  let before: string | null = null;
  const timer = clock.setTimeout(() => {
    const words = `${noteName(noteId)} is taking longer than expected to save. Its words are kept here; Rotli waits for the disk before it tries anything else`;
    before = documentSaveError(noteId);
    slow.set(noteId, words);
    setSaveError(noteId, words);
    refreshDirty(noteId);
  }, slowAfter());
  try {
    return await change();
  } finally {
    clock.clearTimeout(timer);
    const words = slow.get(noteId);
    slow.delete(noteId);
    if (words && documentSaveError(noteId) === words) setSaveError(noteId, before);
  }
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
  const lines = bufferLines(noteId);
  const expectedRevision = revisionOf(noteId);
  const expectedBody = baselineOf(noteId);
  // the newest edit has already landed (a timer outlived it): nothing to write
  if (!lines || !hasUnsavedEdits(noteId)) return;
  if (!expectedRevision)
    return setSaveError(noteId, "This note has no save revision. Reload it before editing.");
  if (expectedBody === undefined)
    return setSaveError(noteId, "This note has no saved-body baseline. Reload it before editing.");
  const generation = editGeneration(noteId);
  const body = lines.join("\n");
  let note: Note | void;
  const since = startRead();
  writing.set(noteId, body);
  try {
    note = await mutation(noteId, () => lane.write(noteId, body, expectedRevision, expectedBody));
  } catch (error) {
    writing.delete(noteId);
    return onFailure(noteId, error, body);
  }
  writing.delete(noteId);
  setSaveError(noteId, null);
  unsure.delete(noteId);
  // every read of this note that started before now is older than the disk
  writeLanded(noteId);
  if (note) recordLanded(noteId, body, note.revision);
  // what this write carried is on disk; typing since keeps the note unsaved
  adopt(noteId, generation, { saved: true });
  // An answer's arrival isn't the order things happened on disk: a read taken
  // in while this write was out may have shown a version newer than it (not
  // what it wrote, nor what it was based on). Fold that in, never call the
  // older words saved over it.
  const seen = note ? acceptedSince(noteId, since) : null;
  if (note && seen && seen.revision !== note.revision && seen.revision !== expectedRevision)
    reloadDocument(noteId, seen.body, seen.revision);
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
async function onFailure(noteId: string, error: unknown, body: string): Promise<void> {
  if (isGone(error)) return markGone(noteId);
  setSaveError(noteId, error instanceof Error ? error.message : String(error));
  refreshDirty(noteId);
  // A conflict wrote nothing, and never retries blindly: it gets ONE honest
  // attempt at self-resolution, inside this operation, before anything else
  // writes.
  if (isConflict(error)) return reconcileFromDisk(noteId);
  // Anything else may have been written before it failed.
  const mine = unsure.get(noteId) ?? new Set<string>();
  mine.add(body);
  unsure.set(noteId, mine);
  scheduleRetry(noteId);
}

function markGone(noteId: string): void {
  gone.add(noteId);
  for (const fn of goneSubs) fn();
  setSaveError(noteId, `${noteName(noteId)} was deleted while it had unsaved words`);
  refreshDirty(noteId);
}

/** The queue's own read, numbered like every other (noteReads.ts): undefined when
 * it didn't answer or something newer was taken in (then it reads again), null when gone. */
async function readFile(noteId: string): Promise<Note | null | undefined> {
  const startedAt = startRead();
  const note = await bounded(() => lane.read(noteId));
  if (!note) return note;
  if (!takeRead(stampRead(note, startedAt))) {
    if (note.revision !== revisionOf(noteId)) readAgain(noteId);
    return undefined;
  }
  return note;
}

async function reconcileFromDisk(noteId: string): Promise<void> {
  const note = await readFile(noteId);
  if (!note || !isDirty(noteId)) return;
  if (unsure.get(noteId)?.has(note.body)) return rebaseOnOwn(noteId, note);
  reloadDocument(noteId, note.body, note.revision);
}

/** The disk holds a write of Rotli's own whose answer was lost: it becomes the
 * base, and the buffer (the person's newest words) saves on it. */
function rebaseOnOwn(noteId: string, note: Note): void {
  unsure.delete(noteId);
  recordLanded(noteId, note.body, note.revision);
  setSaveError(noteId, null);
  if (bufferText(noteId) === note.body) adopt(noteId, editGeneration(noteId), { saved: true });
  else scheduleSync(noteId);
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
  // a write of Rotli's own may have landed without saying so (or is landed and
  // still unanswered): that is no other app's text, so nothing is merged
  if (unsure.has(noteId) || writing.get(noteId) === body) return;
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

/** The recovery note for one event, made at most once. A later round with
 * newer words updates it. The create carries the event's id, and Rust gives
 * back the note it made for that id (protection checked) rather than making
 * another, so a create whose answer was lost is simply asked again. */
async function recoveryNote(
  noteId: string,
  event: string,
  folder: string,
  body: string,
  protection: Protection,
): Promise<Recovery> {
  let made = recoveries.get(event);
  if (!made) {
    const id = eventIds.get(event) ?? crypto.randomUUID();
    eventIds.set(event, id);
    const ask = () => mutation(noteId, () => lane.create(folder, body, protection, id));
    // an answer lost after Rust made the note: asking again gives that note back
    const note = await ask().catch(ask);
    made = { id: note.id, revision: note.revision, body: note.body };
    recoveries.set(event, made);
  }
  if (made.body !== body) {
    made = await updateRecovery(noteId, made, body);
    recoveries.set(event, made);
  }
  return made;
}

/** Newer words into a recovery note already made for the same event. */
async function updateRecovery(noteId: string, made: Recovery, body: string): Promise<Recovery> {
  try {
    const written = await mutation(noteId, () => lane.write(made.id, body, made.revision, made.body));
    return { id: made.id, revision: written ? written.revision : made.revision, body };
  } catch (error) {
    // the answer may have been lost after the write: look before trying again
    const now = await bounded(() => lane.read(made.id));
    if (now?.body !== body) throw error;
    return { id: made.id, revision: now.revision, body };
  }
}

/** Quit must never be held hostage by a conflict. The unsaved buffer becomes a
 * sibling note (same folder, title suffixed, same protection and lock) and the
 * open note adopts the disk version, read again after the copy is made. Words
 * typed while the copy was made stay in the buffer, and the next round writes
 * them into the same copy. */
async function keepConflictCopy(noteId: string): Promise<void> {
  if (!isDirty(noteId) || !documentSaveError(noteId)?.startsWith("revision conflict")) return;
  const generation = editGeneration(noteId);
  const mine = bufferText(noteId);
  const note = await readFile(noteId);
  // No file to read (or no answer; a Mac read says null for both): the write
  // lane tells the two apart. One attempt: it lands, says the note is gone, or
  // conflicts again.
  if (note === null) return writeNow(noteId);
  if (mine === undefined || !note) return;
  // the "conflict" is Rotli's own write whose answer was lost: no copy
  if (unsure.get(noteId)?.has(note.body)) return rebaseOnOwn(noteId, note);
  const event = `${noteId}@${note.revision}`;
  const stamp = stamps.get(event) ?? new Date(clock.now()).toISOString().slice(0, 16).replace("T", " ");
  stamps.set(event, stamp);
  const body = mine.startsWith("# ")
    ? mine.replace(/^# (.*)$/m, `# $1 (unsaved edits ${stamp})`)
    : `# Unsaved edits ${stamp}\n\n${mine}`;
  try {
    // a read that can't say the note is unprotected counts as protected
    await recoveryNote(noteId, event, note.folderId, body, {
      secure: note.secure !== false,
      locked: note.locked === true,
    });
  } catch {
    return; // still unsaved: quit reports it
  }
  // the file may have changed again while the copy was made
  const now = await readFile(noteId);
  if (!now || now.revision !== note.revision) return;
  const disk = { body: now.body, revision: now.revision };
  const made = recoveries.get(event)!;
  if (adopt(noteId, generation, { disk, lines: now.body.split("\n"), saved: true })) {
    setSaveError(noteId, null);
    recoveries.delete(event);
    eventIds.delete(event);
    stamps.delete(event);
    // say where the words went (one entry per copy, kept across a restart),
    // and let the copy show in the lists
    const told = useUiStore.getState().copiedAside;
    if (!told.some((entry) => entry.copyId === made.id))
      useUiStore
        .getState()
        .setCopiedAside([
          ...told,
          { copyId: made.id, copyName: `“${titleOf(made.body)}”`, noteName: noteName(noteId) },
        ]);
    void invalidateNotes();
  }
}

function scheduleRetry(noteId: string): void {
  if (timers.has(noteId)) return; // newer keystrokes already queued a sync
  retrying.add(noteId);
  timers.set(
    noteId,
    clock.setTimeout(() => {
      timers.delete(noteId);
      retrying.delete(noteId);
      void syncNow(noteId);
    }, RETRY_DELAY_MS),
  );
}

export function scheduleSync(noteId: string): void {
  refreshDirty(noteId);
  if (isPendingDocument(noteId) || gone.has(noteId)) return;
  clock.clearTimeout(timers.get(noteId));
  retrying.delete(noteId);
  timers.set(
    noteId,
    clock.setTimeout(() => {
      timers.delete(noteId);
      void syncNow(noteId);
    }, SYNC_DEBOUNCE_MS),
  );
}

/** Forget a note's queue state (its buffer is going away). Running writes
 * finish; their outcome finds no buffer and changes nothing. */
export function forgetQueue(noteId: string): void {
  clock.clearTimeout(timers.get(noteId));
  timers.delete(noteId);
  retrying.delete(noteId);
  unsure.delete(noteId);
  if (gone.delete(noteId)) for (const fn of goneSubs) fn();
}

/** Flush ONE note. Resolves only when the buffer is saved by the derived rule
 * (everything typed has landed). Rejects with a failed save's own error (its
 * retry stays on the timer), and with STILL_SAVING when typing keeps ahead of
 * the saves or the writes don't settle within `limitMs`; the saves are never
 * cancelled. What every read for a model waits on first. */
export async function flushNote(noteId: string, limitMs = FLUSH_LIMIT_MS): Promise<void> {
  const deadline = clock.now() + limitMs;
  while (clock.now() < deadline) {
    const pending = timers.get(noteId);
    // new typing is saved now; a retry after a failed save is left to its timer
    if (pending !== undefined && !retrying.has(noteId)) {
      clock.clearTimeout(pending);
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
  let timer: TimerHandle | undefined;
  const outOfTime = new Promise<false>((resolve) => {
    timer = clock.setTimeout(() => resolve(false), Math.max(0, deadline - clock.now()));
  });
  const settled = await Promise.race([
    work.then(
      () => true,
      () => true,
    ),
    outOfTime,
  ]);
  clock.clearTimeout(timer);
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
  if (gone.has(noteId)) return `${name} was deleted while it had unsaved words: copy them, or discard them`;
  if (slow.has(noteId)) return `${name} is still waiting on the disk: its words are kept here, not saved`;
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
 * within its own bound (Rust's 15-second wait is the backstop). A write still
 * on its way to the disk always refuses quit: it could land afterwards. */
export async function flushSyncs(limitMs = QUIT_LIMIT_MS): Promise<void> {
  const deadline = clock.now() + limitMs;
  for (let round = 0; round < 6 && clock.now() < deadline; round += 1) {
    for (const [noteId, timer] of [...timers]) {
      // a retry after a failure gets one attempt per quit, not one per round
      if (round > 0 && retrying.has(noteId)) continue;
      clock.clearTimeout(timer);
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
  const reasons = quitReasons();
  if (reasons) throw new Error(reasons);
}

/** What still stands in quit's way, note by note, in words; null when nothing
 * does. Starts nothing: quit's final check (quitFlush.ts) runs it after every
 * flusher has finished. */
export function quitReasons(): string | null {
  const reasons = [
    ...new Set([...dirtyNoteIds(), ...timers.keys(), ...running.keys(), ...queued.keys(), ...gone]),
  ]
    .map(outstanding)
    .filter((reason): reason is string => reason !== null);
  return reasons.length > 0 ? reasons.join("; ") : null;
}

// ——— a note deleted while it had unsaved words (sixth review, F3): the
// person chooses, in plain words; either choice lets quit complete. ———

/** The notes waiting for the person's choice, read once (not a hook). */
export const goneNotes = (): string[] => [...gone];

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

/** A deleted note's file is there again (a fresh read found it): it saves
 * again. The caller folds the file in through the merge path. */
export function reviveGoneNote(noteId: string): void {
  if (!gone.delete(noteId)) return;
  for (const fn of goneSubs) fn();
  setSaveError(noteId, null);
  scheduleSync(noteId);
}

/** Let the words go. Rotli doesn't make a note of them itself (eighth review:
 * that handoff couldn't be shown safe); the notice offers to copy them first. */
export function discardGoneNote(noteId: string): void {
  if (gone.has(noteId)) letGo(noteId);
}

const letGo = (noteId: string) => {
  forgetQueue(noteId);
  forget(noteId);
};
