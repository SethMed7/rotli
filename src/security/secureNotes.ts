/**
 * Product-level secure-note vocabulary. Rust's corpus is the enforcement
 * authority; creation and UI surfaces share these names and defaults.
 */
export const SECURE_NOTES_FOLDER = "Secure notes";
/** Physical protected lane inside a memex Brain. Underscore keeps it out of the
 * organizer's normal area vocabulary; the sidebar exposes it deliberately. */
export const SECURE_BRAIN_FOLDER = "wiki/_secure";

export interface NoteCreationPolicy {
  /** Secure notes are gitignored and categorically unavailable to remote AI. */
  secure?: boolean;
}

export function isSecureNotesFolder(folderId: string): boolean {
  return folderId === SECURE_NOTES_FOLDER || folderId.startsWith(`${SECURE_NOTES_FOLDER}/`);
}

export function isSecureBrainFolder(folderId: string): boolean {
  return folderId === SECURE_BRAIN_FOLDER || folderId.startsWith(`${SECURE_BRAIN_FOLDER}/`);
}

export function creationIsSecure(folderId: string, policy?: NoteCreationPolicy): boolean {
  return policy?.secure === true || isSecureNotesFolder(folderId);
}
