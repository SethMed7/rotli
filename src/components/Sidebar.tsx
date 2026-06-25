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
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  invalidateFolders,
  invalidateNotes,
  useArchiveNote,
  useFolders,
  useMoveNote,
  useNotes,
  useRestoreNote,
  useTrashNote,
} from "../services/hooks";
import { notesService } from "../services/notes";
import { corpusCreateBoard } from "../lib/tauri";
import {
  DEST,
  type Destination,
  isHidden,
  isRootMarker,
  isVault,
} from "../services/destinations";
import { useFocusedBoardId, useFocusedNoteId, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import type { Folder, NoteSummary } from "../types";
import { dispatch } from "../keys/registry";
import { useTransientPopover } from "../lib/popover";
import {
  ArchiveGlyph,
  BoardGlyph as CanvasItemGlyph,
  ChevronRight,
  ClockGlyph,
  FileGlyph,
  FolderGlyph,
  InboxGlyph,
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

/** Day label for a compact row's trailing date (lifted from NoteList). */
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

/** The five reserved destinations, in sidebar order, each with its glyph. */
const DEST_ROWS: { id: Destination; label: string; Glyph: typeof InboxGlyph }[] = [
  { id: DEST.inbox, label: "Inbox", Glyph: InboxGlyph },
  { id: DEST.vault, label: "Vault", Glyph: VaultGlyph },
  { id: DEST.storage, label: "Storage", Glyph: StorageGlyph },
  { id: DEST.archive, label: "Archive", Glyph: ArchiveGlyph },
  { id: DEST.trash, label: "Trash", Glyph: TrashGlyph },
];

/** The lifecycle handlers a compact row needs in its hover slot — wired once at
 * the Sidebar top (the hooks live there) and passed down so the row stays a
 * pure-ish leaf (Seth, 2026-06-13). */
interface RowActions {
  archive: (id: string) => void;
  trash: (id: string) => void;
  restore: (id: string) => void;
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
      <FileGlyph size={14} className="snicon" />
      <span className="snt">{note.title || "Empty note"}</span>
      <span className="snd">{dayLabel(note.updatedAt)}</span>
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
  rowProps,
}: {
  board: NoteSummary;
  selected: boolean;
  padLeft: number;
  onOpen: (newTab: boolean) => void;
  rowProps: ReturnType<ReturnType<typeof useRovingList>["rowProps"]>;
}) {
  const onClick = (event: MouseEvent) => onOpen(event.metaKey);
  return (
    <button
      type="button"
      className={selected ? "snrow sel" : "snrow"}
      style={{ paddingLeft: padLeft }}
      onClick={onClick}
      {...rowProps}
    >
      <CanvasItemGlyph size={14} className="snicon" />
      <span className="snt">{board.title || "Untitled board"}</span>
    </button>
  );
}

export function Sidebar() {
  const folders = useFolders().data ?? [];
  const allNotes = useNotes().data ?? [];
  // the five reserved queries — all served from the one cached corpus_list, so
  // five hooks here are five cache reads, not five fetches
  const inboxNotes = useNotes(DEST.inbox).data ?? [];
  const vaultNotes = useNotes(DEST.vault).data ?? [];
  const storageNotes = useNotes(DEST.storage).data ?? [];
  const archiveNotes = useNotes(DEST.archive).data ?? [];
  const trashNotes = useNotes(DEST.trash).data ?? [];
  const boardNotes = useNotes(DEST.board).data ?? [];

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
  };

  // — the active dropzone (a destination/folder id) while a note is mid-drag;
  // drives the .drop-over accent ring and is cleared on leave/drop. —
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  // a flat set of every loaded board id — the roving onOpen/onOpenMenu branch on
  // this (board rows ride kind:"note" in the roving list since RovingRow has no
  // board variant, so the Set is how we tell a board apart at open time).
  const boardIds = new Set<string>();
  for (const n of [
    ...allNotes,
    ...inboxNotes,
    ...vaultNotes,
    ...storageNotes,
    ...archiveNotes,
    ...trashNotes,
  ])
    if (isBoard(n)) boardIds.add(n.id);

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
              onOpen={openRow(note.id)}
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
    childrenOf(parentId).map((folder) => {
      const open = expandedDests[folder.id] ?? false;
      const selected = selectedFolderId === folder.id;
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
            <span className="fname">{folder.name}</span>
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

  const rows: RovingRow[] = [
    { id: ALL_NOTES, kind: "smart" },
    { id: RECENT, kind: "smart" },
    ...DEST_ROWS.flatMap(({ id }) => {
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
  ];

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
      if (row.kind !== "note" || boardIds.has(row.id)) return;
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

  return (
    <aside className="sidebar" aria-label="Notes">
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

      {/* the Board — quick captures collected as cards; opens its own surface
          (Seth, 2026-06-19). Outside the roving listbox: it's an action, not a
          folder selection. */}
      <button
        type="button"
        className={`frow sb-board${contentView === "board" ? " sel" : ""}`}
        onClick={() => dispatch("board.open")}
      >
        <CaptureBoardGlyph size={14.5} />
        <span className="fname">Board</span>
        <span className="count">{boardNotes.length}</span>
      </button>

      {/* the scrolling tree is the roving listbox: Tab enters at the one
          tabIndex=0 row, then j/k walk it (Seth, 2026-06-13). The keyboard
          highlight is :focus-visible — .sel stays the open-note grammar. */}
      <div className="sb-rows" role="listbox" aria-label="Notes tree">
        {/* — smart rows: same semantics as FoldersRail (no expansion) — */}
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
        <button
          type="button"
          className={`frow${selectedFolderId === RECENT ? " sel" : ""}`}
          onClick={() => {
            setSelectedFolderId(RECENT);
            setContentView("panes");
          }}
          {...rowProps({ id: RECENT, kind: "smart" })}
        >
          <ClockGlyph size={14.5} />
          <span className="fname">Recent</span>
          <span className="count">{Math.min(allNotes.length, 9)}</span>
        </button>

        <div className="fsec">Destinations</div>

        {/* — destination rows: each toggles expansion AND selects (⌘N target) — */}
        {DEST_ROWS.map(({ id, label, Glyph }) => {
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
