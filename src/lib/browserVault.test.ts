import { describe, expect, test } from "bun:test";

import { BrowserVault, MemoryVaultStore, isWebVault } from "./browserVault";

describe("browser vault", () => {
  test("the desktop build never has a web vault", () => {
    // bun tests run without the Vite define, which is the desktop default
    expect(isWebVault()).toBe(false);
  });

  test("plain keys round-trip and a missing key reads as undefined", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    expect(await vault.read("settings:settings")).toBeUndefined();
    await vault.write("settings:settings", '{"theme":"dark"}');
    expect(await vault.read("settings:settings")).toBe('{"theme":"dark"}');
  });

  test("a versioned file starts empty at revision 0 and advances on every write", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    expect(await vault.readVersioned("main")).toEqual({ contents: "", revision: "0" });
    const first = await vault.writeVersioned("main", '{"version":1,"tree":[]}', "0");
    expect(first).toBe("1");
    const second = await vault.writeVersioned("main", '{"version":1,"tree":[{"x":1}]}', first);
    expect(second).toBe("2");
    expect(await vault.readVersioned("main")).toEqual({
      contents: '{"version":1,"tree":[{"x":1}]}',
      revision: "2",
    });
  });

  test("a stale revision is refused and leaves the stored value untouched", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await vault.writeVersioned("views", "a", "0");
    await expect(vault.writeVersioned("views", "b", "0")).rejects.toThrow(/revision conflict/);
    await expect(vault.writeVersioned("views", "b", "")).rejects.toThrow(/revision conflict/);
    expect(await vault.readVersioned("views")).toEqual({ contents: "a", revision: "1" });
  });

  test("versioned keys are independent of each other", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    await vault.writeVersioned("main", "m", "0");
    expect(await vault.readVersioned("views")).toEqual({ contents: "", revision: "0" });
  });

  test("two writers racing from the same revision: exactly one wins, in one transaction", async () => {
    const vault = new BrowserVault(new MemoryVaultStore());
    const results = await Promise.allSettled([
      vault.writeVersioned("main", "from tab A", "0"),
      vault.writeVersioned("main", "from tab B", "0"),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won.length).toBe(1);
    expect(lost.length).toBe(1);
    expect(String((lost[0] as PromiseRejectedResult).reason)).toMatch(/revision conflict/);
    expect((await vault.readVersioned("main")).revision).toBe("1");
  });
});
