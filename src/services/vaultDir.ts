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
  /** Creates parents as needed. An expectedContent gate is checked in the same
   * turn as the write; "0" requires a missing file, otherwise FNV-1a 64. */
  writeText(path: string, text: string, expectedContent?: string): Promise<void>;
  /** Binary files (images): the same paths, raw bytes. Throws when missing. */
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Recursive and idempotent. */
  mkdir(path: string): Promise<void>;
  /** File move: read → write → remove, in that order, so a failed write leaves
   * the original in place. Parent directories of `to` are created. NEVER
   * replaces: a `to` that exists is refused ("already exists") — callers pick
   * a free name first (`freeSiblingPath`). */
  move(from: string, to: string): Promise<void>;
  /** A file or an EMPTY directory; a missing path is a no-op. */
  remove(path: string): Promise<void>;
}

/** Desktop-compatible FNV-1a 64 revision of the exact UTF-8 text observed. */
export function contentRevision(text: string): string {
  // the 64-bit hash as four 16-bit words, in plain integer arithmetic:
  // listing a vault hashes every note, and BigInt per byte is slow in V8.
  // The FNV prime is 2^40 + 0x1b3: each word times 0x1b3, plus the low two
  // words shifted 8 bits into the high two (the 2^40 term), then carry.
  let v0 = 0x2325;
  let v1 = 0x8422;
  let v2 = 0x9ce4;
  let v3 = 0xcbf2;
  for (const byte of new TextEncoder().encode(text)) {
    v0 ^= byte;
    const t0 = v0 * 0x1b3;
    let t1 = v1 * 0x1b3;
    let t2 = v2 * 0x1b3 + (v0 << 8);
    const t3 = v3 * 0x1b3 + (v1 << 8);
    t1 += t0 >>> 16;
    v0 = t0 & 0xffff;
    t2 += t1 >>> 16;
    v1 = t1 & 0xffff;
    v3 = (t3 + (t2 >>> 16)) & 0xffff;
    v2 = t2 & 0xffff;
  }
  const word = (v: number) => v.toString(16).padStart(4, "0");
  return `fnv1a64:${word(v3)}${word(v2)}${word(v1)}${word(v0)}`;
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

/** "a.md" → "a (label).md", then "a (label 2).md", … — the first name the
 * folder doesn't already hold. A copy kept beside a file never replaces
 * anything, not even an earlier copy. */
export async function freeSiblingPath(
  dir: Pick<VaultDir, "exists">,
  path: string,
  label: string,
): Promise<string> {
  for (let n = 1; ; n += 1) {
    const candidate = siblingPath(path, label, n);
    if (!(await dir.exists(candidate))) return candidate;
  }
}

/** A folder holding `wiki/` is a memex vault (Rust `Layout::Memex`); any other
 * folder is a plain vault of Markdown. */
export function vaultIsMemex(dir: Pick<VaultDir, "exists">): Promise<boolean> {
  return dir.exists("wiki");
}

/** The first free path for `desired` inside `folder` — the Rust `free_name_with`
 * twin. The desired name is tried first; after that `collide(stem, ext, n)`
 * names candidates from n = 2 up. Existing numbers are never renumbered. Notes
 * collide as "name (2).md", boards as "name-2.excalidraw" (Rust `free_name`). */
export async function freeVaultPath(
  dir: Pick<VaultDir, "exists">,
  folder: string,
  desired: string,
  collide: (stem: string, ext: string, n: number) => string,
): Promise<string> {
  const dot = desired.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [desired.slice(0, dot), desired.slice(dot)] : [desired, ""];
  for (let n = 1; ; n += 1) {
    const path = joinVaultPath(folder, n === 1 ? desired : collide(stem, ext, n));
    if (!(await dir.exists(path))) return path;
  }
}

/** The nth labelled sibling of a file: "a.md" → "a (label).md" (n = 1),
 * "a (label 2).md", …. Pure. */
export function siblingPath(path: string, label: string, n: number): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  return `${stem} (${n === 1 ? label : `${label} ${n}`})${ext}`;
}

/** UTF-8 byte length — the size a real file reports, and the one half of the
 * revision stamp. A note full of em dashes and curly quotes must not disagree
 * with what the browser adapter reads back from `File.size`. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

interface MemoryFile {
  text: string;
  /** Present for a binary file; `text` is "" then. */
  bytes?: Uint8Array;
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

  async writeText(path: string, text: string, expectedContent?: string): Promise<void> {
    const key = normalizeVaultPath(path);
    if (!key) throw new Error("a file needs a name");
    if (this.dirs.has(key)) throw new Error(`a directory already holds ${key}`);
    await this.mkdir(parentPath(key));
    const current = this.files.get(key);
    if (
      expectedContent !== undefined &&
      expectedContent !== (current ? contentRevision(current.text) : "0")
    ) {
      throw new Error(`revision conflict on ${key}`);
    }
    this.files.set(key, { text, lastModified: this.tick(), size: byteLength(text) });
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const key = normalizeVaultPath(path);
    const file = this.files.get(key);
    if (!file) throw new Error(`no such file: ${key}`);
    return file.bytes ?? new TextEncoder().encode(file.text);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const key = normalizeVaultPath(path);
    if (!key) throw new Error("a file needs a name");
    if (this.dirs.has(key)) throw new Error(`a directory already holds ${key}`);
    await this.mkdir(parentPath(key));
    this.files.set(key, { text: "", bytes, lastModified: this.tick(), size: bytes.byteLength });
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
    const file = this.files.get(source);
    if (!file) throw new Error(`no such file: ${source}`);
    if (await this.exists(target)) throw new Error(`${target} already exists`);
    // a binary moves as bytes; reading it as text would leave an empty file
    if (file.bytes) await this.writeBytes(target, file.bytes);
    else await this.writeText(target, file.text);
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
