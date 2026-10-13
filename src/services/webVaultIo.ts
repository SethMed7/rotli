// Composition for public corpus wrappers in the browser shell.
import { looksSecret } from "../ai/guard";
import { bodyEdit } from "../lib/aiEditPolicy";
import { isLockedFrontmatter, isSecureFrontmatter, parseNoteDocument } from "../lib/frontmatter";
import type { FrontmatterView } from "../lib/tauri";
import { registerWebVaultIo } from "../lib/webAiSeam";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import {
  folderAssetUrl,
  folderFileBytes,
  folderFileStat,
  folderFileText,
  folderWriteFileBytes,
} from "./folderFileIo";
import { createManagedFile, discardPristineManagedFile } from "./folderManagedFiles";
import { readFolderRawMetadata, writeFolderRawMetadata, setFolderProtection } from "./folderMetadata";
import type { FolderNotesService } from "./folderNotes";
import { type VaultDir, vaultHasRotliMarker } from "./vaultDir";

let connectedDir: VaultDir | null = null;
let connectedNotes: (() => FolderNotesService | null) | null = null;

export function configureWebVaultIo(
  dir: VaultDir | null,
  notes: FolderNotesService | (() => FolderNotesService | null) | null,
): void {
  connectedDir = dir;
  connectedNotes = typeof notes === "function" ? notes : () => notes;
  registerWebVaultIo(dir && notes ? webVaultIo : null);
}

const directory = () => {
  const dir = connectedDir;
  if (!dir) throw new Error("Connect a vault first");
  return dir;
};
const notePath = async (id: string) => {
  const notes = connectedNotes;
  const active = notes?.();
  if (!active) throw new Error("Connect a vault first");
  return active.filePathOf(id);
};
const notesService = () => {
  const notes = connectedNotes?.();
  if (!notes) throw new Error("Connect a vault first");
  return notes;
};

export const webVaultIo = {
  createManagedFile: (name: string, base64: string) =>
    createManagedFile(
      directory(),
      name,
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    ),
  discardPristineManagedFile: (id: string) => discardPristineManagedFile(directory(), id),
  moveFileToSink: async (id: string, sink: "Archive" | "Trash") => {
    // the Rust storage_file_lifecycle_block twin: a folder opened in place keeps
    // its files where they are (owner rule 2026-10-13)
    if (!(await vaultHasRotliMarker(directory())))
      throw new Error("this file can't move (a folder opened in place keeps its files where they are)");
    return (await notesService().moveNote(id, sink)).id;
  },
  restoreFile: async (id: string) => (await notesService().restoreNote(id)).id,
  async protection(
    id: string,
    key: "locked" | "ai_edit" | "secure" | "local_ai_allowed",
    value: boolean,
  ): Promise<void> {
    const notes = connectedNotes?.();
    if (!notes) throw new Error("Connect a vault first");
    await setFolderProtection(directory(), notes, id, key, value);
  },
  assetUrl: (id: string, temporary: boolean) => folderAssetUrl(directory(), id, temporary),
  text: (id: string, max?: number) => folderFileText(directory(), id, max),
  bytes: (id: string, max?: number) => folderFileBytes(directory(), id, max),
  stat: (id: string) => folderFileStat(directory(), id),
  writeBytes: (id: string, bytes: string, backup: boolean, revision: string) =>
    folderWriteFileBytes(directory(), id, bytes, backup, revision),
  rawMetadata: async (id: string) => readFolderRawMetadata(directory(), await notePath(id)),
  writeMetadata: async (id: string, block: string, revision: string) =>
    writeFolderRawMetadata(directory(), await notePath(id), block, revision),
  async frontmatter(id: string): Promise<FrontmatterView | null> {
    const dir = directory();
    const path = await notePath(id);
    const { frontmatter: fm, body } = parseNoteDocument(await dir.readText(path));
    const fields = fm?.foreign ?? [];
    let localAiAllowed = true;
    if (await dir.exists(".rotli/settings.json")) {
      const settings = JSON.parse(await dir.readText(".rotli/settings.json")) as { secureLocalAi?: boolean };
      localAiAllowed = settings.secureLocalAi !== false;
    }
    const override = fields
      .find((line) => line.split(":", 1)[0]?.trim() === "local_ai_allowed")
      ?.split(":")
      .slice(1)
      .join(":")
      .trim();
    if (override === "true" || override === "false") localAiAllowed = override === "true";
    const locked = !!fm && isLockedFrontmatter(fm);
    return {
      id: fm?.id || id,
      created: fm?.created ?? "",
      updated: fm?.updated ?? "",
      pinned: fm?.pinned ?? false,
      locked,
      secure:
        (!!fm && isSecureFrontmatter(fm)) ||
        looksSecret(body) ||
        isSecureBrainFolder(path.slice(0, path.lastIndexOf("/"))) ||
        isSecureNotesFolder(path.slice(0, path.lastIndexOf("/"))),
      localAiAllowed,
      aiBodyEdit: locked ? "locked" : bodyEdit(fields),
      fields,
    };
  },
};
