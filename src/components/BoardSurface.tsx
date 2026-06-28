// The Board (Seth, 2026-06-19): quick captures collected as cards, NOT dumped
// into your note list. ⌥C drops a card here (a real .md in Board/, hidden from
// All Notes until merged). Click cards to multi-select, then MERGE the selected
// ones into a single joint note (in Inbox) — the originals are archived
// (recoverable, never hard-deleted), per the never-delete lifecycle. Double-click
// a card to open it on its own. A view in the content area now (the sidebar
// stays); the registry's app.hide (Esc) closes it back to the panes via the
// contentView model (setContentView("panes")).

import { useState } from "react";
import { DEST } from "../services/destinations";
import { invalidateNotes, useNotes } from "../services/hooks";
import { corpusOpenFile } from "../lib/tauri";
import { notesService } from "../services/notes";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { ArchiveGlyph, CheckGlyph, FileGlyph } from "./glyphs";

/** Relative day label for a card's timestamp (mirrors the sidebar's). */
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

export function BoardSurface() {
  const captures = useNotes(DEST.board).data ?? [];
  const setContentView = useUiStore((s) => s.setContentView);
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // only ids still on the board count as selected (a refetch drops archived ones)
  const chosen = captures.filter((c) => selected.has(c.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // open a card by kind — a stray board in the Board root opens its canvas, not
  // a dead note tab. open* returns the content area to the panes on its own.
  const openOne = (c: { id: string; kind?: "note" | "board" | "file" }) =>
    c.kind === "board"
      ? openCanvas(c.id)
      : c.kind === "file"
        ? void corpusOpenFile(c.id)
        : openNote(c.id);

  const back = () => setContentView("panes");

  /** Merge the selected cards into ONE note in Inbox (bodies joined oldest-first
   * with a blank line), then archive the originals — they're consumed, not lost. */
  const merge = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      // board order is newest-first; read oldest-first so the joint note reads
      // in the order the thoughts arrived
      const ordered = [...chosen].reverse();
      const docs = await Promise.all(ordered.map((c) => notesService.getNote(c.id)));
      const body = docs
        .map((d) => d?.body.trim() ?? "")
        .filter((b) => b.length > 0)
        .join("\n\n");
      const note = await notesService.createNote(DEST.inbox, body);
      for (const c of ordered) await notesService.archiveNote(c.id);
      await invalidateNotes();
      setSelected(new Set());
      openNote(note.id); // returns the content area to the panes
    } finally {
      setBusy(false);
    }
  };

  /** Archive the selected cards (recoverable; clears them off the board). */
  const archiveSelected = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    try {
      for (const c of chosen) await notesService.archiveNote(c.id);
      await invalidateNotes();
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="board">
      <header className="board-head">
        <button type="button" className="board-back" onClick={back}>
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Back to notes</span>
        </button>
        <h2 className="board-title">Board</h2>
        <span className="board-count">{captures.length}</span>
      </header>

      {captures.length === 0 ? (
        <div className="board-empty">
          <p className="be-title">Nothing captured yet</p>
          <p className="be-sub">
            Press your Quick capture shortcut (⌥C) from anywhere — each thought lands here as a
            card. Select a few and merge them into one note.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          <div className="board-grid">
            {captures.map((c) => {
              const sel = selected.has(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  className={sel ? "board-card sel" : "board-card"}
                  aria-pressed={sel}
                  onClick={() => toggle(c.id)}
                  onDoubleClick={() => openOne(c)}
                  title="Click to select · double-click to open"
                >
                  <span className="bc-check" aria-hidden="true">
                    {sel && <CheckGlyph size={11} />}
                  </span>
                  <span className="bc-body">
                    <span className="bc-title">
                      <FileGlyph size={13} className="bc-icon" />
                      {c.title || "Empty capture"}
                    </span>
                    {c.snippet && <span className="bc-snippet">{c.snippet}</span>}
                  </span>
                  <span className="bc-date">{dayLabel(c.updatedAt)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {chosen.length > 0 && (
        <div className="board-bar" role="toolbar" aria-label="Selected captures">
          <span className="board-bar-count">
            {chosen.length} selected
          </span>
          <span className="board-bar-grow" />
          <button type="button" className="board-btn" disabled={busy} onClick={archiveSelected}>
            <ArchiveGlyph size={14} />
            Archive
          </button>
          <button type="button" className="board-btn primary" disabled={busy} onClick={merge}>
            {busy ? "Merging…" : chosen.length > 1 ? `Merge ${chosen.length} into a note` : "Make a note"}
          </button>
          <button type="button" className="board-btn ghost" disabled={busy} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
