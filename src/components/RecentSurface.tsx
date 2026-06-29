// Recent (Seth, 2026-06-26): every note ordered by most-recently touched, as a
// dated LIST in the content area (the sidebar never moves) — a quick "what was I
// just in?" view. Click a row to open. Mirrors AllNotesSurface's data source
// (useNotes() already excludes the hidden roots) but sorts by recency and lays
// out as rows with the date on the right.

import { useMemo } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { corpusOpenFile } from "../lib/tauri";
import { ClockGlyph, glyphForNote } from "./glyphs";

/** Short, human date for the right column. */
function dateLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecentSurface() {
  const notes = useNotes().data ?? [];
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);

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
            {rows.map((n) => {
              const board = n.kind === "board";
              const file = n.kind === "file";
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className="recent-row"
                    onClick={() =>
                      board ? openCanvas(n.id) : file ? void corpusOpenFile(n.id) : openNote(n.id)
                    }
                    title={board ? "Open board" : file ? "Open file" : "Open note"}
                  >
                    {glyphForNote(n, { size: 14, className: "rr-icon" })}
                    <span className="rr-title">
                      {n.title || (board ? "Untitled board" : "Empty note")}
                    </span>
                    {n.snippet && <span className="rr-snippet">{n.snippet}</span>}
                    <span className="rr-date">{dateLabel(n.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
