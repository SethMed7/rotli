// Picker sub-mode for slash ops that need a note/board/sheet target before insert.

import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PlusGlyph, glyphForNote } from "../components/glyphs";
import { DOCX_EDITABLE } from "../documents/kinds";
import { extOf, fileName } from "../lib/fileKind";
import { subsequenceMatch } from "../lib/fuzzy";
import { fitMenuToWindow, scrollRowIntoList, useTransientPopover } from "../lib/popover";
import { corpusManagedFileCreationAvailable, isTauri } from "../lib/tauri";
import { createManagedItem } from "../newItems/composition";
import { DEST } from "../services/destinations";
import { useChatTranscripts, useNotes, useSearchableNotes } from "../services/hooks";
import { createLinkedNote } from "../services/linkedNotes";
import { inboxFolderId } from "../services/notes";
import { createTemplateNote } from "../services/templateCreate";
import {
  TEMPLATES_FOLDER,
  isPresetTemplate,
  isTemplateNote,
  presetTemplateNotes,
} from "../services/templates";
import { SHEET_EDITABLE } from "../sheets/kinds";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import type { SlashPickerMode } from "./slashMenu";

/** `hostNoteId` is the note being written in: Link note never offers it, as
 * the `[[` picker doesn't — a note does not link to itself. */
function filterNotes(
  notes: NoteSummary[],
  mode: SlashPickerMode,
  query: string,
  hostNoteId?: string,
): NoteSummary[] {
  const q = query.trim();
  let pool = notes;
  // (linkChat is handed the chats themselves — every one of them is a target)
  if (mode === "linkNote" && hostNoteId) pool = notes.filter((n) => n.id !== hostNoteId);
  else if (mode === "insertTemplate") pool = notes.filter(isTemplateNote);
  else if (mode === "continueList") pool = notes.filter((n) => (n.kind ?? "note") === "note");
  else if (mode === "embedBoard") pool = notes.filter((n) => n.kind === "board");
  else if (mode === "embedSheet")
    pool = notes.filter((n) => n.kind === "file" && SHEET_EDITABLE.has(extOf(fileName(n.id))));
  else if (mode === "embedDocument")
    pool = notes.filter((n) => n.kind === "file" && DOCX_EDITABLE.has(extOf(fileName(n.id))));
  return pool.filter((n) => subsequenceMatch(q, n.title) || subsequenceMatch(q, n.id));
}

/** The name a new item made from the picker takes: a board needs one (boards
 * are named before they're created, #92) and takes what's typed in the
 * picker's field; null = type it first. Other kinds name themselves. */
export function embedCreateName(mode: SlashPickerMode, query: string): string | null | undefined {
  if (mode !== "embedBoard") return undefined;
  return query.trim() || null;
}

async function createEmbeddedItem(mode: SlashPickerMode, name?: string): Promise<string | null> {
  if (
    !isTauri() ||
    mode === "linkNote" ||
    mode === "linkChat" ||
    mode === "insertTemplate" ||
    mode === "continueList"
  )
    return null;
  const kind = mode === "embedBoard" ? "board" : mode === "embedSheet" ? "sheet" : "document";
  const item = await createManagedItem(kind, name ? { open: false, name } : { open: false });
  return item.id || null;
}

const MODE_LABEL: Record<SlashPickerMode, string> = {
  linkNote: "Link note",
  linkChat: "Link chat",
  insertTemplate: "Template",
  embedBoard: "Board",
  embedSheet: "Sheet",
  embedDocument: "Document",
  continueList: "Project list",
};

/** A row's quiet right-hand hint: where the note lives. A native note's id is
 * an opaque ULID, never shown (computer-use pass, 2026-09-29: "raw note IDs
 * next to titles"); a path-shaped id shows its file name. */
export function pickerHint(note: NoteSummary): string {
  if (isPresetTemplate(note.id)) return "Built-in";
  return note.id.includes("/") || note.id.includes(".") ? fileName(note.id) : "";
}

export function slashPickerCanCreate(mode: SlashPickerMode, tauri = isTauri(), writable = true): boolean {
  // a template — or a note made from Link note — is an ordinary note: every
  // vault can make one, web included
  if (mode === "insertTemplate" || mode === "linkNote") return writable;
  return tauri && writable && (mode === "embedBoard" || mode === "embedSheet" || mode === "embedDocument");
}

export function SlashPicker({
  mode,
  selectedIndex,
  onHover,
  onPick,
  onClose,
  hostNoteId,
}: {
  mode: SlashPickerMode;
  selectedIndex: number;
  onHover: (index: number) => void;
  onPick: (note: NoteSummary) => void;
  /** `refocus` when the person dismissed it from the picker (Esc, ×): the
   * caret goes back to the note. A click elsewhere keeps its own focus. */
  onClose: (refocus?: boolean) => void;
  /** The note being written in — a note made from here is filed beside it. */
  hostNoteId?: string;
}) {
  const [query, setQuery] = useState("");
  // clicking back into the note (or anywhere else) or pressing Escape closes
  // it, as every other popover does (tester feedback, 2026-09-29)
  const rootRef = useRef<HTMLDivElement | null>(null);
  // the search field and × stay put; only the rows under them scroll
  const listRef = useRef<HTMLDivElement | null>(null);
  useTransientPopover([rootRef], true, onClose);
  const [creationAvailable, setCreationAvailable] = useState<boolean | null>(null);
  const [createError, setCreateError] = useState("");
  const searchable = useSearchableNotes();
  const chats = useChatTranscripts();
  const storage = useNotes(DEST.storage);
  const usesStorage = mode === "embedSheet" || mode === "embedDocument";
  const storageData = storage.data;
  const ready = usesStorage ? storage.isSuccess : searchable.ready;
  const presetsOn = useUiStore((s) => s.templatePresets);
  const items = useMemo(() => {
    const notes = mode === "linkChat" ? chats : usesStorage ? (storageData ?? []) : searchable.notes;
    const found = filterNotes(notes, mode, query, hostNoteId);
    if (mode !== "insertTemplate" || !presetsOn) return found;
    // the vault's own templates first, then Rotli's built-in presets — a preset
    // the person keeps a template of the same name for steps aside
    const q = query.trim();
    const own = new Set(notes.filter(isTemplateNote).map((n) => n.title.toLowerCase()));
    const presets = presetTemplateNotes().filter(
      (n) => !own.has(n.title.toLowerCase()) && subsequenceMatch(q, n.title),
    );
    return [...found, ...presets];
  }, [usesStorage, storageData, searchable.notes, chats, mode, query, presetsOn, hostNoteId]);
  useEffect(() => {
    let cancelled = false;
    if (mode === "linkChat" || mode === "continueList") return;
    if (!isTauri()) return;
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
  // Link note makes the note you typed when none has that title (the owner,
  // 2026-09-29: "create a new note where I just have to type first line")
  const newTitle = mode === "linkNote" ? query.trim() : "";
  const boardName = embedCreateName(mode, query) ?? "";
  const titleTaken = items.some((n) => n.title.toLowerCase() === newTitle.toLowerCase());
  const supportsCreate =
    mode === "insertTemplate" ||
    (mode === "linkNote" && !!newTitle && !titleTaken) ||
    (isTauri() && (mode === "embedBoard" || mode === "embedSheet" || mode === "embedDocument"));
  // Rotli Web writes to the folder the person connected — nothing to ask
  const canCreate =
    supportsCreate && slashPickerCanCreate(mode, isTauri(), !isTauri() || creationAvailable === true);
  const rows = canCreate ? items.length + 1 : items.length;
  const createSelected = canCreate && selectedIndex === items.length;
  // arrowing past the fold scrolls the list with the highlight
  useEffect(() => {
    const list = listRef.current;
    if (list) scrollRowIntoList(list, list.querySelector(".slashrow.sel"));
  }, [selectedIndex]);
  // a short window caps the picker to the room it has (computer-use pass, 2026-09-29)
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root) fitMenuToWindow(root, !!root.closest(".rotli-slash-anchor.up"));
  }, []);

  const runCreate = async () => {
    setCreateError("");
    if (mode === "insertTemplate") {
      // a new template is written, not inserted: open it beside this note
      try {
        const id = await createTemplateNote();
        onClose();
        usePanesStore.getState().openNote(id, { newTab: true });
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Could not create the template");
      }
      return;
    }
    if (mode === "linkNote") {
      try {
        onPick(await createLinkedNote(newTitle, { besideNoteId: hostNoteId }));
      } catch (error) {
        setCreateError(error instanceof Error ? error.message : "Could not create the note");
      }
      return;
    }
    // a board is named first: what's typed in the field above (2026-09-30:
    // "/board" → Create new failed with "a board needs a name")
    const name = embedCreateName(mode, query);
    if (name === null) {
      setCreateError("Type the board’s name above, then choose Create.");
      return;
    }
    try {
      const id = await createEmbeddedItem(mode, name);
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
        onClose(true);
    }
  };

  return (
    <div className="slashmenu slashpicker" role="menu" aria-label={MODE_LABEL[mode]} ref={rootRef}>
      <div className="slashpicker-head">
        <input
          className="slashpicker-input"
          type="search"
          placeholder={
            mode === "embedBoard"
              ? "Search boards, or name a new one…"
              : `Search ${MODE_LABEL[mode].toLowerCase()}…`
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onHover(0);
          }}
          onKeyDown={onInputKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          autoFocus
        />
        <button
          type="button"
          className="slashpicker-close"
          aria-label={`Close ${MODE_LABEL[mode].toLowerCase()}`}
          title="Close (Esc)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onClose(true)}
        >
          ×
        </button>
      </div>
      <div className="slashpicker-list" ref={listRef}>
        {!ready && <div className="slashpicker-empty">Loading…</div>}
        {ready && rows === 0 && (
          <div className="slashpicker-empty">
            {mode === "embedDocument"
              ? "No editable DOCX documents in Storage yet"
              : mode === "linkChat" && !query.trim()
                ? "No chats yet"
                : mode === "insertTemplate" && !query.trim()
                  ? `No templates yet — any note you keep in a folder named ${TEMPLATES_FOLDER} shows up here`
                  : "No matches"}
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
            // only a moving pointer picks the row (see SlashMenu)
            onMouseMove={() => i !== selectedIndex && onHover(i)}
            onClick={() => onPick(note)}
          >
            <span className="slashglyph">{glyphForNote(note)}</span>
            <span className="slashlabel">{note.title}</span>
            <span className="slashhint">{pickerHint(note)}</span>
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
            <span className="slashlabel">
              {newTitle || boardName ? `Create “${newTitle || boardName}”` : "Create new"}
            </span>
            <span className="slashhint">
              {canCreate
                ? newTitle
                  ? "New note, linked here"
                  : mode === "insertTemplate"
                    ? `New note in ${TEMPLATES_FOLDER}`
                    : mode === "embedBoard" && !boardName
                      ? "Type its name above first"
                      : `New ${MODE_LABEL[mode].toLowerCase()}`
                : creationAvailable === null
                  ? "Checking permissions…"
                  : "Read-only in development"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export { filterNotes as filterPickerNotes };
