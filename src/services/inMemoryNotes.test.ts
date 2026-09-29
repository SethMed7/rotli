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

// Round Three (2026-09-26): the twin of corpus.rs's alias rules. Autosave sees
// a half-typed title on every save; neither that trail nor a fresh note's
// "Untitled" is a name anyone links to.
describe("rename aliases", () => {
  async function typeTitles(svc: InMemoryNotesService, titles: string[]) {
    let note = await svc.createNote(DEST.inbox, "");
    for (const title of titles) {
      note = await svc.updateNote(note.id, `# ${title}\n\nBody.`, note.revision ?? "");
    }
    return note;
  }

  test("typing a new note's title keeps only its current slug", async () => {
    const svc = freshService();
    const note = await typeTitles(svc, ["R", "Round", "Round Three", "Round Three -", "Round Three - Rotli"]);
    // the web twin has no file name: the current slug stands in for it
    expect(note.aliases).toEqual(["round-three-rotli"]);
  });

  test("a real rename keeps the old name for links", async () => {
    const svc = freshService();
    const note = await typeTitles(svc, ["Round Three", "Q3 plan"]);
    expect(note.aliases).toEqual(["round-three", "Round Three", "q3-plan"]);
  });
});
