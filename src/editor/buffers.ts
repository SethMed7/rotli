// The editor's buffers: ONE per note across all tabs and panes (the r2
// structural lock #4), each the note's Markdown split into lines, with the
// disk revision and editor body it was last known to match. State only:
// saving lives in saveQueue.ts, the public API in model.ts.
//
// Every replacement of a buffer and every "this note is saved" decision goes
// through `adopt`, which takes the edit generation the decision was computed
// for and does nothing if typing has moved it since (sixth review of pull
// request 267: a conflict copy that finished after the person typed more
// replaced their words with the outside version and called the note saved).
// Typing goes through `edit`; a buffer that doesn't exist yet is made by
// `seed`. Nothing else in the app can reach these maps, and
// scripts/check-owners.mjs keeps it that way inside this file.

import { bumpGeneration, editGeneration, forgetEdits, hasUnsavedEdits, recordSaved } from "./saveGenerations";
import { setDirty, setSaveError } from "./saveStatus";
import { taskSignature } from "./taskState";
import { forgetProtection } from "./unsavedDrafts";

const docs = new Map<string, string[]>();
const revisions = new Map<string, string>();
// The editor body that produced `revisions[noteId]`. Rotli-managed moves and
// metadata writes change the complete-file revision without changing this
// prose; keeping the body baseline lets the write lane tell that safe case
// from a genuine concurrent body edit.
const persistedBodies = new Map<string, string>();
// A Command-T note can be edited before its durable file exists. Pending
// buffers are real shared editor documents, but they deliberately have no save
// timer until creation hands them a stable note id + disk revision.
const pendingDocuments = new Set<string>();
const subs = new Map<string, Set<() => void>>();
// checkbox signature (taskState.ts): a body sync invalidates the Tasks
// projection only when the note's checkbox lines changed (perf audit 2026-07-30).
const taskSigs = new Map<string, string>();

/** A file on disk: its editor body and complete-file revision. */
export interface DiskVersion {
  body: string;
  revision: string;
}

export const hasBuffer = (noteId: string): boolean => docs.has(noteId);
export const bufferLines = (noteId: string): string[] | undefined => docs.get(noteId);
export const bufferText = (noteId: string): string | undefined => docs.get(noteId)?.join("\n");
export const revisionOf = (noteId: string): string | undefined => revisions.get(noteId);
export const baselineOf = (noteId: string): string | undefined => persistedBodies.get(noteId);
export const isPendingDocument = (noteId: string): boolean => pendingDocuments.has(noteId);
export const taskSignatureOf = (noteId: string): string | undefined => taskSigs.get(noteId);
export const viewers = (noteId: string): number => subs.get(noteId)?.size ?? 0;

/** The save dot and the recovery journal follow the derived rule (saveGenerations.ts). */
export function refreshDirty(noteId: string): void {
  setDirty(noteId, docs.has(noteId) && hasUnsavedEdits(noteId));
}

function notify(noteId: string): void {
  const set = subs.get(noteId);
  if (set) for (const fn of set) fn();
}

/** Make a buffer that doesn't exist yet: from disk (saved), or a Command-T
 * draft with no file (`disk` omitted). No-op when the note already has one. */
export function seed(noteId: string, lines: string[], disk?: DiskVersion): void {
  if (docs.has(noteId)) return;
  docs.set(noteId, lines);
  taskSigs.set(noteId, taskSignature(lines));
  if (disk) {
    revisions.set(noteId, disk.revision);
    persistedBodies.set(noteId, disk.body);
    recordSaved(noteId);
  } else {
    persistedBodies.set(noteId, lines.join("\n"));
    pendingDocuments.add(noteId);
  }
  refreshDirty(noteId);
}

/** The person (or an editor command) changed the text. */
export function edit(noteId: string, lines: string[]): void {
  if (!docs.has(noteId)) return;
  docs.set(noteId, lines);
  bumpGeneration(noteId);
  refreshDirty(noteId);
  notify(noteId);
}

/**
 * THE one place a buffer is replaced or declared saved. `generation` is the
 * edit generation the change was computed for: when typing has moved it
 * since, nothing changes and the answer is false.
 * - `disk`: the file the change came from (it becomes the save baseline);
 * - `lines`: the buffer's new text;
 * - `saved`: the buffer now matches `disk` (or the baseline already held).
 */
export function adopt(
  noteId: string,
  generation: number,
  change: { disk?: DiskVersion; lines?: string[]; saved: boolean },
): boolean {
  if (!docs.has(noteId) || editGeneration(noteId) !== generation) return false;
  if (change.disk) {
    revisions.set(noteId, change.disk.revision);
    persistedBodies.set(noteId, change.disk.body);
  }
  const replaced =
    change.lines !== undefined &&
    !(
      change.lines.length === docs.get(noteId)!.length &&
      change.lines.every((l, i) => l === docs.get(noteId)![i])
    );
  if (replaced) {
    docs.set(noteId, change.lines!);
    taskSigs.set(noteId, taskSignature(change.lines!));
    bumpGeneration(noteId);
  }
  if (change.saved) recordSaved(noteId);
  refreshDirty(noteId);
  if (replaced) notify(noteId);
  return true;
}

/** A write of `body` landed at `revision`: the disk facts move whatever the
 * person typed meanwhile, so the next save goes out on the right base. Not a
 * "saved" decision: that is `adopt`'s, for the generation the write carried. */
export function recordLanded(noteId: string, body: string, revision: string): void {
  if (!docs.has(noteId)) return;
  revisions.set(noteId, revision);
  persistedBodies.set(noteId, body);
}

/** The disk no longer holds what the buffer last saved (Rotli's own older
 * write landed late): the same words become unsaved again. */
export function markUnsaved(noteId: string): void {
  if (!docs.has(noteId)) return;
  bumpGeneration(noteId);
  refreshDirty(noteId);
}

/** The Tasks projection's checkbox signature after a save landed. */
export function setTaskSignature(noteId: string, signature: string): void {
  taskSigs.set(noteId, signature);
}

/** The buffer stops being a Command-T draft: its file exists. */
export function forgetPending(noteId: string): void {
  pendingDocuments.delete(noteId);
}

/** Drop everything this file knows about a note. `evict` tells its viewers
 * (the buffer is gone), `release` drops a buffer nobody views, `moved` hands
 * a Command-T draft's text to its new file without telling anyone. */
export function forget(noteId: string, how: "evict" | "release" | "moved" = "evict"): void {
  docs.delete(noteId);
  revisions.delete(noteId);
  persistedBodies.delete(noteId);
  pendingDocuments.delete(noteId);
  forgetProtection(noteId);
  taskSigs.delete(noteId);
  forgetEdits(noteId);
  setDirty(noteId, false);
  setSaveError(noteId, null);
  if (how === "evict") notify(noteId);
  if (how === "release") subs.delete(noteId);
}

/** Watch one note's buffer; `onIdle` runs when its last viewer leaves. */
export function subscribe(noteId: string, fn: () => void, onIdle: () => void): () => void {
  let set = subs.get(noteId);
  if (!set) {
    set = new Set();
    subs.set(noteId, set);
  }
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) onIdle();
  };
}
