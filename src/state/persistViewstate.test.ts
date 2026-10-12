// Viewstate hydration gates restored tabs on what still exists in the vault.
// The gate is the whole corpus: a capture, archived, or trashed note is still
// a note, and its tab must survive a reload or relaunch.

import { describe, expect, test } from "bun:test";

import { DEST } from "../services/destinations";
import { FolderNotesService } from "../services/folderNotes";
import { MemoryVaultDir } from "../services/vaultDir";
import type { Tab } from "../types";
import { existingItemIds, validTab } from "./persist";

describe("existingItemIds — restored tabs are gated on the whole vault", () => {
  test("a new memex note is a capture, hidden from All Notes, and its tab still reopens", async () => {
    const dir = new MemoryVaultDir();
    await dir.mkdir("wiki");
    const notes = new FolderNotesService(dir);
    const created = await notes.createNote(DEST.inbox, "# Chooser thing\n\nSaved in the named file.");
    expect(created.folderId).toBe(DEST.board);
    expect((await notes.listNotes()).map((n) => n.id)).not.toContain(created.id);

    const alive = await existingItemIds(notes);
    const tab = { id: "t1", surfaceKind: "note", noteId: created.id };
    expect(validTab(tab, alive)).toEqual(tab as Tab);
    expect(validTab({ ...tab, noteId: "deleted-elsewhere" }, alive)).toBeNull();
  });
});
