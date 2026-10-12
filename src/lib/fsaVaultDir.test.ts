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
  async getFile(): Promise<{
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    lastModified: number;
    size: number;
  }> {
    if (this.writing) throw new DOMException("could not be read", "NotReadableError");
    const text = this.text;
    return {
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      lastModified: this.lastModified,
      size: text.length,
    };
  }
  async createWritable(): Promise<{ write(t: string | ArrayBuffer): Promise<void>; close(): Promise<void> }> {
    this.writing = true;
    let pending = "";
    return {
      write: async (t: string | ArrayBuffer) => {
        pending = typeof t === "string" ? t : new TextDecoder().decode(t);
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
  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
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

test("a move holds both paths until its copy and removal finish", async () => {
  const root = new FakeDir();
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await dir.writeText("a.md", "old");
  let copied!: () => void;
  const copying = new Promise<void>((resolve) => {
    copied = resolve;
  });
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const target = await root.getFileHandle("b.md", { create: true });
  root.files.delete("b.md");
  const create = target.createWritable.bind(target);
  target.createWritable = async () => {
    const stream = await create();
    return {
      write: async (text) => {
        copied();
        await paused;
        await stream.write(text);
      },
      close: () => stream.close(),
    };
  };
  const get = root.getFileHandle.bind(root);
  root.getFileHandle = async (name, options) => {
    if (name === "b.md" && options?.create) root.files.set(name, target);
    return get(name, options);
  };
  const moving = dir.move("a.md", "b.md");
  await copying;
  let saved = false;
  const saving = dir.writeText("a.md", "new").then(() => {
    saved = true;
  });
  // A concurrent destination save must also wait behind the whole move.
  const destinationSave = dir.writeText("b.md", "destination edit");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const savedDuringMove = saved;
  resume();
  await Promise.all([moving, saving, destinationSave]);
  expect(savedDuringMove).toBe(false);
  expect(await dir.readText("a.md")).toBe("new");
  expect(await dir.readText("b.md")).toBe("destination edit");
});

test("remove waits for an earlier write to close", async () => {
  const root = new FakeDir();
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await dir.writeText("a.md", "before");
  let open = false;
  const remove = root.removeEntry.bind(root);
  root.removeEntry = async (name) => {
    open = root.files.get(name)?.writing ?? false;
    await remove(name);
  };
  const writing = dir.writeText("a.md", "after");
  await new Promise((resolve) => setTimeout(resolve, 1));
  await dir.remove("a.md");
  await writing;
  expect(open).toBe(false);
  expect(await dir.exists("a.md")).toBe(false);
});
