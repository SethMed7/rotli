import { expect, test } from "bun:test";

import { corpusSetLocked, corpusSetAiEdit } from "../lib/noteProtection";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";
import { configureWebVaultIo } from "./webVaultIo";

// Decision B (owner, 2026-10-13): in a folder opened in place (no Rotli
// marker), a person's note changes only by what they asked for. No title
// rename (Obsidian links by file name), no id/created/updated.

async function openInPlace(files: Record<string, string>) {
  const dir = new MemoryVaultDir();
  for (const [path, text] of Object.entries(files)) await dir.writeText(path, text);
  const notes = new FolderNotesService(dir);
  configureWebVaultIo(dir, notes);
  const byPath = async (path: string) => {
    for (const summary of await notes.listAll())
      if ((await notes.filePathOf(summary.id)) === path) return (await notes.getNote(summary.id))!;
    throw new Error(`no note at ${path}`);
  };
  return { dir, notes, byPath };
}

test("a save keeps the person's file name and frontmatter bytes", async () => {
  const { dir, notes, byPath } = await openInPlace({
    "Garden/Roses Today.md": "# Roses Today\n\nPruned.\n",
    "Garden/Beds.md": "---\ntags: [garden]\n---\n# Beds\n\nMulch.\n",
  });
  const roses = await byPath("Garden/Roses Today.md");
  await notes.updateNote(roses.id, "# Roses tomorrow\n\nWatered.\n", roses.revision);
  expect(await dir.readText("Garden/Roses Today.md")).toBe("# Roses tomorrow\n\nWatered.\n");
  expect(await dir.exists("Garden/roses-tomorrow.md")).toBe(false);

  const beds = await byPath("Garden/Beds.md");
  await notes.updateNote(beds.id, "# Beds\n\nCompost.\n", beds.revision);
  expect(await dir.readText("Garden/Beds.md")).toBe("---\ntags: [garden]\n---\n# Beds\n\nCompost.\n");
});

test("lock and the AI edit grant add one line each, and unlocking restores the bytes", async () => {
  const original = "---\ntags: [garden]\n---\n# Shed\n\nTools.\n";
  const { dir, byPath } = await openInPlace({ "Garden/Shed.md": original });
  const shed = await byPath("Garden/Shed.md");
  await corpusSetLocked(shed.id, true);
  expect(await dir.readText("Garden/Shed.md")).toBe(
    "---\ntags: [garden]\nlocked: true\n---\n# Shed\n\nTools.\n",
  );
  await corpusSetLocked(shed.id, false);
  expect(await dir.readText("Garden/Shed.md")).toBe(original);
  await corpusSetAiEdit(shed.id, false);
  const text = await dir.readText("Garden/Shed.md");
  expect(text).toContain("ai_edit: false");
  expect(text).not.toContain("id:");
});

test("trash and restore bring a person's note back byte-for-byte", async () => {
  const original = "---\ntags: [garden]\n---\n# Seeds\n\nSow in spring.\n";
  const { dir, notes, byPath } = await openInPlace({ "Garden/Seeds.md": original });
  const seeds = await byPath("Garden/Seeds.md");
  const trashed = await notes.moveNote(seeds.id, "Trash");
  const trashedPath = await notes.filePathOf(trashed.id);
  const inTrash = await dir.readText(trashedPath);
  expect(inTrash).toContain("origin: ");
  expect(inTrash).not.toContain("created:");
  const restored = await notes.restoreNote(trashed.id);
  expect(await dir.readText(await notes.filePathOf(restored.id))).toBe(original);
});

test("a note Rotli makes there still follows its first title", async () => {
  const { dir, notes } = await openInPlace({ "Garden/Beds.md": "# Beds\n" });
  const made = await notes.createNote("", "# Untitled\n");
  const saved = await notes.updateNote(made.id, "# Planting plan\n\nRows.\n", made.revision);
  expect(await notes.filePathOf(saved.id)).toMatch(/planting-plan\.md$/);
  expect(await dir.readText("Garden/Beds.md")).toBe("# Beds\n");
});
