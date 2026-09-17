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
    await dir.writeBytes("storage/images/shot.png", new Uint8Array([1, 2, 3]));
    const walked = await walkVaultDir(dir);
    expect(walked.files).toEqual({ "wiki/_inbox/a.md": "# A\n", ".rotli/main.json": "{}" });
    expect(walked.binaries).toEqual({ "storage/images/shot.png": new Uint8Array([1, 2, 3]) });
    expect(walked.dirs.sort()).toEqual([
      ".rotli",
      "storage",
      "storage/images",
      "wiki",
      "wiki/_inbox",
      "wiki/empty",
    ]);
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

  test("a reconnect retires the live copy: its write-on-page-hide never lands on the new one", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    const old = new PersistedVaultDir(
      new MemoryVaultDir(),
      "memex",
      (snapshot) => vault.write(IMPORTED_VAULT_KEY, snapshot),
      0,
    );
    await old.writeText("chats/a.md", "old, unsaved"); // dirty, save pending
    await saveImportedVault(
      { version: 1, name: "memex", files: { "chats/a.md": "new" }, dirs: ["chats"] },
      vault,
    );
    await old.flush(); // the reload's pagehide
    await old.writeText("chats/b.md", "late"); // a straggler after retirement
    await old.flush();
    expect(JSON.parse((await vault.read(IMPORTED_VAULT_KEY))!).files).toEqual({ "chats/a.md": "new" });
  });

  test("forgetting the copy retires it too, so it cannot resurrect itself", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    const old = new PersistedVaultDir(
      new MemoryVaultDir(),
      "memex",
      (snapshot) => vault.write(IMPORTED_VAULT_KEY, snapshot),
      0,
    );
    await old.writeText("wiki/a.md", "x");
    await forgetImportedVault(vault);
    await old.flush();
    expect(await vault.read(IMPORTED_VAULT_KEY)).toBeUndefined();
  });

  test("save and forget round-trip through the browser vault", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await saveImportedVault({ version: 1, name: "m", files: { "a.md": "x" }, dirs: [] }, vault);
    expect(await vault.read(IMPORTED_VAULT_KEY)).toContain('"a.md"');
    await forgetImportedVault(vault);
    expect(await vault.read(IMPORTED_VAULT_KEY)).toBeUndefined();
  });
});

describe("binaries in an imported copy", () => {
  test("an image the browser refuses to keep is not kept in memory either", async () => {
    const inner = await seedVaultDir({ version: 1, name: "memex", files: {}, dirs: [] });
    const dir = new PersistedVaultDir(
      inner,
      "memex",
      async () => {
        throw new Error("QuotaExceededError");
      },
      0,
    );
    await expect(dir.writeBytes("storage/images/shot.png", new Uint8Array([1]))).rejects.toThrow(/Quota/);
    expect(await inner.exists("storage/images/shot.png")).toBe(false);
  });

  test("an image written in the browser rides the snapshot and comes back as bytes", async () => {
    let stored = "{}";
    const inner = await seedVaultDir({
      version: 1,
      name: "memex",
      files: { "wiki/a.md": "# A\n" },
      dirs: [],
    });
    const dir = new PersistedVaultDir(
      inner,
      "memex",
      async (snapshot) => {
        stored = snapshot;
      },
      0,
    );
    const bytes = new Uint8Array([137, 80, 78, 71]);
    await dir.writeBytes("storage/images/shot.png", bytes);
    await dir.flush();
    const saved = JSON.parse(stored);
    expect(saved.binaries).toEqual({ "storage/images/shot.png": btoa("\x89PNG") });
    expect(saved.files["storage/images/shot.png"]).toBeUndefined();
    const again = await seedVaultDir(saved);
    expect(await again.readBytes("storage/images/shot.png")).toEqual(bytes);
    expect(await again.readText("wiki/a.md")).toBe("# A\n");
  });
});
