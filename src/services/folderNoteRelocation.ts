import { type NoteFrontmatter, shelfOf } from "../lib/frontmatter";
import { DEST, folderRoles } from "./destinations";
import { baseName, joinVaultPath } from "./vaultDir";

export const WIKI = "wiki";
export const WIKI_INBOX = "wiki/_inbox";
export const WIKI_SECURE = "wiki/_secure";
export const SINK_DIRS = [
  { dir: "archive", dest: DEST.archive },
  { dir: "trash", dest: DEST.trash },
];
export const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** A projection without a disk home changes only the shelf line. */
export function diskDirFor(folderId: string, isMemex: boolean): string | null {
  // an imported vault's Inbox is a real folder (decision D), not the root
  if (!isMemex) return folderId === DEST.inbox && !folderRoles() ? "" : folderId;
  if (folderId === DEST.board) return WIKI_INBOX;
  if (under(folderId, WIKI)) return folderId;
  return null;
}

/** Remove a sink prefix before moving a note between Archive and Trash. */
export function withoutSinkPrefix(path: string): string {
  // an imported vault's sinks are its role folders; its archive/ is the person's
  const roles = folderRoles();
  const dirs = roles ? [roles.archive, roles.trash] : SINK_DIRS.map((sink) => sink.dir);
  for (const dir of dirs) {
    if (path.startsWith(`${dir}/`)) return path.slice(dir.length + 1);
  }
  return path;
}

export function relocationTarget(path: string, targetFolder: string, isMemex: boolean): string {
  // an imported vault's Archive/ and Trash/ are the person's folders; its
  // sinks are role folders reached like any other folder below
  for (const sink of isMemex || !folderRoles() ? SINK_DIRS : []) {
    if (under(targetFolder, sink.dest)) return joinVaultPath(sink.dir, withoutSinkPrefix(path));
  }
  // anything keeps its path beneath an imported vault's sink, so a note with
  // no frontmatter to hold an origin still finds its way home
  const roles = folderRoles();
  const sink = roles && [roles.archive, roles.trash].find((dir) => targetFolder === dir);
  if (sink) return joinVaultPath(sink, withoutSinkPrefix(path));
  const dir = diskDirFor(targetFolder, isMemex);
  return dir === null ? path : joinVaultPath(dir, baseName(path));
}

/** The folder a note is PROJECTED into — the row the sidebar shows, which in a
 * memex differs from the physical directory. A path-based table:
 *
 * • `archive` / `trash` and their subtrees → the reserved Archive / Trash rows.
 * • `wiki/_inbox` → Board (the Captures row).
 * • `wiki/_secure` → Board when the note is shelved to Inbox (a quick capture
 *   is secure at birth but is still a capture), otherwise the Secure spine.
 * • any other `wiki/<path>` → that path; `wiki` itself → "wiki".
 * • a plain vault projects the physical directory, with the root as Inbox.
 *
 * Deliberate divergences from Rust `project_folder`, which the browser build's
 * folder list requires: Rust keeps the suffix (`Archive/wiki/ideas`) where this
 * flattens to `Archive`, and Rust projects a shelved `wiki/**` note onto its
 * primary shelf where this keeps the disk path, because `listFolders` here
 * offers the wiki tree rather than a shelf vocabulary. */
export function projectVaultFolder(
  diskFolderId: string,
  fm: NoteFrontmatter | null,
  isMemex: boolean,
): string {
  if (!isMemex) return diskFolderId === "" && !folderRoles() ? DEST.inbox : diskFolderId;
  for (const sink of SINK_DIRS) if (under(diskFolderId, sink.dir)) return sink.dest;
  if (under(diskFolderId, WIKI_INBOX)) return DEST.board;
  if (under(diskFolderId, WIKI_SECURE)) {
    return fm && shelfOf(fm).includes(DEST.inbox) ? DEST.board : WIKI_SECURE;
  }
  return diskFolderId;
}
