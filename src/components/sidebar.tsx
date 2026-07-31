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
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CHAT_FOLDERS_KEY,
  EMPTY_CHAT_FOLDERS,
  type ChatFoldersManifest,
  assignChatToFolder,
  createChatFolder,
  deleteChatFolder,
  groupChats,
  invalidateChatFolders,
  loadChatFolders,
  renameChatFolder,
  saveChatFolders,
  setChatFolderOrder,
} from "../services/chatFolders";
import { buildStorageTree } from "../services/storageTree";
import {
  type DropPos,
  MAIN_ROOT,
  addFolderToMain,
  addNoteToMain,
  uniqueRootFolderName,
  buildMainTree,
  mainFolderIds,
  mainRowSort,
  mainItemIdsInFolder,
  mainNoteIds,
  mainParentOfNote,
  moveInTree,
  removeFromMain,
  renameFolderInMain,
} from "../services/mainTree";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useMainStore } from "../state/main";
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
  useCorpusRoots,
  useFolders,
  useJournal,
  useSecureHints,
  useTasks,
  useMainGcIds,
  useNoteIndex,
  useNotes,
  useSearchableNotes,
  useTrashItems,
} from "../services/hooks";
import { type CorpusRoot, corpusForgetFolder, isTauri, revealCorpus } from "../lib/tauri";
import { DEST, type Destination, isRootMarker } from "../services/destinations";
import {
  sidebarItemId,
  useFocusedChatSlug,
  useFocusedNoteId,
  useFocusedTab,
  usePanesStore,
} from "../state/panes";
import { ALL_NOTES, SEC_CHAT, SEC_NOTES, TASKS, useUiStore } from "../state/ui";
import { activeInstance } from "../memex/config";
import {
  invalidateMemex,
  useChooseFolder,
  useConnectBrain,
  useInstanceChats,
  useMemexConfig,
} from "../memex/useMemex";
import { buildVaultMenu, vaultDisplayName } from "../services/vaultSwitcher";
import {
  archiveChat,
  deleteChat,
  initMemexAsCorpus,
  pickFolder,
  pinChat,
  revealChat,
} from "../memex/service";
import { useChatRename } from "../services/chatRename";
import type { Folder, NoteSummary } from "../types";
import { dispatch } from "../keys/registry";
import { openNewItemMenu } from "../newItems/menu";
import { createDragGhost } from "../lib/dragGhost";
import { createPointerDragSession } from "../lib/pointerDrag";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import {
  ArchiveGlyph,
  ChatGlyph,
  ChevronRight,
  ActivityGlyph,
  TaskGlyph,
  CoffeeGlyph,
  FileGlyph,
  glyphForNote,
  FolderGlyph,
  InboxGlyph,
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
import { Icon } from "./icon";
import { type RovingRow, useRovingList } from "./sidebar/useRovingList";
import { noteDisplayTitle } from "./sidebar/noteDisplayTitle";
import { BreveSidebar } from "./breve/breveSidebar";
import { QuokkaMark } from "./character";

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
 * but is LABELED "Capture" — the word "Inbox" is reserved for the future email
 * front (removed from the sidebar 2026-07-30, see ROADMAP.md; Seth, 2026-06-26).
 * The ⌥C one-breath capture lands as a staged note in wiki/_inbox/
 * (inbox.md is not a rotli write surface — #96, audit 2026-07). */
/** Trash rows at or past this count wear the alert badge — a quiet "worth
 * emptying" nudge, never a modal (Seth, 2026-07-31). */
const TRASH_NUDGE_AT = 40;

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
      <button type="button" className="frow" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
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
          onKeyDown={(e) => {
            // role="button" spans get no synthetic click from Enter/Space
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.click();
            }
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
        <div className="sb-empty" style={{ paddingLeft: 44 }}>
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
  // unreviewed daemon proposals — the badge on the Librarian link (§4.4.2);
  // sensitive-data decisions waiting on the user wear the RED variant instead
  // (Seth, 2026-07-31: "or I will never know")
  const pendingProposals = deriveJournal(useJournal().data ?? []).pending.length;
  // detector-only hints awaiting a decision (deriveSecureReview's `confirm`,
  // inlined so the always-mounted sidebar doesn't anchor the secure-repair
  // DISK SCAN poll too — repair only feeds the leftover line, not this badge
  // (review F7; perf-audit family #12-14)
  const secureConfirms = (useSecureHints().data ?? []).filter((h) => !h.flagged).length;
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
  const mainSaveState = useMainStore((s) => s.saveState);
  const mainError = useMainStore((s) => s.error);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const setViewsManifest = useViewsStore((s) => s.setManifest);
  const viewsWritable = useViewsStore((s) => s.writable);
  const viewsSaveState = useViewsStore((s) => s.saveState);
  const viewsError = useViewsStore((s) => s.error);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const activeTree = activeView ? viewTree(viewsManifest, activeView) : mainManifest.tree;
  // the header's Saving…/Saved chip follows whichever tree is being edited —
  // main.json now reports its writes too (audit 2026-07-30, correctness #3)
  const treeSaveState = activeView ? viewsSaveState : mainSaveState;
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
  // pinned float, then RECENCY (Seth, 2026-07-30: "most recent chats at top")
  // — the disk listing's arbitrary order surfaced brand-new chats at the bottom
  const chatList = useMemo(
    () =>
      [...(rawChatListData ?? [])].sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.modifiedMs - a.modifiedMs,
      ),
    [rawChatListData],
  );
  const chatRename = useChatRename();
  const quickNoteIds = useUiStore((s) => s.quickNoteIds);
  // the LIMITED Chat view's cap — a Settings knob (5/10/15), default 5 (#17)
  const chatSidebarLimit = useUiStore((s) => s.chatSidebarLimit);

  // — chat FOLDERS: virtual grouping over the flat chats/ surface (Seth,
  // 2026-07-30) — a rebuildable .rotli sidecar per instance; chats never move
  // on disk. Expansion rides expandedDests under reserved chatfolder: ids. —
  const chatFoldersQuery = useQuery({
    queryKey: [...CHAT_FOLDERS_KEY, activeMemex?.root ?? ""],
    enabled: !!activeMemex && isTauri(),
    queryFn: () => loadChatFolders(activeMemex!),
  });
  const chatFoldersManifest = chatFoldersQuery.data ?? EMPTY_CHAT_FOLDERS;
  const groupedChats = useMemo(
    () => groupChats(chatList, chatFoldersManifest),
    [chatList, chatFoldersManifest],
  );
  const [renamingChatFolderId, setRenamingChatFolderId] = useState<string | null>(null);
  // read-modify-write from a FRESH load so two quick menu actions never
  // clobber each other through a stale react-query snapshot
  const updateChatFolders = (
    mutate: (manifest: ChatFoldersManifest) => ChatFoldersManifest,
    after?: () => void,
  ) => {
    if (!activeMemex) return;
    setRowActionError(null);
    void loadChatFolders(activeMemex)
      .then((fresh) => saveChatFolders(activeMemex, mutate(fresh)))
      .then(() => invalidateChatFolders())
      .then(() => after?.())
      .catch((err) =>
        setRowActionError(
          `Couldn’t update chat folders — ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  };

  // — drag a chat INTO a folder (Seth, 2026-07-30: "drag chat into the folder
  // properly"): the Main tree's pointer-drag grammar (HTML5 DnD stays dead in
  // the WKWebView shell). Dropping on a folder row assigns through the same
  // manifest write the row menu uses; anywhere else abandons. The dragged row
  // dims, the hovered folder tints, the title rides as a ghost. —
  type ChatDrop =
    { kind: "folder"; id: string } | { kind: "row"; slug: string; folderId: string; after: boolean };
  const [chatDragSlug, setChatDragSlug] = useState<string | null>(null);
  const [chatDrop, setChatDrop] = useState<ChatDrop | null>(null);
  const didChatDragRef = useRef(false);
  const startChatDrag = (e: ReactPointerEvent, slug: string, label: string) => {
    // button guard BEFORE the ref reset — a right-click must not clear the
    // last drag's click suppression (the session guards again internally)
    if (e.button !== 0 || !activeMemex) return;
    let drop: ChatDrop | null = null;
    didChatDragRef.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(label, x, y),
      // didChatDragRef stays armed past onEnd so the trailing click is eaten
      onStart: () => {
        didChatDragRef.current = true;
        setChatDragSlug(slug);
      },
      onMove: (x, y) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        // an IN-FOLDER chat row is a POSITION target (reorder, Seth
        // 2026-07-30); the folder row itself files at the end
        const row = el?.closest("[data-chat-infolder]") as HTMLElement | null;
        const rowSlug = row?.dataset.chatSlug;
        const rowFolder = row?.dataset.chatInfolder;
        if (row && rowSlug && rowFolder && rowSlug !== slug) {
          const rect = row.getBoundingClientRect();
          drop = {
            kind: "row",
            slug: rowSlug,
            folderId: rowFolder,
            after: rect.height === 0 ? true : y > rect.top + rect.height / 2,
          };
          setChatDrop(drop);
          return;
        }
        const folderRow = el?.closest("[data-chatfolder-id]") as HTMLElement | null;
        const folderId = folderRow?.dataset.chatfolderId;
        drop = folderId ? { kind: "folder", id: folderId } : null;
        setChatDrop(drop);
      },
      onDrop: () => {
        const d = drop;
        if (!d) return;
        if (d.kind === "folder") {
          updateChatFolders((m) => assignChatToFolder(m, slug, d.id));
          return;
        }
        // reorder: rebuild the folder's RENDERED order with the dragged slug
        // spliced beside the target, then commit assignment + order together
        const group = groupedChats.folders.find(({ folder }) => folder.id === d.folderId);
        const slugs = (group?.chats ?? []).map((c) => c.slug).filter((s) => s !== slug);
        const at = slugs.indexOf(d.slug);
        if (at < 0) return;
        slugs.splice(d.after ? at + 1 : at, 0, slug);
        updateChatFolders((m) =>
          setChatFolderOrder(assignChatToFolder(m, slug, d.folderId), d.folderId, slugs),
        );
      },
      onEnd: () => {
        setChatDragSlug(null);
        setChatDrop(null);
      },
    });
  };

  // one chat row, shared by folder groups and the loose list below them
  const renderChatRow = (c: (typeof chatList)[number], folderId: string | null) =>
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
        data-chat-slug={c.slug}
        data-chat-infolder={folderId ?? undefined}
        /* a chat row lights only while the PANES actually show it — never
           alongside an active All-chats (or other) view (Seth, 2026-07-30:
           two highlights at once read as wrong) */
        className={`sb-chatrow${folderId ? " in-folder" : ""}${
          contentView === "panes" && focusedChatSlug === c.slug ? " sel" : ""
        }${chatDragSlug === c.slug ? " dragging" : ""}${
          chatDrop?.kind === "row" && chatDrop.slug === c.slug
            ? chatDrop.after
              ? " mdrop-after"
              : " mdrop-before"
            : ""
        }`}
        onPointerDown={(e) => startChatDrag(e, c.slug, c.title || c.slug)}
        onClick={() => {
          if (didChatDragRef.current) return;
          openChatRow(c.slug);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // failures (e.g. a read-only brain) land in the sidebar's inline
          // error note — the menu is gone by the time they reject (#11
          // pattern; reviewer, 2026-07-08)
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
          const assignedFolder = chatFoldersManifest.assignments[c.slug];
          openContextMenu(e.clientX, e.clientY, [
            // the open verbs mirror the note row's menu (Seth, 2026-07-30:
            // "pretty much the same things as the notes")
            {
              kind: "action" as const,
              label: "Open in new tab",
              onClick: () => openChat(c.slug, { newTab: true }),
            },
            {
              kind: "action" as const,
              label: "Open to the right",
              onClick: () => usePanesStore.getState().openToSide("chat", c.slug),
            },
            { kind: "sep" as const },
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
            {
              kind: "drill" as const,
              label: "Move to folder",
              items: [
                ...chatFoldersManifest.folders.map((folder) => ({
                  kind: "action" as const,
                  label: folder.name,
                  checked: assignedFolder === folder.id,
                  checkedMark: "highlight" as const,
                  onClick: () => updateChatFolders((m) => assignChatToFolder(m, c.slug, folder.id)),
                })),
                ...(assignedFolder
                  ? [
                      {
                        kind: "action" as const,
                        label: "Remove from folder",
                        onClick: () => updateChatFolders((m) => assignChatToFolder(m, c.slug, null)),
                      },
                    ]
                  : []),
                ...(chatFoldersManifest.folders.length > 0 ? [{ kind: "sep" as const }] : []),
                {
                  kind: "action" as const,
                  label: "New folder…",
                  onClick: () => {
                    // create + assign in one write, then open the rename box
                    let createdId: string | null = null;
                    updateChatFolders(
                      (m) => {
                        const created = createChatFolder(m, "New folder");
                        createdId = created.id;
                        return assignChatToFolder(created.manifest, c.slug, created.id);
                      },
                      () => {
                        if (createdId) setRenamingChatFolderId(createdId);
                      },
                    );
                  },
                },
              ],
            },
            {
              kind: "action" as const,
              label: "Show in Finder",
              disabled: !isTauri(),
              onClick: () => {
                if (!activeMemex) return;
                setRowActionError(null);
                void revealChat(activeMemex, c.slug).catch((err) =>
                  setRowActionError(
                    `Couldn't reveal in Finder — ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
              },
            },
            {
              kind: "action" as const,
              // the chat IS a file on disk (chats/<slug>.md) — surface that
              // truth right in the row menu
              label: "Copy file path",
              onClick: () => {
                if (activeMemex) {
                  void navigator.clipboard.writeText(`${activeMemex.root}/chats/${c.slug}.md`);
                }
              },
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
        <ChatGlyph size={14} />
        <span className="fname">{c.title || c.slug}</span>
        {c.pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
      </button>
    );

  // Captures count mirrors BoardSurface's curated-note rule: a staged note
  // placed in Main or starred for Quick access is a full note, not a capture.
  const captureCount = useMemo(() => {
    const boardNotes = boardNotesData ?? [];
    const curated = mainNoteIds(mainManifest.tree);
    return boardNotes.filter((n) => !curated.has(n.id) && !quickNoteIds.includes(n.id)).length;
  }, [boardNotesData, mainManifest.tree, quickNoteIds]);

  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const contentView = useUiStore((s) => s.contentView);
  const setContentView = useUiStore((s) => s.setContentView);
  const expandedDests = useUiStore((s) => s.expandedDests);
  const collapseAllDests = useUiStore((s) => s.collapseAllDests);
  const toggleDestExpanded = useUiStore((s) => s.toggleDestExpanded);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const requestSystemFolder = useUiStore((s) => s.requestSystemFolder);
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  const openChat = usePanesStore((s) => s.openChat);
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
  // failed row-menu actions (file-to-brain, board rename) land here — the menu
  // that launched them is gone by the time they fail (#11, audit 2026-07)
  const rowActionError = useUiStore((s) => s.rowActionError);
  const setRowActionError = useUiStore((s) => s.setRowActionError);
  const sidebarZoom = useUiStore((s) => s.sidebarZoom);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  // the sidebar's live filter is retired (Seth, 2026-07-07) — the global titlebar
  // search covers it; `filter` stays empty so `matches()` passes every row.
  const filter = "";

  const trashItems = useTrashItems();

  // ONE Main-folder menu for right-click AND the roving "m" key (slice 5,
  // 2026-07-28: keyboard users could reach a folder row but never rename it).
  const openMainFolderMenu = (
    x: number,
    y: number,
    folderId: string,
    opts?: { returnFocus?: () => void },
  ) => {
    const f = mainProjection.folders.find((ff) => ff.id === folderId);
    if (!f) return;
    const folderItemIds = mainItemIdsInFolder(activeTree, f.id);
    const folderItems = folderItemIds.flatMap((id) => {
      const item = noteIndex.get(id);
      return item ? [item] : [];
    });
    const folderScopeComplete = folderItems.length === folderItemIds.length;
    openContextMenu(
      x,
      y,
      [
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
                        transferTreeItemToView(mainManifest.tree, viewsManifest, activeView, f.id, null),
                      ),
                  },
                  ...viewsManifest.views.map((view) => ({
                    kind: "action" as const,
                    label: view.name,
                    checked: activeView === view.name,
                    checkedMark: "highlight" as const,
                    onClick: () =>
                      setViewsManifest(
                        transferTreeItemToView(mainManifest.tree, viewsManifest, activeView, f.id, view.name),
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
              label: `Move ${folderItems.length} ${folderItems.length === 1 ? "item" : "items"} to Trash`,
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
      ],
      opts,
    );
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
      // "New vault…": pick an empty folder, scaffold a vault, switch into it
      createNew: () =>
        void pickFolder()
          .then((path) => (path ? initMemexAsCorpus(path) : undefined))
          .catch(vaultErr("create the vault")),
      // Location lives inside Settings — the pane picker is one click away
      openSettings: () => dispatch("app.settings"),
    });
    const rect = e.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, items, { returnFocus: () => e.currentTarget.focus() });
  };

  // — Main pointer-drag reorder (HTML5 DnD is dead in the WKWebView shell, so the
  //   BoardSurface pointer pattern; a threshold distinguishes drag from click) —
  const [mainDragId, setMainDragId] = useState<string | null>(null);
  // Finder-style multi-select in Main (Seth, 2026-07-28): ⌘-click gathers
  // rows, dragging any gathered row moves the WHOLE selection into a folder;
  // a plain click still just opens (and clears the gathering).
  const [mainSel, setMainSel] = useState<ReadonlySet<string>>(new Set());
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
    // dragging a gathered row moves the whole selection (Finder's rule)
    const dragIds = mode === "move" && mainSel.has(id) && mainSel.size > 1 ? [...mainSel] : [id];
    const dragLabel = dragIds.length > 1 ? `${dragIds.length} items` : label;
    let drop: { id: string; pos: DropPos } | null = null;
    const dragFlag = mode === "move" ? didMainDragRef : crossDragRef;
    dragFlag.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(dragLabel, x, y),
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
        if (!hit || !tid || (mode === "move" && dragIds.includes(tid))) {
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
          let tree = activeTree;
          for (const moveId of dragIds) tree = moveInTree(tree, moveId, d.id, d.pos);
          setActiveTree(tree, liveIds);
          setMainSel(new Set());
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
    // depth 0 starts flush at the section inset (Seth, 2026-07-28: the extra
    // first step was wasted left whitespace); children advance 16px per level
    const rowPad = 10 + depth * 16;
    // Folder rows reserve 18px for the disclosure chevron. Note rows and
    // rename inputs compensate for that slot so same-depth icons share one
    // visual column and nested children still advance by exactly 16px.
    const contentPad = rowPad + 18;
    const childFolders = mainProjection.folders.filter((f) => f.parentId === parentId);
    // the live filter narrows Main too (it used to skip this section entirely —
    // the one Seth curates by hand); MUST mirror mainRovingRows below
    const childNotes = mainProjection.notes
      .filter((n) => n.folderId === parentId && matches(n))
      // pinned float above hand-arranged order — the ONE comparator, shared
      // with mainRovingRows so j/k always mirrors the rendered order
      .sort(mainRowSort);
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
            if (full) {
              // the disabled star must explain itself — a silent no-op read as
              // broken (slice 5, 2026-07-28); the inline error lane is right here
              setRowActionError(`Quick access is full (${QUICK_MAX}) — unstar one first.`);
              return;
            }
            togglePinQuick(id);
          }}
          // a span with role="button" gets no synthetic click from the
          // keyboard — wire Enter/Space by hand (slice 5, 2026-07-28)
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              ev.currentTarget.click();
            }
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
              className={`snrow main-row${n.id === focusedItemId ? " sel" : ""}${mainSel.has(n.id) ? " msel" : ""}${dropCls(n.id)}${mainDragId === n.id ? " dragging" : ""}`}
              style={{ paddingLeft: contentPad }}
              onPointerDown={(e) => startMainDrag(e, n.id, "move", displayTitle)}
              onClick={(e) => {
                if (didMainDragRef.current) return;
                // ⌘-click gathers for a multi-drag instead of opening
                if (e.metaKey) {
                  setMainSel((prev) => {
                    const next = new Set(prev);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  });
                  return;
                }
                setMainSel(new Set());
                // Main is the creation context as well as the visible projection:
                // ⌘T / New note must not inherit a stale Brain/Storage selection
                // from before this row was opened.
                setSelectedFolderId(parentId);
                setContentView("panes");
                usePanesStore.getState().openSummary(n);
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
                aria-expanded={open}
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
                  openMainFolderMenu(e.clientX, e.clientY, f.id);
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

  // the top-level sections' open state (Seth's IA, 2026-06-26). Default
  // open so a fresh window shows the full tree; persisted via expandedDests.
  const chatSecOpen = expandedDests[SEC_CHAT] ?? true;
  const notesSecOpen = expandedDests[SEC_NOTES] ?? true;
  // MAIN is collapsible as a whole (Seth, 2026-07-26) — default open
  // the System browser target (contentView "system")
  const systemRoot = useUiStore((s) => s.systemRoot);
  const setSystemRoot = useUiStore((s) => s.setSystemRoot);
  const openSystemRoot = (id: string) => {
    setSelectedFolderId(id);
    setSystemRoot(id);
    setContentView("system");
  };
  const hasBrain = childrenOf("wiki").length > 0 || brainNotes.length > 0 || secureNotes.length > 0;

  // Main rows in the roving order — mirrors renderMainTree's traversal exactly
  // (notes first, then folders + their open subtrees). Main notes reference the
  // SAME ids as their Brain twins, so their roving ids carry a "main>" prefix
  // (folders already carry "main:") — no id collision, j/k walks both copies.
  const MAIN_ROW_PREFIX = "main>";
  // roving id for the one ACTION row (opens a surface, never a selection) —
  // a distinct sentinel so it can't collide with folder/dest ids. (The old
  // Activity row moved into the utility footer, outside the roving list.)
  const CAPTURES_ROW = "row:captures";
  const mainRovingRows = (parentId: string): RovingRow[] => [
    // filtered by matches() exactly like renderMainTree — the roving cursor
    // must never point at a row the live filter hid
    ...mainProjection.notes
      .filter((n) => n.folderId === parentId && matches(n))
      .sort(mainRowSort) // MUST mirror renderMainTree — pinned float included
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
  // that section is collapsed there are no roving rows; the Chat section
  // is plain buttons, outside the listbox.
  // MUST mirror the rendered order exactly — a skipped visual row makes the
  // cursor teleport. System is PINNED at the sidebar's bottom and never
  // collapses (Seth, 2026-07-28), so its rows are always walkable.
  const rows: RovingRow[] = [
    ...(notesSecOpen
      ? [
          { id: ALL_NOTES, kind: "smart" } as RovingRow,
          { id: CAPTURES_ROW, kind: "smart" } as RovingRow,
          { id: TASKS, kind: "smart" } as RovingRow,
          // Main — always visible; the header only switches views (2026-07-28)
          ...mainRovingRows(MAIN_ROOT),
        ]
      : []),
    ...(hasBrain ? [{ id: "Brain", kind: "folder" } as RovingRow] : []),
    ...visibleDestRows.map(({ id }) => ({ id, kind: "folder" }) as RovingRow),
  ];

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
      // the action row: it opens its surface, never becomes a selection
      if (row.id === CAPTURES_ROW) {
        dispatch("board.open");
        return;
      }
      setSelectedFolderId(row.id);
      if (row.id === ALL_NOTES) {
        setContentView("allNotes");
      } else if (row.id === TASKS) {
        setContentView("tasks");
      } else if (row.id === "Brain" || visibleDestRows.some((d) => d.id === row.id)) {
        // System rows open the browser surface (2026-07-26), never a dropdown
        openSystemRoot(row.id);
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
      if (row.kind !== "note") {
        // Main folder rows have a real menu (Rename / Move to view / Remove /
        // Trash contents) — the keyboard deserves it too (slice 5, 2026-07-28)
        if (row.kind === "folder" && row.id.startsWith(MAIN_ROOT)) {
          const rect = anchor.getBoundingClientRect();
          openMainFolderMenu(rect.left + 24, rect.bottom + 4, row.id, {
            returnFocus: () => anchor.focus(),
          });
        }
        return;
      }
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
    // System content no longer expands inline (2026-07-26) — an EXPLICIT
    // reveal ("Show in Library" / the location chip) opens the right-side
    // browser at the item's root instead; auto-reveal on plain navigation
    // stays quiet (there is no sidebar row to surface).
    if (mode !== "brain") return;
    if (fid === "wiki" || fid.startsWith("wiki/")) {
      openSystemRoot("Brain");
    } else if (fid.startsWith("Storage")) {
      openSystemRoot(DEST.storage);
    } else if (fid.startsWith("Archive")) {
      openSystemRoot(DEST.archive);
    } else if (fid.startsWith("Trash")) {
      openSystemRoot(DEST.trash);
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

  // — Chat openers: chats open as PANES now (a pane holds a chat OR a note, side
  //   by side, multiple at once), so "New chat"/a row opens a chat pane; "All
  //   chats" opens a searchable content view (the twin of All notes). The open
  //   chat = the focused pane's. —
  const openNewChat = () => openChat(null);
  const openAllChats = () => setContentView("allChats");
  const openChatRow = (slug: string) => openChat(slug);

  // a top-level section header (Chat · Notes): a clickable disclosure row
  // that toggles its accordion (state persisted in expandedDests under SEC_*).
  // The chevron rides the RIGHT edge (Seth, 2026-07-28: the left slot was
  // wasted whitespace) — the glyph + label start flush at the row's inset.
  const sectionHeader = (
    id: string,
    label: string,
    Glyph: typeof ChatGlyph,
    open: boolean,
    count?: number,
  ): ReactNode => (
    <button type="button" className="sb-section" aria-expanded={open} onClick={() => toggleDestExpanded(id)}>
      <Glyph size={15.5} />
      <span className="fname">{label}</span>
      {count != null && count > 0 && <span className="count">{count}</span>}
      <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
        <ChevronRight size={11} />
      </span>
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
      {/* ONE header row (Seth, 2026-07-26): the vault switcher + the create
          icons share a line — less chrome before the content starts. Hidden in
          Breve mode — Breve is a mode over the same vault, not a different one. */}
      <div className={sidebarMode === "breve" ? "nl-top breve-active" : "nl-top"}>
        {sidebarMode !== "breve" && (
          <button
            type="button"
            className="vault-switch"
            aria-haspopup="menu"
            aria-label={`Vault: ${vaultName}. Switch or connect vaults`}
            title={`${vaultName} — switch or connect vaults`}
            onClick={openVaultMenu}
          >
            <VaultGlyph size={14.5} />
            <span className="vault-switch-name">{vaultName}</span>
            <span className="vault-switch-caret caret-down" aria-hidden="true">
              <ChevronRight size={9} />
            </span>
          </button>
        )}
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
          onClick={() => {
            // the System browser open? create a real folder at its cwd; else a
            // Main (virtual) folder — the inline notes-tree input died with the
            // 2026-07-26 System fold and left this button a silent no-op (P0)
            if (contentView === "system") {
              requestSystemFolder();
            } else {
              setMainNewFolder(true);
            }
          }}
        >
          <NewFolderGlyph size={16} />
          <span className="tip" aria-hidden="true">
            {sidebarMode === "breve" ? "Unavailable in Breve" : "New folder"}
          </span>
        </button>
        {/* New board lives in the New… dropdown (Seth, 2026-07-28) — its own
            header icon was one too many for a narrow sidebar */}
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

      {/* the top-level sections (Seth's IA, 2026-06-26): Chat · Notes — each a
          collapsible accordion; only the Notes tree is the roving j/k listbox.
          The Inbox (email) front was removed 2026-07-30 pending the real mail
          integration — see ROADMAP.md; the restore blueprint is
          docs/archive/notes-chat-inbox-rearchitecture.md. */}
      {/* the whole section tree scales with the sidebar zoom (⌘+/⌘− while focus
          is in the sidebar) — CSS zoom scales rows + text together; the fixed-
          positioned popovers (RowMenu, the "+" menu) sit OUTSIDE this node, so
          their pixel coordinates stay unscaled. */}
      {sidebarMode === "breve" ? (
        <BreveSidebar zoom={sidebarZoom} />
      ) : (
        <div className="sb-rows" aria-label="Sections" style={{ zoom: sidebarZoom }}>
          {/* ── CHAT — a ChatGPT-style front over the memex chats/: New chat, a
            searchable All, and the recent history (a LIMITED view). ── */}
          {sectionHeader(SEC_CHAT, "Chat", ChatGlyph, chatSecOpen, chatList.length)}
          {chatSecOpen && (
            <div className="sb-chat">
              <button type="button" className="sb-chatnew" onClick={openNewChat}>
                <PlusGlyph size={14} />
                <span>New chat</span>
              </button>
              <button
                type="button"
                /* highlight "All chats" only when its content view is active — so it
                 never lights up alongside an open chat row (Seth, 2026-07-01) */
                className={`sb-chatrow all${contentView === "allChats" ? " sel" : ""}`}
                onClick={openAllChats}
              >
                <SearchGlyph size={14} />
                <span className="fname">All chats</span>
              </button>
              {!activeMemex ? (
                <button type="button" className="sb-chat-empty" onClick={() => dispatch("app.settings")}>
                  Connect a memex in Settings → Location
                </button>
              ) : chatList.length === 0 ? (
                <p className="sb-empty">No chats yet.</p>
              ) : (
                <>
                  {groupedChats.folders.map(({ folder, chats }) => {
                    const folderKey = `chatfolder:${folder.id}`;
                    const open = expandedDests[folderKey] ?? true;
                    return (
                      <div key={folder.id} className="sb-chatfolder">
                        {renamingChatFolderId === folder.id ? (
                          <InlineRenameInput
                            className="sb-chatrename"
                            defaultValue={folder.name}
                            ariaLabel="Rename chat folder"
                            onCommit={(value) => {
                              setRenamingChatFolderId(null);
                              updateChatFolders((m) => renameChatFolder(m, folder.id, value));
                            }}
                            onCancel={() => setRenamingChatFolderId(null)}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`sb-chatrow sb-chatfolder-row${
                              chatDrop?.kind === "folder" && chatDrop.id === folder.id ? " chatdrop" : ""
                            }`}
                            data-chatfolder-id={folder.id}
                            aria-expanded={open}
                            onClick={() => setDestExpanded(folderKey, !open)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openContextMenu(e.clientX, e.clientY, [
                                {
                                  kind: "action" as const,
                                  label: "Rename…",
                                  onClick: () => setRenamingChatFolderId(folder.id),
                                },
                                { kind: "sep" as const },
                                {
                                  kind: "action" as const,
                                  // frees the chats back to the list — files never move
                                  label: "Delete folder",
                                  danger: true,
                                  onClick: () => updateChatFolders((m) => deleteChatFolder(m, folder.id)),
                                },
                              ]);
                            }}
                            title={folder.name}
                          >
                            {/* the Notes tree's disclosure grammar (Seth,
                                2026-07-30: "needs to be clear what is a
                                folder") — rotating chevron + folder glyph */}
                            <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                              <ChevronRight size={10} />
                            </span>
                            <FolderGlyph size={14} />
                            <span className="fname">{folder.name}</span>
                            <span className="sb-chatfolder-n">{chats.length}</span>
                          </button>
                        )}
                        {open && chats.map((c) => renderChatRow(c, folder.id))}
                      </div>
                    );
                  })}
                  {groupedChats.loose.slice(0, chatSidebarLimit).map((c) => renderChatRow(c, null))}
                </>
              )}
              {groupedChats.loose.length > chatSidebarLimit && (
                <button type="button" className="sb-chat-more" onClick={openAllChats}>
                  +{groupedChats.loose.length - chatSidebarLimit} more
                </button>
              )}
            </div>
          )}

          {/* ── NOTES — the corpus (the deepest tree). All notes · Board · Recent ·
            the local destinations + Vault/Knowledge + nested folders. This wrapper
            is the roving listbox: Tab enters at the one tabIndex=0 row, j/k walk
            it; the keyboard highlight is :focus-visible. ── */}
          {sectionHeader(SEC_NOTES, "Notes", NotesStackGlyph, notesSecOpen)}
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
                {searchableCount > 0 && <span className="count">{searchableCount}</span>}
              </button>
              {/* Board — quick captures collected as cards; opens its grid in the
                content area (an action row, not a roving folder). */}
              <button
                type="button"
                className={`frow${contentView === "board" ? " sel" : ""}`}
                onClick={() => dispatch("board.open")}
                {...rowProps({ id: CAPTURES_ROW, kind: "smart" })}
              >
                <CaptureBoardGlyph size={14.5} />
                <span className="fname">Captures</span>
                {captureCount > 0 && <span className="count">{captureCount}</span>}
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
              {/* the MAIN header (reworked 2026-07-28, Seth: "not collapsible —
                  just a way to change the views"): the label + ▾ are ONE view
                  switcher; Main always shows. */}
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
                  <span className="caret-down" aria-hidden="true">
                    <ChevronRight size={9} />
                  </span>
                </button>
                {(treeSaveState === "saving" || treeSaveState === "saved") && (
                  <span className="fsec-save" role="status">
                    {treeSaveState === "saving" ? "Saving…" : "Saved"}
                  </span>
                )}
                <button
                  type="button"
                  className="fsec-add"
                  aria-label={`New note in ${activeView ?? "Main"}`}
                  title={`New note in ${activeView ?? "Main"}`}
                  onClick={() => dispatch("notes.new")}
                >
                  <NewFileGlyph size={13} />
                </button>
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
              {mainError && (
                <p className="view-state-error" role="alert">
                  {mainError}
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
                      The notes you reach for, arranged your way. Right-click a note and choose{" "}
                      <b>Add to Main</b>
                      {hasBrain ? ", or drag one here from the Library" : ""} — then <b>★</b> your top{" "}
                      {QUICK_MAX} for Quick access (the ⌥ Quick window).
                    </>
                  )}
                </p>
              ) : (
                <div data-main-id="main:" data-active-view={activeView ?? "Main"} className="main-tree">
                  {renderMainTree(MAIN_ROOT, 0, rowProps)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* — SYSTEM, pinned (Seth, 2026-07-28): its own bottom zone — always
          visible, never collapses, visually separate from the scrolling tree.
          The Files button is the vault's Finder door. — */}
      {sidebarMode === "notes" && (
        <div className="sb-system" style={{ zoom: sidebarZoom }}>
          {/* — SYSTEM (Seth, 2026-07-26: Destinations→System): app-managed
                surfaces. NOT dropdowns — each row opens the Finder-style
                browser on the right (search + Folders⇄List), where a real
                file view belongs. No create affordances, no add-folder row
                (external folders connect from Location settings). — */}
          <div className="fsec">System</div>

          {hasBrain && (
            <button
              type="button"
              className={`frow${contentView === "system" && systemRoot === "Brain" ? " sel" : ""}`}
              onClick={() => openSystemRoot("Brain")}
              title={
                brainEnabledUi
                  ? "The Library — where the Librarian files everything"
                  : "The Library — plain folders in this raw vault"
              }
              {...rowProps({ id: "Brain", kind: "folder" })}
            >
              <NotesStackGlyph size={14.5} />
              <span className="fname">Library</span>
              {brainNotes.length + secureNotes.length > 0 && (
                <span className="count">{brainNotes.length + secureNotes.length}</span>
              )}
            </button>
          )}
          {visibleDestRows.map(({ id, label, Glyph }) => {
            const destNotes = notesByDest[id] ?? [];
            const selected = contentView === "system" && systemRoot === id;
            // a piled-up Trash earns the alert badge (Seth, 2026-07-31) — the
            // browser's Empty Trash… is one click behind it
            const trashFull = id === DEST.trash && destNotes.length >= TRASH_NUDGE_AT;
            return (
              <button
                key={id}
                type="button"
                className={`frow${selected ? " sel" : ""}`}
                title={
                  trashFull ? `${destNotes.length} items — open Trash to review and empty it` : undefined
                }
                onClick={() => openSystemRoot(id)}
                {...rowProps({ id, kind: "folder" })}
              >
                <Glyph size={14.5} />
                <span className="fname">{label}</span>
                {destNotes.length > 0 && (
                  <span className={trashFull ? "count alert" : "count"}>{destNotes.length}</span>
                )}
              </button>
            );
          })}
          {/* added external folders (Seth, 2026-06-27): folders you point rotli at
              without moving them into the memex — browse + edit in place.
              Adding one moved to Location settings (2026-07-26). */}
          {addedRoots.length > 0 && <div className="fsec">Folders</div>}
          {addedRoots.map((r) => (
            <AddedRootRow key={r.id} root={r} />
          ))}
          {/* — the utility footer (Seth, 2026-07-28, from the Obsidian
              reference): Files · Librarian · Settings share one quiet row.
              The Librarian is the old Activity row — it's the Librarian's
              journal, so it wears the Librarian's name; the badge stays the
              unreviewed proposals. — */}
          <div className="sb-foot">
            {isTauri() && (
              <button
                type="button"
                className="sb-footbtn"
                title="Open the vault folder in Finder"
                onClick={() => void revealCorpus()}
              >
                <FolderGlyph size={14} />
                <span className="fname">Files</span>
              </button>
            )}
            <button
              type="button"
              className="sb-footbtn"
              title={
                secureConfirms > 0
                  ? `${secureConfirms} sensitive-data ${secureConfirms === 1 ? "decision waits" : "decisions wait"} for you`
                  : pendingProposals > 0
                    ? `${pendingProposals} ${pendingProposals === 1 ? "suggestion waits" : "suggestions wait"} for your approval`
                    : brainEnabledUi
                      ? "See and undo the Librarian's work"
                      : "The Librarian's journal"
              }
              onClick={() => usePanesStore.getState().openActivity()}
            >
              <ActivityGlyph size={14} />
              <span className="fname">Librarian</span>
              {/* RED = a sensitive-data decision waits (never auto-resolved);
                  otherwise the pending-approval count so Suggest mode is
                  never a silent queue */}
              {secureConfirms > 0 ? (
                <span className="count alert">{secureConfirms}</span>
              ) : (
                pendingProposals > 0 && <span className="count pill">{pendingProposals}</span>
              )}
            </button>
            <button
              type="button"
              className="sb-footbtn"
              title="Settings"
              onClick={() => dispatch("app.settings")}
            >
              <Icon name="rotli-settings" size={14} />
              <span className="fname">Settings</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
