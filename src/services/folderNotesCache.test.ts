import { expect, spyOn, test } from "bun:test";

import * as codec from "../lib/frontmatter";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

test("unchanged folder notes are parsed once across indexing, listing, search and reads", async () => {
  const dir = new MemoryVaultDir();
  for (let i = 0; i < 24; i++)
    await dir.writeText(`sample-${i}.md`, `---\nid: sample-${i}\n---\n# Cedar ${i}\n\nPlanning notes.\n`);
  const parse = spyOn(codec, "parseNoteDocument");
  try {
    const notes = new FolderNotesService(dir);
    expect(await notes.listAll()).toHaveLength(24);
    expect(parse).toHaveBeenCalledTimes(24);
    await notes.listAll();
    expect(await notes.searchNotes("Cedar")).toHaveLength(24);
    await notes.getNote("sample-3");
    expect(parse).toHaveBeenCalledTimes(24);
  } finally {
    parse.mockRestore();
  }
});

test("cached documents follow external edits, metadata and service writes", async () => {
  const dir = new MemoryVaultDir();
  const path = "sample.md";
  await dir.writeText(path, "---\nid: cached-note\npinned: false\n---\n# First\n\nOld body.\n");
  const notes = new FolderNotesService(dir);
  const before = await notes.getNote("cached-note");
  await dir.writeText(path, "---\nid: cached-note\npinned: true\n---\n# Other\n\nNew body.\n");
  const changed = await notes.getNote("cached-note");
  expect(changed).toMatchObject({ title: "Other", pinned: true, body: "# Other\n\nNew body.\n" });
  expect(changed?.revision).not.toBe(before?.revision);
  const saved = await notes.updateNote("cached-note", "# Saved\n\nFresh words.\n", changed!.revision);
  expect((await notes.getNote("cached-note"))?.body).toBe(saved.body);
  expect((await notes.listAll())[0]?.title).toBe("Saved");
});
