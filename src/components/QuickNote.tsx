// Quick Note — the floating, Raycast-style note window (Seth, 2026-06-15).
// A third webview (?window=quick), summoned by its own global chord (⌥Q),
// hidden on blur. It reuses the EXACT main editor + format bar, but over a tiny
// curated set: up to QUICK_MAX notes you cycle with ‹ ›, a "+" that makes a new
// one in the quick folder, and ⌘K search to swap any note into the set. The set
// + the remembered note live in the ui store (state/quick.ts), synced to the
// main window which persists them. Renders standalone in a plain browser
// (localhost:1420/?window=quick) for review, like the capture card.

import { type KeyboardEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { EditorSurface } from "../editor/EditorSurface";
import { useTransientPopover } from "../lib/popover";
import { setQuickHandle } from "../lib/quickHandle";
import { onQuickShow, startWindowDrag } from "../lib/tauri";
import { invalidateNotes, useNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import { usePanesStore } from "../state/panes";
import { QUICK_MAX, addQuickNote, cycleQuick, pruneQuick, removeQuickNote } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { IconButton } from "./IconButton";
import { FileGlyph, PlusGlyph, SearchGlyph } from "./glyphs";

/** activeEditor() resolves through the panes store's focusedPaneId; the quick
 * webview has no pane tree, so we pin it to this id and register the editor
 * under it — that keeps ⌘B / headings / lists working here. */
const QUICK_PANE_ID = "quick";

/** Manual drag (never data-tauri-drag-region) so double-click can't zoom — the
 * same rule the main Titlebar follows. */
function onDragRegionMouseDown(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

/** Forgiving subsequence match — instant, no scoring (mirrors the palette). */
function fuzzy(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i >= q.length) return true;
  }
  return q.length === 0;
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

/** Search every note and pick one INTO the set (add when there's room, else
 * swap the chosen note into the active slot — see addQuickNote). */
function QuickSearch({
  notes,
  inSet,
  onPick,
  onClose,
}: {
  notes: NoteSummary[];
  inSet: Set<string>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  // register in the transient stack so quick.dismiss (Esc) closes the overlay
  // before the window, and an outside click closes it
  useTransientPopover([panelRef], true, onClose);

  const results = useMemo(() => {
    const q = query.trim();
    return notes.filter((n) => fuzzy(q, n.title) || fuzzy(q, n.snippet)).slice(0, 30);
  }, [notes, query]);
  const sel = Math.min(index, Math.max(0, results.length - 1));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const note = results[sel];
      if (note) onPick(note.id);
    }
    // Esc falls through to the quick.dismiss action (the transient stack)
  };

  return (
    <div className="qsearch" ref={panelRef} role="dialog" aria-label="Search notes to pin">
      <div className="qsearch-in">
        <SearchGlyph size={15} />
        <input
          autoFocus
          type="text"
          value={query}
          placeholder="Search notes to pin here…"
          aria-label="Search notes to pin"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="qsearch-list">
        {results.map((n, i) => (
          <button
            type="button"
            key={n.id}
            className={i === sel ? "qsrow sel" : "qsrow"}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onPick(n.id)}
          >
            <FileGlyph size={14} />
            <span className="qslabel">{n.title || "Untitled"}</span>
            {inSet.has(n.id) && <span className="qstag">in set</span>}
          </button>
        ))}
        {results.length === 0 && <div className="qsempty">No notes match.</div>}
      </div>
    </div>
  );
}

export function QuickNote() {
  const ids = useUiStore((s) => s.quickNoteIds);
  const activeId = useUiStore((s) => s.quickActiveId);
  const notesQuery = useNotes();
  const notes = useMemo(() => notesQuery.data ?? [], [notesQuery.data]);
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const [searchOpen, setSearchOpen] = useState(false);

  // point activeEditor() at the one editor this webview mounts
  useEffect(() => {
    usePanesStore.setState({ focusedPaneId: QUICK_PANE_ID });
  }, []);

  // self-heal: drop ids whose notes were deleted, once the corpus list resolves
  useEffect(() => {
    if (notesQuery.isSuccess) pruneQuick(new Set(notes.map((n) => n.id)));
  }, [notesQuery.isSuccess, notes]);

  const newNote = () => {
    const folder = useUiStore.getState().quickFolder;
    void notesService.createNote(folder, "").then(async (note) => {
      await invalidateNotes();
      addQuickNote(note.id);
      setSearchOpen(false);
    });
  };
  const openSearch = () => setSearchOpen(true);

  // route the quick.new / quick.search chords to this live component (no deps —
  // re-register each render so the closures stay fresh, like the capture card)
  useEffect(() => {
    setQuickHandle({ newNote, openSearch });
    return () => setQuickHandle(null);
  });

  // re-summoned: a fresh card never opens mid-search
  useEffect(() => onQuickShow(() => setSearchOpen(false)), []);

  const pos = activeId ? ids.indexOf(activeId) : -1;
  const activeTitle = (activeId && byId.get(activeId)?.title) || "Untitled";

  return (
    <div className="quick-window">
      <header className="quick-head">
        <div className="quick-inset" onMouseDown={onDragRegionMouseDown} />
        <span className="quick-title" onMouseDown={onDragRegionMouseDown}>
          Quick note
        </span>
        <div className="quick-actions">
          <IconButton label="Search & swap — ⌘K" onClick={openSearch}>
            <SearchGlyph size={15} />
          </IconButton>
          <IconButton label="New quick note — ⌘N" onClick={newNote}>
            <PlusGlyph size={15} />
          </IconButton>
        </div>
      </header>

      {ids.length > 0 && activeId ? (
        <>
          <div className="quick-switch">
            <button
              type="button"
              className="qsw-arrow"
              aria-label="Previous quick note"
              disabled={ids.length < 2}
              onClick={() => cycleQuick(-1)}
            >
              <Chevron dir="left" />
            </button>
            <span className="qsw-name" title={activeTitle}>
              {activeTitle}
            </span>
            <span className="qsw-count">
              {pos >= 0 ? pos + 1 : 1}/{ids.length}
            </span>
            <button
              type="button"
              className="qsw-arrow"
              aria-label="Next quick note"
              disabled={ids.length < 2}
              onClick={() => cycleQuick(1)}
            >
              <Chevron dir="right" />
            </button>
            <span className="qsw-grow" />
            <button
              type="button"
              className="qsw-x"
              aria-label="Remove from quick set"
              onClick={() => removeQuickNote(activeId)}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          {/* key forces a clean remount per note — fresh caret/scroll on switch */}
          <EditorSurface key={activeId} noteId={activeId} paneId={QUICK_PANE_ID} />
        </>
      ) : (
        <div className="quick-empty">
          <p className="qe-title">No quick notes yet</p>
          <p className="qe-sub">Pin up to {QUICK_MAX} notes here for instant access.</p>
          <div className="qe-actions">
            <button type="button" className="btn" onClick={newNote}>
              <PlusGlyph size={14} /> New note
            </button>
            <button type="button" className="qe-ghost" onClick={openSearch}>
              Search existing…
            </button>
          </div>
        </div>
      )}

      {searchOpen && (
        <QuickSearch
          notes={notes}
          inSet={new Set(ids)}
          onPick={(id) => {
            addQuickNote(id);
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </div>
  );
}
