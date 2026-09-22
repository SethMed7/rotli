import { expect, test } from "bun:test";

import { seedReservedRoots } from "./demoCorpus";
import { InMemoryNotesService } from "./inMemoryNotes";
import { journalKey, replayJournal, writeJournal } from "./webUnsavedJournal";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
}

test("a draft typed against the file on disk is saved onto its note at the next boot", async () => {
  const svc = new InMemoryNotesService();
  const folder = seedReservedRoots(svc);
  const note = await svc.createNote(folder, "# Plan\n\nbefore");
  const store = storage();
  const key = journalKey("folder:notes");
  writeJournal(store, key, [
    {
      noteId: note.id,
      body: "# Plan\n\nbefore and after",
      expectedRevision: note.revision,
      expectedBody: note.body,
    },
  ]);
  expect(await replayJournal(store, key, svc)).toEqual({ saved: 1, keptAside: [], unresolved: 0 });
  expect((await svc.getNote(note.id))?.body).toBe("# Plan\n\nbefore and after");
  expect(store.values.has(key)).toBe(false);
});

test("a file that changed since is never overwritten: the draft is kept as its own note", async () => {
  const svc = new InMemoryNotesService();
  const folder = seedReservedRoots(svc);
  const note = await svc.createNote(folder, "# Plan\n\nbefore");
  const stale = note.revision;
  await svc.updateNote(note.id, "# Plan\n\nchanged in the Mac app", note.revision);
  const store = storage();
  const key = journalKey("folder:notes");
  writeJournal(store, key, [
    { noteId: note.id, body: "# Plan\n\nmine", expectedRevision: stale, expectedBody: note.body },
  ]);
  expect(await replayJournal(store, key, svc)).toEqual({ saved: 0, keptAside: ["Plan"], unresolved: 0 });
  expect((await svc.getNote(note.id))?.body).toBe("# Plan\n\nchanged in the Mac app");
  expect((await svc.listAll()).filter((n) => n.title === "Plan")).toHaveLength(2);
});

test("a draft the unload's own save already landed is skipped; nothing drafts, nothing stored", async () => {
  const svc = new InMemoryNotesService();
  const folder = seedReservedRoots(svc);
  const note = await svc.createNote(folder, "# Plan\n\nsaved");
  const store = storage();
  const key = journalKey("helper:notes");
  writeJournal(store, key, [
    { noteId: note.id, body: "# Plan\n\nsaved", expectedRevision: "old", expectedBody: "" },
  ]);
  expect(await replayJournal(store, key, svc)).toEqual({ saved: 0, keptAside: [], unresolved: 0 });
  writeJournal(store, key, []);
  expect(store.values.size).toBe(0);
});

test("a draft that can be neither saved nor kept aside stays in the journal for the next boot", async () => {
  const svc = new InMemoryNotesService();
  const folder = seedReservedRoots(svc);
  const note = await svc.createNote(folder, "# Plan\n\nbefore");
  const store = storage();
  const key = journalKey("folder:x");
  const draft = {
    noteId: note.id,
    body: "# Plan\n\nunsaved",
    expectedRevision: "stale",
    expectedBody: note.body,
  };
  writeJournal(store, key, [draft]);
  const failing = {
    getNote: (id: string) => svc.getNote(id),
    updateNote: () => Promise.reject(new Error("disk full")),
    createNote: () => Promise.reject(new Error("disk full")),
  };
  expect(await replayJournal(store, key, failing)).toEqual({ saved: 0, keptAside: [], unresolved: 1 });
  // kept under its own key: the next unload (which rewrites `key`) can't drop it
  expect(store.values.has(key)).toBe(false);
  expect(JSON.parse(store.values.get(`${key}:kept`) ?? "[]")).toEqual([draft]);
  writeJournal(store, key, []);
  expect(JSON.parse(store.values.get(`${key}:kept`) ?? "[]")).toEqual([draft]);
  // the next boot tries it again
  expect((await replayJournal(store, key, failing)).unresolved).toBe(1);
});
