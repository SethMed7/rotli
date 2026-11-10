// Whether a note's buffer holds edits not yet on disk (fifth review of pull
// request 267). Dirty is DERIVED, never a flag a finishing write can clear:
// every edit bumps the note's generation, and a write that succeeds records
// the generation it carried. The buffer is unsaved whenever the two differ.
// A write that started before the newest keystroke can't mark it saved.

const generations = new Map<string, number>();
const savedGenerations = new Map<string, number>();

/** The note's newest edit, as a count. */
export const editGeneration = (noteId: string): number => generations.get(noteId) ?? 0;

export const hasUnsavedEdits = (noteId: string): boolean =>
  editGeneration(noteId) !== (savedGenerations.get(noteId) ?? 0);

/** The buffer's text changed (typing, a merge). */
export function bumpGeneration(noteId: string): void {
  generations.set(noteId, editGeneration(noteId) + 1);
}

/** A write carrying `generation` landed (by default: the buffer now holds
 * exactly what is on disk). A write that lands late never moves it back. */
export function recordSaved(noteId: string, generation = editGeneration(noteId)): void {
  if (generation >= (savedGenerations.get(noteId) ?? 0)) savedGenerations.set(noteId, generation);
}

export function forgetEdits(noteId: string): void {
  generations.delete(noteId);
  savedGenerations.delete(noteId);
}
