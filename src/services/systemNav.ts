// The ONE way to open the System browser at a root (Library / Assets / Archive
// / Trash). It sets three pieces of ui state that must always move together —
// the ⌘N create target, the browser's root, and the content view — so every
// caller (a System row, a roving Enter, a reveal) lands identically.
//
// A store-mutating command module, so it lives in services/ rather than lib/
// (docs/development/adding-things.md).

import { noteDiskFolder } from "../lib/noteLocation";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { DEST } from "./destinations";
import { isChatItem, libraryPathOfChat, rerootDiskPath } from "./systemBrowser";

/** Per-root session memory of the browser's folder — the surface unmounts on
 * every content-view switch, and a Finder that forgets its place feels
 * broken. Shared here so a reveal can set the place before the surface mounts. */
export const systemCwdMemo = new Map<string, string>();

export function openSystemRoot(id: string): void {
  const ui = useUiStore.getState();
  ui.setSelectedFolderId(id);
  ui.setSystemRoot(id);
  ui.setContentView("system");
}

/** The System root a note's disk folder sits under, and its browser prefix. */
function rootOf(folder: string): { id: string; prefix: string } {
  const top = folder.split("/")[0]?.toLowerCase() ?? "";
  if (top === "storage") return { id: DEST.storage, prefix: "Storage" };
  if (top === "archive") return { id: DEST.archive, prefix: "Archive" };
  if (top === "trash") return { id: DEST.trash, prefix: "Trash" };
  return { id: "Brain", prefix: "wiki" };
}

/** The sidebar row that shows where a note lives when Main doesn't hold it
 * (a link can open any note): a capture's Captures row, else the System root
 * of its disk folder. Null for a chat — the Chat front owns those. */
export function sidebarHomeOfNote(note: NoteSummary): string | null {
  if (isChatItem(note)) return null;
  if (note.folderId === DEST.board) return DEST.board;
  return rootOf(noteDiskFolder(note)).id;
}

/** Open the System browser AT a note's folder — Rotli Web's "show me where
 * this file lives" (Finder does it on the Mac). */
export function revealNoteInSystem(note: NoteSummary): void {
  const folder = noteDiskFolder(note);
  const root = rootOf(folder);
  const path = isChatItem(note)
    ? libraryPathOfChat(folder, root.prefix)
    : rerootDiskPath(folder, root.prefix);
  systemCwdMemo.set(root.id, path);
  openSystemRoot(root.id);
}
