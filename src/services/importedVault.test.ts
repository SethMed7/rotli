import { describe, expect, test } from "bun:test";

import { BrowserVault, MemoryVaultStore } from "../lib/browserVault";
import {
  IMPORTED_VAULT_KEY,
  PersistedVaultDir,
  forgetImportedVault,
  importableVaultPaths,
  isImportedVaultSnapshot,
  saveImportedVault,
  seedVaultDir,
  walkVaultDir,
} from "./importedVault";
import { MemoryVaultDir } from "./vaultDir";

describe("importing a picked folder", () => {
  test("keeps the vault's text files, strips the folder name, and leaves binaries and storage out", () => {
    const picked = [
      { relativePath: "memex/wiki/_inbox/a.md", size: 10 },
      { relativePath: "memex/.rotli/main.json", size: 10 },
      { relativePath: "memex/storage/images/x.png", size: 10 },
      { relativePath: "memex/storage/notes.md", size: 10 },
      { relativePath: "memex/.git/HEAD", size: 10 },
      { relativePath: "memex/wiki/photo.jpg", size: 10 },
      { relativePath: "memex/wiki/huge.md", size: 5 * 1024 * 1024 },
      { relativePath: "memex/.hidden/secret.md", size: 10 },
      { relativePath: "memex", size: 0 },
    ];
    expect(importableVaultPaths(picked)).toEqual([
      { from: "memex/wiki/_inbox/a.md", to: "wiki/_inbox/a.md" },
      { from: "memex/.rotli/main.json", to: ".rotli/main.json" },
    ]);
  });

  test("a snapshot seeds a filesystem and a walk reproduces it", async () => {
    const dir = await seedVaultDir({
      version: 1,
      name: "memex",
      files: { "wiki/_inbox/a.md": "# A\n", ".rotli/main.json": "{}" },
      dirs: ["wiki/empty"],
    });
    const walked = await walkVaultDir(dir);
    expect(walked.files).toEqual({ "wiki/_inbox/a.md": "# A\n", ".rotli/main.json": "{}" });
    expect(walked.dirs.sort()).toEqual([".rotli", "wiki", "wiki/_inbox", "wiki/empty"]);
    expect(isImportedVaultSnapshot({ version: 1, name: "x", files: {}, dirs: [] })).toBe(true);
    expect(isImportedVaultSnapshot({ version: 2, name: "x", files: {}, dirs: [] })).toBe(false);
  });

  test("a persisted filesystem mirrors every mutation into the saved snapshot", async () => {
    const saved: string[] = [];
    const dir = new PersistedVaultDir(
      new MemoryVaultDir(),
      "memex",
      async (s) => {
        saved.push(s);
      },
      0,
    );
    await dir.writeText("wiki/_inbox/a.md", "one");
    await dir.flush();
    await dir.move("wiki/_inbox/a.md", "trash/wiki/_inbox/a.md");
    await dir.flush();
    await dir.remove("trash/wiki/_inbox/a.md");
    await dir.flush();
    expect(saved.length).toBe(3);
    const last = JSON.parse(saved[2]!);
    expect(last.files).toEqual({});
    expect(last.dirs).toContain("trash/wiki/_inbox");
    expect(last.name).toBe("memex");
  });

  test("save and forget round-trip through the browser vault", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await saveImportedVault({ version: 1, name: "m", files: { "a.md": "x" }, dirs: [] }, vault);
    expect(await vault.read(IMPORTED_VAULT_KEY)).toContain('"a.md"');
    await forgetImportedVault(vault);
    expect(await vault.read(IMPORTED_VAULT_KEY)).toBeUndefined();
  });
});
