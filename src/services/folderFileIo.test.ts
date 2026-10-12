import { expect, test } from "bun:test";

import { folderFileBytes, folderFileStat, folderFileText, folderWriteFileBytes } from "./folderFileIo";
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
