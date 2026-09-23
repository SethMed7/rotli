// What the Quick Note window lists and calls the open note — pure, so it is
// testable without the editor (CodeMirror needs a DOM).

import type { NoteSummary } from "../types";

/** A blank note has nothing to find or switch to: the one you are typing into
 * is already open, and ⌘N reuses it (the maintainer, 2026-09-23: "Untitled
 * should not be showing"). Pure for tests. */
export function pickableNotes(notes: NoteSummary[]): NoteSummary[] {
  return notes.filter((n) => n.bodyEmpty !== true);
}

/** The header names the open note; a blank one is a new note, not "Untitled". */
export function quickNoteTitle(note: NoteSummary | undefined): string {
  return note && note.bodyEmpty !== true && note.title ? note.title : "New note";
}
