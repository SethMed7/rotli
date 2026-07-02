// One row in a note LIST (All notes · Recent) — glyph + title + snippet + date,
// the whole row a button that opens the note/board/file. Extracted (Seth,
// 2026-06-30) so the two list surfaces share the exact same markup.

import type { MouseEvent, ReactNode } from "react";
import type { NoteSummary } from "../types";
import { longDateLabel } from "../lib/dateLabels";
import { glyphForNote } from "./glyphs";

export function NoteListRow({
  note,
  snippetNode,
  onOpen,
  onContextMenu,
}: {
  note: NoteSummary;
  /** Replaces the plain snippet — a full-text search row passes the framed
   * match snippet with its <mark> (MatchText). Plain lists omit it. */
  snippetNode?: ReactNode | undefined;
  onOpen: (note: NoteSummary, newTab: boolean) => void;
  onContextMenu?: (e: MouseEvent, note: NoteSummary) => void;
}) {
  const board = note.kind === "board";
  const file = note.kind === "file";
  return (
    <li>
      <button
        type="button"
        className="recent-row"
        onClick={(e) => onOpen(note, e.metaKey)}
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
        <span className="rr-title">
          {note.title || (board ? "Untitled board" : "Empty note")}
        </span>
        {snippetNode ? (
          <span className="rr-snippet">{snippetNode}</span>
        ) : (
          note.snippet && <span className="rr-snippet">{note.snippet}</span>
        )}
        <span className="rr-date">{longDateLabel(note.updatedAt)}</span>
      </button>
    </li>
  );
}
