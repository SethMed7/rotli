import { expect, test } from "bun:test";

import { CONTRACT_VERSION } from "../memex/contract";
import { MemoryVaultDir } from "./vaultDir";
import { VAULT_SPINE_DIRS, scaffoldVault, vaultScaffoldFiles } from "./vaultScaffold";

test("the spine mirrors the Mac's: every directory, the four files, a stamped mx_ memex.json", async () => {
  const dir = new MemoryVaultDir();
  await scaffoldVault(dir, new Date("2026-09-22T12:00:00Z"));
  for (const path of VAULT_SPINE_DIRS) expect(await dir.exists(path)).toBe(true);
  const root = (await dir.list("")).map((e) => e.name).sort();
  expect(root).toEqual(
    [
      ".gitignore",
      "MAP.md",
      "archive",
      "chats",
      "history",
      "identity",
      "inbox.md",
      "memex.json",
      "personality",
      "storage",
      "trash",
      "wiki",
    ].sort(),
  );
  const info = JSON.parse(await dir.readText("memex.json"));
  expect(info.id).toMatch(/^mx_[0-9a-f-]{36}$/);
  expect(info.contract).toBe(CONTRACT_VERSION);
  expect(info.createdAt).toBe("2026-09-22T12:00:00.000Z");
  expect(info.apps.rotli.role).toBe("chat-system");
  expect(await dir.readText(".gitignore")).toBe("storage/\n.rotli/\n");
  expect(await dir.readText("inbox.md")).toContain("<!-- entries below this line -->");
});

test("a second pass never overwrites what is there", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("MAP.md", "# My map\n");
  await scaffoldVault(dir);
  expect(await dir.readText("MAP.md")).toBe("# My map\n");
  expect(Object.keys(vaultScaffoldFiles("mx_x", "now"))).toEqual([
    "inbox.md",
    "MAP.md",
    ".gitignore",
    "memex.json",
  ]);
});
