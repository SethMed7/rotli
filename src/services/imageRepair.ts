// Self-repair for image links (the maintainer, 2026-07-30): "when an image gets moved,
// wherever it is attached should also get fixed rather than not found." A src
// that no longer resolves is classified against the corpus file listing:
//
//   moved    — exactly ONE live file with the same basename at a new path →
//              the editor heals the markdown link to point there
//   archived — the match sits in the Archive: it still EXISTS, so the image
//              renders from there, but the link is never rewritten into
//              Archive/ (restoring the file heals it properly later)
//   trashed  — the only matches sit in the Trash → say "in the Trash", never
//              the misleading "not found"
//   missing  — nothing matches (or several do: a rewrite must never be a coin
//              flip) → the honest "not found"
//
// Pure classification lives here (unit-tested); the editor widget owns the
// actual dispatch that rewrites the note.

import { rootIdOf } from "../lib/tauri";
import { notesService } from "./notes";

export interface ImageFileEntry {
  /** Wire id — a bare rel path on the default root, `<rootid>:rel` elsewhere. */
  id: string;
  folderId: string;
  kind?: string;
}

export type ImageLocation =
  | { kind: "moved"; rel: string }
  | { kind: "archived"; rel: string }
  | { kind: "trashed" }
  | { kind: "missing" };

/** `storage:NAME` shorthand → the real rel path (mirrors resolveImageSrc). */
export function imageSrcToRel(src: string): string {
  return src.startsWith("storage:") ? `storage/${src.slice("storage:".length)}` : src;
}

function basename(rel: string): string {
  const cut = rel.lastIndexOf("/");
  return cut < 0 ? rel : rel.slice(cut + 1);
}

function relOf(id: string): string {
  const i = id.indexOf(":");
  return i > 0 && !id.slice(0, i).includes("/") ? id.slice(i + 1) : id;
}

function inTrash(entry: ImageFileEntry, rel: string): boolean {
  return entry.folderId === "Trash" || rel === "Trash" || rel.startsWith("Trash/");
}

function inArchive(entry: ImageFileEntry, rel: string): boolean {
  return entry.folderId === "Archive" || rel === "Archive" || rel.startsWith("Archive/");
}

/** Classify a FAILED image src against the file listing of the note's root. */
export function classifyLostImage(
  src: string,
  files: readonly ImageFileEntry[],
  rootId: string,
): ImageLocation {
  const srcRel = imageSrcToRel(src);
  const name = basename(srcRel);
  if (!name) return { kind: "missing" };
  const live: string[] = [];
  const archived: string[] = [];
  let trashed = false;
  for (const entry of files) {
    if (entry.kind !== "file") continue;
    if (rootIdOf(entry.id) !== rootId) continue;
    const rel = relOf(entry.id);
    if (basename(rel) !== name) continue;
    if (rel === srcRel) continue; // the original location — it just failed
    if (inTrash(entry, rel)) trashed = true;
    else if (inArchive(entry, rel)) archived.push(rel);
    else live.push(rel);
  }
  const onlyLive = live[0];
  if (live.length === 1 && onlyLive) return { kind: "moved", rel: onlyLive };
  const onlyArchived = archived[0];
  if (live.length === 0 && archived.length === 1 && onlyArchived) {
    return { kind: "archived", rel: onlyArchived };
  }
  if (live.length === 0 && archived.length === 0 && trashed) return { kind: "trashed" };
  return { kind: "missing" };
}

/** IO wrapper: classify against the live listing. Failures read as missing —
 * the lookup is a rescue path and must never throw into the render. */
export async function locateLostImage(src: string, rootId: string): Promise<ImageLocation> {
  try {
    const notes = await notesService.listNotes();
    return classifyLostImage(src, notes, rootId);
  } catch {
    return { kind: "missing" };
  }
}
