// Recent (Seth, 2026-06-26): every note ordered by most-recently touched, as a
// dated LIST in the content area (the sidebar never moves) — a quick "what was I
// just in?" view. Click a row to open. Mirrors AllNotesSurface's data source
// (useNotes() already excludes the hidden roots) but sorts by recency and lays
// out as rows with the date on the right.

import { useMemo } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { ClockGlyph } from "./glyphs";
import { NoteListRow } from "./NoteListRow";

export function RecentSurface() {
  // drop binary FILES — Recent is a note list; files live in Storage (Seth, 2026-06-30)
  const notes = (useNotes().data ?? []).filter((n) => n.kind !== "file");
  const openSummary = usePanesStore((s) => s.openSummary);

  const rows = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  return (
    <div className="board recent">
      <header className="board-head">
        <ClockGlyph size={15} />
        <h2 className="board-title">Recent</h2>
        <span className="board-count">{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <div className="board-empty">
          <p className="be-title">No notes yet</p>
          <p className="be-sub">Press ⌘N, or your Quick capture shortcut (⌥C), to start one.</p>
        </div>
      ) : (
        <div className="board-scroll">
          <ul className="recent-list">
            {rows.map((n) => (
              <NoteListRow key={n.id} note={n} onOpen={openSummary} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
