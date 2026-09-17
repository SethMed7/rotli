// Rotli Web without a live folder API (Firefox, Zen, Safari, Brave with the
// API off): the user still picks a folder, the browser READS it once, and
// Rotli keeps a copy of its text files in browser storage. Everything then
// runs over the same in-memory filesystem the folder mode uses — same
// projection, same frontmatter, same `.rotli/` — and Export hands the files
// back as a zip. Nothing here can write to the user's disk; the copy is
// honest about that.

import { bytesFromBase64 } from "../documents/images";
import { type BrowserVault, browserVault } from "../lib/browserVault";
import { createDebouncedTask } from "../lib/debouncedTask";
import { zipTextFiles } from "../lib/vaultZip";
import { MemoryVaultDir, type VaultDir, type VaultDirEntry, type VaultStat } from "./vaultDir";
import { isWebImageName } from "./webFiles";

/** The browser-storage key holding an imported vault's snapshot. */
export const IMPORTED_VAULT_KEY = "vault-import";
const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;

export interface ImportedVaultSnapshot {
  version: 1;
  name: string;
  files: Record<string, string>;
  dirs: string[];
  /** Binary files written in the browser (dropped images), base64 by path. */
  binaries?: Record<string, string>;
}

export interface PickedFile {
  /** The path the browser reports (`webkitRelativePath`): "<folder>/wiki/a.md". */
  relativePath: string;
  size: number;
}

/** Which picked files belong in the copy: text files of the vault layout,
 * with the picked folder's own name stripped from every path. Binaries,
 * `storage/`, version control, and dependency folders stay out; so does
 * anything over the size ceiling. Pure; exported for tests. */
export function importableVaultPaths(picked: readonly PickedFile[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const file of picked) {
    const parts = file.relativePath.split("/").filter(Boolean);
    if (parts.length < 2) continue; // the folder itself, or a stray
    const rel = parts.slice(1).join("/");
    const top = parts[1] ?? "";
    if (top === "storage" || top === ".git" || top === "node_modules" || top === ".DS_Store") continue;
    if (parts.slice(1, -1).some((segment) => segment.startsWith(".") && segment !== ".rotli")) continue;
    const name = parts[parts.length - 1] ?? "";
    const text = /\.(md|markdown|txt|json|jsonl|csv|excalidraw)$/i.test(name);
    if (!text || file.size > MAX_TEXT_FILE_BYTES) continue;
    out.push({ from: file.relativePath, to: rel });
  }
  return out;
}

/** Read a picked folder (an `<input type="file" webkitdirectory>` result)
 * into a snapshot. */
export async function readPickedFolder(files: readonly File[]): Promise<ImportedVaultSnapshot | null> {
  const first = files[0];
  if (!first) return null;
  const name = first.webkitRelativePath.split("/")[0] ?? "vault";
  const byPath = new Map(files.map((file) => [file.webkitRelativePath, file]));
  const snapshot: ImportedVaultSnapshot = { version: 1, name, files: {}, dirs: [] };
  for (const { from, to } of importableVaultPaths(
    files.map((f) => ({ relativePath: f.webkitRelativePath, size: f.size })),
  )) {
    const file = byPath.get(from);
    if (file) snapshot.files[to] = await file.text();
  }
  return snapshot;
}

/** Open the browser's folder picker for a one-time read (works everywhere a
 * file input does). Must be called from a user gesture. Resolves null when
 * the user cancels. */
export function pickFolderForImport(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = input.files ? [...input.files] : [];
      input.remove();
      resolve(files.length > 0 ? files : null);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Every file and directory of a VaultDir, for a snapshot or an export:
 * text by path, and image files (a dropped screenshot) as bytes. */
export async function walkVaultDir(
  dir: VaultDir,
): Promise<{ files: Record<string, string>; dirs: string[]; binaries: Record<string, Uint8Array> }> {
  const files: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};
  const dirs: string[] = [];
  const visit = async (path: string): Promise<void> => {
    for (const entry of await dir.list(path)) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        dirs.push(child);
        await visit(child);
      } else if (isWebImageName(entry.name)) binaries[child] = await dir.readBytes(child);
      else files[child] = await dir.readText(child);
    }
  };
  await visit("");
  return { files, dirs, binaries };
}

/** Seed an in-memory filesystem from a snapshot. */
// every save re-walks the images; encode each buffer once
const BASE64_MEMO = new WeakMap<Uint8Array, string>();
function bytesToBase64(bytes: Uint8Array): string {
  const known = BASE64_MEMO.get(bytes);
  if (known !== undefined) return known;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const encoded = btoa(binary);
  BASE64_MEMO.set(bytes, encoded);
  return encoded;
}

export async function seedVaultDir(snapshot: ImportedVaultSnapshot): Promise<MemoryVaultDir> {
  const dir = new MemoryVaultDir();
  for (const path of snapshot.dirs) await dir.mkdir(path);
  for (const [path, text] of Object.entries(snapshot.files)) await dir.writeText(path, text);
  for (const [path, base64] of Object.entries(snapshot.binaries ?? {})) {
    await dir.writeBytes(path, bytesFromBase64(base64));
  }
  return dir;
}

export function isImportedVaultSnapshot(value: unknown): value is ImportedVaultSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.name === "string" &&
    typeof v.files === "object" &&
    v.files !== null &&
    Array.isArray(v.dirs)
  );
}

/** A VaultDir whose every mutation is mirrored, debounced, into a snapshot
 * string handed to `save` (browser storage). Reads are the inner dir's. */
export class PersistedVaultDir implements VaultDir {
  private readonly saver;
  constructor(
    private readonly inner: MemoryVaultDir,
    private readonly name: string,
    save: (snapshot: string) => Promise<void>,
    debounceMs = 500,
  ) {
    this.saver = createDebouncedTask(debounceMs, async () => {
      const walked = await walkVaultDir(this.inner);
      const binaries: Record<string, string> = {};
      for (const [path, bytes] of Object.entries(walked.binaries)) binaries[path] = bytesToBase64(bytes);
      const { files, dirs } = walked;
      const snapshot: ImportedVaultSnapshot = { version: 1, name: this.name, files, dirs, binaries };
      await save(JSON.stringify(snapshot));
    });
  }
  /** Write now (page hide, tests). */
  flush(): Promise<void> {
    return this.saver.flush();
  }
  private touched(): void {
    const hidden = typeof document !== "undefined" && document.hidden;
    if (hidden) void this.saver.flush().catch(() => {});
    else this.saver.schedule();
  }
  list(path: string): Promise<VaultDirEntry[]> {
    return this.inner.list(path);
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
  stat(path: string): Promise<VaultStat | null> {
    return this.inner.stat(path);
  }
  readText(path: string): Promise<string> {
    return this.inner.readText(path);
  }
  async writeText(path: string, text: string): Promise<void> {
    await this.inner.writeText(path, text);
    this.touched();
  }
  readBytes(path: string): Promise<Uint8Array> {
    return this.inner.readBytes(path);
  }
  /** An image is big and the browser may refuse it (storage quota): save now,
   * so the drop fails in words instead of vanishing on the next reload. */
  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.inner.writeBytes(path, bytes);
    try {
      await this.flush();
    } catch (error) {
      await this.inner.remove(path);
      throw error;
    }
  }
  async mkdir(path: string): Promise<void> {
    await this.inner.mkdir(path);
    this.touched();
  }
  async move(from: string, to: string): Promise<void> {
    await this.inner.move(from, to);
    this.touched();
  }
  async remove(path: string): Promise<void> {
    await this.inner.remove(path);
    this.touched();
  }
}

/** Store a freshly picked folder's snapshot and boot from it. */
export async function saveImportedVault(
  snapshot: ImportedVaultSnapshot,
  vault: BrowserVault = browserVault(),
): Promise<void> {
  await vault.write(IMPORTED_VAULT_KEY, JSON.stringify(snapshot));
}

/** Forget the imported copy (the folder on disk is untouched). */
export async function forgetImportedVault(vault: BrowserVault = browserVault()): Promise<void> {
  await vault.store.delete(IMPORTED_VAULT_KEY);
}

/** Export a vault's text files as `<name>.zip` through the browser's download. */
export async function downloadVaultZip(dir: VaultDir, name: string): Promise<void> {
  const { files, binaries } = await walkVaultDir(dir);
  const blob = await zipTextFiles(files, binaries);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name || "rotli-vault"}.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The whole import gesture: pick, read, keep, and boot from the copy. Must
 * run from a user gesture (the picker). Resolves without doing anything when
 * the user cancels; throws when the folder holds nothing Rotli can read. */
export async function importFolderAndReload(): Promise<void> {
  const files = await pickFolderForImport();
  if (!files) return;
  const snapshot = await readPickedFolder(files);
  if (!snapshot || Object.keys(snapshot.files).length === 0) {
    throw new Error(
      "That folder holds no notes Rotli can read (Markdown files under wiki/, or at the root).",
    );
  }
  await saveImportedVault(snapshot);
  window.location.reload();
}
