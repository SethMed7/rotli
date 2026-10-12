import { expect, test } from "bun:test";

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
