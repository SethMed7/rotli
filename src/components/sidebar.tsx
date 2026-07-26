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
  uniqueRootFolderName,
  buildMainTree,
  mainFolderIds,
  mainItemIdsInFolder,
  mainNoteIds,
  mainParentOfNote,
  moveInTree,
  removeFromMain,
  renameFolderInMain,
} from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { renameMainRef, useMainStore } from "../state/main";
import { useViewsStore } from "../state/views";
import {
  createNamedView,
  deleteNamedView,
  renameNamedView,
  setNamedViewTree,
  transferTreeItemToView,
  viewFolderNameError,
  viewNameError,
  viewTree,
} from "../services/viewTree";
import { QUICK_MAX, togglePinQuick } from "../state/quick";
import { InlineRenameInput } from "./inlineRenameInput";
import { useNoteMenu } from "./useNoteMenu";
import { deriveJournal } from "../services/brainJournal";
import {
  invalidateFolders,
  invalidateNotes,
  useArchiveNote,
  useCorpusRoots,
  useFolders,
  useJournal,
  useTasks,
  useMainGcIds,
  useNoteIndex,
  useNotes,
  useRestoreNote,
  useSearchableNotes,
  useTrashItems,
  useTrashNote,
} from "../services/hooks";
import { notesService } from "../services/notes";
import { type CorpusRoot, corpusAddFolder, corpusForgetFolder, corpusRenameBoard } from "../lib/tauri";
import {
  DEST,
  type Destination,
  destContains,
  isHidden,
  isRootMarker,
  isVault,
} from "../services/destinations";
import {
  sidebarItemId,
  useFocusedChatSlug,
  useFocusedNoteId,
  useFocusedTab,
  usePanesStore,
} from "../state/panes";
import { ALL_NOTES, RECENT, SEC_CHAT, SEC_INBOX, SEC_NOTES, TASKS, useUiStore } from "../state/ui";
import { activeInstance } from "../memex/config";
import {
  invalidateMemex,
  useChooseFolder,
  useConnectBrain,
  useInstanceChats,
  useMemexConfig,
} from "../memex/useMemex";
import { buildVaultMenu, vaultDisplayName } from "../services/vaultSwitcher";
import { archiveChat, deleteChat, pinChat } from "../memex/service";
import { useChatRename } from "../services/chatRename";
import type { Folder, NoteSummary } from "../types";
import { dispatch } from "../keys/registry";
import { openNewItemMenu } from "../newItems/menu";
import { longDateLabel } from "../lib/dateLabels";
import { createDragGhost } from "../lib/dragGhost";
import { createPointerDragSession } from "../lib/pointerDrag";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import { isSecureBrainFolder } from "../security/secureNotes";
import {
  ArchiveGlyph,
  BoardGlyph as CanvasItemGlyph,
  ChatGlyph,
  ChevronRight,
  ClockGlyph,
  TaskGlyph,
  CoffeeGlyph,
  ExcalidrawGlyph,
  FileGlyph,
  glyphForNote,
  FolderGlyph,
  InboxGlyph,
  MailGlyph,
  NewFileGlyph,
  NewFolderGlyph,
  NotesStackGlyph,
  PinGlyph,
  PlusGlyph,
  SearchGlyph,
  ShieldGlyph,
  StarGlyph,
  StorageGlyph,
  TrashGlyph,
  VaultGlyph,
} from "./glyphs";
import { type RovingRow, useRovingList } from "./sidebar/useRovingList";
import { noteDisplayTitle } from "./sidebar/noteDisplayTitle";
import { BreveSidebar } from "./breve/breveSidebar";
import { QuokkaMark } from "./character";

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
 * 2026-06-26). The ⌥C one-breath capture lands as a staged note in wiki/_inbox/
 * (inbox.md is not a rotli write surface — #96, audit 2026-07). */
const DEST_ROWS: { id: Destination; label: string; Glyph: typeof InboxGlyph }[] = [
  // "Capture" (DEST.inbox) is GONE — captures have ONE home now, the "Captures"
  // row under Notes (Seth, 2026-06-30). Staged notes (wiki/_inbox) project there.
  { id: DEST.secure, label: "Secure notes", Glyph: ShieldGlyph },
  // "Linked library" (2026-07-26): a CONNECTED vault — distinct from both the
  // local Library and the vault-switcher's whole-vault concept
  { id: DEST.vault, label: "Linked library", Glyph: VaultGlyph },
  // "Assets" is the DISPLAY name (decision 2026-07-25, Zen reference) — one
  // system home for every image/video/PDF/file. The id + disk lane stay
  // "Storage"/storage/ (persisted expansion keys, folder ids, the contract).
  { id: DEST.storage, label: "Assets", Glyph: StorageGlyph },
  { id: DEST.archive, label: "Archive", Glyph: ArchiveGlyph },
  { id: DEST.trash, label: "Trash", Glyph: TrashGlyph },
];

/** Stubbed email accounts for the Inbox (email) placeholder — the intended
 * account/thread structure, rendered disabled until the mail integration lands
 * (a LATER increment; this writes nothing). These two are Seth's known addresses
 * from the IA doc Addendum. */
const STUB_EMAIL_ACCOUNTS = ["maintainer@example.com", "hello@sethmedina.com"];

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
 * ⌘-click opens it in a new tab. The .snact slot carries the hover affordances
 * — Archive + Trash for a normal row, a single Restore for a row already in
 * Archive/Trash. Each action button stops propagation so it never opens the
 * note. */
function CompactNoteRow({
  note,
  displayTitle,
  selected,
  padLeft,
  onOpen,
  actions,
  onBeginMainDrag,
  mainDragRef,
  rowProps,
  onContextMenu,
}: {
  note: NoteSummary;
  /** Context-shortened tree label; the NoteSummary keeps its canonical title. */
  displayTitle?: string;
  selected: boolean;
  /** Depth-scaled left inset so a note sits under its folder (Seth, 2026-06-15). */
  padLeft: number;
  onOpen: (newTab: boolean) => void;
  actions: RowActions;
  /** Right-click → open the row's context menu (optional). */
  onContextMenu?: (e: MouseEvent) => void;
  /** Begin a cross-section pointer-drag of this note INTO Main (optional). */
  onBeginMainDrag?: (e: ReactPointerEvent) => void;
  /** Shared flag set while such a drag happens — suppresses the row's click. */
  mainDragRef?: { current: boolean };
  /** Roving-list props (Seth, 2026-06-13): tabIndex/role/aria-selected + the
   * focus-scoped j/k onKeyDown. Spread last so the keyboard handlers win, but
   * the row keeps its own mouse open + drag gestures. */
  rowProps: ReturnType<ReturnType<typeof useRovingList>["rowProps"]>;
}) {
  const onClick = (event: MouseEvent) => {
    if (mainDragRef?.current) return; // a drag-into-Main just happened, not a click
    onOpen(event.metaKey);
  };
  const hidden = isHidden(note.folderId); // Archive/Trash (or nested) → Restore
  return (
    <button
      type="button"
      data-note-id={note.id}
      className={selected ? "snrow sel" : "snrow"}
      style={{ paddingLeft: padLeft }}
      onClick={onClick}
      onAuxClick={(event) => {
        // middle-click opens in a new tab (IDE/browser habit) — no modifier
        if (event.button === 1) {
          event.preventDefault();
          onOpen(true);
        }
      }}
      onContextMenu={onContextMenu}
      onPointerDown={onBeginMainDrag}
      {...rowProps}
    >
      {glyphForNote(note, { size: 14, className: "snicon" })}
      <span className="snt">{displayTitle || note.title || "Empty note"}</span>
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
  onCommitRename,
  onCancelRename,
  rowProps,
  onContextMenu,
}: {
  board: NoteSummary;
  selected: boolean;
  padLeft: number;
  onOpen: (newTab: boolean) => void;
  renaming: boolean;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  rowProps: ReturnType<ReturnType<typeof useRovingList>["rowProps"]>;
  /** Right-click → the full note context menu (its Rename… drops the row into
   * the inline rename below — the old rename-only right-click grew up). */
  onContextMenu: (e: MouseEvent) => void;
}) {
  const onClick = (event: MouseEvent) => onOpen(event.metaKey);
  // inline rename: the menu's Rename… (or a freshly created board) turns the row
  // into a text input. Enter commits; Esc / click-away cancels (Seth, 2026-06-26).
  if (renaming) {
    return (
      <div className="sb-newfolder snrow" style={{ paddingLeft: padLeft }}>
        <ExcalidrawGlyph size={14} className="snicon" />
        <InlineRenameInput
          defaultValue={board.title}
          placeholder="Board name…"
          ariaLabel="Rename board"
          onCommit={onCommitRename}
          onCancel={onCancelRename}
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
      onAuxClick={(event) => {
        // middle-click opens in a new tab — the same gesture note rows have
        if (event.button === 1) {
          event.preventDefault();
          onOpen(true);
        }
      }}
      onContextMenu={onContextMenu}
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
            if (confirming)
              void corpusForgetFolder(root.id); // relaunches
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
  const foldersData = useFolders().data;
  // the COUNTS speak the same universe the All-notes surface renders
  // (useSearchableNotes — staged + Brain + Vault + added roots): counting the
  // plain useNotes VIEW made the sidebar and the surface disagree the moment
  // an ⌥C capture landed (#60, audit 2026-07). Cache reads, not new fetches.
  const searchableNotes = useSearchableNotes().notes;
  const searchableCount = searchableNotes.length;
  // the five reserved queries — all served from the one cached corpus_list, so
  // five hooks here are five cache reads, not five fetches
  const inboxNotes = useNotes(DEST.inbox).data ?? [];
  const secureNotes = useNotes(DEST.secure).data ?? [];
  const vaultNotes = useNotes(DEST.vault).data ?? [];
  const storageNotesFlatData = useNotes(DEST.storage).data;
  const archiveNotes = useNotes(DEST.archive).data ?? [];
  const trashNotes = useNotes(DEST.trash).data ?? [];
  const boardNotesData = useNotes(DEST.board).data;
  // Storage organization (Seth, 2026-06-30): regroup the flat binaries into a
  // synthetic tree (Type / Date / Folder, a Settings knob) IN THE FRONTEND. The
  // synthetic "Storage/<…>" folders merge into the folder list and the storage
  // notes re-home, so the existing recursive renderer + roving cursor just work —
  // no backend change, instant toggle.
  const storageGrouping = useUiStore((s) => s.storageGrouping);
  const storageTree = useMemo(
    () => buildStorageTree(storageNotesFlatData ?? [], storageGrouping),
    [storageNotesFlatData, storageGrouping],
  );
  const storageNotes = storageTree.notes;
  const folders = useMemo(
    () => [
      ...(foldersData ?? []).filter(
        (f) =>
          f.id !== "storage" &&
          !f.id.startsWith("storage/") &&
          // hide internal memex scaffolding from the Brain (_inbox / _templates)
          !f.id.startsWith("wiki/_"),
      ),
      ...storageTree.folders,
    ],
    [foldersData, storageTree.folders],
  );
  // hide the "Vault" (linked-library) destination until one is actually connected —
  // an empty Vault row next to the user's own memex-vault folder just confuses
  // (Seth, 2026-06-30). It returns the moment a vault root has notes/folders.
  const showVault = vaultNotes.length > 0 || folders.some((f) => f.id.startsWith("vault:"));
  const visibleDestRows = useMemo(
    () => DEST_ROWS.filter((d) => d.id !== DEST.secure && (d.id !== DEST.vault || showVault)),
    [showVault],
  );
  // the BRAIN — the AI-organized wiki areas (People · Projects · Research · …).
  // Curated notes (no shelf) project to their disk area "wiki/<area>"; we surface
  // them as a navigable Brain section under Notes (Seth, 2026-06-30).
  // the BRAIN = the curated wiki AREAS (People/Projects/Research/…). Hide the
  // internal memex scaffolding: `_inbox` (note staging — surfaced as Captures) and
  // `_templates` are underscore-prefixed = not user-facing areas (Seth, 2026-06-30).
  const brainNotes = useMemo(
    () => searchableNotes.map(projectNoteToBrain).filter((n): n is NoteSummary => n !== null),
    [searchableNotes],
  );
  // unreviewed daemon proposals — the quiet badge on the Activity link (§4.4.2)
  const pendingProposals = deriveJournal(useJournal().data ?? []).pending.length;
  // open checkboxes across the corpus — the Tasks smart row's count
  const openTaskCount = useTasks().data?.length ?? 0;
  // raw vault (vault-vs-brain, 2026-07-26): the Brain section's copy changes —
  // the areas are real folders either way, so the TREE stays visible
  const brainEnabledUi = useUiStore((s) => s.brainEnabled);

  // MAIN — the user's hand-arranged view over the Brain (memex-vault wiki/projects/rotli/main-brain-daemon.md).
  // A `.rotli/main.json` manifest of folders + note-id refs, projected into synthetic
  // sidebar rows. It references notes BY ID, so a daemon refiling the Brain underneath
  // never moves Main. Mouse + drag navigable (not part of the j/k roving list yet).
  const mainManifest = useMainStore((s) => s.manifest);
  const setMainTree = useMainStore((s) => s.setTree);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const setViewsManifest = useViewsStore((s) => s.setManifest);
  const viewsWritable = useViewsStore((s) => s.writable);
  const viewsSaveState = useViewsStore((s) => s.saveState);
  const viewsError = useViewsStore((s) => s.error);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const activeTree = activeView ? viewTree(viewsManifest, activeView) : mainManifest.tree;
  const setActiveTree = (tree: typeof activeTree, ids?: Set<string>) => {
    if (activeView) {
      setViewsManifest(setNamedViewTree(viewsManifest, activeView, tree, ids));
    } else {
      setMainTree(tree, ids);
    }
  };
  const openNoteMenu = useNoteMenu();
  // the FULL id → note index (staged Board + Archive + Trash + Vault included).
  // Main references notes by id from ANYWHERE — projecting or GC'ing it from
  // allNotes alone drops every STAGED (wiki/_inbox → "Board") ref: the row
  // vanishes AND the next Main save prunes it from main.json for good.
  // liveIds is undefined until EVERY listing has SUCCEEDED — setTree skips the
  // GC then (an unreachable vault / a boot-frame drag must never prune live refs).
  const noteIndex = useNoteIndex();
  const liveIds = useMainGcIds();
  const mainProjection = useMemo(() => buildMainTree(activeTree, noteIndex), [activeTree, noteIndex]);
  // added external folders (Seth, 2026-06-27): roots the user pointed rotli at,
  // not in the memex — every registered root except the built-in default + vault.
  const addedRoots = (useCorpusRoots().data ?? []).filter((r) => r.id !== "default" && r.id !== "vault");

  // — the Chat section: the active memex's chats/ history (the same source the
  // Chat surface reads), plus the chat-selection ui state the surface renders. —
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const rawChatListData = useInstanceChats(activeMemex).data;
  // pinned chats float to the top (stable sort keeps the slug order within each
  // group) — the pin lives in the chat's own frontmatter (Seth #4, 2026-07-08)
  const chatList = useMemo(
    () => [...(rawChatListData ?? [])].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [rawChatListData],
  );
  const chatRename = useChatRename();
  const quickNoteIds = useUiStore((s) => s.quickNoteIds);
  // the LIMITED Chat view's cap — a Settings knob (5/10/15), default 5 (#17)
  const chatSidebarLimit = useUiStore((s) => s.chatSidebarLimit);

  // Captures count mirrors BoardSurface's curated-note rule: a staged note
  // placed in Main or starred for Quick access is a full note, not a capture.
  const captureCount = useMemo(() => {
    const boardNotes = boardNotesData ?? [];
    const curated = mainNoteIds(mainManifest.tree);
    return boardNotes.filter((n) => !curated.has(n.id) && !quickNoteIds.includes(n.id)).length;
  }, [boardNotesData, mainManifest.tree, quickNoteIds]);

  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const contentView = useUiStore((s) => s.contentView);
  const setContentView = useUiStore((s) => s.setContentView);
  const expandedDests = useUiStore((s) => s.expandedDests);
  const collapseAllDests = useUiStore((s) => s.collapseAllDests);
  const toggleDestExpanded = useUiStore((s) => s.toggleDestExpanded);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  const openChat = usePanesStore((s) => s.openChat);
  const retargetBoard = usePanesStore((s) => s.retargetBoard);
  const focusedChatSlug = useFocusedChatSlug();
  // The DERIVED destination highlight (Seth #1, 2026-07-08): a destination/folder
  // row only reads "selected" while the focused tab's content actually LIVES
  // under it — a stale ⌘N create-target (e.g. Storage) no longer glows while you
  // work in a Main note. Where the content lives = its REAL home (the note
  // index), never the Main projection; a file's home is its wire folder; a chat
  // lives in the Chat front, so every destination goes quiet. Nothing focused
  // (or a meta surface like Activity) keeps the plain behavior.
  const focusedTab = useFocusedTab();
  const focusedItemId = sidebarItemId(focusedTab);
  const focusedHome = useMemo(() => {
    if (!focusedTab) return null;
    if (focusedTab.surfaceKind === "note") {
      const note = noteIndex.get(focusedTab.noteId);
      if (!note) return null;
      const diskFolder = noteDiskFolder(note);
      // wiki/_inbox is internal staging; its user-facing home is Captures.
      return diskFolder.startsWith("wiki/_") ? note.folderId : diskFolder;
    }
    if (focusedTab.surfaceKind === "canvas") return noteIndex.get(focusedTab.boardId)?.folderId ?? null;
    if (focusedTab.surfaceKind === "file") {
      const slash = focusedTab.fileId.lastIndexOf("/");
      if (slash >= 0) return focusedTab.fileId.slice(0, slash);
      // slashless: a root-marker file ("lib:x.pdf") homes to its marker ("lib:");
      // a bare corpus-root file keeps its own id (matches no destination — quiet)
      const colon = focusedTab.fileId.indexOf(":");
      return colon > 0 ? focusedTab.fileId.slice(0, colon + 1) : focusedTab.fileId;
    }
    if (focusedTab.surfaceKind === "chat") return "chats";
    return null; // activity + future meta surfaces
  }, [focusedTab, noteIndex]);
  const destSelected = (id: string) =>
    selectedFolderId === id && (focusedHome === null || destContains(id, focusedHome));
  const renamingBoardId = useUiStore((s) => s.renamingBoardId);
  const setRenamingBoardId = useUiStore((s) => s.setRenamingBoardId);
  // failed row-menu actions (file-to-brain, board rename) land here — the menu
  // that launched them is gone by the time they fail (#11, audit 2026-07)
  const rowActionError = useUiStore((s) => s.rowActionError);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const sidebarZoom = useUiStore((s) => s.sidebarZoom);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  // the sidebar's live filter is retired (Seth, 2026-07-07) — the global titlebar
  // search covers it; `filter` stays empty so `matches()` passes every row.
  const filter = "";

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

  // — lifecycle mutations (Seth, 2026-06-13): wired once here, the .mutate fns
  // flow down to every compact row's hover slot AND the destination dropzones.
  // moveNote handles the origin rule, so dropping on Archive/Trash archives or
  // trashes and dropping on a normal folder moves. —
  const archiveNote = useArchiveNote();
  const trashNote = useTrashNote();
  const trashItems = useTrashItems();
  const restoreNote = useRestoreNote();
  const rowActions: RowActions = {
    archive: (id) => archiveNote.mutate(id),
    trash: (id) => trashNote.mutate(id),
    restore: (id) => restoreNote.mutate(id),
    addToMain: (id) => setMainTree(addNoteToMain(mainManifest.tree, id), liveIds),
  };

  // — Main folder rename + name-first create (#16, audit 2026-07): the ⊕ used to
  //   mint a permanent "New folder 2" with no rename anywhere. renamingMainId
  //   turns that folder's row into an inline input (the board-row pattern);
  //   mainNewFolder is the ⊕'s name-first input at the Main root. —
  const [renamingMainId, setRenamingMainId] = useState<string | null>(null);
  const [mainNewFolder, setMainNewFolder] = useState(false);
  const [editingView, setEditingView] = useState<"create" | "rename" | null>(null);
  const [viewInputError, setViewInputError] = useState<string | null>(null);
  const [deletingView, setDeletingView] = useState<string | null>(null);
  // Enter/Esc unmount the new-folder input, which fires its commit-on-blur —
  // this ref tells the blur the keystroke already settled it (newFolderHandled's law)
  const mainNewFolderHandled = useRef(false);
  const openContextMenu = useContextMenu((s) => s.open);

  useEffect(() => {
    if (activeView && !viewsManifest.views.some((view) => view.name === activeView)) {
      setActiveView(null);
    }
  }, [activeView, setActiveView, viewsManifest.views]);

  const commitViewName = (value: string) => {
    const error = viewNameError(
      value,
      viewsManifest.views,
      editingView === "rename" ? (activeView ?? undefined) : undefined,
    );
    if (error) {
      setViewInputError(error);
      return;
    }
    const name = value.trim();
    if (editingView === "rename" && activeView) {
      setViewsManifest(renameNamedView(viewsManifest, activeView, name));
    } else {
      setViewsManifest(createNamedView(viewsManifest, name));
    }
    setActiveView(name);
    setEditingView(null);
    setViewInputError(null);
  };

  const openViewMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuSpec[] = [
      {
        kind: "action",
        label: "Main — all items",
        checked: activeView === null,
        checkedMark: "highlight",
        onClick: () => setActiveView(null),
      },
      ...viewsManifest.views.map((view) => ({
        kind: "action" as const,
        label: view.name,
        checked: activeView === view.name,
        checkedMark: "highlight" as const,
        onClick: () => setActiveView(view.name),
      })),
      { kind: "sep" },
      {
        kind: "action",
        label: "New view…",
        disabled: !viewsWritable,
        onClick: () => {
          setEditingView("create");
          setViewInputError(null);
        },
      },
    ];
    if (activeView) {
      items.push(
        {
          kind: "action",
          label: "Rename view…",
          disabled: !viewsWritable,
          onClick: () => {
            setEditingView("rename");
            setViewInputError(null);
          },
        },
        {
          kind: "action",
          label: "Delete view…",
          danger: true,
          disabled: !viewsWritable,
          onClick: () => setDeletingView(activeView),
        },
      );
    }
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, items, { returnFocus: () => e.currentTarget.focus() });
  };

  // — the vault switcher (decision 2026-07-25): the sidebar header names the
  //   current vault and opens one menu — switch (repoints the notes folder,
  //   which relaunches), connect another, or open Location settings. Menu
  //   grammar lives in services/vaultSwitcher.ts (pure, tested). —
  const chooseFolderMut = useChooseFolder();
  const connectBrainMut = useConnectBrain();
  const vaultName = vaultDisplayName(memexCfg.data?.instances ?? []);
  const openVaultMenu = (e: MouseEvent<HTMLButtonElement>) => {
    const vaultErr = (verb: string) => (err: unknown) =>
      setRowActionError(`Couldn’t ${verb} — ${err instanceof Error ? err.message : String(err)}`);
    const items = buildVaultMenu(memexCfg.data?.instances ?? [], {
      switchTo: (root) => void chooseFolderMut.mutateAsync(root).catch(vaultErr("switch vaults")),
      connect: () => void connectBrainMut.mutateAsync(undefined).catch(vaultErr("connect the vault")),
      // Location lives inside Settings — the pane picker is one click away
      openSettings: () => dispatch("app.settings"),
    });
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, items, { returnFocus: () => e.currentTarget.focus() });
  };

  // — Main pointer-drag reorder (HTML5 DnD is dead in the WKWebView shell, so the
  //   BoardSurface pointer pattern; a threshold distinguishes drag from click) —
  const [mainDragId, setMainDragId] = useState<string | null>(null);
  const [mainDrop, setMainDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const didMainDragRef = useRef(false);
  // cross-section drag: a note dragged FROM the Brain (or any note list) INTO Main.
  // `crossDragRef` suppresses the row's click when a drag actually happened.
  const crossDragRef = useRef(false);

  // ONE pointer-drag for the Main tree (2026-07-01 consolidation — this and the
  // cross-section add had grown as twins): "move" drags a row already in Main
  // (reorder / into folders, paints the .dragging row); "add" pulls a note in
  // from any other list (Brain, a folder). Same hit-test + drop grammar; the
  // two modes differ only in their commit and which suppress-click ref they
  // arm. (HTML5 DnD stays dead in the WKWebView shell — pointer events only.)
  // The dragged row rides the cursor as a floating ghost (the shared
  // lib/dragGhost, same as tab drags); Esc / pointercancel abandons the drag.
  const startMainDrag = (e: ReactPointerEvent, id: string, mode: "move" | "add", label: string) => {
    // button guard BEFORE the ref reset — a right-click must not clear the
    // last drag's click suppression (the session guards again internally)
    if (e.button !== 0) return;
    let drop: { id: string; pos: DropPos } | null = null;
    const dragFlag = mode === "move" ? didMainDragRef : crossDragRef;
    dragFlag.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(label, x, y),
      // dragFlag stays armed past onEnd so the trailing click is eaten
      onStart: () => {
        dragFlag.current = true;
        if (mode === "move") setMainDragId(id);
      },
      onMove: (x, y) => {
        const hit = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
          "[data-main-id]",
        ) as HTMLElement | null;
        const tid = hit?.dataset.mainId;
        if (!hit || !tid || (mode === "move" && tid === id)) {
          drop = null;
          setMainDrop(null);
          return;
        }
        const rect = hit.getBoundingClientRect();
        const rel = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
        // a folder's middle third = drop INTO it; otherwise before/after by half
        let pos: DropPos = rel < 0.5 ? "before" : "after";
        if (hit.dataset.mainFolder === "1" && rel > 0.33 && rel < 0.67) pos = "into";
        if (tid === MAIN_ROOT) pos = "into"; // the whole Main zone → land at root
        drop = { id: tid, pos };
        setMainDrop(drop);
      },
      onDrop: () => {
        const d = drop;
        if (!d) return;
        if (mode === "add") {
          // Named views are subsets of Main: a cross-section add always keeps a
          // global Main reference, then places the item in the active tree.
          if (activeView) setMainTree(addNoteToMain(mainManifest.tree, id), liveIds);
          let tree = addNoteToMain(activeTree, id);
          if (d.id !== MAIN_ROOT) tree = moveInTree(tree, id, d.id, d.pos);
          setActiveTree(tree, liveIds);
        } else {
          setActiveTree(moveInTree(activeTree, id, d.id, d.pos), liveIds);
        }
      },
      onEnd: () => {
        if (mode === "move") setMainDragId(null);
        setMainDrop(null);
      },
    });
  };

  // recursive render of the Main tree — mouse + drag + roving j/k (Seth follow-up,
  // 2026-07-01). Synthetic folders (id "main:<path>") + notes re-homed by the
  // manifest; a note references the same .md as its Brain twin (one file, two
  // views). `rp` is the roving rowProps factory; note rows ride with a "main>"
  // prefix so they never collide with their Brain twins in the roving list.
  const renderMainTree = (
    parentId: string,
    depth: number,
    rp: ReturnType<typeof useRovingList>["rowProps"],
  ): ReactNode => {
    const rowPad = 10 + (depth + 1) * 16;
    // Folder rows reserve 18px for the disclosure chevron. Note rows and
    // rename inputs compensate for that slot so same-depth icons share one
    // visual column and nested children still advance by exactly 16px.
    const contentPad = rowPad + 18;
    const childFolders = mainProjection.folders.filter((f) => f.parentId === parentId);
    // the live filter narrows Main too (it used to skip this section entirely —
    // the one Seth curates by hand); MUST mirror mainRovingRows below
    const childNotes = mainProjection.notes
      .filter((n) => n.folderId === parentId && matches(n))
      // pinned notes FLOAT above the hand-arranged order (Seth, 2026-07-09:
      // "pin should float") — the manifest itself is never reordered
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.mainOrder - b.mainOrder);
    const dropCls = (rowId: string) => (mainDrop?.id === rowId ? ` mdrop-${mainDrop.pos}` : "");
    // Star = "quick access": pins a Main note into the capped set the ⌥ Quick
    // window cycles (Seth, 2026-07-01 — "anything starred opens with my hotkey").
    const starBtn = (id: string) => {
      const starred = quickNoteIds.includes(id);
      const full = !starred && quickNoteIds.length >= QUICK_MAX;
      const label = starred
        ? "Unstar — remove from Quick access"
        : full
          ? `Quick access is full (${QUICK_MAX}) — unstar one first`
          : "Star for Quick access (the ⌥ Quick window)";
      return (
        <span
          role="button"
          tabIndex={0}
          className={`snactbtn mstar${starred ? " on" : ""}${full ? " full" : ""}`}
          aria-label={label}
          aria-pressed={starred}
          title={label}
          onClick={(ev) => {
            ev.stopPropagation();
            if (!full) togglePinQuick(id);
          }}
        >
          <StarGlyph size={13} filled={starred} />
        </span>
      );
    };
    return (
      <>
        {childNotes.map((n) => {
          const parentFolderName = mainProjection.folders.find((folder) => folder.id === parentId)?.name;
          const displayTitle = noteDisplayTitle(n.title, parentFolderName) || "Empty note";
          return (
            <button
              key={`main:${n.id}`}
              type="button"
              data-main-id={n.id}
              data-note-id={n.id}
              /* the current file's Main copy wins the highlight (#25) — the same
                 accent pill a compact row gets when it's the focused note */
              className={`snrow main-row${n.id === focusedItemId ? " sel" : ""}${dropCls(n.id)}${mainDragId === n.id ? " dragging" : ""}`}
              style={{ paddingLeft: contentPad }}
              onPointerDown={(e) => startMainDrag(e, n.id, "move", displayTitle)}
              onClick={() => {
                if (!didMainDragRef.current) {
                  // Main is the creation context as well as the visible projection:
                  // ⌘T / New note must not inherit a stale Brain/Storage selection
                  // from before this row was opened.
                  setSelectedFolderId(parentId);
                  setContentView("panes");
                  usePanesStore.getState().openSummary(n);
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  setSelectedFolderId(parentId);
                  setContentView("panes");
                  usePanesStore.getState().openSummary(n, { newTab: true });
                }
              }}
              onContextMenu={(e) => openNoteMenu(e, n)}
              {...rp({ id: `main>${n.id}`, kind: "note" })}
            >
              {glyphForNote(n, { size: 14, className: "snicon" })}
              <span className="snt">{displayTitle}</span>
              {/* the floated pin's marker — same quiet glyph as pinned chats */}
              {n.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
              {starBtn(n.id)}
              {/* the hover-× is GONE (Seth, 2026-07-09: its reserved slot read as
                  a broken gap next to the star) — the context menu owns
                  "Remove from Main"; folder rows keep their × below */}
            </button>
          );
        })}
        {childFolders.map((f) => {
          const open = expandedDests[f.id] ?? true;
          const folderItemIds = mainItemIdsInFolder(activeTree, f.id);
          const folderItems = folderItemIds.flatMap((id) => {
            const item = noteIndex.get(id);
            return item ? [item] : [];
          });
          const folderScopeComplete = folderItems.length === folderItemIds.length;
          // inline rename (#16): the context menu's Rename… turns the row into a
          // text input — Enter commits (sibling-uniquified), Esc/click-away cancels
          // (the CompactBoardRow grammar).
          if (renamingMainId === f.id) {
            return (
              <div key={f.id} className="sb-newfolder" style={{ paddingLeft: contentPad }}>
                <FolderGlyph size={14} />
                <InlineRenameInput
                  defaultValue={f.name}
                  placeholder="Folder name…"
                  ariaLabel="Rename Main folder"
                  onCommit={(value) => {
                    if (activeView) {
                      const error = viewFolderNameError(value);
                      if (error) {
                        setRowActionError(`Couldn’t rename folder — ${error}`);
                        return;
                      }
                    }
                    setRenamingMainId(null);
                    setActiveTree(renameFolderInMain(activeTree, f.id, value), liveIds);
                  }}
                  onCancel={() => setRenamingMainId(null)}
                />
              </div>
            );
          }
          return (
            <div key={f.id}>
              <button
                type="button"
                data-main-id={f.id}
                data-main-folder="1"
                className={`frow child main-row${dropCls(f.id)}${mainDragId === f.id ? " dragging" : ""}`}
                style={{ paddingLeft: rowPad }}
                onPointerDown={(e) => startMainDrag(e, f.id, "move", f.name)}
                onClick={() => {
                  // toggle against the OPEN default (?? true) — toggleDestExpanded
                  // assumes closed, so the first click on a fresh folder no-oped
                  if (!didMainDragRef.current) setDestExpanded(f.id, !open);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openContextMenu(e.clientX, e.clientY, [
                    {
                      kind: "action" as const,
                      label: "Rename folder…",
                      onClick: () => setRenamingMainId(f.id),
                    },
                    ...(viewsManifest.views.length > 0
                      ? [
                          {
                            kind: "drill" as const,
                            label: "Move to view",
                            items: [
                              {
                                kind: "action" as const,
                                label: "Main only",
                                checked: activeView === null,
                                checkedMark: "highlight" as const,
                                onClick: () =>
                                  setViewsManifest(
                                    transferTreeItemToView(
                                      mainManifest.tree,
                                      viewsManifest,
                                      activeView,
                                      f.id,
                                      null,
                                    ),
                                  ),
                              },
                              ...viewsManifest.views.map((view) => ({
                                kind: "action" as const,
                                label: view.name,
                                checked: activeView === view.name,
                                checkedMark: "highlight" as const,
                                onClick: () =>
                                  setViewsManifest(
                                    transferTreeItemToView(
                                      mainManifest.tree,
                                      viewsManifest,
                                      activeView,
                                      f.id,
                                      view.name,
                                    ),
                                  ),
                              })),
                            ],
                          },
                        ]
                      : []),
                    { kind: "sep" as const },
                    {
                      kind: "action" as const,
                      label: `Remove from ${activeView ?? "Main"}`,
                      onClick: () => setActiveTree(removeFromMain(activeTree, f.id), liveIds),
                    },
                    { kind: "sep" as const },
                    {
                      kind: "drill" as const,
                      label: folderScopeComplete
                        ? "Move folder contents to Trash…"
                        : "Unavailable items — can’t trash folder",
                      danger: true,
                      disabled: folderItems.length === 0 || !folderScopeComplete,
                      items: [
                        {
                          kind: "action" as const,
                          label: `Move ${folderItems.length} ${
                            folderItems.length === 1 ? "item" : "items"
                          } to Trash`,
                          danger: true,
                          onClick: () => {
                            setRowActionError(null);
                            trashItems.mutate(folderItems, {
                              onSuccess: () => setActiveTree(removeFromMain(activeTree, f.id), liveIds),
                            });
                          },
                        },
                      ],
                    },
                  ]);
                }}
                {...rp({ id: f.id, kind: "folder" })}
              >
                <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                  <ChevronRight size={10} />
                </span>
                <FolderGlyph size={14} />
                <span className="fname">{f.name}</span>
                {/* NO inline remove-× here: it rendered unstyled mid-row on .frow
                    (the .snactbtn hover/size grammar is .snrow-scoped), so
                    "clicking the folder" silently deleted it from Main. Removal
                    lives in the right-click menu, like note rows (2026-07-09). */}
              </button>
              {open && renderMainTree(f.id, depth + 1, rp)}
            </div>
          );
        })}
      </>
    );
  };

  // each destination's subtree notes, by dest id (Brain/Storage include their
  // nested user folders; the nested rows slice their own out of this list)
  const notesByDest: Record<string, NoteSummary[]> = {
    [DEST.inbox]: inboxNotes,
    [DEST.secure]: secureNotes,
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
        (f) => f.parentId == null && f.id.startsWith(parentId) && !f.id.slice(parentId.length).includes("/"),
      );
    }
    return folders.filter((f) => f.parentId === parentId);
  };
  const countFor = (folder: Folder, destNotes: NoteSummary[]): number => {
    const own = destNotes.filter((n) => n.folderId === folder.id).length;
    return own + childrenOf(folder.id).reduce((sum, c) => sum + countFor(c, destNotes), 0);
  };

  // the live filter narrows the compact rows by title OR snippet (applied per
  // section — including Main, which the first filter pass skipped entirely)
  const q = filter.trim().toLowerCase();
  const matches = (note: NoteSummary): boolean =>
    !q || note.title.toLowerCase().includes(q) || note.snippet.toLowerCase().includes(q);

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
  for (const n of noteIndex.values()) {
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
    const parentFolderName = folders.find((folder) => folder.id === folderId)?.name;
    return (
      <>
        {own
          .filter((n) => !isBoard(n))
          .map((note) => {
            const displayTitle = noteDisplayTitle(note.title, parentFolderName) || "Empty note";
            return (
              <CompactNoteRow
                key={note.id}
                note={note}
                displayTitle={displayTitle}
                selected={note.id === focusedItemId}
                padLeft={28 + level * 16}
                onOpen={
                  isFile(note)
                    ? (newTab) => usePanesStore.getState().openFile(note.id, { newTab })
                    : openRow(note.id)
                }
                actions={rowActions}
                onBeginMainDrag={(e) => startMainDrag(e, note.id, "add", displayTitle)}
                mainDragRef={crossDragRef}
                rowProps={rp({ id: note.id, kind: "note" })}
                onContextMenu={(e) => openNoteMenu(e, note)}
              />
            );
          })}
        {own.filter(isBoard).map((board) => (
          <CompactBoardRow
            key={board.id}
            board={board}
            selected={board.id === focusedItemId}
            padLeft={28 + level * 16}
            onOpen={openBoardRow(board.id)}
            renaming={renamingBoardId === board.id}
            onCommitRename={(name) => void commitBoardRename(board.id, name)}
            onCancelRename={() => setRenamingBoardId(null)}
            rowProps={rp({ id: board.id, kind: "note" })}
            onContextMenu={(e) => openNoteMenu(e, board)}
          />
        ))}
      </>
    );
  };

  // hide memex plumbing folders ("_templates", "_inbox", …): they're how the
  // AI stages/templates notes, never something the user files into (2026-06-26).
  // ONE predicate for the JSX tree AND the roving list — subtreeRows missing it
  // put phantom rows in the j/k order that wedged the cursor (#45, audit 2026-07).
  const isPlumbingFolder = (folder: { id: string; name: string }): boolean =>
    folder.id.startsWith("vault:") && folder.name.startsWith("_");

  // —— recursive user-folder subtree under a destination (like FoldersRail) ——
  const renderFolderTree = (
    parentId: string,
    destNotes: NoteSummary[],
    depth: number,
    rp: ReturnType<typeof useRovingList>["rowProps"],
  ): ReactNode =>
    childrenOf(parentId)
      .filter((folder) => !isPlumbingFolder(folder))
      .map((folder) => {
        const open = expandedDests[folder.id] ?? false;
        const selected = destSelected(folder.id);
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
              className={`frow child${selected ? " sel" : ""}`}
              style={{ paddingLeft: 10 + (depth + 1) * 16 }}
              onClick={() => {
                toggleDestExpanded(folder.id);
                setSelectedFolderId(folder.id);
                setContentView("panes");
              }}
              {...rp({ id: folder.id, kind: "folder" })}
            >
              <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                <ChevronRight size={10} />
              </span>
              <FolderGlyph size={14} />
              <span className="fname" title={hint}>
                {label}
              </span>
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
    return [...own.filter((n) => !isBoard(n)), ...own.filter(isBoard)].map((n) => ({
      id: n.id,
      kind: "note" as const,
    }));
  };

  const subtreeRows = (parentId: string, destNotes: NoteSummary[]): RovingRow[] =>
    childrenOf(parentId)
      // MUST mirror renderFolderTree's plumbing filter — a folder the JSX hides
      // must never become a roving row (#45: j/k wedged on the phantom)
      .filter((folder) => !isPlumbingFolder(folder))
      .flatMap((folder) => {
        const open = expandedDests[folder.id] ?? false;
        const row: RovingRow = { id: folder.id, kind: "folder" };
        if (!open) return [row];
        return [row, ...visibleNoteRows(destNotes, folder.id), ...subtreeRows(folder.id, destNotes)];
      });

  // the three top-level sections' open state (Seth's IA, 2026-06-26). Default
  // open so a fresh window shows the full tree; persisted via expandedDests.
  const inboxSecOpen = expandedDests[SEC_INBOX] ?? true;
  const chatSecOpen = expandedDests[SEC_CHAT] ?? true;
  const notesSecOpen = expandedDests[SEC_NOTES] ?? true;
  const brainOpen = expandedDests.Brain ?? true;
  const secureOpen = expandedDests[DEST.secure] ?? false;
  const hasBrain = childrenOf("wiki").length > 0 || brainNotes.length > 0 || secureNotes.length > 0;

  // Main rows in the roving order — mirrors renderMainTree's traversal exactly
  // (notes first, then folders + their open subtrees). Main notes reference the
  // SAME ids as their Brain twins, so their roving ids carry a "main>" prefix
  // (folders already carry "main:") — no id collision, j/k walks both copies.
  const MAIN_ROW_PREFIX = "main>";
  const mainRovingRows = (parentId: string): RovingRow[] => [
    // filtered by matches() exactly like renderMainTree — the roving cursor
    // must never point at a row the live filter hid
    ...mainProjection.notes
      .filter((n) => n.folderId === parentId && matches(n))
      .sort((a, b) => a.mainOrder - b.mainOrder)
      .map((n) => ({ id: `${MAIN_ROW_PREFIX}${n.id}`, kind: "note" as const })),
    ...mainProjection.folders
      .filter((f) => f.parentId === parentId)
      .flatMap((f) => {
        const row: RovingRow = { id: f.id, kind: "folder" };
        return (expandedDests[f.id] ?? true) ? [row, ...mainRovingRows(f.id)] : [row];
      }),
  ];

  // the roving j/k cursor walks the NOTES section (the corpus tree) INCLUDING
  // the Main manifest rows (Seth follow-up, 2026-07-01 — j/k for Main). When
  // that section is collapsed there are no roving rows; the Inbox/Chat sections
  // are plain buttons, outside the listbox.
  const rows: RovingRow[] = notesSecOpen
    ? [
        { id: ALL_NOTES, kind: "smart" },
        { id: RECENT, kind: "smart" },
        { id: TASKS, kind: "smart" },
        // Main — the user's hand-arranged rows, in manifest order.
        ...mainRovingRows(MAIN_ROOT),
        // Brain — a collapsible destination; its areas ride under it when open.
        ...(hasBrain
          ? [
              { id: "Brain", kind: "folder" } as RovingRow,
              ...(brainOpen
                ? [
                    { id: DEST.secure, kind: "folder" } as RovingRow,
                    ...(secureOpen
                      ? [
                          ...visibleNoteRows(secureNotes, DEST.secure),
                          ...subtreeRows(DEST.secure, secureNotes),
                        ]
                      : []),
                    ...subtreeRows("wiki", brainNotes),
                  ]
                : []),
            ]
          : []),
        ...visibleDestRows.flatMap(({ id }) => {
          const destNotes = notesByDest[id] ?? [];
          const open = expandedDests[id] ?? false;
          const row: RovingRow = { id, kind: "folder" };
          if (!open) return [row];
          return [row, ...visibleNoteRows(destNotes, id), ...subtreeRows(id, destNotes)];
        }),
      ]
    : [];

  const { rowProps } = useRovingList(rows, {
    // l / Enter: a note opens in place; a folder/dest toggles its expansion and
    // becomes the ⌘N selection — mirrors the click gesture exactly.
    onOpen: (row, newTab) => {
      if (row.kind === "note") {
        // a Main row references its Brain twin by id — strip the prefix, open
        // the same file ("one file, two views")
        if (row.id.startsWith(MAIN_ROW_PREFIX)) {
          const noteId = row.id.slice(MAIN_ROW_PREFIX.length);
          const n = noteIndex.get(noteId);
          if (n) {
            setSelectedFolderId(mainParentOfNote(activeTree, noteId) ?? MAIN_ROOT);
            setContentView("panes");
            usePanesStore.getState().openSummary(n, { newTab });
          }
          return;
        }
        // board rows ride kind:"note" in the roving list — the Set tells them
        // apart so a board opens its canvas, not the editor (Seth, 2026-06-24)
        if (boardIds.has(row.id)) openCanvas(row.id, { newTab });
        else if (fileIds.has(row.id)) usePanesStore.getState().openFile(row.id, { newTab });
        else openNote(row.id, { newTab });
        return;
      }
      // a Main folder defaults OPEN (?? true) — toggle against that default,
      // not toggleDestExpanded's closed default (first press must collapse)
      if (row.id.startsWith(MAIN_ROOT)) {
        setDestExpanded(row.id, !(expandedDests[row.id] ?? true));
        return;
      }
      setSelectedFolderId(row.id);
      if (row.id === ALL_NOTES) {
        setContentView("allNotes");
      } else if (row.id === TASKS) {
        setContentView("tasks");
      } else if (row.id === RECENT) {
        setContentView("recent");
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
      const open = row.id.startsWith(MAIN_ROOT)
        ? (expandedDests[row.id] ?? true) // Main folders default open
        : expandedDests[row.id];
      if (open) {
        setDestExpanded(row.id, false);
        return true;
      }
      return false;
    },
    onFocusFilter: () => dispatch("palette.toggle"),
    // m: a note/board/file row opens the SAME context menu the right-click
    // uses, anchored under the row; on close the cursor returns to the row
    // (the RowMenu unification, 2026-07-01). A Main row maps to its note.
    onOpenMenu: (row, anchor) => {
      if (row.kind !== "note") return;
      const bare = row.id.startsWith(MAIN_ROW_PREFIX) ? row.id.slice(MAIN_ROW_PREFIX.length) : row.id;
      // the FULL index — the menu's hidden-root branch needs archived/trashed
      // (and staged Main) rows to resolve, not just the default listing
      const note = noteIndex.get(bare);
      if (!note) return;
      const rect = anchor.getBoundingClientRect();
      openNoteMenu({ clientX: rect.left + 24, clientY: rect.bottom + 4 }, note, {
        returnFocus: () => anchor.focus(),
      });
    },
  });

  // #25 — reveal the current item: when the focused note, board, or file changes,
  // auto-expand the folder that holds it so its row is on screen and highlighted.
  // Main's copy wins; an item not in Main is revealed at its physical home.
  // Keyed ONLY on focusedItemId (the latest projections ride in a ref) so it
  // fires on navigation, never re-opening a folder the user just collapsed.
  const revealRef = useRef({ mainProjection, noteIndex });
  revealRef.current = { mainProjection, noteIndex };
  const revealNonce = useUiStore((s) => s.revealNonce);

  // Expand the folder chain that holds the focused item (Main copy wins).
  // Reads the latest projections via the ref so it never re-opens a folder the
  // user just collapsed by hand.
  const expandToFocusedItem = (
    mode: "auto" | "brain" = "auto",
    targetItemId: string | null = focusedItemId,
  ) => {
    if (!targetItemId) return;
    const { mainProjection: proj, noteIndex: idx } = revealRef.current;
    // "brain" mode skips the Main-wins short-circuit so "Open in Brain" reveals the
    // note's REAL home in the Brain even when it's also pinned in Main (Seth #3,
    // 2026-07-08). "auto" keeps Main's copy winning on ordinary navigation.
    const inMain = mode === "brain" ? undefined : proj.notes.find((n) => n.id === targetItemId);
    if (inMain) {
      let parent: string | null = inMain.folderId;
      const seen = new Set<string>();
      while (parent && parent !== MAIN_ROOT && !seen.has(parent)) {
        seen.add(parent);
        setDestExpanded(parent, true);
        parent = proj.folders.find((f) => f.id === parent)?.parentId ?? null;
      }
      return;
    }
    const note = idx.get(targetItemId);
    if (!note) return;
    const fid = noteDiskFolder(note);
    if (isSecureBrainFolder(fid)) {
      setDestExpanded("Brain", true);
      setDestExpanded(DEST.secure, true);
      const shelfParts = note.folderId.split("/");
      for (let i = 2; i <= shelfParts.length; i++) {
        setDestExpanded(shelfParts.slice(0, i).join("/"), true);
      }
    } else if (fid === "wiki" || fid.startsWith("wiki/")) {
      setDestExpanded("Brain", true);
      // "wiki/projects/rotli" → open "wiki/projects" then "wiki/projects/rotli"
      const parts = fid.split("/");
      for (let i = 2; i <= parts.length; i++) {
        setDestExpanded(parts.slice(0, i).join("/"), true);
      }
    } else if (fid) {
      // Storage/… · Archive · Trash · a plain folder: open the id chain so the
      // row is on screen (reveal was a no-op for these — pre-release review).
      const parts = fid.split("/");
      for (let i = 1; i <= parts.length; i++) {
        setDestExpanded(parts.slice(0, i).join("/"), true);
      }
    }
  };

  // #25 — auto-reveal on navigation: expand the holder, never scroll (a yanked
  // scroll on every click is jarring). Keyed on the item id, not the closure.
  useEffect(() => {
    expandToFocusedItem("auto", focusedItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedItemId, setDestExpanded]);

  // Explicit reveal (the editor's location chip): expand AND scroll the row into
  // view. Fires ONLY on the nonce bump, so normal navigation never scroll-yanks.
  useEffect(() => {
    if (!revealNonce) return;
    const { revealMode: mode, revealNoteId } = useUiStore.getState();
    const targetItemId = revealNoteId ?? focusedItemId;
    expandToFocusedItem(mode, targetItemId);
    // two frames: the first lets the just-expanded folder chain commit to the
    // DOM, the second scrolls the now-rendered row into view (pre-release review).
    // In "brain" mode, scroll to the BRAIN occurrence (not the Main copy, which
    // also carries .sel) by skipping .main-row (Seth #3, 2026-07-08).
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const candidates = Array.from(
          document.querySelectorAll<HTMLElement>(
            mode === "brain" ? ".sidebar .snrow.sel:not(.main-row)" : ".sidebar .snrow.sel",
          ),
        );
        const sel = candidates.find((row) => row.dataset.noteId === targetItemId) ?? candidates[0];
        sel?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

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

  // Commit an inline board rename (right-click a board row, or naming a fresh
  // one): rename the .excalidraw, retarget any open canvas tab to the new id,
  // refresh. Enter commits; Esc / click-away cancels (Seth, 2026-06-26).
  const commitBoardRename = async (boardId: string, raw: string) => {
    setRenamingBoardId(null);
    const name = raw.trim();
    if (!name) return;
    try {
      setRowActionError(null);
      const meta = await corpusRenameBoard(boardId, name);
      retargetBoard(boardId, meta.id);
      renameMainRef(boardId, meta.id); // the Main slot follows the new path id (#33)
      await invalidateNotes();
    } catch (e) {
      // board is read-only or gone — leave it as is, and SAY why: the inline
      // sidebar error note, not a console.warn (#11, audit 2026-07)
      setRowActionError(`Couldn’t rename the board — ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // "+" → New folder: open the inline input row under a parent (and expand it so
  // the input is on screen). The header "+" passes nothing → the resolved
  // (selected) folder; a per-section "+" passes that section id directly, so you
  // can drop a folder inside any section in one click ("folders in folders").
  const startNewFolder = (parent?: string) => {
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

  // per-destination hover icons (Seth #7/#13, 2026-07-03): VS Code drops a
  // new-file + new-folder pair on a folder row's hover — content lands in THAT
  // exact folder, no target ambiguity. role=button spans (the row itself is a
  // <button>, so a nested <button> would be invalid markup — the same trick the
  // note rows use for archive/trash). New note routes through notes.new after
  // selecting the folder, so it inherits every routing + Main-filing rule.
  const sectionAddBtn = (parentId: string): ReactNode => (
    <>
      <span
        role="button"
        tabIndex={0}
        className="frow-add"
        aria-label="New note here"
        title="New note here"
        onClick={(event) => {
          event.stopPropagation();
          setSelectedFolderId(parentId);
          dispatch("notes.new");
        }}
      >
        <NewFileGlyph size={13} />
      </span>
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
        <NewFolderGlyph size={13} />
      </span>
    </>
  );

  // — Chat openers: chats open as PANES now (a pane holds a chat OR a note, side
  //   by side, multiple at once), so "New chat"/a row opens a chat pane; "All
  //   chats" opens a searchable content view (the twin of All notes). The open
  //   chat = the focused pane's. —
  const openNewChat = () => openChat(null);
  const openAllChats = () => setContentView("allChats");
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
    <button type="button" className="sb-section" aria-expanded={open} onClick={() => toggleDestExpanded(id)}>
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
      aria-label={sidebarMode === "breve" ? "Breve" : "Notes"}
      // suppress the WKWebView's default right-click menu ("Reload", …) inside the
      // sidebar; rotli's own row menus (board rename) handle contextmenu instead.
      // The editor keeps its native menu (spell-check / copy) — this is scoped here.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* the vault header (decision 2026-07-25, Zen reference): the current
          vault by name, one click to switch/connect. Hidden in Breve mode —
          Breve is a mode over the same vault, not a different one. */}
      {sidebarMode !== "breve" && (
        <button
          type="button"
          className="vault-switch"
          aria-haspopup="menu"
          aria-label={`Vault: ${vaultName}. Switch or connect vaults`}
          title="Switch or connect vaults"
          onClick={openVaultMenu}
        >
          <VaultGlyph size={14.5} />
          <span className="vault-switch-name">{vaultName}</span>
          <span className="vault-switch-caret" aria-hidden="true">
            ▾
          </span>
        </button>
      )}
      {/* the sidebar toggle now lives in the titlebar (always visible, the clear
          reopen) — the search row is just the filter + new-note (Seth, 2026-06-15) */}
      <div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>
        <button
          type="button"
          className={sidebarMode === "breve" ? "icobtn railon sb-breve-toggle" : "icobtn sb-breve-toggle"}
          aria-label={sidebarMode === "breve" ? "Back to Rotli home" : "Open Breve"}
          aria-pressed={sidebarMode === "breve"}
          onClick={() => dispatch("view.breve")}
        >
          {sidebarMode === "breve" ? <QuokkaMark size={17} /> : <CoffeeGlyph size={16} />}
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Back to Rotli" : "Breve"}
          </span>
        </button>
        <span className="nl-mode-sep" aria-hidden="true" />
        {/* IDE-style create icons (Seth #7/#13, 2026-07-03): the old "+" dropdown
            became three explicit, always-visible actions — New note · New folder ·
            New board — mirroring VS Code's file-explorer title bar. Each targets
            the resolved (selected) folder; per-destination hover icons below drop
            content into an exact folder. */}
        <button
          type="button"
          className="icobtn"
          aria-label={sidebarMode === "breve" ? "New is unavailable in Breve" : "New…"}
          disabled={sidebarMode === "breve"}
          onClick={openNewItemMenu}
        >
          <NewFileGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "New…"}
          </span>
        </button>
        <button
          type="button"
          className="icobtn"
          aria-label={sidebarMode === "breve" ? "New folder is unavailable in Breve" : "New folder"}
          disabled={sidebarMode === "breve"}
          onClick={() => startNewFolder()}
        >
          <NewFolderGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "New folder"}
          </span>
        </button>
        <button
          type="button"
          className="icobtn"
          aria-label={sidebarMode === "breve" ? "New board is unavailable in Breve" : "New board"}
          disabled={sidebarMode === "breve"}
          onClick={() => dispatch("boards.new")}
        >
          <CanvasItemGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "New board"}
          </span>
        </button>
        {/* collapse-all — fold every expanded section/folder at once (VS Code's
            collapse icon; handy once folders nest deep). Kept last, like the IDE. */}
        <button
          type="button"
          className="icobtn"
          aria-label={
            sidebarMode === "breve" ? "Collapse all is unavailable in Breve" : "Collapse all folders"
          }
          disabled={sidebarMode === "breve"}
          /* default-OPEN rows (Main folders, the Brain header) need an explicit
             false — wiping the map alone re-EXPANDED them (#83, audit 2026-07) */
          onClick={() => collapseAllDests([...mainFolderIds(activeTree), "Brain"])}
        >
          <FoldGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "Collapse all"}
          </span>
        </button>
      </div>

      {/* a failed row-menu action (file-to-brain, board rename) says so HERE —
          inline, dismissible, above the tree it happened in (#11, audit 2026-07) */}
      {sidebarMode === "notes" && rowActionError && (
        <div className="sb-error" role="alert">
          <span className="sb-error-text">⚠ {rowActionError}</span>
          <button
            type="button"
            className="sb-error-x"
            aria-label="Dismiss"
            onClick={() => setRowActionError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* the three top-level sections (Seth's IA, 2026-06-26): Inbox (email) ·
          Chat · Notes — replacing the retired top module dropdown. Each is a
          collapsible accordion; only the Notes tree is the roving j/k listbox. */}
      {/* the whole section tree scales with the sidebar zoom (⌘+/⌘− while focus
          is in the sidebar) — CSS zoom scales rows + text together; the fixed-
          positioned popovers (RowMenu, the "+" menu) sit OUTSIDE this node, so
          their pixel coordinates stay unscaled. */}
      {sidebarMode === "breve" ? (
        <BreveSidebar zoom={sidebarZoom} />
      ) : (
        <div className="sb-rows" aria-label="Sections" style={{ zoom: sidebarZoom }}>
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
                /* highlight "All chats" only when its content view is active — so it
                 never lights up alongside an open chat row (Seth, 2026-07-01) */
                className={`sb-chatrow all${contentView === "allChats" ? " sel" : ""}`}
                onClick={openAllChats}
              >
                <SearchGlyph size={13} />
                <span className="fname">All chats</span>
              </button>
              {!activeMemex ? (
                <button type="button" className="sb-chat-empty" onClick={() => dispatch("app.settings")}>
                  Connect a memex in Settings → Location
                </button>
              ) : chatList.length === 0 ? (
                <p className="sb-chat-empty">No chats yet.</p>
              ) : (
                chatList.slice(0, chatSidebarLimit).map((c) =>
                  chatRename.renamingChatSlug === c.slug ? (
                    <InlineRenameInput
                      key={c.slug}
                      className="sb-chatrename"
                      defaultValue={c.title || c.slug}
                      ariaLabel="Rename chat"
                      onCommit={(value) => chatRename.commit(c.slug, value)}
                      onCancel={chatRename.cancel}
                    />
                  ) : (
                    <button
                      type="button"
                      key={c.slug}
                      className={`sb-chatrow${focusedChatSlug === c.slug ? " sel" : ""}`}
                      onClick={() => openChatRow(c.slug)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // failures (e.g. a read-only brain) land in the sidebar's
                        // inline error note — the menu is gone by the time they
                        // reject (#11 pattern; reviewer, 2026-07-08)
                        const runChatOp = (verb: string, op: Promise<void>) => {
                          setRowActionError(null);
                          void op
                            .then(() => invalidateMemex())
                            .catch((err) =>
                              setRowActionError(
                                `Couldn't ${verb} this chat — ${err instanceof Error ? err.message : String(err)}`,
                              ),
                            );
                        };
                        openContextMenu(e.clientX, e.clientY, [
                          {
                            kind: "action" as const,
                            label: c.pinned ? "Unpin from top" : "Pin to top",
                            checked: c.pinned,
                            onClick: () => {
                              if (activeMemex) runChatOp("pin", pinChat(activeMemex, c.slug, !c.pinned));
                            },
                          },
                          {
                            kind: "action" as const,
                            label: "Rename…",
                            onClick: () => chatRename.start(c.slug),
                          },
                          { kind: "sep" as const },
                          {
                            kind: "action" as const,
                            label: "Archive",
                            onClick: () => {
                              if (activeMemex) runChatOp("archive", archiveChat(activeMemex, c.slug));
                            },
                          },
                          {
                            kind: "action" as const,
                            label: "Delete",
                            danger: true,
                            onClick: () => {
                              if (activeMemex) runChatOp("delete", deleteChat(activeMemex, c.slug));
                            },
                          },
                        ]);
                      }}
                      title={c.title || c.slug}
                    >
                      <ChatGlyph size={13} />
                      <span className="fname">{c.title || c.slug}</span>
                      {c.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
                    </button>
                  ),
                )
              )}
              {chatList.length > chatSidebarLimit && (
                <button type="button" className="sb-chat-more" onClick={openAllChats}>
                  +{chatList.length - chatSidebarLimit} more
                </button>
              )}
            </div>
          )}

          {/* ── NOTES — the corpus (the deepest tree). All notes · Board · Recent ·
            the local destinations + Vault/Knowledge + nested folders. This wrapper
            is the roving listbox: Tab enters at the one tabIndex=0 row, j/k walk
            it; the keyboard highlight is :focus-visible. ── */}
          {sectionHeader(SEC_NOTES, "Notes", NotesStackGlyph, notesSecOpen, searchableCount)}
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
                <span className="count">{searchableCount}</span>
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
                <span className="count">{captureCount}</span>
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
                {/* no count: "how many notes exist" says nothing about RECENCY —
                  the total lives on All notes (#60, audit 2026-07) */}
                <span className="fname">Recent</span>
              </button>
              {/* Tasks — every open checkbox across your notes, one view
                  (decision 2026-07-25). The count is OPEN tasks, not notes. */}
              <button
                type="button"
                className={`frow${contentView === "tasks" ? " sel" : ""}`}
                onClick={() => {
                  setSelectedFolderId(TASKS);
                  setContentView("tasks");
                }}
                {...rowProps({ id: TASKS, kind: "smart" })}
              >
                <TaskGlyph size={14.5} />
                <span className="fname">Tasks</span>
                {openTaskCount > 0 && <span className="count">{openTaskCount}</span>}
              </button>

              {/* — MAIN: your hand-picked notes, arranged your way. Star a row (★) to
                  put it in Quick access — the capped set the ⌥ Quick window cycles
                  (Seth, 2026-07-01). Add with the ⊕ on a note row or drag from the Brain. — */}
              {/* the header carries a QUIET hover new-folder mark (Seth, 2026-07-01:
                the always-visible "+ New folder" row was too loud; 2026-07-17: the
                bare "+" said nothing — the IDE-style NewFolderGlyph, same as the
                toolbar, is self-explanatory) — opacity-hidden so Tab still reaches it. */}
              <div className="fsec fsec-hdr">
                <button
                  type="button"
                  className="fsec-view"
                  aria-label={`Current view: ${activeView ?? "Main"}. Change view`}
                  aria-haspopup="menu"
                  title="Change view"
                  onClick={openViewMenu}
                >
                  <span>{activeView ?? "Main"}</span>
                  <span aria-hidden="true">
                    <ChevronRight size={9} />
                  </span>
                </button>
                {(viewsSaveState === "saving" || viewsSaveState === "saved") && (
                  <span className="fsec-save" role="status">
                    {viewsSaveState === "saving" ? "Saving…" : "Saved"}
                  </span>
                )}
                <button
                  type="button"
                  className="fsec-add"
                  aria-label={`New folder in ${activeView ?? "Main"}`}
                  title={`New folder in ${activeView ?? "Main"}`}
                  disabled={!!activeView && !viewsWritable}
                  /* name-FIRST (#16): open the inline input instead of minting a
                   permanent "New folder 2" the old flow could never rename */
                  onClick={() => setMainNewFolder(true)}
                >
                  <NewFolderGlyph size={13} />
                </button>
              </div>
              {editingView && (
                <div className="view-editor">
                  <label htmlFor="new-view-name">
                    {editingView === "rename" ? "Rename view" : "New view"}
                  </label>
                  <div className="view-editor-row">
                    <input
                      id="new-view-name"
                      autoFocus
                      type="text"
                      defaultValue={editingView === "rename" ? (activeView ?? "") : ""}
                      placeholder="View name"
                      aria-invalid={!!viewInputError}
                      aria-describedby={viewInputError ? "view-name-error" : undefined}
                      onChange={() => viewInputError && setViewInputError(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitViewName(event.currentTarget.value);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingView(null);
                          setViewInputError(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="view-editor-save"
                      onClick={(event) => {
                        const input = event.currentTarget.parentElement?.querySelector("input");
                        if (input) commitViewName(input.value);
                      }}
                    >
                      Save
                    </button>
                  </div>
                  {viewInputError && (
                    <p id="view-name-error" className="view-editor-error" role="alert">
                      {viewInputError}
                    </p>
                  )}
                </div>
              )}
              {deletingView && (
                <div className="view-delete" role="alert">
                  <p>
                    Delete <b>{deletingView}</b>? Items stay in Main.
                  </p>
                  <div>
                    <button type="button" onClick={() => setDeletingView(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setViewsManifest(deleteNamedView(viewsManifest, deletingView));
                        setDeletingView(null);
                        setActiveView(null);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
              {viewsError && (
                <p className="view-state-error" role="alert">
                  {viewsError}
                </p>
              )}
              {mainNewFolder && (
                <div className="sb-newfolder" style={{ paddingLeft: 44 }}>
                  <FolderGlyph size={14} />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Folder name…"
                    aria-label="New folder in Main"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        mainNewFolderHandled.current = true; // the ensuing blur must not re-commit
                        const name = e.currentTarget.value.trim();
                        setMainNewFolder(false);
                        if (name) {
                          if (activeView) {
                            const error = viewFolderNameError(name);
                            if (error) {
                              setRowActionError(`Couldn’t create folder — ${error}`);
                              return;
                            }
                          }
                          // compute the rendered id BEFORE the commit (same
                          // uniquify law) so the fresh row — appended after every
                          // root note — can be scrolled into view, not lost
                          const folderId = `${MAIN_ROOT}${uniqueRootFolderName(activeTree, name)}`;
                          setActiveTree(addFolderToMain(activeTree, name), liveIds);
                          requestAnimationFrame(() => {
                            document
                              .querySelector(`[data-main-id="${CSS.escape(folderId)}"]`)
                              ?.scrollIntoView({ block: "nearest" });
                          });
                        }
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        mainNewFolderHandled.current = true; // …nor override the cancel
                        setMainNewFolder(false);
                      }
                    }}
                    onBlur={(e) => {
                      if (mainNewFolderHandled.current) {
                        mainNewFolderHandled.current = false;
                        return;
                      }
                      // click-away commits a non-empty name (the corpus new-folder law)
                      const name = e.currentTarget.value.trim();
                      setMainNewFolder(false);
                      if (name) {
                        if (activeView) {
                          const error = viewFolderNameError(name);
                          if (error) {
                            setRowActionError(`Couldn’t create folder — ${error}`);
                            return;
                          }
                        }
                        const folderId = `${MAIN_ROOT}${uniqueRootFolderName(activeTree, name)}`;
                        setActiveTree(addFolderToMain(activeTree, name), liveIds);
                        requestAnimationFrame(() => {
                          document
                            .querySelector(`[data-main-id="${CSS.escape(folderId)}"]`)
                            ?.scrollIntoView({ block: "nearest" });
                        });
                      }
                    }}
                  />
                </div>
              )}
              {mainProjection.folders.length === 0 && mainProjection.notes.length === 0 ? (
                <p className="main-empty" data-main-id="main:">
                  {activeView ? (
                    <>
                      This view is empty. Press <b>⌘T</b> to create here, or right-click an item and choose{" "}
                      <b>Move to view → {activeView}</b>. It will still appear in Main.
                    </>
                  ) : (
                    <>
                      The notes you reach for, arranged your way. Add one with the <b>⊕</b> on a note row
                      {hasBrain ? " (or drag it here from the Brain)" : ""} — then <b>★</b> your top{" "}
                      {QUICK_MAX} for Quick access (the ⌥ Quick window).
                    </>
                  )}
                </p>
              ) : (
                <div data-main-id="main:" data-active-view={activeView ?? "Main"} className="main-tree">
                  {renderMainTree(MAIN_ROOT, 0, rowProps)}
                </div>
              )}

              <div className="fsec">Destinations</div>

              {/* — the Brain: AI-organized areas, now a COLLAPSIBLE destination (Seth) — */}
              {hasBrain && (
                <div>
                  <button
                    type="button"
                    className={`frow${destSelected("Brain") ? " sel" : ""}`}
                    onClick={() => {
                      toggleDestExpanded("Brain");
                      setSelectedFolderId("Brain");
                    }}
                    {...rowProps({ id: "Brain", kind: "folder" })}
                  >
                    <span className={`fchev${brainOpen ? " open" : ""}`} aria-hidden="true">
                      <ChevronRight size={10} />
                    </span>
                    <NotesStackGlyph size={14} />
                    {/* the LIBRARY — the Librarian's organized areas (2026-07-26
                        rename; the "Brain" folder id stays internal) */}
                    <span className="fname">Library</span>
                    <span className="count">{brainNotes.length + secureNotes.length}</span>
                  </button>
                  {brainOpen && (
                    <>
                      <p className="brain-hint">
                        {brainEnabledUi ? (
                          <>
                            The Librarian files everything here so it stays findable. Your <b>Main</b> above
                            is yours — same notes, your order.
                          </>
                        ) : (
                          <>
                            This vault is raw — no Librarian. These areas are plain folders, yours to arrange.
                          </>
                        )}
                      </p>
                      <button
                        type="button"
                        className="frow child brain-activity-link"
                        style={{ paddingLeft: 42 }}
                        onClick={() => usePanesStore.getState().openActivity()}
                        title={
                          brainEnabledUi
                            ? "See and undo what the Librarian has done"
                            : "History of the Librarian's past actions and secure-note repairs"
                        }
                      >
                        <ClockGlyph size={13} />
                        <span className="fname">Activity</span>
                        {pendingProposals > 0 && <span className="count">{pendingProposals}</span>}
                      </button>
                      <button
                        type="button"
                        className={`frow child${destSelected(DEST.secure) ? " sel" : ""}`}
                        style={{ paddingLeft: 42 }}
                        onClick={() => {
                          toggleDestExpanded(DEST.secure);
                          setSelectedFolderId(DEST.secure);
                          setContentView("panes");
                        }}
                        {...rowProps({ id: DEST.secure, kind: "folder" })}
                      >
                        <span className={`fchev${secureOpen ? " open" : ""}`} aria-hidden="true">
                          <ChevronRight size={10} />
                        </span>
                        <ShieldGlyph size={14} />
                        <span className="fname">Secure notes</span>
                        {/* no create affordances on system rows (Seth, 2026-07-25):
                            quick captures are secure at birth, and the toolbar's
                            New… still targets this row when it's selected */}
                        <span className="count">{secureNotes.length}</span>
                      </button>
                      {secureOpen && (
                        <>
                          <p className="brain-hint secure-brain-hint">
                            Stored inside your Brain, but never visible to remote AI. Local AI remains off
                            until you allow it on an individual note.
                          </p>
                          {compactRows(secureNotes, DEST.secure, rowProps, 2)}
                          {newFolderRow(DEST.secure, 60)}
                          {renderFolderTree(DEST.secure, secureNotes, 1, rowProps)}
                        </>
                      )}
                      {renderFolderTree("wiki", brainNotes, 1, rowProps)}
                    </>
                  )}
                </div>
              )}

              {/* — destination rows: each toggles expansion AND selects (⌘N target) — */}
              {visibleDestRows.map(({ id, label, Glyph }) => {
                const destNotes = notesByDest[id] ?? [];
                const open = expandedDests[id] ?? false;
                const selected = destSelected(id);
                return (
                  <div key={id}>
                    <button
                      type="button"
                      className={`frow${selected ? " sel" : ""}`}
                      onClick={() => {
                        toggleDestExpanded(id);
                        setSelectedFolderId(id);
                        setContentView("panes");
                      }}
                      {...rowProps({ id, kind: "folder" })}
                    >
                      <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                        <ChevronRight size={10} />
                      </span>
                      <Glyph size={14.5} />
                      <span className="fname">{label}</span>
                      {/* destination rows are SYSTEM rows (Seth, 2026-07-25) —
                          no create affordances here; the always-visible pair
                          lives on user folder rows, the toolbar covers the rest */}
                      <span className="count">{destNotes.length}</span>
                    </button>
                    {open && (
                      <>
                        {id === DEST.secure && (
                          <p className="brain-hint">
                            Remote AI never sees these notes. Local AI is off until you allow it on an
                            individual note.
                          </p>
                        )}
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
      )}
    </aside>
  );
}
