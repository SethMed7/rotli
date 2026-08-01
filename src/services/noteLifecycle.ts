// Note lifecycle with image housekeeping (Seth, 2026-07-30): "if I put a note
// in trash, any linked images should go in trash with it — unless it is in
// multiple spots. Also consider archived." One chokepoint every trash/archive
// entry point routes through; the behavior is a Settings toggle
// (tidyImagesWithNote, default ON). Reference counting is CONSERVATIVE — an
// image any other note mentions stays put, and a failed check counts as
// referenced. Files move through corpus_move_file_to_sink, so restoring one
// from Trash/Archive returns it to its original path and the link simply
// works again.

import { corpusMoveFileToSink, corpusSearch, isTauri, rootIdOf } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import type { Note } from "../types";
import { imageSrcToRel } from "./imageRepair";
import { notesService } from "./notes";

const IMAGE_MD_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** Image srcs a note body references — rel-normalized, deduped; remote and
 * already-resolved urls are never lifecycle candidates. Pure. */
export function noteImageRels(body: string): string[] {
  const out = new Set<string>();
  for (const match of body.matchAll(IMAGE_MD_RE)) {
    const src = match[1] ?? "";
    if (!src || /^(https?:|data:|blob:|asset:)/i.test(src)) continue;
    out.add(imageSrcToRel(src));
  }
  return [...out];
}

/** Whether any OTHER note references this image. Pure over an injected
 * search; errors read as "referenced" — never cascade on doubt. */
export async function referencedElsewhere(
  rel: string,
  excludeNoteId: string,
  search: (query: string) => Promise<{ id: string }[]>,
): Promise<boolean> {
  const name = rel.slice(rel.lastIndexOf("/") + 1);
  if (!name) return true;
  try {
    const hits = await search(name);
    return hits.some((hit) => hit.id !== excludeNoteId);
  } catch {
    return true;
  }
}

async function cascadeImages(noteId: string, body: string, sink: "Archive" | "Trash"): Promise<void> {
  // browser twin: no file lifecycle exists — nothing to tidy
  if (!isTauri()) return;
  if (!useUiStore.getState().tidyImagesWithNote) return;
  const rootId = rootIdOf(noteId);
  const rels = noteImageRels(body);
  // Every reference check is its own full-corpus walk (perf audit 2026-07-30,
  // finding 16). Each image searches for its OWN file name, so one search can't
  // stand in for K. The batch issues all K checks up front — but corpus_search
  // is still a sync main-thread command under the registry mutex (audit
  // findings 2/5), so the walks execute serially today; the batch removes only
  // the per-await scheduling gaps and starts overlapping the moment that
  // command goes async. referencedElsewhere never rejects (a failure reads as
  // "referenced"), so the batch stays as conservative as the serial loop was.
  const referenced = await Promise.all(
    rels.map((rel) => referencedElsewhere(rel, noteId, (query) => corpusSearch(query, 25))),
  );
  for (const [index, rel] of rels.entries()) {
    if (referenced[index]) continue;
    const wireId = rootId === "default" ? rel : `${rootId}:${rel}`;
    // best-effort per image: one gone/read-only file must not block the rest
    await corpusMoveFileToSink(wireId, sink).catch(() => {});
  }
}

async function noteBodySafe(id: string): Promise<string> {
  try {
    return (await notesService.getNote(id))?.body ?? "";
  } catch {
    return "";
  }
}

/** Trash a note and tidy its solely-referenced images along with it. */
export async function trashNoteWithImages(id: string): Promise<Note> {
  const body = await noteBodySafe(id);
  const note = await notesService.trashNote(id);
  if (body) void cascadeImages(id, body, "Trash");
  return note;
}

/** Archive a note and tidy its solely-referenced images along with it. */
export async function archiveNoteWithImages(id: string): Promise<Note> {
  const body = await noteBodySafe(id);
  const note = await notesService.archiveNote(id);
  if (body) void cascadeImages(id, body, "Archive");
  return note;
}
