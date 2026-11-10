// How new a note read is (eighth review of pull request 267, F2). A query's
// answer can arrive after the editor has moved on: save v1, a refetch reads
// v1 and its answer is held, the person saves v2, then the old answer arrives
// and a clean buffer took it, showing v1 as saved over v2 on disk. Every read
// is numbered when it starts (`startRead`); a write of Rotli's own that lands,
// and every read the editor takes in, move the note's mark forward; a read
// numbered before the mark is older than what the editor already holds, and
// is dropped. Pure state, no imports from the app.

import type { Note } from "../types";

let sequence = 0;
const marks = new Map<string, number>();

/** The number a read gets when it starts: take it before asking the disk. */
export const startRead = (): number => {
  sequence += 1;
  return sequence;
};

/** `note`, carrying when its read started (now, unless the caller took it earlier). */
export function stampRead(note: Note, startedAt: number = startRead()): Note {
  return { ...note, readAt: startedAt };
}

/** A write of Rotli's own landed: every read started before it is older. */
export function writeLanded(noteId: string): void {
  marks.set(noteId, startRead());
}

/** May the editor take this read in? An unnumbered read may (a source that
 * doesn't number its reads keeps the old behaviour); a numbered one only when
 * nothing newer has been taken in since it started, and taking it moves the mark. */
export function takeRead(note: Note): boolean {
  if (note.readAt === undefined) return true;
  if (note.readAt < (marks.get(note.id) ?? 0)) return false;
  marks.set(note.id, note.readAt);
  return true;
}
