// The disk, as the save queue (saveQueue.ts) sees it: the write lane, the
// read and the create, swappable so tests drive a fake that
// follows Rust's contract (writeLane.fixtures.ts), the save-state explorer's
// held acknowledgements (saveExplorer.fixtures.ts), or the real Rust store
// (realWriteLane.lane.ts); and the bound a change or a read is given.

import { notesService } from "../services/notes";
import type { Note } from "../types";
import { clock, type TimerHandle } from "./saveClock";

export type Protection = { secure: boolean; locked: boolean };

/** How long a write, or a recovery note's creation, may take before the note
 * says it is taking longer than expected; also how long a read is waited for. */
let slowAfterMs = 8000;
export const slowAfter = (): number => slowAfterMs;

// The write lane, the read and the create — swappable so tests can drive a
// fake that follows Rust's contract, or the real Rust store. A recovery note's
// create carries its event's id: Rust gives back the note it made for that id
// rather than making another (corpus.rs `create_with`).
type WriteBody = (noteId: string, body: string, revision: string, base: string) => Promise<Note | void>;
type ReadNote = (noteId: string) => Promise<Note | null>;
type CreateNote = (folderId: string, body: string, protection: Protection, event?: string) => Promise<Note>;
export const lane = {
  write: ((id, body, revision, base) => notesService.updateNote(id, body, revision, base)) as WriteBody,
  read: ((id) => notesService.getNote(id)) as ReadNote,
  create: ((folder, body, protection, event) =>
    notesService.createNote(folder, body, {
      ...protection,
      ...(event ? { recoveryEvent: event } : {}),
    })) as CreateNote,
};
const defaults = { ...lane };
export function setWriteNoteBodyForTests(fn: WriteBody | null): void {
  lane.write = fn ?? defaults.write;
}
export function setReadNoteForTests(fn: ReadNote | null): void {
  lane.read = fn ?? defaults.read;
}
export function setCreateNoteForTests(fn: CreateNote | null): void {
  lane.create = fn ?? defaults.create;
}
export function setWriteLimitForTests(ms: number | null): void {
  slowAfterMs = ms ?? 8000;
}
/** A read, waited for within the bound. A read changes nothing, so one that
 * doesn't answer in time is left behind: undefined (not known), where null
 * means the note isn't there. */
export async function bounded<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: TimerHandle | undefined;
  const result = await Promise.race([
    read().then(
      (value) => value,
      () => undefined,
    ),
    new Promise<undefined>((resolve) => {
      timer = clock.setTimeout(() => resolve(undefined), slowAfterMs);
    }),
  ]);
  clock.clearTimeout(timer);
  return result;
}
