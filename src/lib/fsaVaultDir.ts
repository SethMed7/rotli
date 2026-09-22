// The File System Access API behind the VaultDir port: a real folder on the
// user's disk, opened by the browser with the user's permission. Chromium
// only; the caller decides what to do where `showDirectoryPicker` is absent.
// Effectful adapter (scripts/source-ownership.ts LIB_EFFECTFUL_FILE_OWNERS).
//
// Reads and writes of ONE path take turns. Chromium writes through a swap
// file and swaps it in at `close()`; a `getFile()` that lands inside that
// window throws NotReadableError or NotFoundError (2026-09-17: the boot
// listing read a chat while the model backfill rewrote it, the whole notes
// query rejected, and the window opened on "Untitled"). Every writer to the
// folder — chats, notes, `.rotli/` — shares this one adapter, so the lock
// lives here, per path, and never serializes unrelated files.

import type { VaultDir, VaultDirEntry, VaultStat } from "../services/vaultDir";

function segments(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0 && part !== ".");
}

export class FsaVaultDir implements VaultDir {
  private readonly turns = new Map<string, Promise<void>>();

  constructor(readonly root: FileSystemDirectoryHandle) {}

  /** Run `task` after every earlier read or write of the same path settles. */
  private async inTurn<T>(path: string, task: () => Promise<T>): Promise<T> {
    const key = segments(path).join("/");
    const before = this.turns.get(key) ?? Promise.resolve();
    let done!: () => void;
    const mine = new Promise<void>((resolve) => {
      done = resolve;
    });
    const turn = before.then(() => mine);
    this.turns.set(key, turn);
    await before;
    try {
      return await task();
    } finally {
      done();
      if (this.turns.get(key) === turn) this.turns.delete(key);
    }
  }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle | null> {
    let handle = this.root;
    for (const part of segments(path)) {
      try {
        handle = await handle.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    return handle;
  }

  private async file(path: string, create = false): Promise<FileSystemFileHandle | null> {
    const parts = segments(path);
    const name = parts.pop();
    if (!name) return null;
    const parent = await this.dir(parts.join("/"), create);
    if (!parent) return null;
    try {
      return await parent.getFileHandle(name, { create });
    } catch {
      return null;
    }
  }

  async list(path: string): Promise<VaultDirEntry[]> {
    const handle = await this.dir(path);
    if (!handle) return [];
    const entries: VaultDirEntry[] = [];
    for await (const [name, child] of handle.entries()) {
      entries.push({ name, kind: child.kind === "directory" ? "directory" : "file" });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null || (await this.dir(path)) !== null;
  }

  async stat(path: string): Promise<VaultStat | null> {
    return this.inTurn(path, async () => {
      const handle = await this.file(path);
      if (!handle) return null;
      const file = await handle.getFile();
      return { lastModified: file.lastModified, size: file.size };
    });
  }

  async readText(path: string): Promise<string> {
    return this.inTurn(path, async () => {
      const handle = await this.file(path);
      if (!handle) throw new Error(`not found: ${path}`);
      return (await handle.getFile()).text();
    });
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeFile(path, text);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return this.inTurn(path, async () => {
      const handle = await this.file(path);
      if (!handle) throw new Error(`not found: ${path}`);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    });
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.writeFile(path, bytes.slice().buffer as ArrayBuffer);
  }

  private async writeFile(path: string, contents: string | ArrayBuffer): Promise<void> {
    await this.inTurn(path, async () => {
      const handle = await this.file(path, true);
      if (!handle) throw new Error(`cannot create: ${path}`);
      const writable = await handle.createWritable();
      try {
        await writable.write(contents);
      } finally {
        await writable.close(); // the swap happens here; readers wait for it
      }
    });
  }

  async mkdir(path: string): Promise<void> {
    if ((await this.dir(path, true)) === null) throw new Error(`cannot create folder: ${path}`);
  }

  /** read → write → remove, so a failure at any step leaves the original. */
  async move(from: string, to: string): Promise<void> {
    // never replace what is already there (a stale listing must not destroy
    // a note); the caller picks a free name
    if (await this.exists(to)) throw new Error(`${to} already exists`);
    // bytes, so an image moves intact (text is bytes too)
    const bytes = await this.readBytes(from);
    await this.writeBytes(to, bytes);
    await this.remove(from);
  }

  async remove(path: string): Promise<void> {
    const parts = segments(path);
    const name = parts.pop();
    if (!name) return;
    const parent = await this.dir(parts.join("/"));
    if (!parent) return;
    try {
      await parent.removeEntry(name);
    } catch (error) {
      if ((error as { name?: string }).name === "NotFoundError") return;
      throw error;
    }
  }
}
