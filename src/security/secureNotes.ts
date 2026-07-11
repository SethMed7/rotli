/**
 * Product-level secure-note vocabulary. Rust's corpus is the enforcement
 * authority; creation and UI surfaces share these names and defaults.
 */
export const SECURE_NOTES_FOLDER = "Secure notes";

export interface NoteCreationPolicy {
  /** Secure notes are gitignored and categorically unavailable to remote AI. */
  secure?: boolean;
}

export function isSecureNotesFolder(folderId: string): boolean {
  return folderId === SECURE_NOTES_FOLDER || folderId.startsWith(`${SECURE_NOTES_FOLDER}/`);
}

export function creationIsSecure(folderId: string, policy?: NoteCreationPolicy): boolean {
  return policy?.secure === true || isSecureNotesFolder(folderId);
}
