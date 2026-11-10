// Is what a model is about to be sent the version the editor just saved?
// Every caller that reads a note for a model asks this after `flushNote`
// (fourth review of pull request 267: the Librarian could read the version
// before a save still in flight). Split from model.ts, which owns the state.

import { flushNote, saveState } from "./model";
import { documentSaveError, isDirty } from "./saveStatus";

/** `flushNote`, answering why the note couldn't be saved (null when it was). */
export const saveFailure = (noteId: string): Promise<string | null> =>
  flushNote(noteId).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

/** What a model must not be sent while it's true, in the person's words. */
export const STILL_SAVING = "Still saving. Try again in a moment.";

/** After `flushNote`: is `read` (a gated read for a model) the version the
 * editor holds? Null when it is, or when the note isn't open in an editor
 * (then the file is the truth); otherwise why not: still saving, or the
 * save's error. Nothing from `read` is sent unless this is null. */
export function savedVersionMismatch(
  noteId: string,
  read: { revision: string; body: string },
): string | null {
  const state = saveState(noteId);
  if (state.text === undefined) return null;
  if (state.pending) return STILL_SAVING;
  if (isDirty(noteId)) return documentSaveError(noteId) ?? STILL_SAVING;
  if (state.revision === read.revision) return null;
  // the same words under another revision scheme (Rotli Web's twin) still match
  return read.body.replace(/\r\n/g, "\n") === state.text ? null : STILL_SAVING;
}
