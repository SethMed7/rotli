import { expect, test } from "bun:test";

import { renameFolderFile } from "./folderFileRename";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";

test("a renamed Office file takes its first-save backup to the new name", async () => {
  const dir = new MemoryVaultDir();
  await dir.mkdir("wiki");
  await dir.writeBytes("storage/rotli/Working.xlsx", new Uint8Array([11]));
  await dir.writeBytes("storage/rotli/Working.xlsx.bak", new Uint8Array([12]));
  const notes = new FolderNotesService(dir);
  expect(await notes.renameFile("storage/rotli/Working.xlsx", "Budget")).toBe("storage/rotli/Budget.xlsx");
  expect(await dir.readBytes("storage/rotli/Budget.xlsx.bak")).toEqual(new Uint8Array([12]));
  expect(await dir.exists("storage/rotli/Working.xlsx.bak")).toBe(false);
});

test("a destination backup wins and a colliding name is refused", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeBytes("Storage/Current.docx", new Uint8Array([21]));
  await dir.writeBytes("Storage/Current.docx.bak", new Uint8Array([22]));
  await dir.writeBytes("Storage/Target.docx.bak", new Uint8Array([23]));
  await dir.writeBytes("Storage/Taken.docx", new Uint8Array([24]));
  const notes = new FolderNotesService(dir);
  await expect(notes.renameFile("Storage/Current.docx", "Taken")).rejects.toThrow(/already exists/);
  expect(await notes.renameFile("Storage/Current.docx", "Target")).toBe("Storage/Target.docx");
  expect(await dir.readBytes("Storage/Target.docx.bak")).toEqual(new Uint8Array([23]));
  expect(await dir.readBytes("Storage/Current.docx.bak")).toEqual(new Uint8Array([22]));
});

test("a case-only rename carries its backup", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeBytes("Storage/Plan.docx", new Uint8Array([31]));
  await dir.writeBytes("Storage/Plan.docx.bak", new Uint8Array([32]));
  const notes = new FolderNotesService(dir);
  expect(await notes.renameFile("Storage/Plan.docx", "PLAN")).toBe("Storage/PLAN.docx");
  expect(await dir.readBytes("Storage/PLAN.docx.bak")).toEqual(new Uint8Array([32]));
});

test("a racing destination takes the backup to the actual collided name", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeBytes("Storage/Old.docx", new Uint8Array([1]));
  await dir.writeBytes("Storage/Old.docx.bak", new Uint8Array([2]));
  const moved = await renameFolderFile(
    dir,
    "Storage/Old.docx",
    "New",
    "Storage/Old.docx",
    async (from, to) => {
      await dir.writeBytes(to, new Uint8Array([3]), "0");
      const actual = "Storage/New (2).docx";
      await dir.move(from, actual);
      return actual;
    },
  );
  expect(moved).toBe("Storage/New (2).docx");
  expect(await dir.readBytes("Storage/New (2).docx.bak")).toEqual(new Uint8Array([2]));
  expect(await dir.exists("Storage/New.docx.bak")).toBe(false);
});
