// Picker sub-mode for slash ops that need a note/board/sheet target before insert.

import { type KeyboardEvent, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { corpusCreateBoard, corpusNewFileBytes, isTauri } from "../lib/tauri";
import { extOf, fileName } from "../lib/fileKind";
import { DEST } from "../services/destinations";
import { invalidateNotes, useSearchableNotes } from "../services/hooks";
import { inboxFolderId } from "../services/notes";
import { SHEET_EDITABLE } from "../sheets/kinds";
import type { NoteSummary } from "../types";
import { PlusGlyph, glyphForNote } from "../components/glyphs";
import type { SlashPickerMode } from "./SlashMenu";

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
  return pool.filter((n) => fuzzy(q, n.title) || fuzzy(q, n.id));
}

async function createBoard(): Promise<string | null> {
  if (!isTauri()) return null;
  const meta = await corpusCreateBoard(inboxFolderId);
  await invalidateNotes();
  return meta.id;
}

async function createSheet(): Promise<string | null> {
  if (!isTauri()) return null;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1");
  const buf = await wb.xlsx.writeBuffer();
  const bytes = new Uint8Array(buf as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = btoa(binary);
  const id = await corpusNewFileBytes(DEST.storage, `untitled-${Date.now()}.xlsx`, b64);
  await invalidateNotes();
  return id || null;
}

const MODE_LABEL: Record<SlashPickerMode, string> = {
  linkNote: "Link note",
  embedBoard: "Board",
  embedSheet: "Sheet",
};

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
  const { notes, ready } = useSearchableNotes();
  const items = useMemo(() => filterNotes(notes, mode, query), [notes, mode, query]);
  const canCreate = mode !== "linkNote" && isTauri();
  const rows = canCreate ? items.length + 1 : items.length;
  const createSelected = canCreate && selectedIndex === items.length;

  const runCreate = async () => {
    const id =
      mode === "embedBoard"
        ? await createBoard()
        : mode === "embedSheet"
          ? await createSheet()
          : null;
    if (!id) return;
    onPick({
      id,
      title: fileName(id),
      snippet: "",
      folderId: inboxFolderId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      kind: mode === "embedBoard" ? "board" : "file",
    });
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
      {ready && rows === 0 && <div className="slashpicker-empty">No matches</div>}
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
      {canCreate && (
        <button
          type="button"
          className={createSelected ? "slashrow sel" : "slashrow"}
          role="menuitem"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover(items.length)}
          onClick={() => void runCreate()}
        >
          <span className="slashglyph">
            <PlusGlyph size={15} />
          </span>
          <span className="slashlabel">Create new</span>
          <span className="slashhint">New {MODE_LABEL[mode].toLowerCase()}</span>
        </button>
      )}
    </div>
  );
}

/** Row count for keyboard navigation (includes Create new when shown). */
export function slashPickerRowCount(mode: SlashPickerMode, notes: NoteSummary[], query: string): number {
  const items = filterNotes(notes, mode, query);
  const canCreate = mode !== "linkNote" && isTauri();
  return items.length + (canCreate ? 1 : 0);
}

export function slashPickerNoteAt(
  mode: SlashPickerMode,
  notes: NoteSummary[],
  query: string,
  index: number,
): NoteSummary | "create" | null {
  const items = filterNotes(notes, mode, query);
  const canCreate = mode !== "linkNote" && isTauri();
  if (index < items.length) return items[index] ?? null;
  if (canCreate && index === items.length) return "create";
  return null;
}

export { filterNotes as filterPickerNotes };
