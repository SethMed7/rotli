// The note list (r2 dedup: filter ON TOP, no header row). WINDOW-LEVEL
// SINGULAR: its selected row mirrors the focused pane's active tab; plain
// click REPLACES that tab's note, ⌘-click opens a new tab (the only list
// gesture that creates one). Pinned notes first; selected row = peach tint
// + the 3px clay bar (the pane's one clay element).

import { type MouseEvent, useMemo, useState } from "react";
import { useNotes } from "../services/hooks";
import { useFocusedNoteId, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import type { Folder, NoteSummary } from "../types";
import { useFolders } from "../services/hooks";
import { PencilGlyph, PinGlyph, SearchGlyph } from "./glyphs";
import { dispatch } from "../keys/registry";

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function NoteRow({
  note,
  folderName,
  selected,
  onOpen,
}: {
  note: NoteSummary;
  folderName: string;
  selected: boolean;
  onOpen: (newTab: boolean) => void;
}) {
  const onClick = (event: MouseEvent) => onOpen(event.metaKey);
  return (
    <button type="button" className={selected ? "nrow sel" : "nrow"} onClick={onClick}>
      <span className="nt">{note.title}</span>
      <span className="ns">{note.snippet || "Empty note"}</span>
      <span className="nd">
        {note.pinned && (
          <>
            <PinGlyph size={11} className="pin" />
            Pinned ·{" "}
          </>
        )}
        {dayLabel(note.updatedAt)} · {folderName}
      </span>
    </button>
  );
}

export function NoteList() {
  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const isSmart = selectedFolderId === ALL_NOTES || selectedFolderId === RECENT;
  const notesQuery = useNotes(isSmart ? undefined : selectedFolderId);
  const folders = useFolders().data ?? [];
  const focusedNoteId = useFocusedNoteId();
  const openNote = usePanesStore((s) => s.openNote);
  const [filter, setFilter] = useState("");

  const folderName = useMemo(() => {
    const byId = new Map<string, Folder>(folders.map((f) => [f.id, f]));
    return (id: string) => byId.get(id)?.name ?? "";
  }, [folders]);

  const notes = useMemo(() => {
    let list = notesQuery.data ?? [];
    if (selectedFolderId === RECENT) {
      list = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 9);
    }
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || n.snippet.toLowerCase().includes(q),
      );
    }
    return list;
  }, [notesQuery.data, selectedFolderId, filter]);

  return (
    <section className="notelist" aria-label="Notes">
      <div className="nl-top">
        <div className="filter">
          <SearchGlyph size={13} />
          <input
            type="text"
            placeholder="Filter notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter notes"
          />
        </div>
        <button
          type="button"
          className="icobtn"
          aria-label="New note — ⌘N"
          onClick={() => dispatch("notes.new")}
        >
          <PencilGlyph size={15} />
          <span className="tip" aria-hidden="true">
            New note — ⌘N
          </span>
        </button>
      </div>
      <div className="nl-rows">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            folderName={folderName(note.folderId)}
            selected={note.id === focusedNoteId}
            onOpen={(newTab) => openNote(note.id, { newTab })}
          />
        ))}
      </div>
    </section>
  );
}
