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

/** Seed the buffer from the service body. No-op if the note is already open
 * somewhere — the live buffer is the truth, never the (possibly stale) query. */
export function ensureDocument(noteId: string, body: string): void {
  if (!docs.has(noteId)) docs.set(noteId, body.split("\n"));
}

export function documentLines(noteId: string): string[] | undefined {
  return docs.get(noteId);
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

function scheduleSync(noteId: string): void {
  const pending = timers.get(noteId);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    noteId,
    setTimeout(() => {
      timers.delete(noteId);
      const lines = docs.get(noteId);
      if (!lines) return;
      void notesService.updateNote(noteId, lines.join("\n")).then(() => invalidateNotes());
    }, SYNC_DEBOUNCE_MS),
  );
}

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
