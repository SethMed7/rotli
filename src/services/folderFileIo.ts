// Connected-folder file I/O. Native callers keep using the Rust corpus.
import { extOf, imageMimeOf, VIDEO_EXTS } from "../lib/fileKind";
import type { FileStat, VersionedText } from "../lib/tauri";
import { type VaultDir, bytesRevision, contentRevision, vaultIsMemex } from "./vaultDir";

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

async function assertSurfacedPath(dir: VaultDir, path: string): Promise<boolean> {
  assertVaultFilePath(path);
  const memex = await vaultIsMemex(dir);
  if (
    memex &&
    !["wiki", "chats", "archive", "trash", "Archive", "Trash", "storage"].some((root) => under(path, root))
  )
    throw new Error("file is outside the surfaced vault lanes");
  return memex;
}

function fileWritable(memex: boolean, path: string): boolean {
  return (
    !memex ||
    !under(path, "storage") ||
    under(path, "storage/excalidraw") ||
    STORAGE_OFFICE_EXTS.some((ext) => ext === extOf(path))
  );
}

/** A text file and the revision of exactly the bytes read — never a stat
 * taken around the read, which could pair old text with a newer revision. */
export async function readVersionedFile(dir: VaultDir, path: string): Promise<VersionedText> {
  const contents = await dir.readText(path);
  return { contents, revision: contentRevision(contents) };
}

/** The content revision a text file has now ("0" when it is missing). */
export async function textRevision(dir: VaultDir, path: string): Promise<string> {
  return (await dir.exists(path)) ? contentRevision(await dir.readText(path)) : "0";
}

/** Write `text` only if the file still holds what `revision` saw ("0": only if
 * it is missing). The folder adapter checks the gate in the same turn as the
 * write, so nothing can land between the check and the write. */
export async function writeVersionedFile(
  dir: VaultDir,
  path: string,
  text: string,
  revision: string,
): Promise<string> {
  if (!revision) throw new Error("revision conflict: file changed after it was opened");
  try {
    await dir.writeText(path, text, revision);
  } catch (error) {
    if (error instanceof Error && /revision conflict/i.test(error.message))
      throw new Error("revision conflict: file changed after it was opened");
    throw error;
  }
  return contentRevision(text);
}

/** Rust's surfaced + storage_office_editable gates. Binaries never become notes. */
export async function folderFileStat(dir: VaultDir, path: string): Promise<FileStat | null> {
  const memex = await assertSurfacedPath(dir, path);
  const stat = await dir.stat(path);
  if (!stat) return null;
  return {
    len: stat.size,
    revision: bytesRevision(await dir.readBytes(path)),
    writable: fileWritable(memex, path),
    lifecycleMutable: true,
    lifecycleReason: null,
    createdMs: null,
    modifiedMs: stat.lastModified,
  };
}

export async function folderFileText(dir: VaultDir, path: string, maxBytes = 2_000_000): Promise<string> {
  await assertSurfacedPath(dir, path);
  const stat = await dir.stat(path);
  if (!stat) throw new Error(`no such file: ${path}`);
  if (stat.size > maxBytes) throw new Error("file is too large to read safely");
  const bytes = await dir.readBytes(path);
  if (bytes.length > maxBytes) throw new Error("file is too large to read safely");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function folderFileBytes(dir: VaultDir, path: string, maxBytes = 8_000_000): Promise<string> {
  await assertSurfacedPath(dir, path);
  const stat = await dir.stat(path);
  if (!stat) throw new Error(`no such file: ${path}`);
  if (stat.size > maxBytes) throw new Error("file is too large to read safely");
  const bytes = await dir.readBytes(path);
  if (bytes.length > maxBytes) throw new Error("file is too large to read safely");
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
  const memex = await assertSurfacedPath(dir, path);
  const stat = await folderFileStat(dir, path);
  if (!fileWritable(memex, path)) throw new Error("file is not writable");
  if (!revision || (stat ? stat.revision !== revision : revision !== "0"))
    throw new Error("revision conflict: file changed after it was opened");
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const textLike = ["csv", "tsv", "txt", "html", "htm"].includes(extOf(path));
  const observedBytes = stat ? await dir.readBytes(path) : null;
  if (textLike) {
    try {
      if (observedBytes) new TextDecoder("utf-8", { fatal: true }).decode(observedBytes);
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("This text file is not valid UTF-8; Rotli cannot save it without changing its bytes.");
    }
  }
  if (observedBytes && bytesRevision(observedBytes) !== revision)
    throw new Error("revision conflict: file changed during save");
  if (backup && observedBytes && !(await dir.exists(`${path}.bak`))) {
    try {
      await dir.writeBytes(`${path}.bak`, observedBytes, "0");
    } catch (error) {
      // Another tab may have created the one-time backup after exists(). Its
      // exclusive create gate protects that copy; the main file has its own
      // revision gate below and must still get a chance to save.
      if (!(error instanceof Error) || !/revision conflict/i.test(error.message)) throw error;
    }
  }
  try {
    await dir.writeBytes(path, bytes, revision);
  } catch (error) {
    if (error instanceof Error && /revision conflict/i.test(error.message))
      throw new Error("revision conflict: file changed after it was opened");
    throw error;
  }
  return bytesRevision(bytes);
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
