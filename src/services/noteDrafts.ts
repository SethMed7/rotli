// Session registry for newly-created markdown notes — the ephemeral-note
// lifecycle ("a new note is just a view until you write into it", the maintainer
// 2026-07-17). Mirrors the DOCX pristine-draft policy: track on create,
// un-track on the first expressed intent to keep (a keystroke, a frontmatter
// edit), claim for hard-discard only when the final tab closes. In-memory on
// purpose — an app restart must never infer an EXISTING blank note is
// disposable. Rust's corpus_discard_blank is the authoritative backstop: it
// refuses any non-blank body, so edits this registry can't see (organizer,
// agents, external editors) are safe regardless.

import { PristineDocumentDrafts } from "../documents/draftLifecycle";

const drafts = new PristineDocumentDrafts();
const promoteAfterFirstSave = new Map<string, () => void>();

/** A note this session created AND opened — only those can be abandoned-blank. */
export function trackNewNoteDraft(noteId: string, promote?: () => void): void {
  drafts.track(noteId);
  if (promote) promoteAfterFirstSave.set(noteId, promote);
}

/** Any expressed intent to keep: a body keystroke, a pin/secure/frontmatter
 * change. The note stops being disposable forever. */
export function markNoteDraftChanged(noteId: string): void {
  drafts.markChanged(noteId);
}

/** Main is an authored-content projection, not a list of open placeholders.
 * Promote a session-created note only after its body is durably non-empty.
 * The callback is one-shot because every later save belongs to the ordinary
 * note-update lane. */
export function markNoteDraftSaved(noteId: string, body: string): void {
  if (!body.trim()) return;
  const promote = promoteAfterFirstSave.get(noteId);
  if (!promote) return;
  promoteAfterFirstSave.delete(noteId);
  promote();
}

/** Claim closed pristine notes exactly once (duplicate tabs keep them alive). */
export function claimClosedNoteDrafts(
  noteIds: Iterable<string>,
  stillOpenNoteIds: Iterable<string>,
): string[] {
  const claimed = drafts.claimClosed(noteIds, stillOpenNoteIds);
  for (const noteId of claimed) promoteAfterFirstSave.delete(noteId);
  return claimed;
}
