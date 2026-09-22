// Rotli Web's vault export (a zip of the connected vault) and the one piece
// of the retired read-only copy lane still read: its stored snapshot, so
// notes it held can be copied into a real vault (legacyBrowserNotes.ts).
// Since 2026-09-22 a vault is required and every browser writes real files —
// Chromium directly, the rest through Rotli Helper — so nothing is copied
// INTO the browser any more.

import { zipTextFiles } from "../lib/vaultZip";
import type { VaultDir } from "./vaultDir";
import { isWebImageName } from "./webFiles";

/** Where the retired copy lane kept its snapshot in browser storage. */
export const IMPORTED_VAULT_KEY = "vault-import";

interface ImportedVaultSnapshot {
  version: 1;
  name: string;
  files: Record<string, string>;
  dirs: string[];
  /** Binary files written in the browser (dropped images), base64 by path. */
  binaries?: Record<string, string>;
  /** When the copy was taken (ms). A copy never follows the vault; the
   * sidebar says how old it is so a stale one is never mistaken for live. */
  importedAt?: number;
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

/** Every file and directory of a VaultDir, for a snapshot or an export:
 * text by path, and image files (a dropped screenshot) as bytes. */
async function walkVaultDir(
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
