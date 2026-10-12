import { DEST } from "./destinations";
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
  if (!isMemex) return folderId === DEST.inbox ? "" : folderId;
  if (folderId === DEST.board) return WIKI_INBOX;
  if (under(folderId, WIKI)) return folderId;
  return null;
}

/** Remove a sink prefix before moving a note between Archive and Trash. */
export function withoutSinkPrefix(path: string): string {
  for (const sink of SINK_DIRS) {
    if (path.startsWith(`${sink.dir}/`)) return path.slice(sink.dir.length + 1);
  }
  return path;
}

export function relocationTarget(path: string, targetFolder: string, isMemex: boolean): string {
  for (const sink of SINK_DIRS) {
    if (under(targetFolder, sink.dest)) return joinVaultPath(sink.dir, withoutSinkPrefix(path));
  }
  const dir = diskDirFor(targetFolder, isMemex);
  return dir === null ? path : joinVaultPath(dir, baseName(path));
}
