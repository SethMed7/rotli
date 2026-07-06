// The dated note LIST in the content area — ONE component behind both "All
// notes" (searchable) and "Recent" (plain recency), which had grown as twins
// (2026-07-01 consolidation). Every note ordered by most-recently touched,
// title + snippet left, date right; click a row to open it. The list reads the
// SEARCHABLE universe (staged + Brain + Vault + added roots) — notes and
// boards, never binary files (they live under Storage) and never chats/
// transcripts (All chats owns those). Typing searches FULL TEXT through
// corpus_search (title > body rank, highlighted-match snippet, debounced); the
// instant title/snippet filter covers the debounce window and boards.

import { type ReactNode, useMemo, useState } from "react";
import { useNoteSearch, useSearchableNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import type { NoteSummary, SearchHit } from "../types";
import { Character } from "./Character";
import { SearchGlyph } from "./glyphs";
import { MatchText } from "./MatchText";
import { NoteListRow } from "./NoteListRow";
import { useNoteMenu } from "./useNoteMenu";

interface ListRow {
  note: NoteSummary;
  /** Present on a full-text BODY hit — the framed snippet + match offsets. */
  hit?: SearchHit | undefined;
}

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
  const { notes } = useSearchableNotes();
  const openSummary = usePanesStore((s) => s.openSummary);
  const openMenu = useNoteMenu();
  const [query, setQuery] = useState("");
  // full-text hits (debounced, min 2 chars) — gated on the LIVE query so a
  // keepPreviousData placeholder never rides under a shorter/cleared box
  const searchData = useNoteSearch(query).data;
  const hits = query.trim().length >= 2 ? searchData : undefined;

  const q = query.trim().toLowerCase();
  const rows = useMemo<ListRow[]>(() => {
    // pinned notes float to the top (Seth, 2026-07-06), then most-recent first
    const sorted = [...notes].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    );
    if (!q) return sorted.map((note) => ({ note }));
    const local = sorted.filter(
      (n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
    );
    if (!hits) return local.map((note) => ({ note }));
    // hits first (title rank, then recency — Rust's order), then the instant
    // local matches search missed (boards; a hit outside this list's scope
    // still opens fine — Archive is findable by search, browsed via its row)
    const byId = new Map(notes.map((n) => [n.id, n]));
    const seen = new Set(hits.map((h) => h.id));
    return [
      ...hits.map((h) => ({
        note:
          byId.get(h.id) ??
          ({
            id: h.id,
            title: h.title,
            snippet: h.snippet,
            folderId: h.folderId,
            createdAt: 0,
            updatedAt: h.updatedAt,
            pinned: false,
            kind: h.kind,
          } satisfies NoteSummary),
        hit: h.rank === 1 ? h : undefined,
      })),
      ...local.filter((n) => !seen.has(n.id)).map((note) => ({ note })),
    ];
  }, [notes, q, hits]);

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
          {notes.length === 0 && <Character name="notes" size={104} className="be-quokka" />}
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
            {rows.map((r) => (
              <NoteListRow
                key={r.note.id}
                note={r.note}
                snippetNode={
                  r.hit ? (
                    <MatchText text={r.hit.snippet} start={r.hit.matchStart} len={r.hit.matchLen} />
                  ) : undefined
                }
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
