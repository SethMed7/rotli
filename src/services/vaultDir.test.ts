import { describe, expect, test } from "bun:test";

import {
  MemoryVaultDir,
  baseName,
  byteLength,
  joinVaultPath,
  normalizeVaultPath,
  parentPath,
} from "./vaultDir";

/** A fake whose write fails for one target — the only way to prove move()
 * keeps the original when the second half of read → write → remove fails. */
class FailingWriteVaultDir extends MemoryVaultDir {
  constructor(private readonly refuse: string) {
    super();
  }

  override async writeText(path: string, text: string): Promise<void> {
    if (path === this.refuse) throw new Error("disk full");
    return super.writeText(path, text);
  }
}

describe("path helpers", () => {
  test("normalize drops leading, trailing, and doubled separators", () => {
    expect(normalizeVaultPath("/wiki//_inbox/")).toBe("wiki/_inbox");
    expect(normalizeVaultPath("")).toBe("");
    expect(normalizeVaultPath("/")).toBe("");
  });

  test("parent and base split a relative path; root-level entries have no parent", () => {
    expect(parentPath("wiki/_inbox/a.md")).toBe("wiki/_inbox");
    expect(parentPath("a.md")).toBe("");
    expect(baseName("wiki/_inbox/a.md")).toBe("a.md");
    expect(baseName("")).toBe("");
    expect(joinVaultPath("", "wiki", "a.md")).toBe("wiki/a.md");
  });

  test("size is UTF-8 bytes, not code units", () => {
    expect(byteLength("a—b")).toBe(5);
    expect(byteLength("abc")).toBe(3);
  });
});

describe("MemoryVaultDir", () => {
  test("writeText creates parent directories and stat reports bytes", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/_inbox/a.md", "hello—");
    expect(await dir.exists("wiki")).toBe(true);
    expect(await dir.exists("wiki/_inbox")).toBe(true);
    const stat = await dir.stat("wiki/_inbox/a.md");
    expect(stat?.size).toBe(byteLength("hello—"));
    expect(stat?.lastModified).toBeGreaterThan(0);
  });

  test("lastModified advances on every write so revisions differ", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("a.md", "one");
    const first = await dir.stat("a.md");
    await dir.writeText("a.md", "two");
    const second = await dir.stat("a.md");
    expect(second?.lastModified).toBeGreaterThan(first?.lastModified ?? 0);
  });

  test("list returns sorted direct children only, and [] for a missing directory", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/b.md", "b");
    await dir.writeText("wiki/deep/c.md", "c");
    await dir.writeText("wiki/a.md", "a");
    expect(await dir.list("wiki")).toEqual([
      { name: "a.md", kind: "file" },
      { name: "b.md", kind: "file" },
      { name: "deep", kind: "directory" },
    ]);
    expect(await dir.list("nowhere")).toEqual([]);
  });

  test("readText throws for a missing file; stat answers null", async () => {
    const dir = new MemoryVaultDir();
    expect(await dir.stat("gone.md")).toBeNull();
    await expect(dir.readText("gone.md")).rejects.toThrow("no such file");
  });

  test("mkdir is recursive and idempotent", async () => {
    const dir = new MemoryVaultDir();
    await dir.mkdir("wiki/projects/deep");
    const before = await dir.stat("wiki/projects");
    await dir.mkdir("wiki/projects/deep");
    expect(await dir.stat("wiki/projects")).toEqual(before as never);
    expect(await dir.exists("wiki/projects/deep")).toBe(true);
  });

  test("remove of a missing path is a no-op and leaves the tree alone", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/a.md", "a");
    await dir.remove("wiki/never-existed.md");
    await dir.remove("nowhere/at/all");
    expect(await dir.exists("wiki/a.md")).toBe(true);
  });

  test("removing the last file keeps its directory; remove refuses a full one", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/_inbox/a.md", "a");
    await dir.remove("wiki/_inbox/a.md");
    expect(await dir.exists("wiki/_inbox")).toBe(true);
    await dir.writeText("wiki/_inbox/b.md", "b");
    await expect(dir.remove("wiki/_inbox")).rejects.toThrow("isn't empty");
    await dir.remove("wiki/_inbox/b.md");
    await dir.remove("wiki/_inbox");
    expect(await dir.exists("wiki/_inbox")).toBe(false);
  });

  test("move carries the text and creates the target's parent directories", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/_inbox/a.md", "body");
    await dir.move("wiki/_inbox/a.md", "trash/wiki/_inbox/a.md");
    expect(await dir.exists("wiki/_inbox/a.md")).toBe(false);
    expect(await dir.readText("trash/wiki/_inbox/a.md")).toBe("body");
    expect(await dir.exists("trash/wiki")).toBe(true);
  });

  test("a failed write keeps the original file and creates no target", async () => {
    const dir = new FailingWriteVaultDir("archive/a.md");
    await dir.writeText("a.md", "body");
    await expect(dir.move("a.md", "archive/a.md")).rejects.toThrow("disk full");
    expect(await dir.readText("a.md")).toBe("body");
    expect(await dir.exists("archive/a.md")).toBe(false);
  });

  test("move of a missing source throws before touching the target", async () => {
    const dir = new MemoryVaultDir();
    await expect(dir.move("gone.md", "archive/gone.md")).rejects.toThrow("no such file");
    expect(await dir.exists("archive/gone.md")).toBe(false);
  });
});
