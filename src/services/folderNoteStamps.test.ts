import { describe, expect, test } from "bun:test";

import { parseNoteDocument } from "../lib/frontmatter";
import { today } from "../memex/contract";
import { DEST } from "./destinations";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

async function memexVault(): Promise<MemoryVaultDir> {
  const dir = new MemoryVaultDir();
  await dir.mkdir("wiki/_inbox");
  return dir;
}

describe("web note stamps and first title", () => {
  test("a body save stamps a hand-written fenced note without blank managed fields", async () => {
    const dir = await memexVault();
    const path = "wiki/_inbox/no-id.md";
    await dir.writeText(path, "---\ntitle: NoId\ncustom: keep\n---\n# NoId\n");
    const modified = (await dir.stat(path))!.lastModified;
    const notes = new FolderNotesService(dir);
    const opened = (await notes.getNote(path))!;
    const saved = await notes.updateNote(path, "# NoId\n\nA typed word.\n", opened.revision);
    const text = await dir.readText(path);
    const fm = parseNoteDocument(text).frontmatter;
    expect(fm?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(fm?.id).toBe(saved.id);
    expect(fm?.created).toBe(new Date(modified).toISOString().replace(/\.000Z$/, "Z"));
    expect(fm?.updated).toBe(today());
    expect(fm?.foreign).toEqual(["title: NoId", "custom: keep"]);
    expect(text).not.toMatch(/^(?:id|created|updated):\s*$/m);
    expect((await notes.getNote(saved.id))?.body).toBe("# NoId\n\nA typed word.\n");
  });

  test("a blank new note follows its first H1 and keeps its id and Main reference", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const opened = await notes.createNote(DEST.inbox, "");
    await dir.writeText(".rotli/main.json", JSON.stringify({ version: 1, tree: [{ note: opened.id }] }));
    expect(await dir.exists("wiki/_inbox/untitled.md")).toBe(true);
    const saved = await notes.updateNote(opened.id, "# Chooser thing\n", opened.revision);
    expect(saved.id).toBe(opened.id);
    expect(await notes.filePathOf(opened.id)).toBe("wiki/_inbox/chooser-thing.md");
    expect(await dir.exists("wiki/_inbox/untitled.md")).toBe(false);
    expect(
      parseNoteDocument(await dir.readText("wiki/_inbox/chooser-thing.md")).frontmatter?.foreign,
    ).not.toContain('aliases: ["Untitled"]');
    expect(await dir.readText(".rotli/main.json")).toContain(opened.id);
    expect((await new FolderNotesService(dir).getNote(opened.id))?.body).toBe("# Chooser thing\n");
  });

  test("the first title takes a collision suffix without retaining an untitled alias", async () => {
    const dir = await memexVault();
    await dir.writeText("wiki/_inbox/chooser-thing.md", "---\nid: already-here\n---\n# Chooser thing\n");
    const notes = new FolderNotesService(dir);
    const opened = await notes.createNote(DEST.inbox, "");
    const saved = await notes.updateNote(opened.id, "# Chooser thing\n", opened.revision);
    expect(saved.id).toBe(opened.id);
    expect(await notes.filePathOf(opened.id)).toBe("wiki/_inbox/chooser-thing (2).md");
    expect(await dir.exists("wiki/_inbox/untitled.md")).toBe(false);
    expect(saved.aliases).not.toContain("untitled");
    expect((await notes.getNote("already-here"))?.body).toBe("# Chooser thing\n");
  });

  test("trashing a hand-written fenced note stamps missing identity and file dates", async () => {
    const dir = await memexVault();
    const path = "wiki/_inbox/handwritten.md";
    await dir.writeText(path, "---\ncustom: keep\n---\n# Handwritten\n");
    const modified = (await dir.stat(path))!.lastModified;
    const notes = new FolderNotesService(dir);
    const moved = await notes.trashNote(path);
    const text = await dir.readText("trash/wiki/_inbox/handwritten.md");
    const fm = parseNoteDocument(text).frontmatter;
    const stamp = new Date(modified).toISOString().replace(/\.000Z$/, "Z");
    expect(fm?.id).toBe(moved.id);
    expect(fm?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(fm?.created).toBe(stamp);
    expect(fm?.updated).toBe(stamp);
    expect(fm?.foreign).toEqual(["custom: keep"]);
    expect(text).not.toMatch(/^(?:id|created|updated):\s*$/m);
    expect((await notes.getNote(moved.id))?.folderId).toBe(DEST.trash);
  });
});
