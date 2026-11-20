// Owned metadata on a hand-written fenced note, matching the Rust corpus
// write_resolved / relocate paths. The browser has mtime but no birth time.
import { composeNoteDocument, type NoteFrontmatter } from "../lib/frontmatter";
import { composeInPlace, withTopLevelLine } from "../lib/frontmatterInPlace";
import { guardFrontmatterWrite } from "../lib/frontmatterWrites";
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
  if (asWritten) return `${original.slice(0, original.length - currentBody.length)}${body}`;
  if (!frontmatter) return body;
  const saved = composeNoteDocument(ownedNoteFacts(frontmatter, modified!, true), body);
  guardFrontmatterWrite(original, saved);
  return saved;
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
    guardFrontmatterWrite(original, text);
    return text === original ? null : text;
  }
  const changed =
    next.id !== frontmatter.id ||
    next.created !== frontmatter.created ||
    next.updated !== frontmatter.updated ||
    next.origin !== frontmatter.origin ||
    next.foreign !== frontmatter.foreign;
  if (!changed) return null;
  const moved = composeNoteDocument(next, body);
  guardFrontmatterWrite(original, moved);
  return moved;
}

/** The text with a note's `origin` breadcrumb cleared (a note leaving Trash
 * or Archive): only that line in place, a recomposed document elsewhere. */
export function originClearedText(
  original: string,
  frontmatter: NoteFrontmatter,
  body: string,
  asWritten: boolean,
): string {
  const text = asWritten
    ? withTopLevelLine(original, "origin", null)
    : composeNoteDocument({ ...frontmatter, origin: null }, body);
  guardFrontmatterWrite(original, text);
  return text;
}
