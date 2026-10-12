import { describe, expect, test } from "bun:test";

import { testByteEditorRoad } from "../services/folderFileIo.test";
import { FolderNotesService } from "../services/folderNotes";
import { contentRevision } from "../services/vaultDir";
import { FsaVaultDir } from "./fsaVaultDir";

// A fake of the one Chromium behaviour that matters: while a writable stream
// is open on a file, `getFile()` throws (NotReadableError), and the new
// contents only appear once `close()` has swapped them in.
class FakeFile {
  bytes = new Uint8Array();
  get text(): string {
    return new TextDecoder().decode(this.bytes);
  }
  set text(value: string) {
    this.bytes = new TextEncoder().encode(value);
  }
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
    const bytes = this.bytes.slice();
    return {
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.buffer,
      lastModified: this.lastModified,
      size: bytes.length,
    };
  }
  async createWritable(): Promise<{ write(t: string | ArrayBuffer): Promise<void>; close(): Promise<void> }> {
    this.writing = true;
    let pending = new Uint8Array();
    return {
      write: async (t: string | ArrayBuffer) => {
        pending = typeof t === "string" ? new TextEncoder().encode(t) : new Uint8Array(t).slice();
        await new Promise((r) => setTimeout(r, 5)); // the bytes take time
      },
      close: async () => {
        this.bytes = pending;
        this.lastModified += 1;
        this.writing = false;
      },
    };
  }
}

class FakeDir {
  readonly kind = "directory";
  readonly files = new Map<string, FakeFile>();
  async *entries(): AsyncIterableIterator<[string, FakeFile]> {
    for (const entry of this.files) yield entry;
  }
  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
  }
  async getDirectoryHandle(_name?: string): Promise<FileSystemDirectoryHandle> {
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

async function withWebLocks(task: () => Promise<void>): Promise<void> {
  const turns = new Map<string, Promise<void>>();
  const locks = {
    request: async <T>(
      name: string,
      _options: { signal: AbortSignal },
      callback: () => Promise<T>,
    ): Promise<T> => {
      const before = turns.get(name) ?? Promise.resolve();
      let release!: () => void;
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      const turn = before.then(() => done);
      turns.set(name, turn);
      await before;
      try {
        return await callback();
      } finally {
        release();
        if (turns.get(name) === turn) turns.delete(name);
      }
    },
  };
  const browser = globalThis.navigator as Navigator;
  const prior = Object.getOwnPropertyDescriptor(browser, "locks");
  Object.defineProperty(browser, "locks", { configurable: true, value: locks });
  try {
    await task();
  } finally {
    if (prior) Object.defineProperty(browser, "locks", prior);
    else Reflect.deleteProperty(browser, "locks");
  }
}

for (const [label, initial] of [
  ["save", "before"],
  ["create", null],
] as const) {
  test(`two FSA adapters sharing a vault serialize a ${label} revision check with its write`, async () => {
    await withWebLocks(async () => {
      const root = new FakeDir();
      if (initial) (await root.getFileHandle("shared.md", { create: true })).text = initial;
      const originalGet = root.getFileHandle.bind(root);
      let checked = 0;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      root.getFileHandle = async (name, options) => {
        if (name === "shared.md" && !options?.create) {
          checked += 1;
          if (checked === 2) release();
          await held;
        }
        return originalGet(name, options);
      };
      const first = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle, "shared-vault");
      const second = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle, "shared-vault");
      const expected = initial ? contentRevision(initial) : "0";
      const pending = [
        first.writeText("shared.md", "first", expected),
        second.writeText("shared.md", "second", expected),
      ];
      setTimeout(release, 25); // lets a correctly locked first writer finish without waiting for the second
      const results = await Promise.allSettled(pending);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    });
  });
}

test("an outside edit to a move source after destination publication survives", async () => {
  const root = new FakeDir();
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await dir.writeText("from.md", "original");
  const get = root.getFileHandle.bind(root);
  root.getFileHandle = async (name, options) => {
    const handle = await get(name, options);
    if (name === "to.md" && options?.create) {
      const create = handle.createWritable.bind(handle);
      handle.createWritable = async () => {
        const stream = await create();
        return {
          write: (bytes) => stream.write(bytes),
          close: async () => {
            await stream.close();
            root.files.get("from.md")!.text = "outside edit";
          },
        };
      };
    }
    return handle;
  };
  await expect(dir.move("from.md", "to.md")).rejects.toThrow(/revision conflict/);
  expect(root.files.get("from.md")?.text).toBe("outside edit");
  expect(root.files.get("to.md")?.text).toBe("original");
});

test("FSA managed rename moves a backup through a case-only rename", async () => {
  const dir = dirOf();
  await dir.writeBytes("Draft.docx", new Uint8Array([1]));
  await dir.writeBytes("Draft.docx.bak", new Uint8Array([2]));
  const notes = new FolderNotesService(dir);
  expect(await notes.renameFile("Draft.docx", "DRAFT")).toBe("DRAFT.docx");
  expect(await dir.readBytes("DRAFT.docx.bak")).toEqual(new Uint8Array([2]));
});

testByteEditorRoad("FSA", () => {
  const root = new FakeDir();
  return {
    dir: new FsaVaultDir(root as unknown as FileSystemDirectoryHandle),
    externalBytes: async (path, bytes) => {
      root.files.get(path)!.bytes = new Uint8Array(bytes);
    },
    externalText: async (path, text) => {
      root.files.get(path)!.text = text;
    },
  };
});

test("writeText with stale expected content preserves the file bytes", async () => {
  const dir = dirOf();
  await dir.writeText("note.md", "latest note bytes");
  await expect(
    dir.writeText("note.md", "stale replacement", contentRevision("superseded note bytes")),
  ).rejects.toThrow(/revision conflict/);
  expect(await dir.readBytes("note.md")).toEqual(new TextEncoder().encode("latest note bytes"));
});

test("writeBytes with stale expected content preserves the file bytes", async () => {
  const dir = dirOf();
  const newer = new Uint8Array([0, 1, 255, 2]);
  await dir.writeBytes("asset.bin", newer);
  await expect(
    dir.writeBytes("asset.bin", new Uint8Array([3, 4]), contentRevision("superseded asset bytes")),
  ).rejects.toThrow(/revision conflict/);
  expect(await dir.readBytes("asset.bin")).toEqual(newer);
});

test("remove checks expected content after an external edit in its removal turn", async () => {
  const root = new FakeDir();
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await dir.writeText(".gitignore", "created by Rotli\n");
  const get = root.getFileHandle.bind(root);
  root.getFileHandle = async (name, options) => {
    const handle = await get(name, options);
    if (name === ".gitignore") handle.text = "edited outside Rotli\n";
    return handle;
  };
  await expect(dir.remove(".gitignore", contentRevision("created by Rotli\n"))).rejects.toThrow(
    /revision conflict/,
  );
  expect(root.files.get(".gitignore")?.text).toBe("edited outside Rotli\n");
});

test("a content-gated remove cannot delete an empty directory", async () => {
  const root = new FakeDir();
  let removed = false;
  root.getDirectoryHandle = async (name?: string) => {
    if (name !== ".gitignore") throw new DOMException("not found", "NotFoundError");
    return { kind: "directory" } as FileSystemDirectoryHandle;
  };
  root.removeEntry = async () => {
    removed = true;
  };
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await expect(dir.remove(".gitignore", "0")).rejects.toThrow(/revision conflict/);
  expect(removed).toBe(false);
});

test("a content-gated remove refuses a missing file", async () => {
  await expect(dirOf().remove("missing.md", "0")).rejects.toThrow(/revision conflict/);
});

test("an ungated remove after an external delete is a no-op", async () => {
  const root = new FakeDir();
  const dir = new FsaVaultDir(root as unknown as FileSystemDirectoryHandle);
  await dir.writeText("note.md", "text");
  root.files.delete("note.md");
  await expect(dir.remove("note.md")).resolves.toBeUndefined();
});

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
