import { expect, test } from "bun:test";

import { folderFileBytes, folderFileStat, folderFileText, folderWriteFileBytes } from "./folderFileIo";
import { FolderNotesService } from "./folderNotes";
import { fileLifecycleRows, readFileLifecycle } from "./itemLifecycle";
import { MemoryVaultDir, bytesRevision, contentRevision, type VaultDir } from "./vaultDir";

interface Road {
  dir: VaultDir;
  externalBytes(path: string, bytes: Uint8Array): Promise<void>;
  externalText(path: string, text: string): Promise<void>;
}

async function changeWithSameStat(
  disk: MemoryVaultDir,
  path: string,
  write: () => Promise<void>,
): Promise<void> {
  const stamp = await disk.stat(path);
  const stat = disk.stat.bind(disk);
  disk.stat = async (target) => (target === path ? stamp : stat(target));
  await write();
}

export function memoryBackedRoad(dir: VaultDir, disk: MemoryVaultDir): Road {
  return {
    dir,
    externalBytes: (path, bytes) => changeWithSameStat(disk, path, () => disk.writeBytes(path, bytes)),
    externalText: (path, text) => changeWithSameStat(disk, path, () => disk.writeText(path, text)),
  };
}

/** Every road exercises the same editor-facing stat/read/write contract. */
export function testByteEditorRoad(name: string, make: () => Road): void {
  test(`${name} byte editor protects same-stamp edits and chains saves`, async () => {
    const road = make();
    const { dir } = road;
    const path = "book.xlsx";
    const original = new Uint8Array([0, 1, 2, 255]);
    const external = new Uint8Array([0, 1, 3, 255]);
    await dir.writeBytes(path, original);
    const opened = (await folderFileStat(dir, path))!;
    const read = Uint8Array.from(atob(await folderFileBytes(dir, path)), (c) => c.charCodeAt(0));
    expect(opened.revision).toBe(bytesRevision(read));
    await road.externalBytes(path, external);
    await expect(folderWriteFileBytes(dir, path, btoa("save"), false, opened.revision)).rejects.toThrow(
      /revision conflict/,
    );
    expect(await dir.readBytes(path)).toEqual(external);
    const fresh = (await folderFileStat(dir, path))!;
    const first = await folderWriteFileBytes(dir, path, btoa("save"), false, fresh.revision);
    expect(first).toBe(bytesRevision(new TextEncoder().encode("save")));
    const second = await folderWriteFileBytes(dir, path, btoa("next"), false, first);
    expect(second).toBe(bytesRevision(new TextEncoder().encode("next")));
    await expect(folderWriteFileBytes(dir, path, btoa("oops"), false, "0")).rejects.toThrow(
      /revision conflict/,
    );
    expect(await dir.readBytes(path)).toEqual(new TextEncoder().encode("next"));
    expect(await folderWriteFileBytes(dir, "new.xlsx", btoa("new"), false, "0")).toBe(
      bytesRevision(new TextEncoder().encode("new")),
    );
  });

  test(`${name} CSV editor refuses a same-stamp external text edit`, async () => {
    const road = make();
    const { dir } = road;
    const path = "rows.csv";
    await dir.writeText(path, "a,b\n1,2\n");
    const opened = (await folderFileStat(dir, path))!;
    expect(opened.revision).toBe(contentRevision(await folderFileText(dir, path)));
    await road.externalText(path, "a,b\n3,4\n");
    await expect(folderWriteFileBytes(dir, path, btoa("a,b\n5,6\n"), false, opened.revision)).rejects.toThrow(
      /revision conflict/,
    );
    expect(new TextDecoder().decode(await dir.readBytes(path))).toBe("a,b\n3,4\n");
  });
}

testByteEditorRoad("Memory", () => {
  const dir = new MemoryVaultDir();
  return memoryBackedRoad(dir, dir);
});

test("two first saves race for one backup but both reach the main file revision gate", async () => {
  const disk = new MemoryVaultDir();
  const path = "rows.csv";
  await disk.writeText(path, "before");
  let arrived = 0;
  let release!: () => void;
  const bothChecked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let mainWrites = 0;
  const dir = new Proxy(disk, {
    get(target, key) {
      if (key === "exists")
        return async (candidate: string) => {
          if (candidate === `${path}.bak`) {
            arrived += 1;
            if (arrived === 2) release();
            await bothChecked;
            return false;
          }
          return target.exists(candidate);
        };
      if (key === "writeBytes")
        return async (candidate: string, bytes: Uint8Array, gate?: string) => {
          if (candidate === path) mainWrites += 1;
          return target.writeBytes(candidate, bytes, gate);
        };
      const value = Reflect.get(target, key) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as VaultDir;
  const revision = contentRevision("before");
  const results = await Promise.allSettled([
    folderWriteFileBytes(dir, path, btoa("first"), true, revision),
    folderWriteFileBytes(dir, path, btoa("other"), true, revision),
  ]);
  expect(mainWrites).toBe(2);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await disk.readText(`${path}.bak`)).toBe("before");
});

test("a connected-folder file enables Archive and Trash in its menu", async () => {
  const dir = new MemoryVaultDir();
  await dir.mkdir("wiki");
  await dir.writeBytes("storage/rotli/Plan.docx", new Uint8Array([1]));
  const stat = await folderFileStat(dir, "storage/rotli/Plan.docx");
  expect(fileLifecycleRows(await readFileLifecycle(async () => stat)).movable).toBe(true);
  const notes = new FolderNotesService(dir);
  const archived = await notes.moveNote("storage/rotli/Plan.docx", "Archive");
  expect(archived.id).toBe("archive/storage/rotli/Plan.docx");
  expect(await dir.exists("storage/rotli/Plan.docx")).toBe(false);
  const restored = await notes.restoreNote(archived.id);
  expect(restored.id).toBe("storage/rotli/Plan.docx");
  const trashed = await notes.moveNote(restored.id, "Trash");
  expect(trashed.id).toBe("trash/storage/rotli/Plan.docx");
});
