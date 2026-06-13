// The unified compact-tree sidebar (Seth, 2026-06-13): ONE scrollable column
// that REPLACES the old FoldersRail + NoteList two-rail era. Smart rows (All
// notes · Recent) sit on top; the five reserved destinations (Inbox · Brain ·
// Storage · Archive · Trash) follow, each EXPANDABLE inline to reveal its notes
// as compact rows. User folders nest under Brain/Storage (path-style ids like
// "Brain/Work"), each independently expandable and indented by depth.
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
  useRef,
  useState,
} from "react";
import {
  useArchiveNote,
  useFolders,
  useMoveNote,
  useNotes,
  useRestoreNote,
  useTrashNote,
} from "../services/hooks";
import { DEST, type Destination, isHidden } from "../services/destinations";
import { useFocusedNoteId, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import type { Folder, NoteSummary } from "../types";
import { dispatch } from "../keys/registry";
import {
  ArchiveGlyph,
  BrainGlyph,
  ChevronRight,
  ClockGlyph,
  FileGlyph,
  FolderGlyph,
  InboxGlyph,
  PencilGlyph,
  SearchGlyph,
  SidebarGlyph,
  StorageGlyph,
  TrashGlyph,
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
  { id: DEST.brain, label: "Brain", Glyph: BrainGlyph },
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
  onOpen,
  actions,
  rowProps,
}: {
  note: NoteSummary;
  selected: boolean;
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
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      {...rowProps}
    >
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

export function Sidebar() {
  const folders = useFolders().data ?? [];
  const allNotes = useNotes().data ?? [];
  // the five reserved queries — all served from the one cached corpus_list, so
  // five hooks here are five cache reads, not five fetches
  const inboxNotes = useNotes(DEST.inbox).data ?? [];
  const brainNotes = useNotes(DEST.brain).data ?? [];
  const storageNotes = useNotes(DEST.storage).data ?? [];
  const archiveNotes = useNotes(DEST.archive).data ?? [];
  const trashNotes = useNotes(DEST.trash).data ?? [];

  // a flat id → note lookup across every loaded list (incl. hidden Archive/
  // Trash) — the drop handler's same-folder no-op check trusts this (Seth,
  // 2026-06-13). allNotes alone would miss hidden notes dragged back home.
  const noteById = new Map<string, NoteSummary>();
  for (const n of [
    ...allNotes,
    ...inboxNotes,
    ...brainNotes,
    ...storageNotes,
    ...archiveNotes,
    ...trashNotes,
  ])
    noteById.set(n.id, n);

  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const expandedDests = useUiStore((s) => s.expandedDests);
  const toggleDestExpanded = useUiStore((s) => s.toggleDestExpanded);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const focusedNoteId = useFocusedNoteId();
  const openNote = usePanesStore((s) => s.openNote);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
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
    [DEST.brain]: brainNotes,
    [DEST.storage]: storageNotes,
    [DEST.archive]: archiveNotes,
    [DEST.trash]: trashNotes,
  };

  // count for a user folder = own notes + every descendant folder's notes,
  // sliced from the destination subtree it belongs to (mirrors FoldersRail)
  const childrenOf = (parentId: string) => folders.filter((f) => f.parentId === parentId);
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

  // —— compact rows for one folder id (own notes only), filtered + sorted ——
  // `rp` is the roving rowProps factory (passed in so this helper can run before
  // useRovingList is even declared — React calls it during render either way).
  const compactRows = (
    notes: NoteSummary[],
    folderId: string,
    rp: ReturnType<typeof useRovingList>["rowProps"],
  ): ReactNode =>
    notes
      .filter((n) => n.folderId === folderId && matches(n))
      .map((note) => (
        <CompactNoteRow
          key={note.id}
          note={note}
          selected={note.id === focusedNoteId}
          onOpen={openRow(note.id)}
          actions={rowActions}
          rowProps={rp({ id: note.id, kind: "note" })}
        />
      ));

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
            style={{ paddingLeft: 18 + depth * 14 }}
            onClick={() => {
              toggleDestExpanded(folder.id);
              setSelectedFolderId(folder.id);
            }}
            {...dropProps(folder.id)}
            {...rp({ id: folder.id, kind: "folder" })}
          >
            <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
              <ChevronRight size={10} />
            </span>
            <FolderGlyph size={14} />
            <span className="fname">{folder.name}</span>
            <span className="count">{countFor(folder, destNotes)}</span>
          </button>
          {open && (
            <>
              {compactRows(destNotes, folder.id, rp)}
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
  const visibleNoteRows = (notes: NoteSummary[], folderId: string): RovingRow[] =>
    notes
      .filter((n) => n.folderId === folderId && matches(n))
      .map((n) => ({ id: n.id, kind: "note" as const }));

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
      if (row.kind === "note") openNote(row.id, { newTab });
      else {
        toggleDestExpanded(row.id);
        setSelectedFolderId(row.id);
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
    // m: only note rows get the full menu; folder/smart rows have no popover.
    onOpenMenu: (row, anchor) => {
      if (row.kind !== "note") return;
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

  return (
    <aside className="sidebar" aria-label="Notes">
      <div className="nl-top">
        {/* the unified sidebar toggle (Seth, 2026-06-13): hides/shows the one
            sidebar with memory — lives left of the filter, not in the titlebar */}
        <button
          type="button"
          className="sidebtn"
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          onClick={() => dispatch("chrome.toggleSidebars")}
        >
          <SidebarGlyph size={15} />
          <span className="tip" aria-hidden="true">
            {sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          </span>
        </button>
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

      {/* the scrolling tree is the roving listbox: Tab enters at the one
          tabIndex=0 row, then j/k walk it (Seth, 2026-06-13). The keyboard
          highlight is :focus-visible — .sel stays the open-note grammar. */}
      <div className="sb-rows" role="listbox" aria-label="Notes tree">
        {/* — smart rows: same semantics as FoldersRail (no expansion) — */}
        <button
          type="button"
          className={`frow${selectedFolderId === ALL_NOTES ? " sel" : ""}`}
          onClick={() => setSelectedFolderId(ALL_NOTES)}
          {...rowProps({ id: ALL_NOTES, kind: "smart" })}
        >
          <FileGlyph size={14.5} />
          <span className="fname">All notes</span>
          <span className="count">{allNotes.length}</span>
        </button>
        <button
          type="button"
          className={`frow${selectedFolderId === RECENT ? " sel" : ""}`}
          onClick={() => setSelectedFolderId(RECENT)}
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
                }}
                {...dropProps(id)}
                {...rowProps({ id, kind: "folder" })}
              >
                <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                  <ChevronRight size={10} />
                </span>
                <Glyph size={14.5} />
                <span className="fname">{label}</span>
                <span className="count">{destNotes.length}</span>
              </button>
              {open && (
                <>
                  {compactRows(destNotes, id, rowProps)}
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
