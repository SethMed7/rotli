import { describe, expect, test } from "bun:test";

import { MemoryVaultDir, type VaultDir } from "../services/vaultDir";
import { HelperVaultDir } from "./helperVaultDir";

/** Rotli Helper's vault verbs, served from a MemoryVaultDir: the wire the
 * adapter speaks, with the helper's revision gate. Counts every call. */
function fakeHelper(disk = new MemoryVaultDir()) {
  const calls: string[] = [];
  let down = false;
  const walk = async (path: string, out: object[]): Promise<void> => {
    for (const entry of await disk.list(path)) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      const stat = await disk.stat(child);
      out.push({
        path: child,
        kind: entry.kind,
        lastModified: stat?.lastModified ?? 0,
        size: stat?.size ?? 0,
      });
      if (entry.kind === "directory") await walk(child, out);
    }
  };
  const revision = async (path: string) => {
    const stat = (await disk.exists(path)) ? await disk.stat(path) : null;
    return stat ? `${stat.lastModified}:${stat.size}` : "0";
  };
  const call = async (cmd: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push(cmd);
    if (down) throw new TypeError("Failed to fetch");
    const path = typeof args.path === "string" ? args.path : "";
    switch (cmd) {
      case "vault_walk": {
        const out: object[] = [];
        await walk("", out);
        return out;
      }
      case "vault_read":
        if (!(await disk.exists(path)))
          throw Object.assign(new Error(`no such file: ${path}`), { status: 404 });
        if (args.encoding === "base64") return btoa(String.fromCharCode(...(await disk.readBytes(path))));
        return disk.readText(path);
      case "vault_read_many": {
        const files: Record<string, string | null> = {};
        for (const p of args.paths as string[])
          files[p] = (await disk.exists(p)) ? await disk.readText(p) : null;
        return { files, more: [] };
      }
      case "vault_stat":
        return disk.stat(path);
      case "vault_write": {
        if (typeof args.expectedRevision === "string" && args.expectedRevision !== (await revision(path))) {
          throw Object.assign(new Error("revision conflict: the file changed on disk"), { status: 409 });
        }
        if (typeof args.text === "string") await disk.writeText(path, args.text);
        else
          await disk.writeBytes(
            path,
            Uint8Array.from(atob(String(args.base64)), (c) => c.charCodeAt(0)),
          );
        return disk.stat(path);
      }
      case "vault_mkdir":
        return disk.mkdir(path);
      case "vault_move":
        return disk.move(String(args.from), String(args.to));
      case "vault_remove":
        return disk.remove(path);
      default:
        throw new Error(`unknown ${cmd}`);
    }
  };
  const reconnecting: boolean[] = [];
  const dir = new HelperVaultDir(call, {
    ping: async () => !down,
    unreachable: (error) => error instanceof TypeError,
    onReconnecting: (value) => reconnecting.push(value),
    freshMs: 60_000,
    retryMs: 5,
  });
  return {
    dir,
    disk,
    calls,
    reconnecting,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

// The same cases the port promises, run against the reference and the adapter.
const contract: Array<[string, () => VaultDir]> = [
  ["MemoryVaultDir", () => new MemoryVaultDir()],
  ["HelperVaultDir", () => fakeHelper().dir],
];

for (const [name, make] of contract) {
  describe(`the VaultDir contract: ${name}`, () => {
    test("writes create parents; list, stat, exists, and reads agree", async () => {
      const dir = make();
      await dir.writeText("wiki/ideas/a.md", "# A\n");
      expect(await dir.list("wiki")).toEqual([{ name: "ideas", kind: "directory" }]);
      expect(await dir.list("wiki/ideas")).toEqual([{ name: "a.md", kind: "file" }]);
      expect(await dir.list("missing")).toEqual([]);
      expect(await dir.exists("wiki/ideas/a.md")).toBe(true);
      expect(await dir.exists("wiki/none.md")).toBe(false);
      expect((await dir.stat("wiki/ideas/a.md"))?.size).toBe(4);
      expect(await dir.stat("nope")).toBeNull();
      expect(await dir.readText("wiki/ideas/a.md")).toBe("# A\n");
      await expect(dir.readText("wiki/none.md")).rejects.toThrow();
    });

    test("bytes round-trip; mkdir is idempotent; move and remove follow the port", async () => {
      const dir = make();
      await dir.writeBytes("storage/p.png", new Uint8Array([0, 1, 255]));
      expect([...(await dir.readBytes("storage/p.png"))]).toEqual([0, 1, 255]);
      await dir.mkdir("chats/2026");
      await dir.mkdir("chats/2026");
      expect(await dir.list("chats")).toEqual([{ name: "2026", kind: "directory" }]);
      await dir.writeText("wiki/_inbox/n.md", "N");
      await dir.move("wiki/_inbox/n.md", "wiki/Welcome/n.md");
      expect(await dir.readText("wiki/Welcome/n.md")).toBe("N");
      expect(await dir.exists("wiki/_inbox/n.md")).toBe(false);
      await expect(dir.remove("wiki/Welcome")).rejects.toThrow(/isn't empty/);
      await dir.remove("wiki/Welcome/n.md");
      await dir.remove("wiki/Welcome");
      await dir.remove("wiki/Welcome");
      expect(await dir.exists("wiki/Welcome")).toBe(false);
    });
  });
}

describe("Rotli Helper round trips", () => {
  test("a 300-note index costs one walk and one batch read, and an unchanged note is never re-read", async () => {
    const disk = new MemoryVaultDir();
    for (let i = 0; i < 300; i += 1) await disk.writeText(`wiki/n${i}.md`, `# Note ${i}\n`);
    const { dir, calls } = fakeHelper(disk);
    for (const entry of await dir.list("wiki")) {
      await dir.stat(`wiki/${entry.name}`);
      await dir.readText(`wiki/${entry.name}`);
    }
    expect(calls).toEqual(["vault_walk", "vault_read_many"]);
    await dir.readText("wiki/n7.md");
    expect(calls.length).toBe(2);
  });

  test("a note changed on disk is read again after the next walk", async () => {
    const { dir, disk, calls } = fakeHelper();
    await disk.writeText("wiki/a.md", "one");
    expect(await dir.readText("wiki/a.md")).toBe("one");
    await disk.writeText("wiki/a.md", "two!");
    dir.invalidate();
    expect(await dir.readText("wiki/a.md")).toBe("two!");
    expect(calls.filter((c) => c === "vault_walk").length).toBe(2);
  });
});

describe("never overwriting another writer", () => {
  test("a first write is refused when Rotli for Mac changed the file behind the cache", async () => {
    const fake = fakeHelper();
    await fake.dir.writeText("wiki/a.md", "mine");
    await fake.disk.writeText("wiki/a.md", "edited in the Mac app");
    await expect(fake.dir.writeText("wiki/a.md", "web edit")).rejects.toThrow(/revision conflict/);
    expect(await fake.disk.readText("wiki/a.md")).toBe("edited in the Mac app");
    // the refusal re-reads the vault: the next read sees the Mac's text
    expect(await fake.dir.readText("wiki/a.md")).toBe("edited in the Mac app");
  });

  test("rapid saves of one note each land: every write is gated on the one before it", async () => {
    const fake = fakeHelper();
    await Promise.all([
      fake.dir.writeText("wiki/a.md", "1"),
      fake.dir.writeText("wiki/a.md", "12"),
      fake.dir.writeText("wiki/a.md", "123"),
    ]);
    expect(await fake.disk.readText("wiki/a.md")).toBe("123");
  });
});

describe("an outage", () => {
  test("a write waits, unsaved, while the helper is gone and lands in order when it is back", async () => {
    const fake = fakeHelper();
    fake.setDown(true);
    let saved = false;
    const first = fake.dir.writeText("wiki/a.md", "one").then(() => {
      saved = true;
    });
    const second = fake.dir.writeText("wiki/a.md", "two");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(saved).toBe(false);
    expect(fake.dir.pendingOps().map((op) => op.kind)).toEqual(["write", "write"]);
    expect(fake.reconnecting).toEqual([true]);
    fake.setDown(false);
    await Promise.all([first, second]);
    expect(await fake.disk.readText("wiki/a.md")).toBe("two");
    expect(fake.dir.pendingOps()).toEqual([]);
    expect(fake.reconnecting).toEqual([true, false]);
  });

  test("a retried write is refused when the file changed on disk meanwhile", async () => {
    const fake = fakeHelper();
    await fake.dir.writeText("wiki/a.md", "mine");
    fake.setDown(true);
    const edit = fake.dir.writeText("wiki/a.md", "offline edit");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fake.disk.writeText("wiki/a.md", "changed in the Mac app");
    fake.setDown(false);
    await expect(edit).rejects.toThrow(/revision conflict/);
    expect(await fake.disk.readText("wiki/a.md")).toBe("changed in the Mac app");
  });
});
