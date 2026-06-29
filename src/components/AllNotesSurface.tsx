// All notes (Seth, 2026-06-24): a searchable grid of every note, rendered in the
// content area while the sidebar stays put — the same shape as the Board, but
// read-through. Click a card to open the note (which returns the content area to
// the panes). Search narrows by title + snippet. Reuses the board card grammar.

import { useMemo, useState } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { corpusOpenFile } from "../lib/tauri";
import { SearchGlyph, glyphForNote } from "./glyphs";

/** Relative day label (mirrors the Board's). */
function dayLabel(ts: number): string {
  const date = new Date(ts);
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AllNotesSurface() {
  // useNotes() (no folder) is the All-notes list — already excludes the hidden
  // roots (Archive / Trash / Board). It now also carries boards (kind:"board"),
  // so a card opens by kind: notes in the editor, boards in the canvas.
  const notes = useNotes().data ?? [];
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      notes.filter(
        (n) => !q || n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
      ),
    [notes, q],
  );

  return (
    <div className="board allnotes">
      <header className="board-head">
        <h2 className="board-title">All notes</h2>
        <span className="board-count">{notes.length}</span>
        <div className="cv-search">
          <SearchGlyph size={14} />
          <input
            type="text"
            value={query}
            placeholder="Search all notes…"
            aria-label="Search all notes"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </header>

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
          <div className="board-grid">
            {results.map((n) => {
              const board = n.kind === "board";
              const file = n.kind === "file";
              return (
                <button
                  type="button"
                  key={n.id}
                  className="board-card"
                  onClick={() =>
                    board ? openCanvas(n.id) : file ? void corpusOpenFile(n.id) : openNote(n.id)
                  }
                  title={board ? "Open board" : file ? "Open file" : "Open note"}
                >
                  <span className="bc-body">
                    <span className="bc-title">
                      {glyphForNote(n, { size: 13, className: "bc-icon" })}
                      {n.title || (board ? "Untitled board" : "Empty note")}
                    </span>
                    {n.snippet && <span className="bc-snippet">{n.snippet}</span>}
                  </span>
                  <span className="bc-date">{dayLabel(n.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
