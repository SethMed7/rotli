// One row in a note LIST (All notes · Recent) — glyph + title + snippet + date,
// the whole row a button that opens the note/board/file. Extracted (the maintainer,
// 2026-06-30) so the two list surfaces share the exact same markup.

import { type MouseEvent, type ReactNode, memo } from "react";

import { longDateLabel } from "../lib/dateLabels";
import { startMainAddDrag } from "../lib/mainAddDrag";
import type { NoteSummary } from "../types";
import { glyphForNote, PinGlyph } from "./glyphs";

// memo: list surfaces render hundreds of rows and re-render per search
// keystroke / corpus invalidation — with stable summaries and callbacks the
// unchanged rows skip (perf audit 2026-07-30, finding 12).
export const NoteListRow = memo(NoteListRowImpl);

function NoteListRowImpl({
  note,
  snippetNode,
  selected,
  viewName,
  onOpen,
  onContextMenu,
}: {
  note: NoteSummary;
  /** Replaces the plain snippet — a full-text search row passes the framed
   * match snippet with its <mark> (MatchText). Plain lists omit it. */
  snippetNode?: ReactNode | undefined;
  /** The revealed row ("Show in Library" landed here) — the one active state. */
  selected?: boolean | undefined;
  /** The named view this note is assigned to, if any — All notes stays global
   * (a named view never filters it), so the row says which view owns it. */
  viewName?: string | null | undefined;
  onOpen: (note: NoteSummary, newTab: boolean) => void;
  onContextMenu?: (e: MouseEvent, note: NoteSummary) => void;
}) {
  const board = note.kind === "board";
  const file = note.kind === "file";
  return (
    <li>
      <button
        type="button"
        className={selected ? "recent-row sel" : "recent-row"}
        data-note-id={note.id}
        onClick={(e) => onOpen(note, e.metaKey)}
        onPointerDown={
          // drag a note/board row into Main (a plain click still opens it); files
          // can't be arranged in Main, so they don't drag (the maintainer, 2026-07-07).
          file ? undefined : (e) => startMainAddDrag(e, note.id, note.title || "Empty note")
        }
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onOpen(note, true);
          }
        }}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, note) : undefined}
        title={board ? "Open board" : file ? "Open file" : "Open note"}
      >
        {glyphForNote(note, { size: 14, className: "rr-icon" })}
        <span className="rr-title">{note.title || (board ? "Untitled board" : "Empty note")}</span>
        {snippetNode ? (
          <span className="rr-snippet">{snippetNode}</span>
        ) : (
          note.snippet && <span className="rr-snippet">{note.snippet}</span>
        )}
        {note.pinned && <PinGlyph size={13} className="rr-pin" filled />}
        {viewName && (
          <span className="rr-view" title={`In the ${viewName} view`}>
            {viewName}
          </span>
        )}
        <span className="rr-date">{longDateLabel(note.updatedAt)}</span>
      </button>
    </li>
  );
}
