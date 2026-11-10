// Two calm notices about where unsaved words are, beside the hard-link notice.
// No badge, no alarm.
//
// A note deleted (purged) while it still had unsaved words (sixth review of
// pull request 267): its save can never land. Its words stay in its editor,
// quit names it, and the person chooses: copy the words (to paste wherever
// they like), or discard them. Rotli no longer makes a note of them itself
// (eighth review: handing the editor over to a new note couldn't be shown
// safe in this round).
//
// A conflict copy (eighth review): another app changed a note while it had
// unsaved words, so Rotli kept them as a copy beside it and the note took the
// other app's text. The notice says so, names the copy, and opens it.

import { useEffect, useState } from "react";

import {
  discardGoneNote,
  dismissCopiedAside,
  getDocumentText,
  noteName,
  useCopiedAside,
  useGoneNotes,
} from "../../editor/model";
import { leaves, usePanesStore } from "../../state/panes";
import type { CopiedAside } from "../../state/ui";

export const COPY_WORDS = "Copy the words";
export const DISCARD_WORDS = "Discard";
export const OPEN_COPY = "Open the copy";

async function copyWords(noteId: string): Promise<void> {
  await navigator.clipboard.writeText(getDocumentText(noteId) ?? "");
}

/** Let the words go, and every pane that showed them. */
function discardEverywhere(noteId: string): void {
  discardGoneNote(noteId);
  usePanesStore.getState().closeNoteTabs(noteId);
}

/** Open the copy: that is the person having seen it. */
function openCopy(copyId: string): void {
  usePanesStore.getState().openNote(copyId);
  dismissCopiedAside(copyId);
}

export function GoneNotesNotice() {
  const entries = useCopiedAside();
  // a copy opened any other way (the sidebar, search) counts as seen too
  const shown = usePanesStore((state) =>
    leaves(state.root)
      .flatMap((leaf) => leaf.tabs.map((tab) => (tab.surfaceKind === "note" ? tab.noteId : "")))
      .join("\n"),
  );
  useEffect(() => {
    const open = new Set(shown.split("\n"));
    for (const entry of entries) if (open.has(entry.copyId)) dismissCopiedAside(entry.copyId);
  }, [entries, shown]);
  return (
    <>
      <GoneNotesNoticeView
        ids={useGoneNotes()}
        name={noteName}
        copy={copyWords}
        discard={discardEverywhere}
      />
      <CopiedAsideNoticeView entries={entries} open={openCopy} dismiss={dismissCopiedAside} />
    </>
  );
}

export function GoneNotesNoticeView({
  ids,
  name,
  copy,
  discard,
}: {
  ids: readonly string[];
  name: (noteId: string) => string;
  copy: (noteId: string) => Promise<void>;
  discard: (noteId: string) => void;
}) {
  const [said, setSaid] = useState<Record<string, string>>({});
  if (ids.length === 0) return null;
  const copyNow = async (noteId: string) => {
    try {
      await copy(noteId);
      setSaid((now) => ({ ...now, [noteId]: "Copied. The words are still here until you discard them." }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaid((now) => ({ ...now, [noteId]: `Couldn’t copy them: ${message}. The words are still here.` }));
    }
  };
  return (
    <section className="gone-notice" aria-label="Unsaved words from deleted notes">
      {ids.map((noteId) => (
        <div key={noteId} className="gone-notice-row">
          <p className="gone-notice-text">
            {name(noteId)} was deleted while it had unsaved words. They’re still in its editor: copy them to
            keep them, or discard them.
          </p>
          <div className="gone-notice-actions">
            <button type="button" className="gone-notice-action" onClick={() => void copyNow(noteId)}>
              {COPY_WORDS}
            </button>
            <button type="button" className="gone-notice-action" onClick={() => discard(noteId)}>
              {DISCARD_WORDS}
            </button>
          </div>
          {said[noteId] && (
            <p className="gone-notice-text" role="status">
              {said[noteId]}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

export function CopiedAsideNoticeView({
  entries,
  open,
  dismiss,
}: {
  entries: readonly CopiedAside[];
  open: (copyId: string) => void;
  dismiss: (copyId: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="gone-notice" aria-label="Unsaved words kept as a copy">
      {entries.map((entry) => (
        <div key={entry.copyId} className="gone-notice-row">
          <p className="gone-notice-text">
            Another app changed {entry.noteName} while it had unsaved words. Your words are in{" "}
            {entry.copyName}, beside it.
          </p>
          <div className="gone-notice-actions">
            <button type="button" className="gone-notice-action" onClick={() => open(entry.copyId)}>
              {OPEN_COPY}
            </button>
            <button type="button" className="gone-notice-action" onClick={() => dismiss(entry.copyId)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
