// Picker sub-mode for slash ops that need a note/board/sheet target before insert.

import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import {
  corpusManagedFileCreationAvailable,
  isTauri,
} from "../lib/tauri";
import { extOf, fileName } from "../lib/fileKind";
import { useNotes, useSearchableNotes } from "../services/hooks";
import { DEST } from "../services/destinations";
import { inboxFolderId } from "../services/notes";
import { SHEET_EDITABLE } from "../sheets/kinds";
import { DOCUMENT_EXTS } from "../documents/kinds";
import type { NoteSummary } from "../types";
import { PlusGlyph, glyphForNote } from "../components/glyphs";
import { createManagedItem } from "../newItems/composition";
import type { SlashPickerMode } from "./slashMenu";

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

function filterNotes(notes: NoteSummary[], mode: SlashPickerMode, query: string): NoteSummary[] {
  const q = query.trim();
  let pool = notes;
  if (mode === "embedBoard") pool = notes.filter((n) => n.kind === "board");
  else if (mode === "embedSheet")
    pool = notes.filter((n) => n.kind === "file" && SHEET_EDITABLE.has(extOf(fileName(n.id))));
  else if (mode === "embedDocument")
    pool = notes.filter((n) => n.kind === "file" && DOCUMENT_EXTS.has(extOf(fileName(n.id))));
  return pool.filter((n) => fuzzy(q, n.title) || fuzzy(q, n.id));
}

async function createEmbeddedItem(mode: SlashPickerMode): Promise<string | null> {
  if (!isTauri() || mode === "linkNote") return null;
  const kind = mode === "embedBoard" ? "board" : mode === "embedSheet" ? "sheet" : "document";
  const item = await createManagedItem(kind, { open: false });
  return item.id || null;
}

const MODE_LABEL: Record<SlashPickerMode, string> = {
  linkNote: "Link note",
  embedBoard: "Board",
  embedSheet: "Sheet",
  embedDocument: "Document",
};

export function slashPickerCanCreate(
  mode: SlashPickerMode,
  tauri = isTauri(),
  writable = true,
): boolean {
  return tauri && writable && (mode === "embedBoard" || mode === "embedSheet" || mode === "embedDocument");
}

export function SlashPicker({
  mode,
  selectedIndex,
  onHover,
  onPick,
  onClose,
}: {
  mode: SlashPickerMode;
  selectedIndex: number;
  onHover(index: number): void;
  onPick(note: NoteSummary): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [creationAvailable, setCreationAvailable] = useState<boolean | null>(null);
  const [createError, setCreateError] = useState("");
  const searchable = useSearchableNotes();
  const storage = useNotes(DEST.storage);
  const usesStorage = mode === "embedSheet" || mode === "embedDocument";
  const notes = usesStorage ? storage.data ?? [] : searchable.notes;
  const ready = usesStorage ? storage.isSuccess : searchable.ready;
  const items = useMemo(() => filterNotes(notes, mode, query), [notes, mode, query]);
  useEffect(() => {
    let cancelled = false;
    if (mode === "linkNote" || !isTauri()) return;
    void corpusManagedFileCreationAvailable()
      .then((available) => {
        if (!cancelled) setCreationAvailable(available);
      })
      .catch(() => {
        if (!cancelled) setCreationAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);
  const supportsCreate = isTauri() && mode !== "linkNote";
  const canCreate = slashPickerCanCreate(mode, isTauri(), creationAvailable === true);
  const rows = canCreate ? items.length + 1 : items.length;
  const createSelected = canCreate && selectedIndex === items.length;

  const runCreate = async () => {
    setCreateError("");
    try {
      const id = await createEmbeddedItem(mode);
      if (!id) return;
      onPick({
        id,
        title: fileName(id),
        snippet: "",
        folderId: mode === "embedBoard" ? inboxFolderId : "Storage",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
        kind: mode === "embedBoard" ? "board" : "file",
      });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create this file");
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (rows === 0 && e.key !== "Escape") return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows) onHover((selectedIndex + 1) % rows);
        return;
      case "ArrowUp":
        e.preventDefault();
        if (rows) onHover((selectedIndex - 1 + rows) % rows);
        return;
      case "Enter": {
        e.preventDefault();
        if (createSelected) void runCreate();
        else {
          const hit = items[selectedIndex];
          if (hit) onPick(hit);
        }
        return;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
    }
  };

  return (
    <div className="slashmenu slashpicker" role="menu" aria-label={MODE_LABEL[mode]}>
      <input
        className="slashpicker-input"
        type="search"
        placeholder={`Search ${MODE_LABEL[mode].toLowerCase()}…`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onHover(0);
        }}
        onKeyDown={onInputKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        autoFocus
      />
      {!ready && <div className="slashpicker-empty">Loading…</div>}
      {ready && rows === 0 && (
        <div className="slashpicker-empty">
          {mode === "embedDocument" ? "No documents in Storage yet" : "No matches"}
        </div>
      )}
      {createError && <div className="slashpicker-empty is-error">{createError}</div>}
      {items.map((note, i) => (
        <button
          key={note.id}
          type="button"
          className={i === selectedIndex ? "slashrow sel" : "slashrow"}
          role="menuitem"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(note)}
        >
          <span className="slashglyph">{glyphForNote(note)}</span>
          <span className="slashlabel">{note.title}</span>
          <span className="slashhint">{fileName(note.id)}</span>
        </button>
      ))}
      {supportsCreate && (
        <button
          type="button"
          className={createSelected ? "slashrow sel" : "slashrow"}
          role="menuitem"
          disabled={!canCreate}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => {
            if (canCreate) onHover(items.length);
          }}
          onClick={() => void runCreate()}
        >
          <span className="slashglyph">
            <PlusGlyph size={15} />
          </span>
          <span className="slashlabel">Create new</span>
          <span className="slashhint">
            {canCreate
              ? `New ${MODE_LABEL[mode].toLowerCase()}`
              : creationAvailable === null
                ? "Checking permissions…"
                : "Read-only in development"}
          </span>
        </button>
      )}
    </div>
  );
}

export { filterNotes as filterPickerNotes };
