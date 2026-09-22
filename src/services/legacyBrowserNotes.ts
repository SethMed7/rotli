// Notes an earlier Rotli Web kept INSIDE the browser — the browser-storage
// vault, or a read-only copy of a vault — moved into the vault this browser
// now connects to. Since 2026-09-22 a vault is required, so these stores are
// read once, copied, and cleared only when the user says so. Nothing is ever
// overwritten: a file the vault already holds with different text gets the
// browser's version beside it.

import { type BrowserVault, browserStorageVault } from "../lib/browserVault";
import { DEST } from "./destinations";
import { IMPORTED_VAULT_KEY, isImportedVaultSnapshot } from "./importedVault";
import { InMemoryNotesService, isNotesSnapshot } from "./inMemoryNotes";
import type { VaultDir } from "./vaultDir";

/** The key the browser-storage vault kept its notes snapshot under. */
const BROWSER_NOTES_KEY = "notes";
/** Where notes from the browser-storage vault land in the connected vault. */
export const FROM_BROWSER_FOLDER = "From this browser";

export interface LegacyFile {
  /** Vault-relative, before the memex `wiki/` prefix (see copyLegacyInto). */
  path: string;
  text?: string;
  base64?: string;
  /** A browser-vault note (lands under wiki/ in a memex), not a copied file. */
  note: boolean;
}

/** A name a file can carry on every OS. Pure. */
export function safeFileName(title: string): string {
  // control characters first, without a control-character regex
  const printable = [...title].map((c) => (c.charCodeAt(0) < 0x20 ? " " : c)).join("");
  const cleaned = printable
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Untitled").slice(0, 120);
}

/** Every note of a browser-vault snapshot, as files under "From this browser",
 * in their folders. Trash stays behind. Pure over the snapshot text. */
export async function filesFromBrowserSnapshot(raw: string): Promise<LegacyFile[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isNotesSnapshot(parsed)) return [];
  const service = new InMemoryNotesService();
  service.importSnapshot(parsed);
  const folders = new Map((await service.listFolders()).map((f) => [f.id, f]));
  const chain = (id: string | null): string[] => {
    const out: string[] = [];
    for (let at = id; at; at = folders.get(at)?.parentId ?? null) {
      const folder = folders.get(at);
      if (!folder) break;
      out.unshift(safeFileName(folder.name));
    }
    return out;
  };
  const files: LegacyFile[] = [];
  const taken = new Set<string>();
  for (const summary of await service.listAll()) {
    if (summary.folderId === DEST.trash) continue;
    const note = await service.getNote(summary.id);
    if (!note || !note.body.trim()) continue;
    const dir = [FROM_BROWSER_FOLDER, ...chain(summary.folderId)].join("/");
    let path = `${dir}/${safeFileName(summary.title)}.md`;
    for (let n = 2; taken.has(path); n += 1) path = `${dir}/${safeFileName(summary.title)} (${n}).md`;
    taken.add(path);
    files.push({ path, text: note.body, note: true });
  }
  return files;
}

/** What this browser still holds from before vaults were required. */
export async function legacyBrowserFiles(vault: BrowserVault = browserStorageVault()): Promise<LegacyFile[]> {
  const files: LegacyFile[] = [];
  const notes = await vault.read(BROWSER_NOTES_KEY).catch(() => undefined);
  if (notes) files.push(...(await filesFromBrowserSnapshot(notes)));
  const copy = await vault.read(IMPORTED_VAULT_KEY).catch(() => undefined);
  if (copy) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(copy);
    } catch {
      parsed = null;
    }
    if (isImportedVaultSnapshot(parsed)) {
      for (const [path, text] of Object.entries(parsed.files)) files.push({ path, text, note: false });
      for (const [path, base64] of Object.entries(parsed.binaries ?? {}))
        files.push({ path, base64, note: false });
    }
  }
  return files;
}

/** "a.md" → "a (from this browser).md". Pure. */
export function fromBrowserPath(path: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1
    ? `${path.slice(0, dot)} (from this browser)${path.slice(dot)}`
    : `${path} (from this browser)`;
}

/** Copy into the connected vault without overwriting anything: a missing
 * file is written, an identical one skipped, a different one lands beside
 * the vault's own. Resolves how many files were written. */
export async function copyLegacyInto(dir: VaultDir, files: readonly LegacyFile[]): Promise<number> {
  const memex = await dir.exists("wiki");
  let written = 0;
  for (const file of files) {
    const path = file.note && memex ? `wiki/${file.path}` : file.path;
    let target = path;
    if (await dir.exists(path)) {
      if (file.text !== undefined && (await dir.readText(path).catch(() => null)) === file.text) continue;
      target = fromBrowserPath(path);
      if (await dir.exists(target)) continue; // an earlier copy already put it there
    }
    if (file.text !== undefined) await dir.writeText(target, file.text);
    else if (file.base64 !== undefined) {
      await dir.writeBytes(
        target,
        Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)),
      );
    }
    written += 1;
  }
  return written;
}

/** Forget what the browser held, after it has been copied. */
export async function clearLegacyBrowserFiles(vault: BrowserVault = browserStorageVault()): Promise<void> {
  for (const key of [BROWSER_NOTES_KEY, `${BROWSER_NOTES_KEY}#rev`, IMPORTED_VAULT_KEY]) {
    await vault.store.delete(key);
  }
}
