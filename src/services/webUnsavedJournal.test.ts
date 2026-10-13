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

test("a secure locked conflict keeps its protection on the recovered note", async () => {
  const { FolderNotesService } = await import("./folderNotes");
  const { MemoryVaultDir } = await import("./vaultDir");
  const dir = new MemoryVaultDir();
  await dir.mkdir("wiki");
  await dir.writeText(
    "wiki/_secure/a.md",
    "---\nid: protected\nsecure: true\nlocked: true\nlocal_ai_allowed: false\nai_edit: false\n---\nbefore",
  );
  const svc = new FolderNotesService(dir);
  const note = (await svc.getNote("protected"))!;
  const store = storage();
  const key = journalKey("secure-vault");
  writeJournal(store, key, [
    { noteId: note.id, body: "mine", expectedRevision: note.revision, expectedBody: note.body },
  ]);
  await svc.updateNote(note.id, "external", note.revision);
  expect((await replayJournal(store, key, svc)).unresolved).toBe(0);
  const copy = (await svc.listAll()).find((n) => n.id !== note.id)!;
  expect(copy.secure).toBe(true);
  expect(copy.locked).toBe(true);
  expect(copy.diskFolderId).toBe("wiki/_secure");
  expect((await dir.readText(".gitignore")).split("\n")).toContain(await svc.filePathOf(copy.id));
  expect((await svc.getNote(copy.id))?.body).toBe("mine");
});

test("a missing note with unknown protection retains its draft instead of downgrading it", async () => {
  const svc = new InMemoryNotesService();
  const store = storage();
  const key = journalKey("unknown-vault");
  const draft = { noteId: "missing", body: "private draft", expectedRevision: "old", expectedBody: "before" };
  writeJournal(store, key, [draft]);
  expect(await replayJournal(store, key, svc)).toEqual({ saved: 0, keptAside: [], unresolved: 1 });
  expect(await svc.listAll()).toHaveLength(0);
  expect(JSON.parse(store.values.get(`${key}:kept`) ?? "[]")).toEqual([draft]);
});

test("a pending tab's journaled words become a note after reload", async () => {
  const svc = new InMemoryNotesService();
  const store = storage();
  const key = journalKey("new-vault");
  writeJournal(store, key, [
    {
      noteId: "rotli-pending-note:tab",
      body: "# Written before creation finished",
      expectedRevision: "0",
      expectedBody: "",
      protection: { secure: false, locked: false },
    },
  ]);
  expect((await replayJournal(store, key, svc)).keptAside).toEqual(["Written before creation finished"]);
  expect((await svc.listAll())[0]?.title).toBe("Written before creation finished");
});

test("a deleted secure note can recover from its journaled protection", async () => {
  const svc = new InMemoryNotesService();
  const store = storage();
  const key = journalKey("deleted-secure-vault");
  writeJournal(store, key, [
    {
      noteId: "deleted",
      body: "# Private draft",
      expectedRevision: "old",
      expectedBody: "before",
      protection: { secure: true, locked: true },
    },
  ]);
  expect((await replayJournal(store, key, svc)).unresolved).toBe(0);
  expect((await svc.listAll())[0]).toMatchObject({ secure: true, locked: true });
});

test("a newer disk protection cannot be downgraded by an older draft", async () => {
  const svc = new InMemoryNotesService();
  const folder = seedReservedRoots(svc);
  const note = await svc.createNote(folder, "before", { secure: true, locked: true });
  const store = storage();
  const key = journalKey("newly-protected-vault");
  writeJournal(store, key, [
    {
      noteId: note.id,
      body: "mine",
      expectedRevision: "stale",
      expectedBody: "before",
      protection: { secure: false, locked: false },
    },
  ]);
  expect((await replayJournal(store, key, svc)).unresolved).toBe(0);
  expect((await svc.listAll()).find((item) => item.id !== note.id)).toMatchObject({
    secure: true,
    locked: true,
  });
});

test("malformed policy for a missing note leaves the journal intact", async () => {
  const svc = new InMemoryNotesService();
  const store = storage();
  const key = journalKey("bad-policy-vault");
  store.setItem(
    key,
    JSON.stringify([
      {
        noteId: "missing",
        body: "private draft",
        expectedRevision: "old",
        expectedBody: "before",
        protection: { secure: "false", locked: false },
      },
    ]),
  );
  expect((await replayJournal(store, key, svc)).unresolved).toBe(1);
  expect(await svc.listAll()).toHaveLength(0);
});
