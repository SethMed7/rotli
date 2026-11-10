// How new a note read is (eighth review of pull request 267, F2). A query's
// answer can arrive after the editor has moved on: save v1, a refetch reads
// v1 and its answer is held, the person saves v2, then the old answer arrives
// and a clean buffer took it, showing v1 as saved over v2 on disk. Every read
// is numbered when it starts (`startRead`); a write of Rotli's own that lands,
// and every read the editor takes in, move the note's mark forward; a read
// numbered before the mark is older than what the editor already holds, and
// is dropped.
//
// An answer's arrival isn't the order things happened on disk (ninth review):
// a read dropped as older may still have seen a version the editor hasn't, and
// publishing a write cancels the note's reads on their way. Either way one
// fresh read is made, judged by its own number (`refresh`). The query side
// registers how to cancel and read again (services/hooks.ts).

import type { Note } from "../types";

let sequence = 0;
const marks = new Map<string, number>();
// the last read each note's editor took in, with when it started
const accepted = new Map<string, { readAt: number; body: string; revision: string }>();

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
  accepted.set(note.id, { readAt: note.readAt, body: note.body, revision: note.revision });
  return true;
}

/** The version a read taken in after `since` showed, if one was: a write
 * whose answer comes later may be older than it (ninth review). */
export function acceptedSince(noteId: string, since: number): { body: string; revision: string } | null {
  const read = accepted.get(noteId);
  return read && read.readAt > since ? read : null;
}

/** How the note queries are cancelled and read again (services/hooks.ts). */
export interface ReadHooks {
  /** Cancel the note's reads on their way; true when one was. */
  cancel(noteId: string): boolean;
  /** Read the note again, numbered as it starts. */
  refresh(noteId: string): void;
}
const none: ReadHooks = { cancel: () => false, refresh: () => {} };
let registered: ReadHooks = none;
let override: ReadHooks | null = null;
const hooks = (): ReadHooks => override ?? registered;

export function registerReadHooks(next: ReadHooks): void {
  registered = next;
}
export function setReadHooksForTests(next: ReadHooks | null): void {
  override = next;
}

/** Before a write of Rotli's own is published: cancel the note's reads on
 * their way. The answer says whether one was (so a fresh read must follow). */
export const beforePublish = (noteId: string): boolean => hooks().cancel(noteId);
/** After it is published: if a read was cancelled, read once more. */
export function afterPublish(noteId: string, cancelled: boolean): void {
  if (cancelled) hooks().refresh(noteId);
}
/** A read was dropped as older, yet saw a version the editor doesn't hold:
 * read once more, so nothing newer on disk is left unread. */
export const readAgain = (noteId: string): void => hooks().refresh(noteId);
