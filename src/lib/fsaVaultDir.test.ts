import { describe, expect, test } from "bun:test";

import { FsaVaultDir } from "./fsaVaultDir";

// A fake of the one Chromium behaviour that matters: while a writable stream
// is open on a file, `getFile()` throws (NotReadableError), and the new
// contents only appear once `close()` has swapped them in.
class FakeFile {
  text = "";
  lastModified = 1;
  writing = false;
  readonly kind = "file";
  constructor(readonly name: string) {}
  async getFile(): Promise<{ text(): Promise<string>; lastModified: number; size: number }> {
    if (this.writing) throw new DOMException("could not be read", "NotReadableError");
    const text = this.text;
    return { text: async () => text, lastModified: this.lastModified, size: text.length };
  }
  async createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> {
    this.writing = true;
    let pending = "";
    return {
      write: async (t: string) => {
        pending = t;
        await new Promise((r) => setTimeout(r, 5)); // the bytes take time
      },
      close: async () => {
        this.text = pending;
        this.lastModified += 1;
        this.writing = false;
      },
    };
  }
}

class FakeDir {
  readonly kind = "directory";
  readonly files = new Map<string, FakeFile>();
  async getDirectoryHandle(): Promise<never> {
    throw new DOMException("flat fake", "NotFoundError");
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    let file = this.files.get(name);
    if (!file) {
      if (!opts?.create) throw new DOMException("not found", "NotFoundError");
      file = new FakeFile(name);
      this.files.set(name, file);
    }
    return file;
  }
}

const dirOf = () => new FsaVaultDir(new FakeDir() as unknown as FileSystemDirectoryHandle);

describe("FsaVaultDir takes turns per path", () => {
  test("a read that starts mid-write waits for the swap and sees the new text", async () => {
    const dir = dirOf();
    await dir.writeText("chat.md", "old");
    const write = dir.writeText("chat.md", "new");
    const read = dir.readText("chat.md"); // would throw NotReadableError unguarded
    const stat = dir.stat("chat.md");
    await write;
    expect(await read).toBe("new");
    expect((await stat)?.size).toBe(3);
  });

  test("a write that starts mid-read lands after it, and reads of other paths never wait", async () => {
    const dir = dirOf();
    await dir.writeText("a.md", "A");
    await dir.writeText("b.md", "B");
    const order: string[] = [];
    const readA = dir.readText("a.md").then((t) => order.push(`readA=${t}`));
    const writeA = dir.writeText("a.md", "A2").then(() => order.push("writeA"));
    const readB = dir.readText("b.md").then((t) => order.push(`readB=${t}`));
    await Promise.all([readA, writeA, readB]);
    expect(order[0]).toBe("readA=A");
    expect(order).toContain("writeA");
    expect(order).toContain("readB=B");
    expect(await dir.readText("a.md")).toBe("A2");
  });

  test("a failed turn releases the path for the next one", async () => {
    const dir = dirOf();
    await expect(dir.readText("missing.md")).rejects.toThrow("not found");
    await dir.writeText("missing.md", "now here");
    expect(await dir.readText("missing.md")).toBe("now here");
  });
});
