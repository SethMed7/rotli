// Owned metadata on a hand-written fenced note, matching the Rust corpus
// write_resolved / relocate paths. The browser has mtime but no birth time.
import {
  composeNoteDocument,
  emptyFrontmatter,
  type NoteFrontmatter,
  parseNoteDocument,
} from "../lib/frontmatter";
import { composeInPlace } from "../lib/frontmatterInPlace";
import { stampToMs, today, ulid } from "../memex/contract";

export function ownedNoteFacts(
  fm: NoteFrontmatter,
  fileModified: number,
  bodySave: boolean,
): NoteFrontmatter {
  const fileStamp = new Date(fileModified).toISOString().replace(/\.000Z$/, "Z");
  return {
    ...fm,
    id: fm.id || ulid(),
    created: stampToMs(fm.created) === null ? fileStamp : fm.created,
    updated: bodySave ? today() : stampToMs(fm.updated) === null ? fileStamp : fm.updated,
  };
}

/** The text a body save writes. A person's note in a folder opened in place
 * (`asWritten`, decision B 2026-10-13) keeps its frontmatter bytes and gets
 * only the new words; a fenceless note stays fenceless; any other fenced note
 * gets its owned facts. */
export function savedNoteText(
  original: string,
  currentBody: string,
  frontmatter: NoteFrontmatter | null,
  body: string,
  modified: number | undefined,
  asWritten: boolean,
): string {
  // a --- block at the top of a fenceless note's new text would turn into
  // metadata, `ai_edit: true` and all (review 2026-11-20). In place, where
  // Rotli adds no metadata of its own, that save is refused; in a Rotli vault
  // the note gains its own block, so the pasted one stays body text (as on
  // the Mac).
  const pastedBlock = !frontmatter && parseNoteDocument(body).frontmatter !== null;
  if (asWritten) {
    if (pastedBlock)
      throw new Error(
        "This note has no metadata block, so a --- block at its top would become its metadata. Add a line above it, or add metadata from Show file metadata.",
      );
    return `${original.slice(0, original.length - currentBody.length)}${body}`;
  }
  if (pastedBlock)
    return composeNoteDocument(ownedNoteFacts(emptyFrontmatter(), modified ?? Date.now(), true), body);
  return frontmatter ? composeNoteDocument(ownedNoteFacts(frontmatter, modified!, true), body) : body;
}

/** The text a move writes before relocating, or `null` when the bytes stay.
 * In place, only the changed lines (the origin breadcrumb, a shelf); elsewhere
 * a note with complete metadata keeps its hand-authored bytes on a plain wiki
 * move, and missing managed facts are stamped before the relocation. */
export function movedNoteText(
  original: string,
  frontmatter: NoteFrontmatter,
  next: NoteFrontmatter,
  body: string,
  asWritten: boolean,
): string | null {
  if (asWritten) {
    const text = composeInPlace(original, next);
    return text === original ? null : text;
  }
  const changed =
    next.id !== frontmatter.id ||
    next.created !== frontmatter.created ||
    next.updated !== frontmatter.updated ||
    next.origin !== frontmatter.origin ||
    next.foreign !== frontmatter.foreign;
  return changed ? composeNoteDocument(next, body) : null;
}
