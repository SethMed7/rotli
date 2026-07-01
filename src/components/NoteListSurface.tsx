// The dated note LIST in the content area — ONE component behind both "All
// notes" (searchable) and "Recent" (plain recency), which had grown as twins
// (2026-07-01 consolidation). Every note ordered by most-recently touched,
// title + snippet left, date right; click a row to open it. Binary files are
// excluded — they live under Storage. The sidebar never moves.

import { type ReactNode, useMemo, useState } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { SearchGlyph } from "./glyphs";
import { NoteListRow } from "./NoteListRow";
import { useNoteMenu } from "./useNoteMenu";

export function NoteListSurface({
  title,
  glyph,
  searchable = false,
  searchPlaceholder = "Search…",
}: {
  title: string;
  /** An optional header glyph (Recent shows the clock; All notes goes bare). */
  glyph?: ReactNode;
  /** Adds the full-width title/snippet search on top (All notes). */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  // useNotes() (no folder) excludes the hidden roots (Archive / Trash / Board).
  // It carries boards (kind:"board"); binary FILES live under Storage.
  const notes = (useNotes().data ?? []).filter((n) => n.kind !== "file");
  const openSummary = usePanesStore((s) => s.openSummary);
  const openMenu = useNoteMenu();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      notes
        .filter((n) => !q || n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [notes, q],
  );

  return (
    <div className="board allnotes">
      <header className="board-head">
        {glyph}
        <h2 className="board-title">{title}</h2>
        <span className="board-count">{notes.length}</span>
      </header>

      {searchable && (
        <div className="allnotes-search">
          <SearchGlyph size={15} />
          <input
            type="text"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {rows.length === 0 ? (
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
            {rows.map((n) => (
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
