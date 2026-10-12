import { describe, expect, test } from "bun:test";

import { createManagedFile, discardPristineManagedFile } from "./folderManagedFiles";
import { MemoryVaultDir, bytesRevision, type VaultDir } from "./vaultDir";

const bytes = new Uint8Array([0, 255, 19]);

describe("web managed files", () => {
  test("creates in the memex lane, selects collision names, and preserves a racing file", async () => {
    const disk = new MemoryVaultDir();
    await disk.mkdir("wiki");
    await disk.writeBytes("storage/rotli/Plan.docx", new Uint8Array([1]));
    let raced = false;
    const dir: VaultDir = new Proxy(disk, {
      get(target, key) {
        if (key === "writeBytes")
          return async (path: string, data: Uint8Array, gate?: string) => {
            if (!raced && path.endsWith("Plan-2.docx")) {
              raced = true;
              await target.writeBytes(path, new Uint8Array([2]), "0");
            }
            return target.writeBytes(path, data, gate);
          };
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await createManagedFile(dir, "Plan.docx", bytes)).toBe("storage/rotli/Plan-3.docx");
    expect(await disk.readBytes("storage/rotli/Plan-2.docx")).toEqual(new Uint8Array([2]));
    expect(await disk.readBytes("storage/rotli/Plan-3.docx")).toEqual(bytes);
  });

  test("plain vault uses Storage and refuses invalid names and extensions", async () => {
    const dir = new MemoryVaultDir();
    expect(await createManagedFile(dir, "Book.xlsx", bytes)).toBe("Storage/Book.xlsx");
    await expect(createManagedFile(dir, "../bad.docx", bytes)).rejects.toThrow();
    await expect(createManagedFile(dir, ".hidden.docx", bytes)).rejects.toThrow();
    await expect(createManagedFile(dir, "script.sh", bytes)).rejects.toThrow(/managed files must use/);
  });

  test("discard removes only exact session-created bytes", async () => {
    const dir = new MemoryVaultDir();
    const id = await createManagedFile(dir, "Draft.docx", bytes);
    await discardPristineManagedFile(dir, id);
    expect(await dir.exists(id)).toBe(false);
    const changed = await createManagedFile(dir, "Draft.docx", bytes);
    await dir.writeBytes(changed, new Uint8Array([9]), bytesRevision(bytes));
    await expect(discardPristineManagedFile(dir, changed)).rejects.toThrow(/revision conflict/);
    expect(await dir.readBytes(changed)).toEqual(new Uint8Array([9]));
  });
});
