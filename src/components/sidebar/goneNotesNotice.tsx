// A note deleted (purged) while it still had unsaved words (sixth review of
// pull request 267, F3): its save can never land, so Rotli asks once, in
// plain words, beside the hard-link notice: keep the words as a new note
// (protected as the deleted note was), or discard them. Either choice lets
// quit complete; until then quit names the note. No badge, no alarm.

import { useState } from "react";

import { discardGoneNote, keepGoneNote, noteName, useGoneNotes } from "../../editor/model";

export const KEEP_WORDS = "Keep as a new note";
export const DISCARD_WORDS = "Discard";

export function GoneNotesNotice() {
  return (
    <GoneNotesNoticeView ids={useGoneNotes()} name={noteName} keep={keepGoneNote} discard={discardGoneNote} />
  );
}

export function GoneNotesNoticeView({
  ids,
  name,
  keep,
  discard,
}: {
  ids: readonly string[];
  name: (noteId: string) => string;
  keep: (noteId: string) => Promise<void>;
  discard: (noteId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  if (ids.length === 0) return null;
  const keepWords = async (noteId: string) => {
    setBusy(noteId);
    try {
      await keep(noteId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailed((now) => ({ ...now, [noteId]: `Couldn’t keep them: ${message}. The words are still here.` }));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="gone-notice" aria-label="Unsaved words from deleted notes">
      {ids.map((noteId) => (
        <div key={noteId} className="gone-notice-row">
          <p className="gone-notice-text">
            {name(noteId)} was deleted while it had unsaved words. Keep them as a new note in your Inbox, or
            discard them.
          </p>
          <div className="gone-notice-actions">
            <button
              type="button"
              className="gone-notice-action"
              disabled={busy === noteId}
              onClick={() => void keepWords(noteId)}
            >
              {busy === noteId ? "Keeping…" : KEEP_WORDS}
            </button>
            <button
              type="button"
              className="gone-notice-action"
              disabled={busy === noteId}
              onClick={() => discard(noteId)}
            >
              {DISCARD_WORDS}
            </button>
          </div>
          {failed[noteId] && (
            <p className="gone-notice-text" role="alert">
              {failed[noteId]}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
