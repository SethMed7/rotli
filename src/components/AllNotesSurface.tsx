// All notes (Seth, 2026-06-30): a searchable LIST of every note (not a card grid)
// — title + snippet on the left, date on the right, a full-width search at the top.
// Binary files are excluded (they live under Storage). Click a row to open it.

import { useMemo, useState } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { SearchGlyph } from "./glyphs";
import { NoteListRow } from "./NoteListRow";
import { useNoteMenu } from "./useNoteMenu";

export function AllNotesSurface() {
  // useNotes() (no folder) excludes the hidden roots (Archive / Trash / Board). It
  // carries boards (kind:"board"); we drop binary FILES — those live under Storage.
  const notes = (useNotes().data ?? []).filter((n) => n.kind !== "file");
  const openSummary = usePanesStore((s) => s.openSummary);
  const openMenu = useNoteMenu();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      notes
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [notes, q],
  );

  return (
    <div className="board allnotes">
      <header className="board-head">
        <h2 className="board-title">All notes</h2>
        <span className="board-count">{notes.length}</span>
      </header>

      <div className="allnotes-search">
        <SearchGlyph size={15} />
        <input
          type="text"
          value={query}
          placeholder="Search all notes…"
          aria-label="Search all notes"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {results.length === 0 ? (
        <div className="board-empty">
          <p className="be-title">{notes.length === 0 ? "No notes yet" : "No matches"}</p>
          <p className="be-sub">
            {notes.length === 0
              ? "Press ⌘N, or your Quick capture shortcut (⌥C), to start one."
              : "Try a different search."}
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          <ul className="recent-list">
            {results.map((n) => (
              <NoteListRow
                key={n.id}
                note={n}
                onOpen={(note, newTab) => openSummary(note, { newTab })}
                onContextMenu={openMenu}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
