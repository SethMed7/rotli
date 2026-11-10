// The shared document buffer — ONE buffer per noteId across all tabs/panes
// (the r2 structural lock #4). The document is the note's markdown string,
// split into lines. Edits mutate the buffer synchronously (typing never waits
// on a store round-trip) and flow to NotesService.update on a debounce, so
// updatedAt moves and the list/snippets refresh. Tabs hold only view state.
//
// The public API over two owners: buffers.ts (the buffers, and the one
// function that replaces one or declares it saved) and saveQueue.ts (each
// note's one-at-a-time save queue, recovery included).

import { useCallback, useSyncExternalStore } from "react";

import { onQuitCheck, onQuitFlush } from "../lib/quitFlush";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { readAgain, startRead, takeRead } from "../services/noteReads";
import { keepTabsFor } from "../state/panes";
import type { Note } from "../types";
import {
  adopt,
  baselineOf,
  bufferLines,
  bufferText,
  edit,
  forget,
  forgetPending,
  hasBuffer,
  isPendingDocument,
  revisionOf,
  seed,
  subscribe,
  viewers,
} from "./buffers";
import { clock } from "./saveClock";
import { editGeneration } from "./saveGenerations";
import {
  flushSyncs,
  forgetQueue,
  queueBusy,
  quitReasons,
  reloadDocument,
  reviveGoneNote,
  scheduleSync,
} from "./saveQueue";
import { documentSaveError, isDirty, setSaveError } from "./saveStatus";
import { draftsOf, setDocumentProtection, type UnsavedDraft } from "./unsavedDrafts";

export { stampRead } from "../services/noteReads";
export { documentSaveError, useDocumentDirty, useDocumentSaveError } from "./saveStatus";
export {
  setCreateNoteForTests,
  setReadNoteForTests,
  setWriteLimitForTests,
  setWriteNoteBodyForTests,
} from "./saveLane";
export {
  copiedAside,
  discardGoneNote,
  dismissCopiedAside,
  flushNote,
  flushSyncs,
  noteName,
  saveState,
  STILL_SAVING,
  useCopiedAside,
  useGoneNotes,
} from "./saveQueue";

/** Every buffer the dimmed save dot is showing, read synchronously (an
 * unloading page can't await). Rotli Web writes these to its recovery journal
 * on unload (webVaultOverlays.tsx); the Mac app has no such journal. */
export const unsavedDrafts = (): UnsavedDraft[] =>
  draftsOf((noteId) => ({
    lines: bufferLines(noteId),
    pending: isPendingDocument(noteId),
    revision: revisionOf(noteId),
    persisted: baselineOf(noteId),
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
  if (hasBuffer(noteId)) return;
  seed(noteId, body.split("\n"), { body, revision });
  if (!viewers(noteId)) scheduleRelease(noteId); // a seed nobody opened
}

/** Stable session id for the editable surface shown before Command-T's file
 * creation returns. It is never sent to the corpus or persisted in viewstate. */
export function pendingNoteDocumentId(tabId: string): string {
  return `rotli-pending-note:${tabId}`;
}

/** Seed the first-paint Command-T editor. No revision exists yet, so edits stay
 * in this shared buffer until `adoptPendingDocument` binds them to disk. */
export function ensurePendingDocument(noteId: string, body = ""): void {
  seed(noteId, body.split("\n"));
}

/** Move an optimistic editor buffer onto the newly-created durable note before
 * the tab retargets. The CodeMirror remount therefore sees the exact live text,
 * and a typed draft starts its first ordinary revision-protected save. */
export function adoptPendingDocument(pendingId: string, note: Note): boolean {
  const lines = [...(bufferLines(pendingId) ?? note.body.split("\n"))];
  const changed = lines.join("\n") !== note.body;
  forgetQueue(pendingId);
  forget(pendingId, "moved");
  forgetPending(note.id);
  seed(note.id, note.body.split("\n"), { body: note.body, revision: note.revision });
  setDocumentProtection(note.id, note);
  setSaveError(note.id, null);
  if (changed) {
    markNoteDraftChanged(note.id);
    edit(note.id, lines);
    scheduleSync(note.id);
  } else {
    adopt(note.id, editGeneration(note.id), { saved: true });
  }
  return changed;
}

/** A read of a note (the editor's query, a watcher's refetch) reaching the
 * editor: dropped when it started before something newer was taken in (a
 * write of Rotli's own landing, a newer read; services/noteReads.ts), else
 * seeded or folded in like any disk truth. */
// The last note each read gave the editor, so a note whose file vanished
// (deleted outside) still shows its retained words (ninth review: the editor
// rendered an empty container, in every pane, though the buffer survived).
const lastRead = new Map<string, Note>();

/** The note to show for `noteId` when its query finds nothing: the last one
 * read, while its buffer (the person's words) is still here. */
export function retainedNote(noteId: string): Note | undefined {
  return hasBuffer(noteId) ? lastRead.get(noteId) : undefined;
}

export function adoptReadNote(note: Note): boolean {
  if (!takeRead(note)) {
    // older than what the editor holds, yet it saw another version: read again
    if (note.revision !== revisionOf(note.id)) readAgain(note.id);
    return false;
  }
  lastRead.set(note.id, note);
  reviveGoneNote(note.id);
  ensureDocument(note.id, note.body, note.revision, note);
  reloadDocumentIfClean(note.id, note.body, note.revision);
  return true;
}

/** Text Rotli itself just wrote outside the editor's queue (`/ai`), shown at
 * once: a read that starts now, numbered like any other. */
export function adoptWrittenText(noteId: string, body: string, revision: string): void {
  if (!takeRead({ id: noteId, body, revision, readAt: startRead() } as Note)) return;
  reloadDocumentIfClean(noteId, body, revision);
}

/** Disk truth for a note (external edit / agent write). A clean buffer takes
 * it; unsaved local edits win until flush, folded together with it when the
 * two touched different lines. Seeds when the buffer doesn't exist yet. */
export function reloadDocumentIfClean(noteId: string, body: string, revision: string): void {
  if (!hasBuffer(noteId)) {
    ensureDocument(noteId, body, revision);
    return;
  }
  reloadDocument(noteId, body, revision);
}

/** Drop a note's buffer + pending sync. The hook for the delete path — a dead
 * buffer must never keep shadowing (or writing over) service state. */
export function evictDocument(noteId: string): void {
  clock.clearTimeout(releaseTimers.get(noteId));
  releaseTimers.delete(noteId);
  forgetQueue(noteId);
  forget(noteId);
  lastRead.delete(noteId);
}

/** Apply an edit to the shared buffer: notify every pane synchronously,
 * sync to the service on the debounce. */
export function editDocument(noteId: string, change: (lines: readonly string[]) => string[]): void {
  const current = bufferLines(noteId);
  if (!current) return;
  // the single funnel every real keystroke passes through — a session-created
  // note stops being an ephemeral blank draft the moment it's written into,
  // and an edited PREVIEW tab becomes a kept tab (the maintainer, 2026-07-28)
  if (!isPendingDocument(noteId)) {
    markNoteDraftChanged(noteId);
    keepTabsFor(noteId);
  }
  edit(noteId, change(current));
  scheduleSync(noteId);
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
// after every flusher (a workbook, another window): quit is acknowledged only
// when no note has anything unsaved or outstanding (quitFlush.ts)
onQuitCheck(quitReasons);

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
    !viewers(noteId) &&
    !isDirty(noteId) &&
    !queueBusy(noteId) &&
    !isPendingDocument(noteId) &&
    documentSaveError(noteId) === null
  );
}

function scheduleRelease(noteId: string): void {
  clock.clearTimeout(releaseTimers.get(noteId));
  releaseTimers.set(
    noteId,
    clock.setTimeout(() => {
      releaseTimers.delete(noteId);
      if (!hasBuffer(noteId) || viewers(noteId)) return;
      // still unsaved, saving, or failed: look again later rather than keep
      // the buffer for the life of the window once it settles (review of PR 199)
      if (!releasable(noteId)) return scheduleRelease(noteId);
      forget(noteId, "release");
    }, releaseDelayMs),
  );
}

function subscribeDocument(noteId: string, fn: () => void): () => void {
  clock.clearTimeout(releaseTimers.get(noteId));
  releaseTimers.delete(noteId);
  return subscribe(noteId, fn, () => scheduleRelease(noteId));
}

/** Live lines for a note; undefined until the buffer exists (callers fall
 * back to the query body — identical content until the first edit). */
export function useDocumentLines(noteId: string): readonly string[] | undefined {
  const watch = useCallback((fn: () => void) => subscribeDocument(noteId, fn), [noteId]);
  return useSyncExternalStore(watch, () => bufferLines(noteId));
}

/** The whole buffer as one string — the CodeMirror editing surface's source of
 * truth (the editor edits this text directly, the .md never round-trips a rich
 * model). undefined until the buffer exists. */
export function getDocumentText(noteId: string): string | undefined {
  return bufferText(noteId);
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
