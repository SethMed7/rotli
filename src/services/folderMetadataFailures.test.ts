import { expect, test } from "bun:test";

import { parseNoteDocument } from "../lib/frontmatter";
import { folderFileStat, folderWriteFileBytes } from "./folderFileIo";
import { setFolderSecure, writeFolderRawMetadata } from "./folderMetadata";
import { FolderNotesService } from "./folderNotes";
import { writeFolderViews } from "./folderViewSync";
import { MemoryVaultDir } from "./vaultDir";

const text = "---\nid: untouched-id\ncustom: survives\n---\n# Before rename\n\nKeep this prose.\n";

test("a failed git exclusion aborts secure marking before any note write or move", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("wiki/keep.md", text);
  await dir.mkdir(".gitignore");
  await expect(setFolderSecure(dir, "wiki/keep.md", true)).rejects.toThrow();
  expect(await dir.readText("wiki/keep.md")).toBe(text);
  expect(await dir.exists("wiki/_secure/keep.md")).toBe(false);
});

test("an imported path-addressed note cannot claim a secure move without durable identity", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("plain.md", "# Imported without provenance\n");
  await expect(setFolderSecure(dir, "plain.md", true)).rejects.toThrow(/stable frontmatter id/);
  expect(await dir.readText("plain.md")).toBe("# Imported without provenance\n");
});

test("a raw secure flag synchronizes git exclusion while preserving the exact body", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("wiki/raw.md", text);
  const stat = (await dir.stat("wiki/raw.md"))!;
  await writeFolderRawMetadata(
    dir,
    "wiki/raw.md",
    "id: untouched-id\ncustom: survives\nsecure: true",
    `${stat.lastModified}:${stat.size}`,
  );
  const out = await dir.readText("wiki/raw.md");
  expect(parseNoteDocument(out).body).toBe(parseNoteDocument(text).body);
  expect(await dir.readText(".gitignore")).toContain("wiki/raw.md");
});

test("secure title renames preserve aliases and move the git exclusion to the final path", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("wiki/before-rename.md", text);
  await setFolderSecure(dir, "wiki/before-rename.md", true);
  const notes = new FolderNotesService(dir);
  const note = (await notes.getNote("untouched-id"))!;
  const saved = await notes.updateNote(note.id, "# Completely changed\n\nKeep this prose.\n", note.revision);
  expect(saved.aliases).toContain("Before rename");
  expect(await dir.readText(".gitignore")).toContain("wiki/_secure/completely-changed.md");
  expect(await dir.readText(".gitignore")).not.toContain("wiki/_secure/before-rename.md");
});

test("views reject duplicate membership and future schemas without changing note bytes", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("wiki/keep.md", text);
  for (const contents of [
    '{"version":2,"views":[]}',
    '{"version":1,"views":[{"name":"Work","tree":[{"note":"untouched-id"},{"note":"untouched-id"}]}]}',
  ])
    await expect(writeFolderViews(dir, contents, "0")).rejects.toThrow();
  expect(await dir.readText("wiki/keep.md")).toBe(text);
  expect(await dir.exists(".rotli/views.json")).toBe(false);
});

test("a manifest write failure restores notes but never overwrites an intervening edit", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("wiki/keep.md", text);
  const write = dir.writeText.bind(dir);
  dir.writeText = async (path, contents) => {
    if (path === ".rotli/views.json") {
      await write("wiki/keep.md", "# A newer external edit\n");
      throw new Error("manifest denied");
    }
    await write(path, contents);
  };
  await expect(
    writeFolderViews(dir, '{"version":1,"views":[{"name":"Work","tree":[{"note":"untouched-id"}]}]}', "0"),
  ).rejects.toThrow("manifest denied");
  expect(await dir.readText("wiki/keep.md")).toBe("# A newer external edit\n");
  expect(await dir.exists(".rotli/views.json")).toBe(false);
});

test("binary write gates protect read-only storage and create the first CSV backup only once", async () => {
  const dir = new MemoryVaultDir();
  await dir.mkdir("wiki");
  await dir.writeText("storage/original.png", "synthetic bytes");
  const image = (await folderFileStat(dir, "storage/original.png"))!;
  expect(image.writable).toBe(false);
  await expect(
    folderWriteFileBytes(dir, "storage/original.png", btoa("replace"), false, image.revision),
  ).rejects.toThrow(/not writable/);
  await dir.writeText("storage/grid.csv", "Column\nBefore\n");
  const first = (await folderFileStat(dir, "storage/grid.csv"))!;
  const next = await folderWriteFileBytes(
    dir,
    "storage/grid.csv",
    btoa("Column\nAfter\n"),
    true,
    first.revision,
  );
  await folderWriteFileBytes(dir, "storage/grid.csv", btoa("Column\nFinal\n"), true, next);
  expect(new TextDecoder().decode(await dir.readBytes("storage/grid.csv.bak"))).toBe("Column\nBefore\n");
  await expect(folderFileStat(dir, ".rotli/settings.json")).rejects.toThrow(/not a vault file/);
  await expect(folderFileStat(dir, "storage/../outside.csv")).rejects.toThrow(/not a vault file/);
});

test("detected secrets refuse secure removal through the explicit and raw lanes", async () => {
  const dir = new MemoryVaultDir();
  // Public synthetic test-card fixture, never a real account.
  const note = "---\nid: test-card-fixture\nsecure: true\n---\n# Checkout\n\ncard 4242 4242 4242 4242\n";
  await dir.writeText("wiki/_secure/checkout.md", note);
  await expect(setFolderSecure(dir, "wiki/_secure/checkout.md", false)).rejects.toThrow(/detected secret/);
  const stat = (await dir.stat("wiki/_secure/checkout.md"))!;
  await expect(
    writeFolderRawMetadata(
      dir,
      "wiki/_secure/checkout.md",
      "id: test-card-fixture",
      `${stat.lastModified}:${stat.size}`,
    ),
  ).rejects.toThrow(/detected secret/);
  expect(await dir.readText("wiki/_secure/checkout.md")).toBe(note);
});
