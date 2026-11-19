// What an open note shows when it can't be read because it has a hard link
// (third review of pull request 267; src/lib/hardLinks.ts owns the words):
// the same calm notice as the sidebar's, in place of the note, never its
// cached text. Nothing to dismiss: it goes when the file has one name again.

import { INDEPENDENT_COPY, OPEN_NOTE_HARD_LINKED } from "../lib/hardLinks";

export function HardLinkedNote() {
  return (
    <section className="hard-linked-note" aria-label="Note not opened">
      <p className="hard-linked-note-text">{OPEN_NOTE_HARD_LINKED}</p>
      <p className="hard-linked-note-help">{INDEPENDENT_COPY}</p>
    </section>
  );
}
