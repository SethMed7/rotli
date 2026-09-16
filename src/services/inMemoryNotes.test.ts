import { describe, expect, test } from "bun:test";

import { seedReservedRoots } from "./demoCorpus";
import { DEST } from "./destinations";
import { InMemoryNotesService, isNotesSnapshot } from "./inMemoryNotes";

function freshService(): InMemoryNotesService {
  const svc = new InMemoryNotesService();
  seedReservedRoots(svc);
  return svc;
}

describe("in-memory notes snapshots", () => {
  test("export and import are inverses and keep the trash origin", async () => {
    const source = freshService();
    const note = await source.createNote(DEST.inbox, "# Kept\n\nbody");
    await source.trashNote(note.id); // stamps an origin
    const snapshot = source.exportSnapshot();
    expect(isNotesSnapshot(snapshot)).toBe(true);
    expect(isNotesSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBe(true);

    const restored = new InMemoryNotesService();
    restored.importSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect((await restored.listFolders()).map((f) => f.id).sort()).toEqual(
      (await source.listFolders()).map((f) => f.id).sort(),
    );
    const back = await restored.getNote(note.id);
    expect(back?.body).toBe("# Kept\n\nbody");
    expect(back?.folderId).toBe(DEST.trash);
    expect((await restored.restoreNote(note.id)).folderId).toBe(DEST.inbox);
  });

  test("a top-level folder is its own path id unless the name is taken", async () => {
    const svc = freshService();
    expect((await svc.createFolder("Welcome")).id).toBe("Welcome");
    const clash = await svc.createFolder("Welcome");
    expect(clash.id).not.toBe("Welcome");
    expect(clash.name).toBe("Welcome");
    expect((await svc.createFolder("Sub", "Welcome")).id).toBe("Welcome/Sub");
  });

  test("the snapshot guard rejects other shapes and other versions", () => {
    const base = freshService().exportSnapshot();
    expect(isNotesSnapshot(null)).toBe(false);
    expect(isNotesSnapshot("x")).toBe(false);
    expect(isNotesSnapshot({ ...base, version: 2 })).toBe(false);
    expect(isNotesSnapshot({ ...base, notes: "nope" })).toBe(false);
    expect(isNotesSnapshot(base)).toBe(true);
  });
});
