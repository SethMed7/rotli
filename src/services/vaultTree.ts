// The Vault view (the owner, 2026-09-30: "add 'vault' as a view, so they can
// see things just how they are in Finder, if that's how they choose to work").
// Main is a projection you arrange; this is the vault's own folders, derived
// fresh from where each file physically is — nothing is stored, nothing is
// arranged, and it moves when the files move. Rendered by the same tree as Main
// (read-only), so a Vault row looks and opens exactly like a Main row.

import type { Folder, NoteSummary } from "../types";
import { DEST, RESERVED_FOLDERS, isSink, isVault } from "./destinations";
import type { MainNode } from "./mainTree";

/** A disk path relative to where notes live: a memex's `wiki/` is its root
 * (the Library's rerooting); a plain folder's root is itself. */
function notesRelative(path: string): string {
  if (path === "wiki") return "";
  return path.startsWith("wiki/") ? path.slice("wiki/".length) : path;
}

interface Dir {
  folders: Map<string, Dir>;
  notes: NoteSummary[];
}

const newDir = (): Dir => ({ folders: new Map(), notes: [] });
/** The destination rows a folder list carries that are not folders on disk. In a memex every real
 * folder is a path under wiki/, so a bare destination id (Inbox, Secure notes, Storage, Board) is
 * always a projection: Rotli Web lists them first, and the Mac app makes one for a shelf. In a plain
 * folder vault a top-level folder's id is its bare name, so only the six rows Rotli Web's list
 * leads with are left out; a real Inbox folder after them still shows. */
const DESTINATION_ROWS: ReadonlySet<string> = new Set([DEST.inbox, DEST.secure, DEST.storage, DEST.board]);
function destinationRows(folders: readonly Folder[]): Set<Folder> {
  const rows = new Set<Folder>();
  const memex = folders.some((folder) => folder.id === "wiki" && folder.parentId === null);
  if (memex) {
    for (const folder of folders) if (DESTINATION_ROWS.has(folder.id)) rows.add(folder);
  }
  if (RESERVED_FOLDERS.every((id, i) => folders[i]?.id === id && folders[i].parentId === null)) {
    for (const folder of folders.slice(0, RESERVED_FOLDERS.length)) rows.add(folder);
  }
  return rows;
}
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The vault's folders and files as a tree: folders first, then files, each by
 * name, as Finder lists them. Archive and Trash stay in the System zone. */
export function vaultTree(notes: Iterable<NoteSummary>, folders: readonly Folder[] = []): MainNode[] {
  const root = newDir();
  const at = (path: string): Dir => {
    let dir = root;
    for (const part of path.split("/").filter(Boolean)) {
      let next = dir.folders.get(part);
      if (!next) {
        next = newDir();
        dir.folders.set(part, next);
      }
      dir = next;
    }
    return dir;
  };
  // a folder's path is its names from the top (on disk, its id; a folder with
  // an opaque id still reads by name)
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathOf = (folder: Folder, seen = new Set<string>()): string => {
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    if (!parent || seen.has(parent.id)) return folder.name;
    seen.add(folder.id);
    return `${pathOf(parent, seen)}/${folder.name}`;
  };
  const skipped = destinationRows(folders);
  for (const folder of folders) {
    const path = pathOf(folder);
    if (
      path.split("/").some((part) => part.startsWith(".")) ||
      isSink(folder.id) ||
      isVault(folder.id) ||
      skipped.has(folder)
    )
      continue;
    at(notesRelative(path));
  }
  for (const note of notes) {
    if (isSink(note.folderId) || isVault(note.folderId)) continue;
    at(notesRelative(note.diskFolderId ?? note.folderId)).notes.push(note);
  }
  const nodes = (dir: Dir): MainNode[] => [
    ...[...dir.folders.entries()]
      .sort(([a], [b]) => byName(a, b))
      .map(([name, child]) => ({ folder: name, children: nodes(child) })),
    ...dir.notes.sort((a, b) => byName(a.title, b.title)).map((note) => ({ note: note.id })),
  ];
  return nodes(root);
}
