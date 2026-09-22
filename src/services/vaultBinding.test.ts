import { describe, expect, test } from "bun:test";

import { MemoryVaultStore } from "../lib/browserVault";
import { helperConnection, replayPendingOps, unsupportedBrowser } from "./vaultBinding";
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

describe("edits a closed tab couldn't deliver", () => {
  test("replay onto an unchanged file, and beside a changed one — never over it", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "base");
    await dir.writeText("wiki/b.md", "base");
    const a = await dir.stat("wiki/a.md");
    const b = await dir.stat("wiki/b.md");
    await dir.writeText("wiki/b.md", "changed elsewhere");
    const store = new MemoryVaultStore();
    await store.set(
      "vault-pending",
      JSON.stringify({
        vaultId: "hv_1",
        ops: [
          { kind: "write", path: "wiki/a.md", text: "offline a", base: `${a?.lastModified}:${a?.size}` },
          { kind: "write", path: "wiki/b.md", text: "offline b", base: `${b?.lastModified}:${b?.size}` },
          { kind: "mkdir", path: "chats" },
        ],
      }),
    );
    expect(await replayPendingOps(dir, "hv_1", store)).toBe(3);
    expect(await dir.readText("wiki/a.md")).toBe("offline a");
    expect(await dir.readText("wiki/b.md")).toBe("changed elsewhere");
    expect(await dir.readText("wiki/b (unsaved copy).md")).toBe("offline b");
    expect(await dir.exists("chats")).toBe(true);
    expect(await store.get("vault-pending")).toBeUndefined();
  });

  test("another vault's pending edits are never replayed here", async () => {
    const store = new MemoryVaultStore();
    await store.set(
      "vault-pending",
      JSON.stringify({ vaultId: "hv_other", ops: [{ kind: "mkdir", path: "x" }] }),
    );
    const dir = new MemoryVaultDir();
    expect(await replayPendingOps(dir, "hv_1", store)).toBe(0);
    expect(await dir.exists("x")).toBe(false);
  });

  test("a second conflict never overwrites the first unsaved copy", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "changed elsewhere");
    await dir.writeText("wiki/a (unsaved copy).md", "the first offline edit");
    const store = new MemoryVaultStore();
    await store.set(
      "vault-pending",
      JSON.stringify({
        vaultId: "hv_1",
        ops: [{ kind: "write", path: "wiki/a.md", text: "second", base: "stale" }],
      }),
    );
    expect(await replayPendingOps(dir, "hv_1", store)).toBe(1);
    expect(await dir.readText("wiki/a (unsaved copy).md")).toBe("the first offline edit");
    expect(await dir.readText("wiki/a (unsaved copy 2).md")).toBe("second");
  });

  test("a change that can't be replayed yet is kept for the next boot, not dropped", async () => {
    const dir = new MemoryVaultDir();
    const store = new MemoryVaultStore();
    const ops = [{ kind: "move", from: "missing.md", to: "b.md" }];
    await store.set("vault-pending", JSON.stringify({ vaultId: "hv_1", ops }));
    expect(await replayPendingOps(dir, "hv_1", store)).toBe(0);
    expect(JSON.parse((await store.get("vault-pending")) ?? "{}")).toEqual({ vaultId: "hv_1", ops });
  });
});
