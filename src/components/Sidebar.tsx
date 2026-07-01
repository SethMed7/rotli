// The unified compact-tree sidebar (Seth, 2026-06-13): ONE scrollable column
// that REPLACES the old FoldersRail + NoteList two-rail era. Smart rows (All
// notes · Recent) sit on top; the five reserved destinations (Inbox · Vault ·
// Storage · Archive · Trash) follow, each EXPANDABLE inline to reveal its notes
// as compact rows. User folders nest under Storage (path-style ids like
// "Storage/Work"); Vault is the EXTERNAL memex root ("vault:wiki" etc., Track 2),
// browsed read-only. Each row is independently expandable and indented by depth.
//
// Selection grammar is unchanged: clicking a destination row both toggles its
// expansion AND selects it (the ⌘N target via selectedFolderId); a note row is
// selected when its id === the focused pane's active tab (mirrors NoteList).
// Plain click opens in place; ⌘-click opens a new tab — the one list gesture
// that creates a tab. Peach tint + the 3px clay ::before is the one selection
// grammar, shared with the panes.

import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildStorageTree } from "../services/storageTree";
import {
  type DropPos,
  MAIN_ROOT,
  addFolderToMain,
  addNoteToMain,
  buildMainTree,
  moveInTree,
  removeFromMain,
} from "../services/mainTree";
import { useMainStore } from "../state/main";
import {
  invalidateFolders,
  invalidateNotes,
  useArchiveNote,
  useCorpusRoots,
  useFolders,
  useMoveNote,
  useNotes,
  useRestoreNote,
  useTrashNote,
} from "../services/hooks";
import { notesService } from "../services/notes";
import {
  type CorpusRoot,
  corpusAddFolder,
  corpusCreateBoard,
  corpusForgetFolder,
  corpusRenameBoard,
} from "../lib/tauri";
import {
  DEST,
  type Destination,
  isHidden,
  isRootMarker,
  isVault,
} from "../services/destinations";
import {
  useFocusedBoardId,
  useFocusedChatSlug,
  useFocusedNoteId,
  usePanesStore,
} from "../state/panes";
import { ALL_NOTES, RECENT, SEC_CHAT, SEC_INBOX, SEC_NOTES, useUiStore } from "../state/ui";
import { activeInstance } from "../memex/config";
import { useInstanceChats, useMemexConfig } from "../memex/useMemex";
import type { Folder, NoteSummary } from "../types";
import { dispatch } from "../keys/registry";
import { longDateLabel } from "../lib/dateLabels";
import { useTransientPopover } from "../lib/popover";
import {
  ArchiveGlyph,
  BoardGlyph as CanvasItemGlyph,
  ChatGlyph,
  ChevronRight,
  ClockGlyph,
  ExcalidrawGlyph,
  FileGlyph,
  glyphForNote,
  FolderGlyph,
  InboxGlyph,
  MailGlyph,
  NotesStackGlyph,
  PlusGlyph,
  SearchGlyph,
  StorageGlyph,
  TrashGlyph,
  VaultGlyph,
} from "./glyphs";
import { type RovingRow, useRovingList } from "./sidebar/useRovingList";
import { RowMenu } from "./sidebar/RowMenu";

/** The drag payload type for a note dragged from a compact row onto a
 * destination/folder dropzone (Seth, 2026-06-13). One private MIME so foreign
 * drags (files, text) never match a rotli dropzone. */
const NOTE_DRAG_TYPE = "application/x-rotli-note";

/** Restore-from-hidden glyph (Seth, 2026-06-13): a counter-clockwise arc arrow
 * — "put it back". Lives here, not in glyphs.tsx, since this is the only place
 * Restore appears and this phase touches Sidebar only; same 1.7 stroke /
 * 24-viewBox grammar as the shared Glyph helper so it reads as one family. */
function RestoreGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9a8 8 0 1 1-1.5 5" />
      <path d="M4 4v5h5" />
    </svg>
  );
}

/** Collapse-all glyph — two chevrons folding toward the center ("fold the tree
 * up"). Inline like RestoreGlyph; same 1.7 stroke / 24-viewBox family. */
function FoldGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 9l5-5 5 5M7 20l5-5 5 5" />
    </svg>
  );
}

/** Capture-board glyph — a 2×2 grid of cards (the quick-capture Board button).
 * Named distinctly from the imported CanvasItemGlyph (the .excalidraw board icon)
 * so the two never get crossed. Same stroke/viewBox grammar as the family. */
function CaptureBoardGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** The five reserved destinations, in sidebar order, each with its glyph. The
 * note-capture root keeps its on-disk id "Inbox" (the memex contract is unchanged)
 * but is LABELED "Capture" now that the top-level word "Inbox" means email (Seth,
 * 2026-06-26). The ⌥C one-breath capture still lands here / in the memex inbox.md. */
const DEST_ROWS: { id: Destination; label: string; Glyph: typeof InboxGlyph }[] = [
  // "Capture" (DEST.inbox) is GONE — captures have ONE home now, the "Captures"
  // row under Notes (Seth, 2026-06-30). Staged notes (wiki/_inbox) project there.
  { id: DEST.vault, label: "Vault", Glyph: VaultGlyph },
  { id: DEST.storage, label: "Storage", Glyph: StorageGlyph },
  { id: DEST.archive, label: "Archive", Glyph: ArchiveGlyph },
  { id: DEST.trash, label: "Trash", Glyph: TrashGlyph },
];

/** Stubbed email accounts for the Inbox (email) placeholder — the intended
 * account/thread structure, rendered disabled until the mail integration lands
 * (a LATER increment; this writes nothing). These two are Seth's known addresses
 * from the IA doc Addendum. */
const STUB_EMAIL_ACCOUNTS = ["maintainer@example.com", "hello@sethmedina.com"];

/** How many chats the sidebar Chat section shows before "All chats" takes over —
 * the accordion is a LIMITED view; "All chats" opens the full searchable list. */
const CHAT_SECTION_LIMIT = 12;

/** The lifecycle handlers a compact row needs in its hover slot — wired once at
 * the Sidebar top (the hooks live there) and passed down so the row stays a
 * pure-ish leaf (Seth, 2026-06-13). */
interface RowActions {
  archive: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
  /** Add this note to the user's hand-arranged Main view (a ⊕ hover affordance). */
  addToMain?: (id: string) => void;
}

/** A compact note row: title + day label only — NO snippet line (that is the
 * difference from the old NoteList's three-line .nrow). Click opens the note;
 * ⌘-click opens it in a new tab. Phase 2 (Seth, 2026-06-13): the .snact slot
 * now carries the hover affordances — Archive + Trash for a normal row, a
 * single Restore for a row already in Archive/Trash — and the whole row is
 * draggable onto a destination/folder dropzone (the move/archive/trash gesture
 * with no right-click menu). Each action button stops propagation so it never
 * opens the note. */
function CompactNoteRow({
  note,
  selected,
  padLeft,
  onOpen,
  actions,
  rowProps,
}: {
  note: NoteSummary;
  selected: boolean;
  /** Depth-scaled left inset so a note sits under its folder (Seth, 2026-06-15). */
  padLeft: number;
  onOpen: (newTab: boolean) => void;
  actions: RowActions;
  /** Roving-list props (Seth, 2026-06-13): tabIndex/role/aria-selected + the
   * focus-scoped j/k onKeyDown. Spread last so the keyboard handlers win, but
   * the row keeps its own mouse open + drag gestures. */
  rowProps: ReturnType<ReturnType<typeof useRovingList>["rowProps"]>;
}) {
  const onClick = (event: MouseEvent) => onOpen(event.metaKey);
  const hidden = isHidden(note.folderId); // Archive/Trash (or nested) → Restore
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
    event.dataTransfer.effectAllowed = "move";
  };
  return (
    <button
      type="button"
      className={selected ? "snrow sel" : "snrow"}
      style={{ paddingLeft: padLeft }}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      {...rowProps}
    >
      {glyphForNote(note, { size: 14, className: "snicon" })}
      <span className="snt">{note.title || "Empty note"}</span>
      <span className="snd">{longDateLabel(note.updatedAt)}</span>
      <span className="snact">
        {hidden ? (
          <span
            role="button"
            tabIndex={0}
            className="snactbtn"
            aria-label="Restore"
            onClick={(event) => {
              event.stopPropagation();
              actions.restore(note.id);
            }}
          >
            <RestoreGlyph size={16} />
          </span>
        ) : (
          <>
            {actions.addToMain && (
              <span
                role="button"
                tabIndex={0}
                className="snactbtn"
                aria-label="Add to Main"
                title="Add to Main"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.addToMain?.(note.id);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              className="snactbtn"
              aria-label="Archive"
              onClick={(event) => {
                event.stopPropagation();
                actions.archive(note.id);
              }}
            >
              <ArchiveGlyph size={16} />
            </span>
            <span
              role="button"
              tabIndex={0}
              className="snactbtn"
              aria-label="Move to Trash"
              onClick={(event) => {
                event.stopPropagation();
                actions.trash(note.id);
              }}
            >
              <TrashGlyph size={16} />
            </span>
          </>
        )}
      </span>
    </button>
  );
}

/** A compact board (.excalidraw) row: the canvas glyph + the file's basename —
 * NO date, NO lifecycle slot (boards aren't in the note lifecycle yet). Click
 * opens the board on the focused pane; ⌘-click opens it in a new tab. Reuses
 * the .snrow grammar so a board sits in the same column as the notes around it
 * (Seth, 2026-06-24). */
function CompactBoardRow({
  board,
  selected,
  padLeft,
  onOpen,
  renaming,
  onStartRename,
  onCommitRename,
  onCancelRename,
  rowProps,
}: {
  board: NoteSummary;
  selected: boolean;
  padLeft: number;
  onOpen: (newTab: boolean) => void;
  renaming: boolean;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  rowProps: ReturnType<ReturnType<typeof useRovingList>["rowProps"]>;
}) {
  const onClick = (event: MouseEvent) => onOpen(event.metaKey);
  // inline rename: right-click a board (or a freshly created one) turns the row
  // into a text input. Enter commits; Esc / click-away cancels (Seth, 2026-06-26).
  if (renaming) {
    return (
      <div className="sb-newfolder snrow" style={{ paddingLeft: padLeft }}>
        <ExcalidrawGlyph size={14} className="snicon" />
        <input
          autoFocus
          type="text"
          defaultValue={board.title}
          placeholder="Board name…"
          aria-label="Rename board"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename(e.currentTarget.value);
            else if (e.key === "Escape") onCancelRename();
          }}
          onBlur={() => onCancelRename()}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className={selected ? "snrow sel" : "snrow"}
      style={{ paddingLeft: padLeft }}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        onStartRename();
      }}
      {...rowProps}
    >
      <CanvasItemGlyph size={14} className="snicon" />
      <span className="snt">{board.title || "Untitled board"}</span>
    </button>
  );
}

/** A top-level row for an ADDED external folder (Seth, 2026-06-27): a folder you
 * pointed rotli at without moving it into the memex. Self-contained (its own
 * useNotes over the root marker) so the Sidebar can render N of them via
 * roots.map without breaking rules-of-hooks — the set is fixed per session (adding
 * or removing a folder relaunches). Expand to browse its notes; the × on hover
 * forgets the binding (a two-click confirm; the files on disk are never touched). */
function AddedRootRow({ root }: { root: CorpusRoot }) {
  const notes = useNotes(`${root.id}:`).data ?? [];
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const openNote = usePanesStore((s) => s.openNote);
  const focusedNoteId = useFocusedNoteId();
  return (
    <div>
      <button type="button" className="frow" onClick={() => setOpen((o) => !o)}>
        <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
          <ChevronRight size={10} />
        </span>
        <FolderGlyph size={14.5} />
        <span className="fname" title={root.absPath}>
          {root.label}
        </span>
        <span
          role="button"
          tabIndex={0}
          className={confirming ? "sb-root-x confirm" : "sb-root-x"}
          aria-label={confirming ? "Confirm remove folder" : "Remove this folder"}
          title="Remove this folder from rotli (the files are kept)"
          onClick={(e) => {
            e.stopPropagation();
            if (confirming) void corpusForgetFolder(root.id); // relaunches
            else setConfirming(true);
          }}
        >
          {confirming ? "Remove?" : "×"}
        </span>
        <span className="count">{notes.length}</span>
      </button>
      {open &&
        notes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={n.id === focusedNoteId ? "snrow sel" : "snrow"}
            style={{ paddingLeft: 44 }}
            onClick={(e) => openNote(n.id, { newTab: e.metaKey })}
          >
            {glyphForNote(n, { size: 14, className: "snicon" })}
            <span className="snt">{n.title || "Empty note"}</span>
          </button>
        ))}
      {open && notes.length === 0 && (
        <div className="sb-stub-note" style={{ paddingLeft: 44 }}>
          No notes in this folder yet.
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const rawFolders = useFolders().data ?? [];
  const allNotes = useNotes().data ?? [];
  // the five reserved queries — all served from the one cached corpus_list, so
  // five hooks here are five cache reads, not five fetches
  const inboxNotes = useNotes(DEST.inbox).data ?? [];
  const vaultNotes = useNotes(DEST.vault).data ?? [];
  const storageNotesFlat = useNotes(DEST.storage).data ?? [];
  const archiveNotes = useNotes(DEST.archive).data ?? [];
  const trashNotes = useNotes(DEST.trash).data ?? [];
  const boardNotes = useNotes(DEST.board).data ?? [];
  // Storage organization (Seth, 2026-06-30): regroup the flat binaries into a
  // synthetic tree (Type / Date / Folder, a Settings knob) IN THE FRONTEND. The
  // synthetic "Storage/<…>" folders merge into the folder list and the storage
  // notes re-home, so the existing recursive renderer + roving cursor just work —
  // no backend change, instant toggle.
  const storageGrouping = useUiStore((s) => s.storageGrouping);
  const storageTree = useMemo(
    () => buildStorageTree(storageNotesFlat, storageGrouping),
    [storageNotesFlat, storageGrouping],
  );
  const storageNotes = storageTree.notes;
  const folders = useMemo(
    () => [
      ...rawFolders.filter(
        (f) =>
          f.id !== "storage" &&
          !f.id.startsWith("storage/") &&
          // hide internal memex scaffolding from the Brain (_inbox / _templates)
          !f.id.startsWith("wiki/_"),
      ),
      ...storageTree.folders,
    ],
    [rawFolders, storageTree.folders],
  );
  // hide the "Vault" (linked-library) destination until one is actually connected —
  // an empty Vault row next to the user's own memex-vault folder just confuses
  // (Seth, 2026-06-30). It returns the moment a vault root has notes/folders.
  const showVault = vaultNotes.length > 0 || folders.some((f) => f.id.startsWith("vault:"));
  const visibleDestRows = useMemo(
    () => DEST_ROWS.filter((d) => d.id !== DEST.vault || showVault),
    [showVault],
  );
  // the BRAIN — the AI-organized wiki areas (People · Projects · Research · …).
  // Curated notes (no shelf) project to their disk area "wiki/<area>"; we surface
  // them as a navigable Brain section under Notes (Seth, 2026-06-30).
  // the BRAIN = the curated wiki AREAS (People/Projects/Research/…). Hide the
  // internal memex scaffolding: `_inbox` (note staging — surfaced as Captures) and
  // `_templates` are underscore-prefixed = not user-facing areas (Seth, 2026-06-30).
  const brainNotes = allNotes.filter(
    (n) =>
      (n.folderId === "wiki" || n.folderId.startsWith("wiki/")) && !n.folderId.startsWith("wiki/_"),
  );

  // MAIN — the user's hand-arranged view over the Brain (docs/design/main-brain-daemon.md).
  // A `.rotli/main.json` manifest of folders + note-id refs, projected into synthetic
  // sidebar rows. It references notes BY ID, so a daemon refiling the Brain underneath
  // never moves Main. Mouse + drag navigable (not part of the j/k roving list yet).
  const mainManifest = useMainStore((s) => s.manifest);
  const setMainTree = useMainStore((s) => s.setTree);
  const notesById = useMemo(() => new Map(allNotes.map((n) => [n.id, n] as const)), [allNotes]);
  const liveIds = useMemo(() => new Set(allNotes.map((n) => n.id)), [allNotes]);
  const mainProjection = useMemo(
    () => buildMainTree(mainManifest.tree, notesById),
    [mainManifest.tree, notesById],
  );
  // added external folders (Seth, 2026-06-27): roots the user pointed rotli at,
  // not in the memex — every registered root except the built-in default + vault.
  const addedRoots = (useCorpusRoots().data ?? []).filter(
    (r) => r.id !== "default" && r.id !== "vault",
  );

  // a flat id → note lookup across every loaded list (incl. hidden Archive/
  // Trash) — the drop handler's same-folder no-op check trusts this (Seth,
  // 2026-06-13). allNotes alone would miss hidden notes dragged back home.
  const noteById = new Map<string, NoteSummary>();
  for (const n of [
    ...allNotes,
    ...inboxNotes,
    ...vaultNotes,
    ...storageNotes,
    ...archiveNotes,
    ...trashNotes,
  ])
    noteById.set(n.id, n);

  // — the Chat section: the active memex's chats/ history (the same source the
  // Chat surface reads), plus the chat-selection ui state the surface renders. —
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const chatList = useInstanceChats(activeMemex).data ?? [];
  const chatAllOpen = useUiStore((s) => s.chatAllOpen);
  const setChatAllOpen = useUiStore((s) => s.setChatAllOpen);

  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const contentView = useUiStore((s) => s.contentView);
  const setContentView = useUiStore((s) => s.setContentView);
  const expandedDests = useUiStore((s) => s.expandedDests);
  const collapseAllDests = useUiStore((s) => s.collapseAllDests);
  const toggleDestExpanded = useUiStore((s) => s.toggleDestExpanded);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const focusedNoteId = useFocusedNoteId();
  const focusedBoardId = useFocusedBoardId();
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  const openChat = usePanesStore((s) => s.openChat);
  const retargetBoard = usePanesStore((s) => s.retargetBoard);
  const focusedChatSlug = useFocusedChatSlug();
  const renamingBoardId = useUiStore((s) => s.renamingBoardId);
  const setRenamingBoardId = useUiStore((s) => s.setRenamingBoardId);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // — the "+" create menu (replaces the old pencil): New note / New board / New
  // folder, anchored under the button via the same fixed-position trick RowMenu
  // uses. useTransientPopover wires Esc + outside-click close (Seth, 2026-06-24).
  const [plusOpen, setPlusOpen] = useState(false);
  const plusBtnRef = useRef<HTMLDivElement>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  useTransientPopover([plusMenuRef, plusBtnRef], plusOpen, () => setPlusOpen(false));

  // — inline nested new-folder row: when set, an <input> renders under this
  // parent id; null = not creating. Enter (or clicking away) commits a non-empty
  // name — Finder/Apple Notes commit on blur, not discard; Esc/empty cancels
  // (Seth, 2026-06-24). —
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  // Enter and Esc both unmount the input, which fires a blur — this ref tells the
  // blur handler that the keystroke already settled it, so it doesn't re-commit
  // (a double-create on Enter) or override an Esc-cancel.
  const newFolderHandled = useRef(false);

  // anchor the "+" menu just under its button (fixed-positioned so it escapes
  // the sidebar's overflow clip) — same mount-from-box trick RowMenu uses.
  useEffect(() => {
    if (!plusOpen) return;
    const btn = plusBtnRef.current;
    const menu = plusMenuRef.current;
    if (!btn || !menu) return;
    const rect = btn.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    // right-align the menu to the button so it never overflows the sidebar edge
    menu.style.left = `${Math.max(8, rect.right - menu.offsetWidth)}px`;
  }, [plusOpen]);
  // the open row menu (the "m" / context popover) — its note id, hidden flag,
  // and the row element it hangs off (the focus-return target on close).
  const [menu, setMenu] = useState<{
    noteId: string;
    hidden: boolean;
    anchor: HTMLElement;
  } | null>(null);

  // — lifecycle mutations (Seth, 2026-06-13): wired once here, the .mutate fns
  // flow down to every compact row's hover slot AND the destination dropzones.
  // moveNote handles the origin rule, so dropping on Archive/Trash archives or
  // trashes and dropping on a normal folder moves. —
  const archiveNote = useArchiveNote();
  const trashNote = useTrashNote();
  const restoreNote = useRestoreNote();
  const moveNote = useMoveNote();
  const rowActions: RowActions = {
    archive: (id) => archiveNote.mutate(id),
    trash: (id) => trashNote.mutate(id),
    restore: (id) => restoreNote.mutate(id),
    addToMain: (id) => setMainTree(addNoteToMain(mainManifest.tree, id), liveIds),
  };

  // — the active dropzone (a destination/folder id) while a note is mid-drag;
  // drives the .drop-over accent ring and is cleared on leave/drop. —
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // — Main pointer-drag reorder (HTML5 DnD is dead in the WKWebView shell, so the
  //   BoardSurface pointer pattern; a threshold distinguishes drag from click) —
  const [mainDragId, setMainDragId] = useState<string | null>(null);
  const [mainDrop, setMainDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const didMainDragRef = useRef(false);

  const startMainDrag = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    let drop: { id: string; pos: DropPos } | null = null;
    didMainDragRef.current = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
        dragging = true;
        didMainDragRef.current = true;
        setMainDragId(id);
      }
      const hit = (
        document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      )?.closest("[data-main-id]") as HTMLElement | null;
      const tid = hit?.dataset.mainId;
      if (!hit || !tid || tid === id) {
        drop = null;
        setMainDrop(null);
        return;
      }
      const rect = hit.getBoundingClientRect();
      const rel = rect.height > 0 ? (ev.clientY - rect.top) / rect.height : 0.5;
      // a folder's middle third = drop INTO it; otherwise before/after by half
      let pos: DropPos = rel < 0.5 ? "before" : "after";
      if (hit.dataset.mainFolder === "1" && rel > 0.33 && rel < 0.67) pos = "into";
      drop = { id: tid, pos };
      setMainDrop(drop);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMainDragId(null);
      setMainDrop(null);
      if (dragging && drop) {
        setMainTree(moveInTree(mainManifest.tree, id, drop.id, drop.pos), liveIds);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // recursive render of the Main tree — mouse + drag (NOT roving). Synthetic folders
  // (id "main:<path>") + notes re-homed by the manifest; a note references the same
  // .md as its Brain twin (one file, two views).
  const renderMainTree = (parentId: string, depth: number): ReactNode => {
    const childFolders = mainProjection.folders.filter((f) => f.parentId === parentId);
    const childNotes = mainProjection.notes
      .filter((n) => n.folderId === parentId)
      .sort((a, b) => a.mainOrder - b.mainOrder);
    const dropCls = (rowId: string) => (mainDrop?.id === rowId ? ` mdrop-${mainDrop.pos}` : "");
    const removeBtn = (rowId: string, label: string) => (
      <span
        role="button"
        tabIndex={0}
        className="snactbtn mmx"
        aria-label={label}
        title={label}
        onClick={(ev) => {
          ev.stopPropagation();
          setMainTree(removeFromMain(mainManifest.tree, rowId), liveIds);
        }}
      >
        ×
      </span>
    );
    return (
      <>
        {childNotes.map((n) => (
          <button
            key={`main:${n.id}`}
            type="button"
            data-main-id={n.id}
            className={`snrow main-row${dropCls(n.id)}${mainDragId === n.id ? " dragging" : ""}`}
            style={{ paddingLeft: 10 + (depth + 1) * 16 }}
            onPointerDown={(e) => startMainDrag(e, n.id)}
            onClick={() => {
              if (!didMainDragRef.current) usePanesStore.getState().openSummary(n);
            }}
          >
            {glyphForNote(n, { size: 14, className: "snicon" })}
            <span className="snt">{n.title || "Empty note"}</span>
            <span className="snact">{removeBtn(n.id, "Remove from Main")}</span>
          </button>
        ))}
        {childFolders.map((f) => {
          const open = expandedDests[f.id] ?? true;
          return (
            <div key={f.id}>
              <button
                type="button"
                data-main-id={f.id}
                data-main-folder="1"
                className={`frow child main-row${dropCls(f.id)}${mainDragId === f.id ? " dragging" : ""}`}
                style={{ paddingLeft: 10 + (depth + 1) * 16 }}
                onPointerDown={(e) => startMainDrag(e, f.id)}
                onClick={() => {
                  if (!didMainDragRef.current) toggleDestExpanded(f.id);
                }}
              >
                <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                  <ChevronRight size={10} />
                </span>
                <FolderGlyph size={14} />
                <span className="fname">{f.name}</span>
                {removeBtn(f.id, "Remove folder from Main")}
              </button>
              {open && renderMainTree(f.id, depth + 1)}
            </div>
          );
        })}
      </>
    );
  };

  /** Wire one destination/folder row as a note dropzone: highlight on hover,
   * and on drop move the dragged note there (same-folder drop is a no-op —
   * moveNote handles archive/trash via the origin rule). Smart rows never call
   * this, so they ignore drops by construction. */
  const dropProps = (destId: string) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(NOTE_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== destId) setDropTarget(destId);
    },
    onDragLeave: (event: DragEvent) => {
      // ignore leaves into a child element of the same row
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget((t) => (t === destId ? null : t));
    },
    onDrop: (event: DragEvent) => {
      const id = event.dataTransfer.getData(NOTE_DRAG_TYPE);
      setDropTarget(null);
      if (!id) return;
      event.preventDefault();
      // same-folder drop is a no-op — search every loaded list (incl. the
      // hidden Archive/Trash) so a back-onto-itself drop is caught too
      const note = noteById.get(id);
      if (note && note.folderId === destId) return;
      moveNote.mutate({ id, targetFolder: destId });
    },
  });

  // each destination's subtree notes, by dest id (Brain/Storage include their
  // nested user folders; the nested rows slice their own out of this list)
  const notesByDest: Record<string, NoteSummary[]> = {
    [DEST.inbox]: inboxNotes,
    [DEST.vault]: vaultNotes,
    [DEST.storage]: storageNotes,
    [DEST.archive]: archiveNotes,
    [DEST.trash]: trashNotes,
  };

  // count for a user folder = own notes + every descendant folder's notes,
  // sliced from the destination subtree it belongs to (mirrors FoldersRail)
  // A folder's children are those whose parentId points at it. The external
  // Vault ROOT MARKER ("vault:") is special: its top-level surfaced folders
  // (vault:wiki, vault:chats) carry parentId === null (Rust aggregates them with
  // no parent), so the marker adopts every folder prefixed with it that has no
  // parent and no nested slash in its rel path.
  const childrenOf = (parentId: string) => {
    if (isRootMarker(parentId)) {
      return folders.filter(
        (f) =>
          f.parentId == null &&
          f.id.startsWith(parentId) &&
          !f.id.slice(parentId.length).includes("/"),
      );
    }
    return folders.filter((f) => f.parentId === parentId);
  };
  const countFor = (folder: Folder, destNotes: NoteSummary[]): number => {
    const own = destNotes.filter((n) => n.folderId === folder.id).length;
    return own + childrenOf(folder.id).reduce((sum, c) => sum + countFor(c, destNotes), 0);
  };

  // the live filter narrows the compact rows by title (the old NoteList filter,
  // applied per section now)
  const q = filter.trim().toLowerCase();
  const matches = (note: NoteSummary): boolean =>
    !q || note.title.toLowerCase().includes(q);

  const openRow = (id: string) => (newTab: boolean) => openNote(id, { newTab });
  const openBoardRow = (id: string) => (newTab: boolean) => openCanvas(id, { newTab });

  // an item is a board when its corpus walk tagged it kind:"board"; missing kind
  // (old data, serde default) reads as a note — so this split is back-compat.
  const isBoard = (n: NoteSummary): boolean => n.kind === "board";
  const isFile = (n: NoteSummary): boolean => n.kind === "file";

  // a flat set of every loaded board id — the roving onOpen/onOpenMenu branch on
  // this (board rows ride kind:"note" in the roving list since RovingRow has no
  // board variant, so the Set is how we tell a board apart at open time).
  const boardIds = new Set<string>();
  // same idea for surfaced files (image/pdf/…): they ride as note rows but open
  // in the OS default app, never the editor.
  const fileIds = new Set<string>();
  for (const n of [
    ...allNotes,
    ...inboxNotes,
    ...vaultNotes,
    ...storageNotes,
    ...archiveNotes,
    ...trashNotes,
  ]) {
    if (isBoard(n)) boardIds.add(n.id);
    else if (isFile(n)) fileIds.add(n.id);
  }

  // —— compact rows for one folder id (own notes + own boards), filtered ——
  // `rp` is the roving rowProps factory (passed in so this helper can run before
  // useRovingList is even declared — React calls it during render either way).
  // `level` is the row's tree depth (dest-direct notes = 1); ~16px per level so
  // a row's icon lands under its folder's icon (Seth, 2026-06-15). Notes render
  // first, then boards — both in the same indented column (Seth, 2026-06-24).
  const compactRows = (
    notes: NoteSummary[],
    folderId: string,
    rp: ReturnType<typeof useRovingList>["rowProps"],
    level: number,
  ): ReactNode => {
    const own = notes.filter((n) => n.folderId === folderId && matches(n));
    return (
      <>
        {own
          .filter((n) => !isBoard(n))
          .map((note) => (
            <CompactNoteRow
              key={note.id}
              note={note}
              selected={note.id === focusedNoteId}
              padLeft={28 + level * 16}
              onOpen={
                isFile(note)
                  ? (newTab) => usePanesStore.getState().openFile(note.id, { newTab })
                  : openRow(note.id)
              }
              actions={rowActions}
              rowProps={rp({ id: note.id, kind: "note" })}
            />
          ))}
        {own
          .filter(isBoard)
          .map((board) => (
            <CompactBoardRow
              key={board.id}
              board={board}
              selected={board.id === focusedBoardId}
              padLeft={28 + level * 16}
              onOpen={openBoardRow(board.id)}
              renaming={renamingBoardId === board.id}
              onStartRename={() => setRenamingBoardId(board.id)}
              onCommitRename={(name) => void commitBoardRename(board.id, name)}
              onCancelRename={() => setRenamingBoardId(null)}
              rowProps={rp({ id: board.id, kind: "note" })}
            />
          ))}
      </>
    );
  };

  // —— recursive user-folder subtree under a destination (like FoldersRail) ——
  const renderFolderTree = (
    parentId: string,
    destNotes: NoteSummary[],
    depth: number,
    rp: ReturnType<typeof useRovingList>["rowProps"],
  ): ReactNode =>
    childrenOf(parentId)
      // hide memex plumbing folders ("_templates", "_inbox", …): they're how the
      // AI stages/templates notes, never something the user files into (2026-06-26)
      .filter((folder) => !(folder.id.startsWith("vault:") && folder.name.startsWith("_")))
      .map((folder) => {
      const open = expandedDests[folder.id] ?? false;
      const selected = selectedFolderId === folder.id;
      // the memex "wiki" is the AI's filing structure — surface it as "Knowledge"
      // with a plain-language note that the AI organizes it (transparency without
      // the wiki jargon the average user wouldn't know what to do with)
      const isVaultWiki = folder.id === "vault:wiki";
      // a Brain area (wiki/<area> in the corpus) reads with a capitalized label —
      // "people" → "People", "projects" → "Projects" (Seth, 2026-06-30)
      const isWikiArea = folder.id.startsWith("wiki/") && folder.parentId === "wiki";
      const label = isVaultWiki
        ? "Knowledge"
        : isWikiArea
          ? folder.name.charAt(0).toUpperCase() + folder.name.slice(1)
          : folder.name;
      const hint = isVaultWiki
        ? "Organized by AI so anything you save here stays findable — your folders are how you see your notes; this is how the AI files them underneath."
        : undefined;
      return (
        <div key={folder.id}>
          <button
            type="button"
            className={`frow child${selected ? " sel" : ""}${
              dropTarget === folder.id ? " drop-over" : ""
            }`}
            style={{ paddingLeft: 10 + (depth + 1) * 16 }}
            onClick={() => {
              toggleDestExpanded(folder.id);
              setSelectedFolderId(folder.id);
              setContentView("panes");
            }}
            {...(!isVault(folder.id) ? dropProps(folder.id) : {})}
            {...rp({ id: folder.id, kind: "folder" })}
          >
            <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
              <ChevronRight size={10} />
            </span>
            <FolderGlyph size={14} />
            <span className="fname" title={hint}>{label}</span>
            {!isVault(folder.id) && sectionAddBtn(folder.id)}
            <span className="count">{countFor(folder, destNotes)}</span>
          </button>
          {open && (
            <>
              {compactRows(destNotes, folder.id, rp, depth + 2)}
              {!isVault(folder.id) && newFolderRow(folder.id, 28 + (depth + 2) * 16)}
              {renderFolderTree(folder.id, destNotes, depth + 1, rp)}
            </>
          )}
        </div>
      );
    });

  // —— the flat, in-render-order list the roving j/k cursor walks (Seth,
  // 2026-06-13). One pure pass that mirrors the JSX traversal exactly: the two
  // smart rows, then each destination row, and — when a dest/folder is expanded
  // — its filtered compact note rows followed by its child folders, recursively.
  // Build it from the SAME inputs the render uses (expandedDests + the filter)
  // so the cursor never points at a row that isn't on screen. ——
  // notes first, then boards — MUST mirror compactRows' render order exactly, or
  // the j/k cursor points at an off-screen row (boards ride kind:"note" here;
  // onOpen/onOpenMenu disambiguate via the boardIds Set).
  const visibleNoteRows = (notes: NoteSummary[], folderId: string): RovingRow[] => {
    const own = notes.filter((n) => n.folderId === folderId && matches(n));
    return [
      ...own.filter((n) => !isBoard(n)),
      ...own.filter(isBoard),
    ].map((n) => ({ id: n.id, kind: "note" as const }));
  };

  const subtreeRows = (
    parentId: string,
    destNotes: NoteSummary[],
  ): RovingRow[] =>
    childrenOf(parentId).flatMap((folder) => {
      const open = expandedDests[folder.id] ?? false;
      const row: RovingRow = { id: folder.id, kind: "folder" };
      if (!open) return [row];
      return [
        row,
        ...visibleNoteRows(destNotes, folder.id),
        ...subtreeRows(folder.id, destNotes),
      ];
    });

  // the three top-level sections' open state (Seth's IA, 2026-06-26). Default
  // open so a fresh window shows the full tree; persisted via expandedDests.
  const inboxSecOpen = expandedDests[SEC_INBOX] ?? true;
  const chatSecOpen = expandedDests[SEC_CHAT] ?? true;
  const notesSecOpen = expandedDests[SEC_NOTES] ?? true;

  // the roving j/k cursor only walks the NOTES section (the corpus tree). When
  // that section is collapsed there are no roving rows; the Inbox/Chat sections
  // are plain buttons, outside the listbox.
  const rows: RovingRow[] = notesSecOpen
    ? [
        { id: ALL_NOTES, kind: "smart" },
        { id: RECENT, kind: "smart" },
        // the Brain areas (wiki/<area>) ride between the smart rows and destinations
        ...subtreeRows("wiki", brainNotes),
        ...visibleDestRows.flatMap(({ id }) => {
          const destNotes = notesByDest[id] ?? [];
          const open = expandedDests[id] ?? false;
          const row: RovingRow = { id, kind: "folder" };
          if (!open) return [row];
          return [
            row,
            ...visibleNoteRows(destNotes, id),
            ...subtreeRows(id, destNotes),
          ];
        }),
      ]
    : [];

  // a flat id → note lookup for the menu's hidden-root branch (search every
  // loaded list incl. the hidden Archive/Trash — same source the drop handler
  // trusts). noteById already aggregates them above.

  const { rowProps, focusActive } = useRovingList(rows, {
    // l / Enter: a note opens in place; a folder/dest toggles its expansion and
    // becomes the ⌘N selection — mirrors the click gesture exactly.
    onOpen: (row, newTab) => {
      if (row.kind === "note") {
        // board rows ride kind:"note" in the roving list — the Set tells them
        // apart so a board opens its canvas, not the editor (Seth, 2026-06-24)
        if (boardIds.has(row.id)) openCanvas(row.id, { newTab });
        else if (fileIds.has(row.id)) usePanesStore.getState().openFile(row.id, { newTab });
        else openNote(row.id, { newTab });
        return;
      }
      setSelectedFolderId(row.id);
      if (row.id === ALL_NOTES) {
        setContentView("allNotes");
      } else {
        toggleDestExpanded(row.id);
        setContentView("panes");
      }
    },
    // h / Esc: collapse an expanded dest/folder; return true to consume. A note
    // row, or an already-collapsed folder, has nothing to collapse → return
    // false so Esc bubbles to the registry's app.hide (h at the root no-ops).
    onCollapseOrOut: (row) => {
      if (row.kind === "note") return false;
      if (expandedDests[row.id]) {
        setDestExpanded(row.id, false);
        return true;
      }
      return false;
    },
    onFocusFilter: () => filterRef.current?.focus(),
    // m: only note rows get the full menu; folder/smart rows — and board rows
    // (no noteById entry, no lifecycle yet) — have no popover.
    onOpenMenu: (row, anchor) => {
      if (row.kind !== "note" || boardIds.has(row.id) || fileIds.has(row.id)) return;
      const note = noteById.get(row.id);
      setMenu({ noteId: row.id, hidden: isHidden(note?.folderId ?? ""), anchor });
    },
  });

  // Esc in the filter input returns focus to the active row (so the cursor is
  // never stranded in the field) — its own local handler, not the global rule.
  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      focusActive();
    }
  };

  // the create target: the selected folder, falling back to Inbox when a smart
  // row (All notes / Recent), a hidden root (Archive / Trash / Board), OR the
  // external read-mostly Vault is selected — so freshly created content never
  // starts life inside a sink, the capture board, or the Vault (mirrors
  // newNote() in actions, plus the lifecycle + read-only-vault guards).
  const resolvedParent = (): string =>
    selectedFolderId === ALL_NOTES ||
    selectedFolderId === RECENT ||
    isHidden(selectedFolderId) ||
    isVault(selectedFolderId)
      ? DEST.inbox
      : selectedFolderId;

  // "+" → New Excalidraw board: create it in the resolved folder, refresh the
  // listing, then open its canvas (meta.id is the new board's relpath).
  const createBoard = async () => {
    setPlusOpen(false);
    const parent = resolvedParent();
    const meta = await corpusCreateBoard(parent);
    await invalidateNotes();
    setDestExpanded(parent, true);
    openCanvas(meta.id);
    // name it immediately — the new board's sidebar row opens in rename mode
    setRenamingBoardId(meta.id);
  };

  // Commit an inline board rename (right-click a board row, or naming a fresh
  // one): rename the .excalidraw, retarget any open canvas tab to the new id,
  // refresh. Enter commits; Esc / click-away cancels (Seth, 2026-06-26).
  const commitBoardRename = async (boardId: string, raw: string) => {
    setRenamingBoardId(null);
    const name = raw.trim();
    if (!name) return;
    try {
      const meta = await corpusRenameBoard(boardId, name);
      retargetBoard(boardId, meta.id);
      await invalidateNotes();
    } catch (e) {
      // board is read-only or gone — leave it as is, but surface why
      console.warn("board rename failed", e);
    }
  };

  // "+" → New folder: open the inline input row under a parent (and expand it so
  // the input is on screen). The header "+" passes nothing → the resolved
  // (selected) folder; a per-section "+" passes that section id directly, so you
  // can drop a folder inside any section in one click ("folders in folders").
  const startNewFolder = (parent?: string) => {
    setPlusOpen(false);
    const target = parent ?? resolvedParent();
    setNewFolderName("");
    setNewFolderParent(target);
    setDestExpanded(target, true);
  };

  const cancelNewFolder = () => {
    setNewFolderParent(null);
    setNewFolderName("");
  };

  // Enter commits an inline new folder; empty name or Esc cancels. Creates via
  // the service directly (the only nested-folder path) then refreshes + expands
  // and selects the parent so the new child is visible.
  const commitNewFolder = async () => {
    const parent = newFolderParent;
    const name = newFolderName.trim();
    if (!parent || !name) {
      cancelNewFolder();
      return;
    }
    await notesService.createFolder(name, parent);
    await invalidateFolders();
    setDestExpanded(parent, true);
    setSelectedFolderId(parent);
    cancelNewFolder();
  };

  const onNewFolderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      newFolderHandled.current = true; // the ensuing blur must not re-commit
      void commitNewFolder();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      newFolderHandled.current = true; // the ensuing blur must not override cancel
      cancelNewFolder();
    }
  };

  // clicking away commits a non-empty name (Finder/Apple Notes behaviour), UNLESS
  // a keystroke (Enter/Esc) already handled it — that keystroke unmounts the input
  // and fires this blur, which would otherwise double-create or undo a cancel.
  const onNewFolderBlur = () => {
    if (newFolderHandled.current) {
      newFolderHandled.current = false;
      return;
    }
    void commitNewFolder();
  };

  // the inline new-folder input row, rendered inside the parent's expanded
  // subtree (depth-scaled to sit under its siblings). Shown only when
  // newFolderParent === this id.
  const newFolderRow = (parentId: string, padLeft: number): ReactNode =>
    newFolderParent === parentId ? (
      <div className="sb-newfolder" style={{ paddingLeft: padLeft }}>
        <FolderGlyph size={14} />
        <input
          autoFocus
          type="text"
          placeholder="Folder name…"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={onNewFolderKeyDown}
          onBlur={onNewFolderBlur}
          aria-label="New folder name"
        />
      </div>
    ) : null;

  // a per-section hover "+" — drops a new folder INSIDE that section in one click
  // (the reference's per-section add; the cleanest "folders in folders" gesture).
  // A role=button span: the row itself is a <button>, so a nested <button> would
  // be invalid markup — same trick the note rows use for archive/trash.
  const sectionAddBtn = (parentId: string): ReactNode => (
    <span
      role="button"
      tabIndex={0}
      className="frow-add"
      aria-label="New folder inside"
      title="New folder inside"
      onClick={(event) => {
        event.stopPropagation();
        startNewFolder(parentId);
      }}
    >
      <PlusGlyph size={13} />
    </span>
  );

  // — Chat openers: chats open as PANES now (a pane holds a chat OR a note, side
  //   by side, multiple at once), so "New chat"/a row opens a chat pane; "All
  //   chats" just expands the sidebar list. The open chat = the focused pane's. —
  const openNewChat = () => openChat(null);
  const openAllChats = () => setChatAllOpen(!chatAllOpen);
  const openChatRow = (slug: string) => openChat(slug);

  // a top-level section header (Inbox · Chat · Notes): a clickable disclosure row
  // that toggles its accordion (state persisted in expandedDests under SEC_*).
  const sectionHeader = (
    id: string,
    label: string,
    Glyph: typeof MailGlyph,
    open: boolean,
    count?: number,
  ): ReactNode => (
    <button
      type="button"
      className="sb-section"
      aria-expanded={open}
      onClick={() => toggleDestExpanded(id)}
    >
      <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
        <ChevronRight size={11} />
      </span>
      <Glyph size={15.5} />
      <span className="fname">{label}</span>
      {count != null && count > 0 && <span className="count">{count}</span>}
    </button>
  );

  return (
    <aside
      className="sidebar"
      aria-label="Notes"
      // suppress the WKWebView's default right-click menu ("Reload", …) inside the
      // sidebar; rotli's own row menus (board rename) handle contextmenu instead.
      // The editor keeps its native menu (spell-check / copy) — this is scoped here.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* the sidebar toggle now lives in the titlebar (always visible, the clear
          reopen) — the search row is just the filter + new-note (Seth, 2026-06-15) */}
      <div className="nl-top">
        <div className="filter">
          <SearchGlyph size={13} />
          <input
            ref={filterRef}
            type="text"
            placeholder="Filter notes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={onFilterKeyDown}
            aria-label="Filter notes"
          />
        </div>
        {/* collapse-all — fold every expanded section/folder at once (matches
            the reference's collapse icon; handy once folders nest deep) */}
        <button
          type="button"
          className="icobtn"
          aria-label="Collapse all folders"
          onClick={collapseAllDests}
        >
          <FoldGlyph size={16} />
          <span className="tip" aria-hidden="true">
            Collapse all
          </span>
        </button>
        {/* the "+" create menu (replaces the pencil): New note / board / folder
            (Seth, 2026-06-24). The wrapper holds the anchor ref so toggling the
            button doesn't close-then-reopen on the same click. */}
        <div className="sb-plus" ref={plusBtnRef}>
          <button
            type="button"
            className="icobtn"
            aria-label="New…"
            aria-haspopup="menu"
            aria-expanded={plusOpen}
            onClick={() => setPlusOpen((o) => !o)}
          >
            <PlusGlyph size={16} />
            <span className="tip" aria-hidden="true">
              New…
            </span>
          </button>
          {plusOpen && (
            <div className="rowmenu" ref={plusMenuRef} role="menu">
              <button
                type="button"
                className="rowmenu-item"
                role="menuitem"
                onClick={() => {
                  setPlusOpen(false);
                  dispatch("notes.new");
                }}
              >
                <span className="rowmenu-glyph">
                  <FileGlyph size={16} />
                </span>
                New note
              </button>
              <button
                type="button"
                className="rowmenu-item"
                role="menuitem"
                onClick={() => void createBoard()}
              >
                <span className="rowmenu-glyph">
                  <CanvasItemGlyph size={16} />
                </span>
                New Excalidraw board
              </button>
              <button
                type="button"
                className="rowmenu-item"
                role="menuitem"
                onClick={() => startNewFolder()}
              >
                <span className="rowmenu-glyph">
                  <FolderGlyph size={16} />
                </span>
                New folder
              </button>
            </div>
          )}
        </div>
      </div>

      {/* the three top-level sections (Seth's IA, 2026-06-26): Inbox (email) ·
          Chat · Notes — replacing the retired top module dropdown. Each is a
          collapsible accordion; only the Notes tree is the roving j/k listbox. */}
      <div className="sb-rows" aria-label="Sections">
        {/* ── INBOX = email. The mail integration is a LATER increment; this is a
            clear placeholder of the intended account → thread structure and rotli
            writes nothing for it. ── */}
        {sectionHeader(SEC_INBOX, "Inbox", MailGlyph, inboxSecOpen)}
        {inboxSecOpen && (
          <div className="sb-inbox-stub">
            <div className="sb-stub-row" aria-disabled="true">
              <SearchGlyph size={13} />
              <span className="fname">All</span>
            </div>
            {STUB_EMAIL_ACCOUNTS.map((addr) => (
              <div key={addr} className="sb-stub-row acct" aria-disabled="true">
                <span className="fchev" aria-hidden="true">
                  <ChevronRight size={10} />
                </span>
                <MailGlyph size={13} />
                <span className="fname">{addr}</span>
              </div>
            ))}
            <p className="sb-stub-note">
              Connect email — coming. Your mailboxes (account → thread) will live here.
            </p>
          </div>
        )}

        {/* ── CHAT — a ChatGPT-style front over the memex chats/: New chat, a
            searchable All, and the recent history (a LIMITED view). ── */}
        {sectionHeader(SEC_CHAT, "Chat", ChatGlyph, chatSecOpen, chatList.length)}
        {chatSecOpen && (
          <div className="sb-chat">
            <button type="button" className="sb-chatnew" onClick={openNewChat}>
              <PlusGlyph size={13} />
              <span>New chat</span>
            </button>
            <button
              type="button"
              className={`sb-chatrow all${chatAllOpen ? " sel" : ""}`}
              onClick={openAllChats}
            >
              <SearchGlyph size={13} />
              <span className="fname">All chats</span>
            </button>
            {!activeMemex ? (
              <button
                type="button"
                className="sb-chat-empty"
                onClick={() => dispatch("app.settings")}
              >
                Connect a memex in Settings → Location
              </button>
            ) : chatList.length === 0 ? (
              <p className="sb-chat-empty">No chats yet.</p>
            ) : (
              (chatAllOpen ? chatList : chatList.slice(0, CHAT_SECTION_LIMIT)).map((c) => (
                <button
                  type="button"
                  key={c.slug}
                  className={`sb-chatrow${focusedChatSlug === c.slug ? " sel" : ""}`}
                  onClick={() => openChatRow(c.slug)}
                  title={c.title || c.slug}
                >
                  <ChatGlyph size={13} />
                  <span className="fname">{c.title || c.slug}</span>
                </button>
              ))
            )}
            {!chatAllOpen && chatList.length > CHAT_SECTION_LIMIT && (
              <button type="button" className="sb-chat-more" onClick={openAllChats}>
                +{chatList.length - CHAT_SECTION_LIMIT} more
              </button>
            )}
          </div>
        )}

        {/* ── NOTES — the corpus (the deepest tree). All notes · Board · Recent ·
            the local destinations + Vault/Knowledge + nested folders. This wrapper
            is the roving listbox: Tab enters at the one tabIndex=0 row, j/k walk
            it; the keyboard highlight is :focus-visible. ── */}
        {sectionHeader(SEC_NOTES, "Notes", NotesStackGlyph, notesSecOpen, allNotes.length)}
        {notesSecOpen && (
          <div className="sb-notes-tree" role="listbox" aria-label="Notes tree">
            <button
              type="button"
              className={`frow${contentView === "allNotes" ? " sel" : ""}`}
              onClick={() => {
                setSelectedFolderId(ALL_NOTES);
                setContentView("allNotes");
              }}
              {...rowProps({ id: ALL_NOTES, kind: "smart" })}
            >
              <FileGlyph size={14.5} />
              <span className="fname">All notes</span>
              <span className="count">{allNotes.length}</span>
            </button>
            {/* Board — quick captures collected as cards; opens its grid in the
                content area (an action row, not a roving folder). */}
            <button
              type="button"
              className={`frow${contentView === "board" ? " sel" : ""}`}
              onClick={() => dispatch("board.open")}
            >
              <CaptureBoardGlyph size={14.5} />
              <span className="fname">Captures</span>
              <span className="count">{boardNotes.length}</span>
            </button>
            <button
              type="button"
              className={`frow${contentView === "recent" ? " sel" : ""}`}
              onClick={() => {
                setSelectedFolderId(RECENT);
                setContentView("recent");
              }}
              {...rowProps({ id: RECENT, kind: "smart" })}
            >
              <ClockGlyph size={14.5} />
              <span className="fname">Recent</span>
              <span className="count">{allNotes.length}</span>
            </button>

            {/* — MAIN: your hand-arranged view over the Brain. Add notes with the ⊕
                  on any note row, make folders, drag to arrange (Seth, 2026-07-01). — */}
            <div className="fsec">Main</div>
            {mainProjection.folders.length === 0 && mainProjection.notes.length === 0 ? (
              <p className="main-empty" data-main-id="main:">
                Add notes with the <b>⊕</b> on a note row, then drag to arrange them your way.
              </p>
            ) : (
              <div data-main-id="main:" className="main-tree">
                {renderMainTree(MAIN_ROOT, 0)}
              </div>
            )}
            <button
              type="button"
              className="frow child main-newfolder"
              style={{ paddingLeft: 26 }}
              onClick={() => setMainTree(addFolderToMain(mainManifest.tree, "New folder"), liveIds)}
            >
              <span className="mnf-plus" aria-hidden="true">+</span>
              <span className="fname">New folder</span>
            </button>

            {/* — the Brain: the AI-organized areas (People · Projects · Research · …) — */}
            {childrenOf("wiki").length > 0 && <div className="fsec">Brain</div>}
            {childrenOf("wiki").length > 0 && (
              <p className="brain-hint">
                Organized by AI so anything you save stays findable. Your <b>Main</b> view above is
                yours — same notes, your order.
              </p>
            )}
            {renderFolderTree("wiki", brainNotes, 0, rowProps)}

            <div className="fsec">Destinations</div>

            {/* — destination rows: each toggles expansion AND selects (⌘N target) — */}
            {visibleDestRows.map(({ id, label, Glyph }) => {
              const destNotes = notesByDest[id] ?? [];
              const open = expandedDests[id] ?? false;
              const selected = selectedFolderId === id;
              return (
                <div key={id}>
                  <button
                    type="button"
                    className={`frow${selected ? " sel" : ""}${
                      dropTarget === id ? " drop-over" : ""
                    }`}
                    onClick={() => {
                      toggleDestExpanded(id);
                      setSelectedFolderId(id);
                      setContentView("panes");
                    }}
                    {...(!isVault(id) ? dropProps(id) : {})}
                    {...rowProps({ id, kind: "folder" })}
                  >
                    <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                      <ChevronRight size={10} />
                    </span>
                    <Glyph size={14.5} />
                    <span className="fname">{label}</span>
                    {/* the external Vault is read-mostly — no "+ new note/folder" */}
                    {!isHidden(id) && !isVault(id) && sectionAddBtn(id)}
                    <span className="count">{destNotes.length}</span>
                  </button>
                  {open && (
                    <>
                      {compactRows(destNotes, id, rowProps, 1)}
                      {!isVault(id) && newFolderRow(id, 44)}
                      {renderFolderTree(id, destNotes, 0, rowProps)}
                    </>
                  )}
                </div>
              );
            })}

            {/* added external folders (Seth, 2026-06-27): folders you point rotli at
                without moving them into the memex — browse + edit in place. The
                "Add a folder…" row picks one (relaunches to surface it). */}
            {addedRoots.length > 0 && <div className="fsec">Folders</div>}
            {addedRoots.map((r) => (
              <AddedRootRow key={r.id} root={r} />
            ))}
            <button
              type="button"
              className="frow sb-addfolder"
              title="Add a folder to browse + edit in place (not moved into your memex)"
              onClick={() => void corpusAddFolder()}
            >
              <PlusGlyph size={13} />
              <span className="fname">Add a folder…</span>
            </button>
          </div>
        )}
      </div>

      {/* the row context menu (m / right-click later): one at a time, anchored
          to its row; Esc + outside-click close via the transient stack, and on
          close focus returns to the row (Seth, 2026-06-13). */}
      {menu && (
        <RowMenu
          noteId={menu.noteId}
          hidden={menu.hidden}
          anchor={menu.anchor}
          onClose={() => {
            const anchor = menu.anchor;
            setMenu(null);
            anchor.focus(); // Esc / outside-click returns the cursor to the row
          }}
        />
      )}
    </aside>
  );
}
