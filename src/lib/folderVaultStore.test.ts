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
