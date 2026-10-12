// A note's save status (the olive dot and the save-error line), split out of
// the shared buffer (model.ts), its one writer; the rest of the app reads it
// through model.ts's re-exports.

import { useCallback, useSyncExternalStore } from "react";

// ——— the olive-dot grammar: muted while a debounced sync is pending or in
// flight, olive once the service confirmed the write. NO spinners, ever. ———

const dirtyIds = new Set<string>();
const dirtySubs = new Set<() => void>();

export function setDirty(noteId: string, value: boolean): void {
  if (dirtyIds.has(noteId) === value) return;
  if (value) dirtyIds.add(noteId);
  else dirtyIds.delete(noteId);
  for (const fn of dirtySubs) fn();
}

/** Is this note's buffer ahead of the disk? */
export function isDirty(noteId: string): boolean {
  return dirtyIds.has(noteId);
}

/** Every note whose buffer is ahead of the disk. */
export function dirtyNoteIds(): ReadonlySet<string> {
  return dirtyIds;
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

export function setSaveError(noteId: string, message: string | null): void {
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
