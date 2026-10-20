// Which items a person can rename, and the ordering that makes a file rename
// safe. Pure: the composition (itemRenameComposition.ts) supplies the effects.

import { type PathId, pathId } from "../lib/corpusWireId";
import { extOf, fileName, fileNameStem } from "../lib/fileKind";
import type { NoteSummary } from "../types";

/** The conventional work files Rotli names by filename. Mirrors the Rust
 * `RENAMABLE_FILE_EXTS` (src-tauri/src/corpus_file_rename.rs), which enforces it. */
const RENAMABLE_FILE_EXTS = new Set(["docx", "xlsx"]);

/** `title` rewrites a note's H1 (its filename follows); `board` and `file`
 * rename the file itself, keeping its extension. Null = no Rename offered. */
export type RenameLane = "title" | "board" | "file";

export function renameLane(item: Pick<NoteSummary, "id" | "kind">): RenameLane | null {
  if (item.kind === "board") return "board";
  if (item.kind !== "file") return "title";
  return RENAMABLE_FILE_EXTS.has(extOf(fileName(item.id))) ? "file" : null;
}

/** What Rename edits for an item: a note's title, or a board's/file's name
 * without its extension (so selecting it all selects just the name). */
export interface RenameTarget {
  id: string;
  current: string;
  lane: RenameLane;
}

export function renameTargetFor(item: Pick<NoteSummary, "id" | "kind" | "title">): RenameTarget | null {
  const lane = renameLane(item);
  if (!lane) return null;
  return { id: item.id, current: lane === "title" ? item.title : fileNameStem(item.id), lane };
}

export interface FileRenamePorts {
  /** Save every dirty open document, so no pending save targets the old path. */
  flushDocuments(): Promise<void>;
  /** Rename on disk; resolves the new id or rejects with a person-readable reason. */
  rename(id: string, name: string): Promise<string>;
  retarget(oldId: PathId, newId: PathId): void;
  renameReferences(oldId: PathId, newId: PathId): void;
  refresh(): Promise<void>;
}

/** Rename a document/sheet. Resolves the new id, or null when the typed name is
 * blank or unchanged. A failure before the disk rename leaves everything as it was. */
export async function renameFileItem(
  ports: FileRenamePorts,
  id: string,
  raw: string,
): Promise<string | null> {
  const name = raw.trim();
  if (!name || name === fileNameStem(id)) return null;
  await ports.flushDocuments();
  // a document's/sheet's id is its file path, so a rename mints a new one
  const oldId = pathId(id);
  const newId = pathId(await ports.rename(id, name));
  if (newId !== oldId) {
    ports.retarget(oldId, newId);
    ports.renameReferences(oldId, newId);
  }
  await ports.refresh();
  return newId;
}
