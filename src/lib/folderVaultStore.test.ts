import { describe, expect, test } from "bun:test";

import { MemoryVaultDir } from "../services/vaultDir";
import { BrowserVault } from "./browserVault";
import { FolderVaultStore, vaultKeyPath } from "./folderVaultStore";

describe("folder-backed vault store", () => {
  test("keys map to the .rotli files the Mac app reads; unknown keys stay under .rotli/web", () => {
    expect(vaultKeyPath("main")).toBe(".rotli/main.json");
    expect(vaultKeyPath("views")).toBe(".rotli/views.json");
    expect(vaultKeyPath("settings:settings")).toBe(".rotli/settings.json");
    expect(vaultKeyPath("settings:viewstate")).toBe(".rotli/viewstate.json");
    expect(vaultKeyPath("app-settings")).toBe(".rotli/web/app-settings.json");
    expect(vaultKeyPath("weird/key")).toBe(".rotli/web/weird_key");
  });

  test("a versioned write stamps the file's own revision and a stale write is refused", async () => {
    const dir = new MemoryVaultDir();
    const vault = new BrowserVault(new FolderVaultStore(dir));
    expect(await vault.readVersioned("main")).toEqual({ contents: "", revision: "0" });
    const first = await vault.writeVersioned("main", '{"version":1,"tree":[]}', "0");
    expect(first).not.toBe("0");
    expect(await dir.readText(".rotli/main.json")).toBe('{"version":1,"tree":[]}');
    expect((await vault.readVersioned("main")).revision).toBe(first);
    // the Mac app (or another tab) wrote the file in between
    await dir.writeText(".rotli/main.json", '{"version":1,"tree":[{"note":"x"}]}');
    await expect(vault.writeVersioned("main", "{}", first)).rejects.toThrow(/revision conflict/);
    expect(await dir.readText(".rotli/main.json")).toBe('{"version":1,"tree":[{"note":"x"}]}');
  });

  test("plain keys read and write their files; a missing file reads as undefined", async () => {
    const dir = new MemoryVaultDir();
    const vault = new BrowserVault(new FolderVaultStore(dir));
    expect(await vault.read("settings:settings")).toBeUndefined();
    await vault.write("settings:settings", '{"theme":"dark"}');
    expect(await dir.readText(".rotli/settings.json")).toBe('{"theme":"dark"}');
    expect(await vault.read("settings:settings")).toBe('{"theme":"dark"}');
  });
});

test("manifest bytes and their revision stay paired across an external save", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText(".rotli/main.json", "before");
  const read = dir.readText.bind(dir);
  let changed = false;
  dir.readText = async (path) => {
    const text = await read(path);
    if (!changed) {
      changed = true;
      await dir.writeText(path, "external");
    }
    return text;
  };
  const vault = new BrowserVault(new FolderVaultStore(dir));
  const opened = await vault.readVersioned("main");
  if (opened.contents === "before") {
    await expect(vault.writeVersioned("main", "mine", opened.revision)).rejects.toThrow("revision conflict");
  } else expect(opened.contents).toBe("external");
  expect(await read(".rotli/main.json")).toBe("external");
});

test("a manifest write carries its check into the adapter", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText(".rotli/main.json", "before");
  const vault = new BrowserVault(new FolderVaultStore(dir));
  const opened = await vault.readVersioned("main");
  const write = dir.writeText.bind(dir);
  dir.writeText = async (path, text, ...gate) => {
    if (text === "mine") await write(path, "external");
    return write(path, text, ...gate);
  };
  await expect(vault.writeVersioned("main", "mine", opened.revision)).rejects.toThrow("revision conflict");
  expect(await dir.readText(".rotli/main.json")).toBe("external");
});

test("a manifest write returns the revision of its own bytes after a later save", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText(".rotli/main.json", "before");
  const store = new FolderVaultStore(dir);
  const vault = new BrowserVault(store);
  const opened = await vault.readVersioned("main");
  const swap = store.compareAndSwap.bind(store);
  store.compareAndSwap = async (...args) => {
    const swapped = await swap(...args);
    if (swapped) await dir.writeText(".rotli/main.json", "external");
    return swapped;
  };
  const mineRevision = await vault.writeVersioned("main", "mine", opened.revision);
  await expect(vault.writeVersioned("main", "next", mineRevision)).rejects.toThrow("revision conflict");
  expect(await dir.readText(".rotli/main.json")).toBe("external");
});
