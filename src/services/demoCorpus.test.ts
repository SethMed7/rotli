import { describe, expect, test } from "bun:test";

import { seedDemoCorpus, seedReservedRoots } from "./demoCorpus";
import { DEST } from "./destinations";
import { InMemoryNotesService } from "./inMemoryNotes";

describe("the browser twin's seeds", () => {
  test("reserved roots are their own ids, so DEST.inbox === folder.id holds off-disk", async () => {
    const svc = new InMemoryNotesService();
    expect(seedReservedRoots(svc)).toBe(DEST.inbox);
    const ids = new Set((await svc.listFolders()).map((f) => f.id));
    for (const root of [DEST.inbox, DEST.secure, DEST.storage, DEST.board, DEST.archive, DEST.trash]) {
      expect(ids.has(root)).toBe(true);
    }
    expect(await svc.listAll()).toEqual([]);
  });

  test("the demo corpus seeds folders and notes and names the note the window opens on", async () => {
    const svc = new InMemoryNotesService();
    const seeded = seedDemoCorpus(svc, false);
    expect(seeded.inboxId).toBe(DEST.inbox);
    const notes = await svc.listAll();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((n) => n.id === seeded.firstNoteId)).toBe(true);
    expect((await svc.getNote(seeded.firstNoteId))?.title).toBe("rotli — notes first");
  });

  test("?empty keeps every folder and seeds no notes", async () => {
    const svc = new InMemoryNotesService();
    const seeded = seedDemoCorpus(svc, true);
    expect(seeded.firstNoteId).toBe("");
    expect(await svc.listAll()).toEqual([]);
    expect((await svc.listFolders()).length).toBeGreaterThan(6);
  });
});
