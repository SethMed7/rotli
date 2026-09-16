import { describe, expect, test } from "bun:test";

import { DEST } from "./destinations";
import { InMemoryNotesService } from "./inMemoryNotes";
import { persistingNotesService, restoreNotesSnapshot } from "./webNotes";

function freshService(): InMemoryNotesService {
  const svc = new InMemoryNotesService();
  svc.seedReserved(DEST.inbox, DEST.inbox);
  svc.seedReserved(DEST.archive, DEST.archive);
  svc.seedReserved(DEST.trash, DEST.trash);
  return svc;
}

describe("Rotli Web notes persistence", () => {
  test("revisions keep advancing after a restore, so a stale tab cannot collide", async () => {
    const source = freshService();
    const note = await source.createNote(DEST.inbox, "one");
    const restored = new InMemoryNotesService();
    restoreNotesSnapshot(restored, JSON.stringify(source.exportSnapshot()));
    const updated = await restored.updateNote(note.id, "two", note.revision);
    expect(updated.revision).not.toBe(note.revision);
    await expect(restored.updateNote(note.id, "three", note.revision)).rejects.toThrow(/revision conflict/);
  });

  test("a missing, malformed, or newer snapshot leaves the fresh seed in place", () => {
    const svc = freshService();
    const before = svc.exportSnapshot();
    expect(restoreNotesSnapshot(svc, undefined)).toBe(false);
    expect(restoreNotesSnapshot(svc, "{not json")).toBe(false);
    expect(restoreNotesSnapshot(svc, JSON.stringify({ ...before, version: 2 }))).toBe(false);
    expect(restoreNotesSnapshot(svc, JSON.stringify({ hello: "world" }))).toBe(false);
    expect(svc.exportSnapshot()).toEqual(before);
  });

  test("the persisting wrapper reports after every successful mutation and never after a read", async () => {
    const svc = freshService();
    let saves = 0;
    const service = persistingNotesService(svc, () => {
      saves += 1;
    });
    const note = await service.createNote(DEST.inbox, "hello");
    expect(saves).toBe(1);
    await service.listNotes();
    await service.getNote(note.id);
    await service.searchNotes("hello");
    expect(saves).toBe(1);
    await service.updateNote(note.id, "hello again", note.revision);
    await service.trashNote(note.id);
    await service.restoreNote(note.id);
    expect(saves).toBe(4);
  });

  test("a refused mutation reports nothing", async () => {
    const svc = freshService();
    let saves = 0;
    const service = persistingNotesService(svc, () => {
      saves += 1;
    });
    const note = await service.createNote(DEST.inbox, "hello");
    saves = 0;
    await expect(service.updateNote(note.id, "x", "memory:999")).rejects.toThrow(/revision conflict/);
    await expect(service.createNote(DEST.vault, "x")).rejects.toThrow(/read-only/);
    expect(saves).toBe(0);
  });

  test("the welcome catalog is not re-seeded over a restored edit", async () => {
    // The first failing test of the plan: what seedInMemory does is keyed by
    // title inside the Welcome folder, so a restored vault whose welcome note
    // was edited (title kept) must be left alone. Modelled here at the
    // service level with the same lookup rule seedInMemory uses.
    const svc = freshService();
    const folder = await svc.createFolder("Welcome");
    const note = await svc.createNote(folder.id, "# Welcome to Rotli\n\noriginal");
    await svc.updateNote(note.id, "# Welcome to Rotli\n\nmy edit", note.revision);
    const restored = new InMemoryNotesService();
    restoreNotesSnapshot(restored, JSON.stringify(svc.exportSnapshot()));
    const existing = await restored.listAll();
    const match = existing.find((n) => n.folderId === folder.id && n.title === "Welcome to Rotli");
    expect(match?.id).toBe(note.id);
    expect((await restored.getNote(note.id))?.body).toContain("my edit");
  });
});
