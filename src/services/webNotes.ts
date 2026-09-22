// Rotli Web: the notes service over the vault this browser is connected to.
// The desktop shell never loads this path (see ./notes.ts for the switch).
//
// Since 2026-09-22 a vault is REQUIRED (the owner): notes live only in a real
// folder on this computer — Chromium's live folder, or the folder Rotli Helper
// serves to browsers without that API. There is no browser-storage vault and
// no read-only copy any more; a boot that can't reach the bound vault leaves
// the notes service unmounted, and the app shows setup or reconnect instead
// of an editor (state/vaultConnection.ts). Notes an older build kept in the
// browser are only READ, to be copied into the vault (legacyBrowserNotes.ts).

import { configureBrowserVault, setWebVaultName } from "../lib/browserVault";
import { FolderVaultStore } from "../lib/folderVaultStore";
import type { HelperLink } from "../lib/helperPairing";
import { showFileNotice } from "../state/fileNotice";
import { useVaultConnection } from "../state/vaultConnection";
import { FolderNotesService } from "./folderNotes";
import { downloadVaultZip } from "./importedVault";
import type { NotesService } from "./notesPort";
import { resolveVault } from "./vaultBinding";
import type { VaultDir } from "./vaultDir";
import { scaffoldVault } from "./vaultScaffold";

let folderService: FolderNotesService | null = null;
let folderName: string | null = null;
let folderDir: VaultDir | null = null;
let mode: "folder" | "helper" | null = null;
let identity: string | null = null;
/** True when the connected folder held nothing at boot: an empty folder the
 * user chose to become a vault, the way onboarding's empty folder does. */
let freshFolder = false;

/** Whether a folder's listing says "empty": the Finder's own droppings do not
 * count, and neither does a `.rotli/` the page itself may already have made.
 * Pure; exported for tests. */
export function folderIsEmpty(entries: readonly { name: string }[]): boolean {
  return entries.every((entry) => entry.name === ".DS_Store" || entry.name === ".rotli");
}

/** Rotli Web only, before the first render (main.tsx awaits it): resolve the
 * bound vault and, when it is reachable, mount the notes service and the
 * `.rotli/` store on it. An EMPTY folder becomes a vault here (the spine);
 * the app seeds Welcome once it is up. Resolves true when connected. */
export async function hydrateWebNotes(link: HelperLink | null): Promise<boolean> {
  const resolved = await resolveVault(link);
  useVaultConnection.getState().setConnection(resolved.connection);
  const dir = resolved.dir;
  if (resolved.connection.status !== "connected" || !dir) return false;
  const name = resolved.connection.name;
  // read before anything else may write into the folder
  freshFolder = folderIsEmpty(await dir.list("").catch(() => [{ name: "?" }]));
  if (freshFolder) {
    try {
      await scaffoldVault(dir);
    } catch (cause) {
      showFileNotice(
        `Couldn’t set up the vault in “${name}” — ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  configureBrowserVault(new FolderVaultStore(dir));
  folderService = new FolderNotesService(dir);
  folderName = name;
  setWebVaultName(name);
  folderDir = dir;
  mode = resolved.connection.via;
  identity = resolved.identity ?? null;
  return true;
}

/** The service the web build uses after hydrateWebNotes: the vault's when
 * connected; otherwise the unmounted placeholder, which setup keeps unseen. */
export function activeWebNotesService(fallback: NotesService): NotesService {
  return folderService ?? fallback;
}

/** The vault-relative file behind a note; null before a vault is connected. */
export async function webNoteFilePath(id: string): Promise<string | null> {
  if (!folderService) return null;
  return folderService.filePathOf(id).catch(() => null);
}

/** The connected vault's directory port; null before one is connected. */
export function activeWebVaultDir(): VaultDir | null {
  return folderDir;
}

export function connectedFolderName(): string | null {
  return folderName;
}

/** This vault's key for browser-local bookkeeping (the unsaved journal);
 * null before a vault is connected. */
export function webVaultKey(): string | null {
  return identity;
}

/** How this session reaches its vault: the browser's live folder, Rotli
 * Helper, or not at all yet. */
export function webVaultMode(): "folder" | "helper" | null {
  return mode;
}

/** Download the connected vault's text files as a zip. */
export async function exportWebVault(): Promise<void> {
  if (!folderDir) throw new Error("Nothing to export yet — connect a vault first.");
  await downloadVaultZip(folderDir, folderName ?? "rotli-vault");
}

/** True when this boot connected an EMPTY folder: it becomes a vault, so the
 * Welcome folder is seeded into it, as a created vault gets on the Mac. */
export function webVaultIsFreshFolder(): boolean {
  return mode !== null && freshFolder;
}
