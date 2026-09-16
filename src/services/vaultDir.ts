// The narrow filesystem port Rotli Web's vault access depends on, plus the
// in-memory fake every pure test runs against. The browser adapter (File System
// Access API) and any future host implement the same eight methods; nothing
// above this port knows which one it holds.
//
// Paths are relative POSIX strings: "" is the vault root, "wiki/_inbox/a.md" a
// file inside it. Text files only — binaries never cross this seam.

export interface VaultDirEntry {
  name: string;
  kind: "file" | "directory";
}

export interface VaultStat {
  lastModified: number;
  size: number;
}

/** Relative POSIX paths ("" = root, "wiki/_inbox/a.md"). Text files only. */
export interface VaultDir {
  /** Direct children of a directory; `[]` for a missing one (never throws). */
  list(path: string): Promise<VaultDirEntry[]>;
  exists(path: string): Promise<boolean>;
  /** null when the path holds neither a file nor a directory. */
  stat(path: string): Promise<VaultStat | null>;
  /** Throws when the file is missing — a caller that may miss checks first. */
  readText(path: string): Promise<string>;
  /** Creates parent directories as needed. */
  writeText(path: string, text: string): Promise<void>;
  /** Recursive and idempotent. */
  mkdir(path: string): Promise<void>;
  /** File move: read → write → remove, in that order, so a failed write leaves
   * the original in place. Parent directories of `to` are created. */
  move(from: string, to: string): Promise<void>;
  /** A file or an EMPTY directory; a missing path is a no-op. */
  remove(path: string): Promise<void>;
}

/** Trim the separators a caller may pass ("/wiki/", "wiki//a.md") down to the
 * canonical relative form this port stores keys in. */
export function normalizeVaultPath(path: string): string {
  return path
    .split("/")
    .filter((part) => part !== "" && part !== ".")
    .join("/");
}

/** The parent directory of a path; "" for a root-level entry. */
export function parentPath(path: string): string {
  const normalized = normalizeVaultPath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash);
}

/** The last path component ("wiki/a.md" → "a.md"; "" → ""). */
export function baseName(path: string): string {
  const normalized = normalizeVaultPath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}

/** Join path fragments, skipping empties ("", "wiki", "a.md" → "wiki/a.md"). */
export function joinVaultPath(...parts: string[]): string {
  return normalizeVaultPath(parts.join("/"));
}

/** UTF-8 byte length — the size a real file reports, and the one half of the
 * revision stamp. A note full of em dashes and curly quotes must not disagree
 * with what the browser adapter reads back from `File.size`. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface MemoryFile {
  text: string;
  lastModified: number;
  size: number;
}

/** The deterministic in-memory VaultDir. Directories are first-class entries,
 * not derived from file paths: emptying a folder leaves the folder, exactly
 * like a real filesystem, so a restore test cannot pass because its target
 * directory silently evaporated. `lastModified` is a counter advanced on every
 * write, so revisions are stable across runs. */
export class MemoryVaultDir implements VaultDir {
  private readonly files = new Map<string, MemoryFile>();
  private readonly dirs = new Map<string, number>([["", 0]]);
  private clock = 0;

  /** The next write stamp — one monotonic counter shared by files and
   * directories, so every mutation is observably ordered. */
  private tick(): number {
    this.clock += 1;
    return this.clock;
  }

  async list(path: string): Promise<VaultDirEntry[]> {
    const dir = normalizeVaultPath(path);
    if (!this.dirs.has(dir)) return [];
    const entries: VaultDirEntry[] = [];
    for (const key of this.dirs.keys()) {
      if (key !== dir && parentPath(key) === dir) entries.push({ name: baseName(key), kind: "directory" });
    }
    for (const key of this.files.keys()) {
      if (parentPath(key) === dir) entries.push({ name: baseName(key), kind: "file" });
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async exists(path: string): Promise<boolean> {
    const key = normalizeVaultPath(path);
    return this.files.has(key) || this.dirs.has(key);
  }

  async stat(path: string): Promise<VaultStat | null> {
    const key = normalizeVaultPath(path);
    const file = this.files.get(key);
    if (file) return { lastModified: file.lastModified, size: file.size };
    const dir = this.dirs.get(key);
    return dir === undefined ? null : { lastModified: dir, size: 0 };
  }

  async readText(path: string): Promise<string> {
    const key = normalizeVaultPath(path);
    const file = this.files.get(key);
    if (!file) throw new Error(`no such file: ${key}`);
    return file.text;
  }

  async writeText(path: string, text: string): Promise<void> {
    const key = normalizeVaultPath(path);
    if (!key) throw new Error("a file needs a name");
    if (this.dirs.has(key)) throw new Error(`a directory already holds ${key}`);
    await this.mkdir(parentPath(key));
    this.files.set(key, { text, lastModified: this.tick(), size: byteLength(text) });
  }

  async mkdir(path: string): Promise<void> {
    const key = normalizeVaultPath(path);
    if (!key) return;
    const parts = key.split("/");
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      if (this.files.has(built)) throw new Error(`a file already holds ${built}`);
      if (!this.dirs.has(built)) this.dirs.set(built, this.tick());
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalizeVaultPath(from);
    const target = normalizeVaultPath(to);
    if (source === target) return;
    const text = await this.readText(source);
    await this.writeText(target, text);
    await this.remove(source);
  }

  async remove(path: string): Promise<void> {
    const key = normalizeVaultPath(path);
    if (this.files.delete(key)) return;
    if (!this.dirs.has(key) || !key) return;
    const children = await this.list(key);
    if (children.length > 0) throw new Error(`“${baseName(key)}” isn't empty`);
    this.dirs.delete(key);
  }
}
