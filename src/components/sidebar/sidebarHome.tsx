// The HOME front (Seth's IA, 2026-08-01): the notes world, in one uninterrupted
// scroll. All notes · Captures · Tasks, then the MAIN manifest (or the active
// named view) as a hand-arranged tree, then the pinned SYSTEM zone underneath.
// "Home, which is notes essentially and eventually a dashboard" — a dashboard
// block joins the top of this stack without moving anything else
// (docs/design/sidebar-home-chat.md).
//
// Selection grammar is unchanged from the one-rail era: clicking a destination
// row both toggles its expansion AND selects it (the ⌘N target via
// selectedFolderId); a note row is selected when its id === the focused pane's
// active tab. Plain click opens in place; ⌘-click opens a new tab. Peach tint +
// the 3px clay ::before is the one selection grammar, shared with the panes.

import {
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { dispatch } from "../../keys/registry";
import { createDragGhost } from "../../lib/dragGhost";
import { noteDiskFolder, projectNoteToBrain } from "../../lib/noteLocation";
import { createPointerDragSession } from "../../lib/pointerDrag";
import { DEST, isRootMarker } from "../../services/destinations";
import {
  useCorpusRoots,
  useFolders,
  useMainGcIds,
  useNoteIndex,
  useNotes,
  useSearchableNotes,
  useTasks,
  useTrashItems,
} from "../../services/hooks";
import {
  type DropPos,
  MAIN_ROOT,
  addFolderToMain,
  buildMainTree,
  mainItemIdsInFolder,
  mainNoteIds,
  mainParentOfNote,
  mainRowSort,
  moveInTree,
  removeFromMain,
  renameFolderInMain,
  uniqueRootFolderName,
} from "../../services/mainTree";
import { buildStorageTree } from "../../services/storageTree";
import { openSystemRoot } from "../../services/systemNav";
import {
  createNamedView,
  deleteNamedView,
  renameNamedView,
  setNamedViewTree,
  transferTreeItemToView,
  viewFolderNameError,
  viewNameError,
} from "../../services/viewTree";
import { type MenuSpec, useContextMenu } from "../../state/contextMenu";
import { useMainStore } from "../../state/main";
import { sidebarItemId, useFocusedTab, usePanesStore } from "../../state/panes";
import { QUICK_MAX, togglePinQuick } from "../../state/quick";
import { ALL_NOTES, SEC_SYSTEM, TASKS, useUiStore } from "../../state/ui";
import { useViewsStore } from "../../state/views";
import type { NoteSummary } from "../../types";
import {
  ArchiveGlyph,
  ChevronRight,
  FileGlyph,
  FolderGlyph,
  NewFileGlyph,
  NewFolderGlyph,
  PinGlyph,
  ShieldGlyph,
  StarGlyph,
  StorageGlyph,
  TaskGlyph,
  TrashGlyph,
  VaultGlyph,
  glyphForNote,
} from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { useNoteMenu } from "../useNoteMenu";
import { noteDisplayTitle } from "./noteDisplayTitle";
import { SidebarSystem, type SystemDestRow } from "./sidebarSystem";
import { useActiveTree } from "./useActiveTree";
import { type RovingRow, useRovingList } from "./useRovingList";

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

/** The reserved System destinations, in order, each with its glyph. The
 * note-capture root keeps its on-disk id "Inbox" (the memex contract is
 * unchanged) but is LABELED "Capture" — the word "Inbox" is reserved for the
 * future email front (removed from the sidebar 2026-07-30, see ROADMAP.md).
 * "Capture" (DEST.inbox) is GONE from the rows — captures have ONE home now,
 * the "Captures" row below (Seth, 2026-06-30). */
const DEST_ROWS: SystemDestRow[] = [
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

export function SidebarHome({ zoom }: { zoom: number }) {
  const foldersData = useFolders().data;
  // the COUNTS speak the same universe the All-notes surface renders
  // (useSearchableNotes — staged + Brain + Vault + added roots): counting the
  // plain useNotes VIEW made the sidebar and the surface disagree the moment
  // an ⌥C capture landed (#60, audit 2026-07). Cache reads, not new fetches.
  const searchableNotes = useSearchableNotes().notes;
  const searchableCount = searchableNotes.length;
  // the reserved queries — all served from the one cached corpus_list, so
  // these hooks are cache reads, not fetches
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
  // Curated notes (no shelf) project to their disk area "wiki/<area>"; the
  // Library row in the System zone is their door (Seth, 2026-06-30).
  const brainNotes = useMemo(
    () => searchableNotes.map(projectNoteToBrain).filter((n): n is NoteSummary => n !== null),
    [searchableNotes],
  );
  // open checkboxes across the corpus — the Tasks smart row's count
  const openTaskCount = useTasks().data?.length ?? 0;
  // raw vault (vault-vs-brain, 2026-07-26): the Library row's copy changes —
  // the areas are real folders either way, so the TREE stays visible
  const brainEnabledUi = useUiStore((s) => s.brainEnabled);

  // MAIN — the user's hand-arranged view over the Brain (memex-vault wiki/projects/rotli/main-brain-daemon.md).
  // A `.rotli/main.json` manifest of folders + note-id refs, projected into synthetic
  // sidebar rows. It references notes BY ID, so a daemon refiling the Brain underneath
  // never moves Main. Mouse + drag navigable.
  const mainManifest = useMainStore((s) => s.manifest);
  const setMainTree = useMainStore((s) => s.setTree);
  const mainError = useMainStore((s) => s.error);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const setViewsManifest = useViewsStore((s) => s.setManifest);
  const viewsWritable = useViewsStore((s) => s.writable);
  const viewsError = useViewsStore((s) => s.error);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const activeTree = useActiveTree();
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

  const quickNoteIds = useUiStore((s) => s.quickNoteIds);

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
  const toggleDestExpanded = useUiStore((s) => s.toggleDestExpanded);
  const setDestExpanded = useUiStore((s) => s.setDestExpanded);
  const openNote = usePanesStore((s) => s.openNote);
  const openCanvas = usePanesStore((s) => s.openCanvas);
  // The DERIVED destination highlight (Seth #1, 2026-07-08): a destination/folder
  // row only reads "selected" while the focused tab's content actually LIVES
  // under it — a stale ⌘N create-target (e.g. Storage) no longer glows while you
  // work in a Main note.
  const focusedTab = useFocusedTab();
  const focusedItemId = sidebarItemId(focusedTab);
  // failed row-menu actions (file-to-brain, board rename) land here — the menu
  // that launched them is gone by the time they fail (#11, audit 2026-07)
  const setRowActionError = useUiStore((s) => s.setRowActionError);
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
  //   mainNewFolder is the name-first input at the Main root. —
  const [renamingMainId, setRenamingMainId] = useState<string | null>(null);
  const [mainNewFolder, setMainNewFolder] = useState(false);
  const [editingView, setEditingView] = useState<"create" | "rename" | null>(null);
  const [viewInputError, setViewInputError] = useState<string | null>(null);
  const [deletingView, setDeletingView] = useState<string | null>(null);
  // Enter/Esc unmount the new-folder input, which fires its commit-on-blur —
  // this ref tells the blur the keystroke already settled it (newFolderHandled's law)
  const mainNewFolderHandled = useRef(false);
  const openContextMenu = useContextMenu((s) => s.open);

  // the shell's New-folder toolbar button, while Home is the active front,
  // opens THIS input — the nonce is the seam (ui.requestSidebarFolder)
  const sidebarFolderNonce = useUiStore((s) => s.sidebarFolderNonce);
  const lastFolderNonce = useRef(sidebarFolderNonce);
  useEffect(() => {
    if (sidebarFolderNonce === lastFolderNonce.current) return;
    lastFolderNonce.current = sidebarFolderNonce;
    setMainNewFolder(true);
  }, [sidebarFolderNonce]);

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

  // — Main pointer-drag reorder (HTML5 DnD is dead in the WKWebView shell, so the
  //   BoardSurface pointer pattern; a threshold distinguishes drag from click) —
  const [mainDragId, setMainDragId] = useState<string | null>(null);
  // Finder-style multi-select in Main (Seth, 2026-07-28): ⌘-click gathers
  // rows, dragging any gathered row moves the WHOLE selection into a folder;
  // a plain click still just opens (and clears the gathering).
  const [mainSel, setMainSel] = useState<ReadonlySet<string>>(new Set());
  const [mainDrop, setMainDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const didMainDragRef = useRef(false);

  // ONE pointer-drag for the Main tree: reorder a row, or drop it into a folder.
  // (HTML5 DnD stays dead in the WKWebView shell — pointer events only.) The
  // dragged row rides the cursor as a floating ghost (the shared lib/dragGhost,
  // same as tab drags); Esc / pointercancel abandons the drag. Pulling a note IN
  // from another surface is NOT this gesture — lib/mainAddDrag.ts owns that, and
  // the browser rows call it directly (its twin here was dead code).
  const startMainDrag = (e: ReactPointerEvent, id: string, label: string) => {
    // button guard BEFORE the ref reset — a right-click must not clear the
    // last drag's click suppression (the session guards again internally)
    if (e.button !== 0) return;
    // dragging a gathered row moves the whole selection (Finder's rule)
    const dragIds = mainSel.has(id) && mainSel.size > 1 ? [...mainSel] : [id];
    const dragLabel = dragIds.length > 1 ? `${dragIds.length} items` : label;
    let drop: { id: string; pos: DropPos } | null = null;
    didMainDragRef.current = false;
    createPointerDragSession(e, {
      ghost: (x, y) => createDragGhost(dragLabel, x, y),
      // didMainDragRef stays armed past onEnd so the trailing click is eaten
      onStart: () => {
        didMainDragRef.current = true;
        setMainDragId(id);
      },
      onMove: (x, y) => {
        const hit = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(
          "[data-main-id]",
        ) as HTMLElement | null;
        const tid = hit?.dataset.mainId;
        if (!hit || !tid || dragIds.includes(tid)) {
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
        let tree = activeTree;
        for (const moveId of dragIds) tree = moveInTree(tree, moveId, d.id, d.pos);
        setActiveTree(tree, liveIds);
        setMainSel(new Set());
      },
      onEnd: () => {
        setMainDragId(null);
        setMainDrop(null);
      },
    });
  };

  // the live filter narrows the compact rows by title OR snippet (applied per
  // section — including Main, which the first filter pass skipped entirely)
  const q = filter.trim().toLowerCase();
  const matches = (note: NoteSummary): boolean =>
    !q || note.title.toLowerCase().includes(q) || note.snippet.toLowerCase().includes(q);

  // recursive render of the Main tree — mouse + drag + roving j/k (Seth follow-up,
  // 2026-07-01). Synthetic folders (id "main:<path>") + notes re-homed by the
  // manifest; a note references the same .md as its Library twin (one file, two
  // views). `rp` is the roving rowProps factory; note rows ride with a "main>"
  // prefix so they never collide with their Library twins in the roving list.
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
    // the live filter narrows Main too; MUST mirror mainRovingRows below
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
              onPointerDown={(e) => startMainDrag(e, n.id, displayTitle)}
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
                // ⌘T / New note must not inherit a stale Library/Storage selection
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
                onPointerDown={(e) => startMainDrag(e, f.id, f.name)}
                onClick={() => {
                  // toggle against the OPEN default (?? true) — toggleDestExpanded
                  // assumes closed, so the first click on a fresh folder no-oped
                  if (!didMainDragRef.current) {
                    setSelectedFolderId(f.id);
                    setDestExpanded(f.id, !open);
                  }
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

  // each destination's subtree notes, by dest id — the System zone's counts
  const notesByDest: Record<string, NoteSummary[]> = {
    [DEST.secure]: secureNotes,
    [DEST.vault]: vaultNotes,
    [DEST.storage]: storageNotes,
    [DEST.archive]: archiveNotes,
    [DEST.trash]: trashNotes,
  };

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

  // the SYSTEM zone's fold (Seth, 2026-08-01) — default OPEN
  const systemOpen = expandedDests[SEC_SYSTEM] ?? true;
  const hasBrain = childrenOf("wiki").length > 0 || brainNotes.length > 0 || secureNotes.length > 0;

  // Main rows in the roving order — mirrors renderMainTree's traversal exactly
  // (notes first, then folders + their open subtrees). Main notes reference the
  // SAME ids as their Library twins, so their roving ids carry a "main>" prefix
  // (folders already carry "main:") — no id collision, j/k walks both copies.
  const MAIN_ROW_PREFIX = "main>";
  // roving id for the one ACTION row (opens a surface, never a selection) —
  // a distinct sentinel so it can't collide with folder/dest ids.
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

  // the roving j/k cursor walks the Home front top to bottom: the smart rows,
  // the Main manifest rows, then the SYSTEM rows — but only while the System
  // zone is OPEN (a folded zone drops its rows, exactly like a folded folder).
  // MUST mirror the rendered order exactly — a skipped visual row makes the
  // cursor teleport. Chat rows are plain buttons, outside the listbox.
  const rows: RovingRow[] = [
    { id: ALL_NOTES, kind: "smart" },
    { id: CAPTURES_ROW, kind: "smart" },
    { id: TASKS, kind: "smart" },
    // Main — always visible; its header only switches views (2026-07-28)
    ...mainRovingRows(MAIN_ROOT),
    ...(systemOpen
      ? [
          ...(hasBrain ? [{ id: "Brain", kind: "folder" } as RovingRow] : []),
          ...visibleDestRows.map(({ id }) => ({ id, kind: "folder" }) as RovingRow),
        ]
      : []),
  ];

  const { rowProps } = useRovingList(rows, {
    // l / Enter: a note opens in place; a folder/dest toggles its expansion and
    // becomes the ⌘N selection — mirrors the click gesture exactly.
    onOpen: (row, newTab) => {
      if (row.kind === "note") {
        // a Main row references its Library twin by id — strip the prefix, open
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
        setSelectedFolderId(row.id);
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
    // note's REAL home in the Library even when it's also pinned in Main (Seth #3,
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
  // The nonce bump also puts the sidebar on THIS front (ui.revealFocusedNote),
  // so this component is always mounted by the time the effect runs.
  useEffect(() => {
    if (!revealNonce) return;
    const { revealMode: mode, revealNoteId } = useUiStore.getState();
    const targetItemId = revealNoteId ?? focusedItemId;
    expandToFocusedItem(mode, targetItemId);
    // two frames: the first lets the just-expanded folder chain commit to the
    // DOM, the second scrolls the now-rendered row into view (pre-release review).
    // In "brain" mode, scroll to the LIBRARY occurrence (not the Main copy, which
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

  const commitNewFolder = (raw: string) => {
    const name = raw.trim();
    setMainNewFolder(false);
    if (!name) return;
    if (activeView) {
      const error = viewFolderNameError(name);
      if (error) {
        setRowActionError(`Couldn’t create folder — ${error}`);
        return;
      }
    }
    // compute the rendered id BEFORE the commit (same uniquify law) so the
    // fresh row — appended after every root note — can be scrolled into view
    const folderId = `${MAIN_ROOT}${uniqueRootFolderName(activeTree, name)}`;
    setActiveTree(addFolderToMain(activeTree, name), liveIds);
    requestAnimationFrame(() => {
      document.querySelector(`[data-main-id="${CSS.escape(folderId)}"]`)?.scrollIntoView({
        block: "nearest",
      });
    });
  };

  return (
    <>
      {/* the whole tree scales with the sidebar zoom (⌘+/⌘− while focus is in
          the sidebar) — CSS zoom scales rows + text together; the fixed-
          positioned popovers (RowMenu, the New… menu) sit OUTSIDE this node, so
          their pixel coordinates stay unscaled. */}
      <div className="sb-rows" aria-label="Home" style={{ zoom }}>
        {/* This wrapper is the roving listbox: Tab enters at the one tabIndex=0
            row, j/k walk it; the keyboard highlight is :focus-visible. */}
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
          {/* Captures — quick captures collected as cards; opens its grid in the
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
              (Seth, 2026-07-01). Add with the row menu or drag from the Library.
              The header (reworked 2026-07-28, Seth: "not collapsible — just a way
              to change the views"): the label + ▾ are ONE view switcher. — */}
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
              <label htmlFor="new-view-name">{editingView === "rename" ? "Rename view" : "New view"}</label>
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
                    commitNewFolder(e.currentTarget.value);
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
                  commitNewFolder(e.currentTarget.value);
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
                  The notes you reach for, arranged your way. Right-click a note and choose <b>Add to Main</b>
                  {hasBrain ? ", or drag one here from the Library" : ""} — then <b>★</b> your top {QUICK_MAX}{" "}
                  for Quick access (the ⌥ Quick window).
                </>
              )}
            </p>
          ) : (
            <div data-main-id="main:" data-active-view={activeView ?? "Main"} className="main-tree">
              {renderMainTree(MAIN_ROOT, 0, rowProps)}
            </div>
          )}
        </div>
      </div>
      <SidebarSystem
        open={systemOpen}
        hasBrain={hasBrain}
        brainCount={brainNotes.length + secureNotes.length}
        destRows={visibleDestRows}
        notesByDest={notesByDest}
        addedRoots={addedRoots}
        brainEnabled={brainEnabledUi}
        rowProps={rowProps}
        zoom={zoom}
      />
    </>
  );
}
