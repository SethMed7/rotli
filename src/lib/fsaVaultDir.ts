// The File System Access API behind the VaultDir port: a real folder on the
// user's disk, opened by the browser with the user's permission. Chromium
// only; the caller decides what to do where `showDirectoryPicker` is absent.
// Effectful adapter (scripts/source-ownership.ts LIB_EFFECTFUL_FILE_OWNERS).

import type { VaultDir, VaultDirEntry, VaultStat } from "../services/vaultDir";

function segments(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0 && part !== ".");
}

export class FsaVaultDir implements VaultDir {
  constructor(readonly root: FileSystemDirectoryHandle) {}

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
    const handle = await this.file(path);
    if (!handle) return null;
    const file = await handle.getFile();
    return { lastModified: file.lastModified, size: file.size };
  }

  async readText(path: string): Promise<string> {
    const handle = await this.file(path);
    if (!handle) throw new Error(`not found: ${path}`);
    return (await handle.getFile()).text();
  }

  async writeText(path: string, text: string): Promise<void> {
    const handle = await this.file(path, true);
    if (!handle) throw new Error(`cannot create: ${path}`);
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
  }

  async mkdir(path: string): Promise<void> {
    if ((await this.dir(path, true)) === null) throw new Error(`cannot create folder: ${path}`);
  }

  /** read → write → remove, so a failure at any step leaves the original. */
  async move(from: string, to: string): Promise<void> {
    const text = await this.readText(from);
    await this.writeText(to, text);
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
