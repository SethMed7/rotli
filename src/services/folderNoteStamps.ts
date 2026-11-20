// Owned metadata on a hand-written fenced note, matching the Rust corpus
// write_resolved / relocate paths. The browser has mtime but no birth time.
import {
  composeNoteDocument,
  emptyFrontmatter,
  type NoteFrontmatter,
  parseNoteDocument,
} from "../lib/frontmatter";
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
 * only the new words; a fenceless note stays fenceless unless its new text
 * would itself read as metadata, which then stays body under Rotli's own
 * facts, as on the Mac (corpus.rs `write_resolved`); any other fenced note
 * gets its owned facts. Every path ends in the one guarded return. */
export function savedNoteText(
  original: string,
  currentBody: string,
  frontmatter: NoteFrontmatter | null,
  body: string,
  modified: number | undefined,
  asWritten: boolean,
): string {
  let saved: string;
  if (asWritten) {
    saved = `${original.slice(0, original.length - currentBody.length)}${body}`;
    keepsItsMetadata(original, saved);
  } else if (frontmatter) saved = composeNoteDocument(ownedNoteFacts(frontmatter, modified!, true), body);
  else if (parseNoteDocument(body).frontmatter)
    saved = composeNoteDocument(ownedNoteFacts(emptyFrontmatter(), modified!, true), `\n${body}`);
  else saved = body;
  return guardFrontmatterWrite(original, saved);
}

/** In a folder opened in place a note without metadata keeps none: text that
 * would become its metadata (a pasted `---` block) is refused, in the words
 * frontmatter_writes.rs `keeps_its_metadata` uses. */
export function keepsItsMetadata(original: string, saved: string): void {
  if (!parseNoteDocument(original).frontmatter && parseNoteDocument(saved).frontmatter)
    throw new Error(
      "This text starts with a metadata block (--- … ---), which would become the note's metadata in this folder. Add a line above it, or change the note's settings from its menu.",
    );
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
    const text = guardFrontmatterWrite(original, composeInPlace(original, next));
    return text === original ? null : text;
  }
  const changed =
    next.id !== frontmatter.id ||
    next.created !== frontmatter.created ||
    next.updated !== frontmatter.updated ||
    next.origin !== frontmatter.origin ||
    next.foreign !== frontmatter.foreign;
  if (!changed) return null;
  return guardFrontmatterWrite(original, composeNoteDocument(next, body));
}

/** The text with a note's `origin` breadcrumb cleared (a note leaving Trash
 * or Archive): only that line in place, a recomposed document elsewhere. */
export function originClearedText(
  original: string,
  frontmatter: NoteFrontmatter,
  body: string,
  asWritten: boolean,
): string {
  return guardFrontmatterWrite(
    original,
    asWritten
      ? withTopLevelLine(original, "origin", null)
      : composeNoteDocument({ ...frontmatter, origin: null }, body),
  );
}
