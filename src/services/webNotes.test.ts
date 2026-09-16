import { describe, expect, test } from "bun:test";

import { BrowserVault, MemoryVaultStore } from "../lib/browserVault";
import { seedReservedRoots } from "./demoCorpus";
import { DEST } from "./destinations";
import { InMemoryNotesService } from "./inMemoryNotes";
import { createWebNotesPersistence, persistingNotesService, restoreNotesSnapshot } from "./webNotes";

function freshService(): InMemoryNotesService {
  const svc = new InMemoryNotesService();
  seedReservedRoots(svc);
  return svc;
}

function harness(store = new MemoryVaultStore()) {
  const notices: string[] = [];
  const inner = freshService();
  const vault = new BrowserVault(store);
  const persistence = createWebNotesPersistence(inner, vault, (m) => notices.push(m));
  return { store, inner, vault, persistence, notices };
}

describe("Rotli Web notes persistence", () => {
  test("revisions keep advancing after a restore, so a stale tab cannot collide", async () => {
    const source = freshService();
    const note = await source.createNote(DEST.inbox, "one");
    const restored = new InMemoryNotesService();
    expect(restoreNotesSnapshot(restored, JSON.stringify(source.exportSnapshot()))).toBe("restored");
    const updated = await restored.updateNote(note.id, "two", note.revision);
    expect(updated.revision).not.toBe(note.revision);
    await expect(restored.updateNote(note.id, "three", note.revision)).rejects.toThrow(/revision conflict/);
  });

  test("nothing stored is a first visit; a malformed or newer snapshot is unreadable and leaves the seed", () => {
    const svc = freshService();
    const before = svc.exportSnapshot();
    expect(restoreNotesSnapshot(svc, undefined)).toBe("fresh");
    expect(restoreNotesSnapshot(svc, "{not json")).toBe("unreadable");
    expect(restoreNotesSnapshot(svc, JSON.stringify({ ...before, version: 2 }))).toBe("unreadable");
    expect(restoreNotesSnapshot(svc, JSON.stringify({ hello: "world" }))).toBe("unreadable");
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

  test("an untouched tab never writes: a flush with nothing changed leaves the vault alone", async () => {
    const store = new MemoryVaultStore();
    // tab B saved a note
    const b = harness(store);
    expect(await b.persistence.hydrate()).toBe("fresh");
    await b.persistence.service.createNote(DEST.inbox, "written by B");
    await b.persistence.flush();
    const saved = store.values.get("notes");
    expect(saved).toContain("written by B");
    // tab A, opened earlier with an empty vault, closes without changing anything
    const a = harness(store);
    await a.persistence.hydrate();
    await a.persistence.flush();
    expect(store.values.get("notes")).toBe(saved);
  });

  test("a foreign change stops this tab's writes instead of clobbering them", async () => {
    const store = new MemoryVaultStore();
    const a = harness(store);
    const b = harness(store);
    await a.persistence.hydrate();
    await b.persistence.hydrate();
    await b.persistence.service.createNote(DEST.inbox, "B's note");
    await b.persistence.flush();
    await a.persistence.service.createNote(DEST.inbox, "A's note");
    await a.persistence.flush();
    expect(a.persistence.disabled()).toBe(true);
    expect(a.notices[0]).toMatch(/another tab/);
    expect(store.values.get("notes")).toContain("B's note");
    expect(store.values.get("notes")).not.toContain("A's note");
    // and it stays off: later edits in A are not written either
    await a.persistence.service.createNote(DEST.inbox, "still A");
    await a.persistence.flush();
    expect(store.values.get("notes")).not.toContain("still A");
  });

  test("an unreadable store disables writes and says so", async () => {
    const store = new MemoryVaultStore();
    store.values.set("notes", "{not json");
    const h = harness(store);
    expect(await h.persistence.hydrate()).toBe("unreadable");
    expect(h.persistence.disabled()).toBe(true);
    expect(h.notices[0]).toMatch(/can’t be read/);
    await h.persistence.service.createNote(DEST.inbox, "x");
    await h.persistence.flush();
    expect(store.values.get("notes")).toBe("{not json");
  });

  test("a storage failure is reported, keeps the tab dirty, and the next flush retries", async () => {
    let failOnce = true;
    class FlakyStore extends MemoryVaultStore {
      override async compareAndSwap(
        k: string,
        v: string,
        rk: string,
        e: string,
        n: string,
      ): Promise<boolean> {
        if (failOnce) {
          failOnce = false;
          throw new Error("QuotaExceededError");
        }
        return super.compareAndSwap(k, v, rk, e, n);
      }
    }
    const h = harness(new FlakyStore());
    await h.persistence.hydrate();
    await h.persistence.service.createNote(DEST.inbox, "keep me");
    await expect(h.persistence.flush()).rejects.toThrow(/Quota/);
    expect(h.notices[0]).toMatch(/Couldn’t save/);
    expect(h.persistence.disabled()).toBe(false);
    await h.persistence.flush();
    expect(h.store.values.get("notes")).toContain("keep me");
  });

  test("Empty Trash hard-deletes trashed notes and persists", async () => {
    const h = harness();
    await h.persistence.hydrate();
    const keep = await h.persistence.service.createNote(DEST.inbox, "keep");
    const gone = await h.persistence.service.createNote(DEST.inbox, "gone");
    await h.persistence.service.trashNote(gone.id);
    expect(await h.persistence.purgeTrash()).toBe(1);
    expect(await h.inner.getNote(gone.id)).toBeNull();
    expect(await h.inner.getNote(keep.id)).not.toBeNull();
    expect(h.store.values.get("notes")).not.toContain('"gone"');
    expect(await h.persistence.purgeTrash()).toBe(0);
  });

  test("the welcome catalog is not re-seeded over a restored edit", async () => {
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
