import { fileName, isCanvasPath } from "../lib/fileKind";
import type { Note } from "../types";
import { DEST } from "./destinations";
import { boardTitle, isBoardPath } from "./folderBoards";
import { canvasTitle } from "./folderCanvases";
import { type VaultDir, parentPath } from "./vaultDir";

/** Stat-only rows never read binaries or join the Markdown text index. */
export async function folderFileSummary(
  dir: VaultDir,
  path: string,
  isMemex: boolean,
  projectFolder: (folder: string) => string,
): Promise<Note> {
  const stat = await dir.stat(path);
  if (!stat) throw new Error(`unknown board: ${path}`);
  const diskFolderId = parentPath(path);
  return {
    id: path,
    title: isCanvasPath(path) ? canvasTitle(path) : isBoardPath(path) ? boardTitle(path) : fileName(path),
    snippet: "",
    bodyEmpty: false,
    aliases: [],
    folderId:
      isMemex && (diskFolderId === "storage" || diskFolderId.startsWith("storage/")) && !isBoardPath(path)
        ? DEST.storage
        : projectFolder(diskFolderId),
    diskFolderId,
    createdAt: stat.lastModified,
    updatedAt: stat.lastModified,
    pinned: false,
    kind: isBoardPath(path) ? "board" : "file",
    secure: false,
    body: "",
    revision: `${stat.lastModified}:${stat.size}`,
  };
}
