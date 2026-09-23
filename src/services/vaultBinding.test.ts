import { describe, expect, test } from "bun:test";

import { MemoryVaultStore } from "../lib/browserVault";
import {
  helperConnection,
  persistPendingOnUnload,
  replayPendingOps,
  unsupportedBrowser,
} from "./vaultBinding";
import { MemoryVaultDir } from "./vaultDir";

const binding = { kind: "helper", vaultId: "hv_1", vaultName: "memex" } as const;
const info = { name: "memex", id: "hv_1", empty: false };

describe("a helper binding's connection", () => {
  test("connected only when the helper serves the vault this browser opened", () => {
    expect(helperConnection(binding, { kind: "serving", info })).toEqual({
      status: "connected",
      via: "helper",
      name: "memex",
    });
  });

  test("every other answer names what's wrong, never a stand-in vault", () => {
    expect(helperConnection(binding, { kind: "offline" })).toEqual({
      status: "helper-offline",
      name: "memex",
    });
    expect(helperConnection(binding, { kind: "refused" })).toEqual({
      status: "helper-refused",
      name: "memex",
    });
    expect(helperConnection(binding, { kind: "outdated" })).toEqual({
      status: "helper-outdated",
      name: "memex",
    });
    expect(helperConnection(binding, { kind: "serving", info: null })).toEqual({ status: "helper-no-vault" });
    expect(
      helperConnection(binding, { kind: "serving", info: { ...info, id: "hv_2", name: "other" } }),
    ).toEqual({
      status: "vault-mismatch",
      expected: "memex",
      served: "other",
    });
    // serving, but this browser hasn't chosen it yet: setup asks
    expect(helperConnection(null, { kind: "serving", info })).toEqual({ status: "unbound" });
  });
});

test("Safari and phones can't reach a folder; Zen and Firefox can, through the helper", () => {
  const safari = { kind: "import-only", browser: "Safari" } as const;
  const zen = { kind: "import-only", browser: "Zen" } as const;
  expect(unsupportedBrowser(safari, "Mozilla/5.0 (Macintosh) Safari/605")).toBe("Safari");
  expect(unsupportedBrowser(zen, "Mozilla/5.0 (Macintosh) Gecko Firefox/140 Zen/1.0")).toBeNull();
  expect(unsupportedBrowser({ kind: "live" }, "Mozilla/5.0 (Linux; Android 15) Mobile Chrome")).toBe(
    "this phone or tablet",
  );
  expect(unsupportedBrowser({ kind: "live" }, "Mozilla/5.0 (Macintosh) Chrome/140")).toBeNull();
});

/** localStorage's shape, in memory: where an unloading page writes. */
function syncStore() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
}

const revisionOf = (stat: { lastModified: number; size: number } | null) =>
  stat ? `${stat.lastModified}:${stat.size}` : "0";

describe("edits a closed tab couldn't deliver", () => {
  test("replay onto an unchanged file, and beside a changed one — never over it", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "base");
    await dir.writeText("wiki/b.md", "base");
    const a = revisionOf(await dir.stat("wiki/a.md"));
    const b = revisionOf(await dir.stat("wiki/b.md"));
    await dir.writeText("wiki/b.md", "changed elsewhere");
    const unload = syncStore();
    persistPendingOnUnload(unload, "hv_1", [
      { kind: "write", path: "wiki/a.md", text: "offline a", base: a },
      { kind: "write", path: "wiki/b.md", text: "offline b", base: b },
      { kind: "mkdir", path: "chats" },
    ]);
    expect(await replayPendingOps(dir, "hv_1", new MemoryVaultStore(), unload)).toBe(3);
    expect(await dir.readText("wiki/a.md")).toBe("offline a");
    expect(await dir.readText("wiki/b.md")).toBe("changed elsewhere");
    expect(await dir.readText("wiki/b (unsaved copy).md")).toBe("offline b");
    expect(await dir.exists("chats")).toBe(true);
    expect(unload.values.size).toBe(0);
  });

  test("an edit that landed before the tab closed is not copied again", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "base");
    const stale = revisionOf(await dir.stat("wiki/a.md"));
    await dir.writeText("wiki/a.md", "the offline edit"); // the helper came back; it landed
    const unload = syncStore();
    persistPendingOnUnload(unload, "hv_1", [
      { kind: "write", path: "wiki/a.md", text: "the offline edit", base: stale },
    ]);
    await replayPendingOps(dir, "hv_1", new MemoryVaultStore(), unload);
    expect(await dir.exists("wiki/a (unsaved copy).md")).toBe(false);
  });

  test("a second conflict never overwrites the first unsaved copy", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "changed elsewhere");
    await dir.writeText("wiki/a (unsaved copy).md", "the first offline edit");
    const unload = syncStore();
    persistPendingOnUnload(unload, "hv_1", [
      { kind: "write", path: "wiki/a.md", text: "second", base: "stale" },
    ]);
    expect(await replayPendingOps(dir, "hv_1", new MemoryVaultStore(), unload)).toBe(1);
    expect(await dir.readText("wiki/a (unsaved copy).md")).toBe("the first offline edit");
    expect(await dir.readText("wiki/a (unsaved copy 2).md")).toBe("second");
  });

  test("a delete decided while offline never removes a note changed meanwhile", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "old");
    const stale = revisionOf(await dir.stat("wiki/a.md"));
    await dir.writeText("wiki/a.md", "newer, from the Mac app");
    await dir.writeText("wiki/b.md", "untouched");
    const b = revisionOf(await dir.stat("wiki/b.md"));
    const unload = syncStore();
    persistPendingOnUnload(unload, "hv_1", [
      { kind: "remove", path: "wiki/a.md", base: stale },
      { kind: "remove", path: "wiki/b.md", base: b },
    ]);
    await replayPendingOps(dir, "hv_1", new MemoryVaultStore(), unload);
    expect(await dir.readText("wiki/a.md")).toBe("newer, from the Mac app");
    expect(await dir.exists("wiki/b.md")).toBe(false);
  });

  test("a change that can't be replayed yet is kept for the next boot, not dropped", async () => {
    const dir = new MemoryVaultDir();
    const store = new MemoryVaultStore();
    const unload = syncStore();
    const ops = [{ kind: "move", from: "missing.md", to: "b.md" }] as const;
    persistPendingOnUnload(unload, "hv_1", ops);
    expect(await replayPendingOps(dir, "hv_1", store, unload)).toBe(0);
    // retained under the vault's own kept key; the unload record is consumed
    expect(unload.values.size).toBe(0);
    expect(JSON.parse((await store.get("vault-pending:kept:hv_1")) ?? "{}")).toEqual({
      vaultId: "hv_1",
      ops,
    });
    // the next unload (nothing pending) can't touch it, and the next boot retries it
    persistPendingOnUnload(unload, "hv_1", []);
    expect(await replayPendingOps(dir, "hv_1", store, unload)).toBe(0);
    expect(JSON.parse((await store.get("vault-pending:kept:hv_1")) ?? "{}").ops).toEqual(ops);
  });

  test("one vault's unload never touches another vault's record, and it isn't replayed there", async () => {
    const unload = syncStore();
    persistPendingOnUnload(unload, "hv_a", [{ kind: "mkdir", path: "x" }]);
    persistPendingOnUnload(unload, "hv_b", []); // vault B closes with nothing pending
    expect(unload.values.has("rotli-vault-pending:hv_a")).toBe(true);
    const dir = new MemoryVaultDir();
    expect(await replayPendingOps(dir, "hv_b", new MemoryVaultStore(), unload)).toBe(0);
    expect(await dir.exists("x")).toBe(false);
    expect(await replayPendingOps(dir, "hv_a", new MemoryVaultStore(), unload)).toBe(1);
    expect(await dir.exists("x")).toBe(true);
  });
});
