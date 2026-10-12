// Connected-folder file I/O. Native callers keep using the Rust corpus.
import { extOf, imageMimeOf, VIDEO_EXTS } from "../lib/fileKind";
import type { FileStat, VersionedText } from "../lib/tauri";
import { type VaultDir, vaultIsMemex } from "./vaultDir";

export const STORAGE_OFFICE_EXTS = ["xlsx", "csv", "docx", "docm", "dotx", "dotm"] as const;

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Reject plumbing and traversal even for adapters which trust their caller. */
export function assertVaultFilePath(path: string): void {
  if (
    !path ||
    path.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith(".")) ||
    /[\\:]/.test(path)
  )
    throw new Error(`not a vault file: ${path}`);
}

export async function fileRevision(dir: VaultDir, path: string): Promise<string> {
  const stat = await dir.stat(path);
  if (!stat) throw new Error(`no such file: ${path}`);
  return `${stat.lastModified}:${stat.size}`;
}

export async function readVersionedFile(dir: VaultDir, path: string): Promise<VersionedText> {
  const revision = await fileRevision(dir, path);
  const contents = await dir.readText(path);
  if ((await fileRevision(dir, path)) !== revision)
    throw new Error("revision conflict: file changed during read");
  return { contents, revision };
}

export async function writeVersionedFile(
  dir: VaultDir,
  path: string,
  text: string,
  revision: string,
): Promise<string> {
  if (!revision || (await fileRevision(dir, path)) !== revision)
    throw new Error("revision conflict: file changed after it was opened");
  await dir.writeText(path, text);
  return fileRevision(dir, path);
}

/** Rust's surfaced + storage_office_editable gates. Binaries never become notes. */
export async function folderFileStat(dir: VaultDir, path: string): Promise<FileStat | null> {
  assertVaultFilePath(path);
  const memex = await vaultIsMemex(dir);
  if (
    memex &&
    !["wiki", "chats", "archive", "trash", "Archive", "Trash", "storage"].some((root) => under(path, root))
  )
    throw new Error("file is outside the surfaced vault lanes");
  const stat = await dir.stat(path);
  if (!stat) return null;
  const storage = under(path, "storage");
  const writable =
    !memex ||
    !storage ||
    under(path, "storage/excalidraw") ||
    STORAGE_OFFICE_EXTS.some((ext) => ext === extOf(path));
  return {
    len: stat.size,
    revision: `${stat.lastModified}:${stat.size}`,
    writable,
    lifecycleMutable: false,
    lifecycleReason: "File lifecycle actions are unavailable on the web",
    createdMs: null,
    modifiedMs: stat.lastModified,
  };
}

export async function folderFileText(dir: VaultDir, path: string, maxBytes = 2_000_000): Promise<string> {
  const stat = await folderFileStat(dir, path);
  if (!stat) throw new Error(`no such file: ${path}`);
  if (stat.len > maxBytes) throw new Error("file is too large to read safely");
  return dir.readText(path);
}

export async function folderFileBytes(dir: VaultDir, path: string, maxBytes = 8_000_000): Promise<string> {
  const stat = await folderFileStat(dir, path);
  if (!stat) throw new Error(`no such file: ${path}`);
  if (stat.len > maxBytes) throw new Error("file is too large to read safely");
  const bytes = await dir.readBytes(path);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function folderWriteFileBytes(
  dir: VaultDir,
  path: string,
  encoded: string,
  backup: boolean,
  revision: string,
): Promise<string> {
  const stat = await folderFileStat(dir, path);
  if (!stat?.writable) throw new Error("file is not writable");
  if (!revision || stat.revision !== revision)
    throw new Error("revision conflict: file changed after it was opened");
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  if (backup && !(await dir.exists(`${path}.bak`)))
    await dir.writeBytes(`${path}.bak`, await dir.readBytes(path));
  if ((await fileRevision(dir, path)) !== revision)
    throw new Error("revision conflict: file changed during save");
  if (["csv", "tsv", "txt", "html", "htm"].includes(extOf(path)))
    await dir.writeText(path, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  else await dir.writeBytes(path, bytes);
  return fileRevision(dir, path);
}

export async function folderAssetUrl(dir: VaultDir, path: string, temporary: boolean): Promise<string> {
  if (!(await folderFileStat(dir, path))) throw new Error(`no such file: ${path}`);
  const ext = extOf(path);
  const type =
    ext === "pdf"
      ? "application/pdf"
      : VIDEO_EXTS.has(ext)
        ? `video/${ext === "mov" ? "quicktime" : ext}`
        : imageMimeOf(ext);
  const bytes = await dir.readBytes(path);
  if (temporary) return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binary)}`;
}
