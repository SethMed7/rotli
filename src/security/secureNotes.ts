/**
 * Product-level secure-note vocabulary. Rust's corpus is the enforcement
 * authority; creation and UI surfaces share these names and defaults.
 */
import type { NoteCreator } from "../lib/aiEditPolicy";

export const SECURE_NOTES_FOLDER = "Secure notes";
/** Physical protected lane inside a memex Brain. Underscore keeps it out of the
 * organizer's normal area vocabulary; the sidebar exposes it deliberately. */
export const SECURE_BRAIN_FOLDER = "wiki/_secure";

export interface NoteCreationPolicy {
  /** Secure notes are gitignored and categorically unavailable to remote AI. */
  secure?: boolean;
  /** Which AI made the note (`created_by`); absent for a person, whose notes
   * no AI may rewrite without a grant (src/lib/aiEditPolicy.ts). */
  createdBy?: NoteCreator;
}

export function isSecureNotesFolder(folderId: string): boolean {
  return folderId === SECURE_NOTES_FOLDER || folderId.startsWith(`${SECURE_NOTES_FOLDER}/`);
}

export function isSecureBrainFolder(folderId: string): boolean {
  return folderId === SECURE_BRAIN_FOLDER || folderId.startsWith(`${SECURE_BRAIN_FOLDER}/`);
}

/** Filed in a secure folder by either of its folders (the shelf it shows on,
 * or the folder it sits in on disk) — secure whatever its frontmatter says. */
export function inSecureFolder(note: { folderId: string; diskFolderId?: string | undefined }): boolean {
  return [note.folderId, note.diskFolderId ?? note.folderId].some(
    (folder) => isSecureNotesFolder(folder) || isSecureBrainFolder(folder),
  );
}

export function creationIsSecure(folderId: string, policy?: NoteCreationPolicy): boolean {
  return policy?.secure === true || isSecureNotesFolder(folderId);
}
