// The System browser (Finder rework 2026-07-27/28, from the maintainer's screenshots):
// Library · Assets · Archive · Trash open HERE as a real Finder — you are IN
// one folder and see only its direct contents. FOUR views behind Finder's own
// icons: Icons (grid, image thumbnails), List (Name · Date Modified · Kind,
// disclosure triangles), Columns, and Gallery (big preview + filmstrip). The
// folder trail is the BOTTOM path bar (Finder's placement) with the selection
// as its leaf; right-clicking empty space offers New folder + Sort by; search
// flattens across the root. Single click selects, double click opens.

import {
  type ButtonHTMLAttributes,
  Fragment,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { longDateLabel } from "../lib/dateLabels";
import { IMAGE_EXTS, extOf } from "../lib/fileKind";
import { startMainAddDrag } from "../lib/mainAddDrag";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import { rangeBetween } from "../lib/rangeSelect";
import { fileAssetUrl } from "../lib/tauri";
import { DEST } from "../services/destinations";
import { invalidateFolders, useFolders, useNoteIndex, useNotes, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import {
  type FolderEntry,
  type FolderListing,
  type SystemSortKey,
  type SystemViewMode,
  breadcrumbOf,
  filterSystemItems,
  LIBRARY_HIDDEN_LANES,
  folderSegmentLabel,
  kindLabel,
  listFolderContents,
  rerootDiskPath,
  sortFolderListing,
  filterSystemFolders,
} from "../services/systemBrowser";
import { emptyTrash, trashSystemSelection } from "../services/systemTrash";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { BackToNotes } from "./backToNotes";
import { Character } from "./character";
import {
  ChevronRight,
  ColumnsViewGlyph,
  FolderGlyph,
  GalleryViewGlyph,
  GridViewGlyph,
  ListViewGlyph,
  NewFolderGlyph,
  SearchGlyph,
  glyphForNote,
} from "./glyphs";
import { NoteListRow } from "./noteListRow";
import { FolderListRow, SearchFolderHits } from "./system/folderListRow";
import { useNoteMenu } from "./useNoteMenu";

/** Root id → the browser's title + the prefix its folder labels strip. */
const ROOTS: Record<string, { title: string; prefix: string }> = {
  Brain: { title: "Library", prefix: "wiki" },
  [DEST.storage]: { title: "Assets", prefix: "Storage" },
  [DEST.archive]: { title: "Archive", prefix: "Archive" },
  [DEST.trash]: { title: "Trash", prefix: "Trash" },
};

// per-root session memory — the surface unmounts on every content-view
// switch, and a Finder that forgets its view or its place feels broken
const modeMemo = new Map<string, SystemViewMode>();
const cwdMemo = new Map<string, string>();
// the Columns view's open chain (relative folder paths), per root
const colPathMemo = new Map<string, string[]>();

// Image tiles show the PICTURE (the maintainer, 2026-07-28: "or else I don't know what
// I'm looking at") — asset-protocol URLs resolve once and cache for the
// session; every other kind keeps its type glyph.
const thumbCache = new Map<string, string>();

function isImageNote(n: NoteSummary): boolean {
  return n.kind === "file" && IMAGE_EXTS.has(extOf(n.id));
}

function useThumb(n: NoteSummary): string | null {
  const img = isImageNote(n);
  const [url, setUrl] = useState<string | null>(img ? (thumbCache.get(n.id) ?? null) : null);
  useEffect(() => {
    if (!img) return;
    const cached = thumbCache.get(n.id);
    if (cached) {
      setUrl(cached);
      return;
    }
    let live = true;
    void fileAssetUrl(n.id).then((u) => {
      if (!u) return;
      thumbCache.set(n.id, u);
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [n.id, img]);
  return img ? url : null;
}

type ItemHandlers = ButtonHTMLAttributes<HTMLButtonElement> & {
  onPointerDown?: ((e: ReactPointerEvent) => void) | undefined;
};

/** One grid tile — a component so the thumb hook runs per tile. */
function ItemTile({ n, selected, handlers }: { n: NoteSummary; selected: boolean; handlers: ItemHandlers }) {
  const thumb = useThumb(n);
  return (
    <button
      type="button"
      className={selected ? "fdr-tile sel" : "fdr-tile"}
      data-note-id={n.id}
      title="Open"
      {...handlers}
    >
      {thumb ? (
        <img className="fdr-thumb" src={thumb} alt="" loading="lazy" draggable={false} />
      ) : (
        glyphForNote(n, { size: 38, className: "fdr-tile-icon" })
      )}
      <span className="fdr-tile-name">{n.title || "Empty note"}</span>
      <span className="fdr-tile-sub">
        {n.kind ? `${kindLabel(n)} · ${longDateLabel(n.updatedAt)}` : longDateLabel(n.updatedAt)}
      </span>
    </button>
  );
}

export function SystemSurface({ rootId }: { rootId: string }) {
  const root = ROOTS[rootId] ?? { title: rootId, prefix: rootId };
  const isLibrary = rootId === "Brain";
  const isTrash = rootId === DEST.trash;
  // Empty Trash (2026-07-31): whole-root count (not just the cwd listing) +
  // the armed two-step's state; the purge lane re-validates each item in Rust
  const trashCount = (useNotes(DEST.trash).data ?? []).length;
  const [emptyArmed, setEmptyArmed] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const runEmptyTrash = () => {
    setEmptying(true);
    void emptyTrash().finally(() => {
      setEmptying(false);
      setEmptyArmed(false);
    });
  };
  // Library = the projected wiki notes + the protected lane; every other root
  // is its own subtree straight from the notes service
  const destData = useNotes(isLibrary ? DEST.secure : rootId).data;
  const { notes: searchable } = useSearchableNotes();
  // Finder truth for the Library too (the maintainer, 2026-07-28: "the Library isn't
  // working like Assets"): the projected wiki NOTES alone hid every file and
  // board living inside wiki folders (brief PDFs, images, canvases) — the
  // full index carries them, minus the internal wiki/_ lanes (secure arrives
  // through its own destination above).
  const noteIndex = useNoteIndex();
  const items = useMemo<NoteSummary[]>(() => {
    const destItems = destData ?? [];
    if (!isLibrary) return destItems;
    const brain = searchable.map(projectNoteToBrain).filter((n): n is NoteSummary => n !== null);
    const seen = new Set([...brain, ...destItems].map((n) => n.id));
    const extras: NoteSummary[] = [];
    for (const n of noteIndex.values()) {
      if (n.kind !== "file" && n.kind !== "board") continue;
      if (seen.has(n.id)) continue;
      const disk = noteDiskFolder(n);
      if (disk !== "wiki" && !disk.startsWith("wiki/")) continue;
      if (disk.startsWith("wiki/_")) continue;
      extras.push(n);
    }
    return [...brain, ...destItems, ...extras];
  }, [isLibrary, destData, searchable, noteIndex]);

  const [query, setQuery] = useState("");
  const [mode, setModeState] = useState<SystemViewMode>(() => modeMemo.get(rootId) ?? "folders");
  const setMode = (m: SystemViewMode) => {
    modeMemo.set(rootId, m);
    setModeState(m);
  };
  const [cwd, setCwdState] = useState<string>(() => cwdMemo.get(rootId) ?? root.prefix);
  const setCwd = (path: string) => {
    cwdMemo.set(rootId, path);
    setCwdState(path);
  };
  // Columns (the maintainer, 2026-07-28, the Finder column view): a chain of opened
  // folders; each column lists one folder, clicking a folder opens the next
  const [colPath, setColPathState] = useState<string[]>(() => colPathMemo.get(rootId) ?? []);
  const setColPath = (chain: string[]) => {
    colPathMemo.set(rootId, chain);
    setColPathState(chain);
  };
  // Finder selection (the maintainer, 2026-07-28): the multi-selection lives in the ui
  // store so ⌘⌫'s registry action can trash it; the anchor drives ⇧ ranges;
  // a highlighted folder is its own single slot (folders don't trash).
  const selection = useUiStore((s) => s.systemSelection);
  const setSelection = useUiStore((s) => s.setSystemSelection);
  const selectedIds = useMemo(() => new Set(selection.map((n) => n.id)), [selection]);
  const anchorRef = useRef<string | null>(null);
  // MULTI folder selection (the maintainer, 2026-07-30: "can't select multiple things")
  // — an array in selection order; the last entry names the path-bar leaf
  const [folderSel, setFolderSel] = useState<string[]>([]);
  const folderSelSet = useMemo(() => new Set(folderSel), [folderSel]);
  const lastFolderSel = folderSel[folderSel.length - 1] ?? null;
  const folderAnchorRef = useRef<string | null>(null);
  // expanded folder rows (List mode disclosure triangles) — per-mount
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [sort, setSort] = useState<{ key: SystemSortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  // Empty directories are real (Finder truth) — seed the Library's on-disk
  // folder list so a folder with zero notes still renders. Library-only:
  // other roots' folder ids use disk-case paths that need their own mapping.
  const foldersData = useFolders().data;
  const folderSeed = useMemo(
    () => (isLibrary ? (foldersData ?? []).filter((f) => f.id.startsWith("wiki/")).map((f) => f.id) : []),
    [isLibrary, foldersData],
  );

  const openSummary = usePanesStore((s) => s.openSummary);
  const openMenu = useNoteMenu();

  const searching = query.trim() !== "";
  const hits = useMemo(() => filterSystemItems(items, query), [items, query]);
  // every browse listing reads disk paths THROUGH the root's namespace — in a
  // memex the disk lane is lowercase ("storage/…") while the destination id is
  // "Storage", and the raw comparison rendered 422 assets as an empty root
  const pathOf = useMemo(
    () => (n: NoteSummary) => rerootDiskPath(noteDiskFolder(n), root.prefix),
    [root.prefix],
  );
  // the Library hides its SYSTEM LANES (_inbox → the Captures front,
  // _templates → machine plumbing) — as bare tiles they read as broken
  // empty folders (the maintainer, 2026-07-30)
  const hiddenLanes = useMemo<ReadonlySet<string>>(
    () => (isLibrary ? LIBRARY_HIDDEN_LANES : new Set()),
    [isLibrary],
  );
  const folderHits = useMemo(
    () => filterSystemFolders(items, query, folderSeed, pathOf, hiddenLanes),
    [items, query, folderSeed, pathOf, hiddenLanes],
  );
  const listing = useMemo(
    () =>
      sortFolderListing(listFolderContents(items, cwd, folderSeed, pathOf, hiddenLanes), sort.key, sort.dir),
    [items, cwd, folderSeed, pathOf, hiddenLanes, sort],
  );
  const crumbs = useMemo(() => breadcrumbOf(cwd, root.prefix, root.title), [cwd, root.prefix, root.title]);
  const atRoot = cwd === root.prefix;
  // the bottom path bar's trail — the Columns view follows its own open chain
  const pathTrail = useMemo(
    () =>
      mode === "columns"
        ? breadcrumbOf(colPath[colPath.length - 1] ?? root.prefix, root.prefix, root.title)
        : crumbs,
    [mode, colPath, crumbs, root.prefix, root.title],
  );
  // the selected entry names the path bar's leaf, like Finder's
  const pathLeaf =
    selection.length === 1
      ? selection[0]!.title || "Empty note"
      : lastFolderSel
        ? folderSegmentLabel(lastFolderSel.slice(lastFolderSel.lastIndexOf("/") + 1))
        : null;
  /** A path under the root → the Columns view's chain of open folders. */
  const colChainTo = (path: string): string[] => {
    const rel = path.startsWith(`${root.prefix}/`) ? path.slice(root.prefix.length + 1) : "";
    if (!rel) return [];
    const segs = rel.split("/");
    return segs.map((_, i) => `${root.prefix}/${segs.slice(0, i + 1).join("/")}`);
  };

  const enter = (path: string) => {
    setCwd(path);
  };

  const revealing = useRef(false);
  useEffect(() => {
    if (revealing.current) {
      // the reveal navigated here AND selected the target — keep it
      revealing.current = false;
      return;
    }
    setSelection([]);
    setFolderSel([]);
    anchorRef.current = null;
    folderAnchorRef.current = null;
    return () => setSelection([]);
  }, [rootId, cwd, setSelection]);

  // "New folder" — a REAL directory at the cwd (Finder's verb, restored after
  // the fold left folder creation with no UI at all; P0 sweep 2026-07-28).
  // The existing write gates answer per vault: legacy vaults create anywhere,
  // a memex refuses the curated wiki tree with its honest message.
  const [newFolder, setNewFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const folderHandled = useRef(false);
  const commitNewFolder = async (name: string) => {
    setNewFolder(false);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      setFolderError(null);
      await notesService.createFolder(trimmed, cwd);
      await invalidateFolders();
    } catch (err) {
      setFolderError(`Couldn’t create the folder — ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // the sidebar's toolbar New-folder button routes here while a browser is open
  const systemFolderNonce = useUiStore((s) => s.systemFolderNonce);
  useEffect(() => {
    if (systemFolderNonce > 0) setNewFolder(true);
  }, [systemFolderNonce]);

  // "Show in Library" (the note menu / the editor's location chip): land IN
  // the note's exact folder — Finder's reveal. Clear any filter, select the
  // row, and scroll it into view once the async items carry it (two frames so
  // the navigated view commits first).
  const revealNonce = useUiStore((s) => s.revealNonce);
  useEffect(() => {
    if (!revealNonce) return;
    const { revealNoteId } = useUiStore.getState();
    if (!revealNoteId) return;
    const target = items.find((n) => n.id === revealNoteId);
    if (!target) return;
    setQuery("");
    revealing.current = true;
    setSelection([target]);
    anchorRef.current = revealNoteId;
    setCwd(rerootDiskPath(noteDiskFolder(target), root.prefix));
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        document
          .querySelector(`.system-browser [data-note-id="${CSS.escape(revealNoteId)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce, items]);

  const sortBy = (key: SystemSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === "date" || key === "created" ? -1 : 1 },
    );

  // right-click on EMPTY space — Finder's background menu (the maintainer, 2026-07-28:
  // "clean up via right click… sort by"): New folder where creation is
  // offered, and the Sort-by selector (re-pick the active key to flip
  // direction, same as the List headers)
  const bgMenu = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-note-id], .fdr-tile, .fdr-row, .fdrg-cell, input")) return;
    e.preventDefault();
    e.stopPropagation();
    const sortItem = (key: SystemSortKey, label: string): MenuSpec => ({
      kind: "action",
      label: sort.key === key ? `${label} ${sort.dir === 1 ? "↑" : "↓"}` : label,
      checked: sort.key === key,
      checkedMark: "highlight",
      onClick: () => sortBy(key),
    });
    const items: MenuSpec[] = [
      ...(isLibrary
        ? [
            { kind: "action" as const, label: "New folder", onClick: () => setNewFolder(true) },
            { kind: "sep" as const },
          ]
        : []),
      {
        kind: "drill",
        label: "Sort by",
        items: [
          sortItem("name", "Name"),
          sortItem("kind", "Kind"),
          sortItem("date", "Date modified"),
          sortItem("created", "Date created"),
        ],
      },
      // Empty Trash (2026-07-31): the confirm lives INSIDE the drill — two
      // deliberate clicks, and every item still lands in the macOS Trash
      ...(isTrash && trashCount > 0
        ? [
            { kind: "sep" as const },
            {
              kind: "drill" as const,
              label: "Empty Trash…",
              items: [
                {
                  kind: "action" as const,
                  danger: true,
                  label: `Delete ${trashCount} ${trashCount === 1 ? "item" : "items"} forever (they land in the macOS Trash)`,
                  onClick: () => runEmptyTrash(),
                },
              ],
            },
          ]
        : []),
    ];
    useContextMenu.getState().open(e.clientX, e.clientY, items);
  };

  const visibleItems = searching ? hits : listing.items;
  /** Folder tiles/rows multi-select exactly like items (the maintainer, 2026-07-30):
   * ⌘ toggles, ⇧ ranges over the listing's folder band, a plain click selects
   * alone (and clears the item selection); ⌘ keeps a MIXED selection alive. */
  const selectFolder = (path: string, e: { metaKey: boolean; shiftKey: boolean }) => {
    if (e.metaKey) {
      const has = folderSelSet.has(path);
      setFolderSel(has ? folderSel.filter((p) => p !== path) : [...folderSel, path]);
      folderAnchorRef.current = path;
    } else if (e.shiftKey && folderAnchorRef.current) {
      // ⇧ is single-band like selectItem's mirror rule: only ⌘ mixes bands
      setSelection([]);
      const range = rangeBetween(listing.folders, (f) => f.path, folderAnchorRef.current, path);
      if (range) setFolderSel(range.map((f) => f.path));
      else {
        setFolderSel([path]);
        folderAnchorRef.current = path;
      }
    } else {
      setSelection([]);
      setFolderSel([path]);
      folderAnchorRef.current = path;
    }
  };
  const selectItem = (n: NoteSummary, e: { metaKey: boolean; shiftKey: boolean }, order?: NoteSummary[]) => {
    // a plain/⇧ item click clears the folder band; ⌘ keeps a mixed selection
    if (!e.metaKey) setFolderSel([]);
    if (e.metaKey) {
      // ⌘-click toggles
      const has = selectedIds.has(n.id);
      setSelection(has ? selection.filter((x) => x.id !== n.id) : [...selection, n]);
      anchorRef.current = n.id;
    } else if (e.shiftKey && anchorRef.current) {
      // ⇧-click ranges from the anchor within the visible order
      const range = rangeBetween(order ?? visibleItems, (v) => v.id, anchorRef.current, n.id);
      if (range) setSelection(range);
      else {
        setSelection([n]);
        anchorRef.current = n.id;
      }
    } else {
      setSelection([n]);
      anchorRef.current = n.id;
    }
  };

  const itemHandlers = (n: NoteSummary) => ({
    onClick: (e: MouseEvent) => selectItem(n, e),
    onDoubleClick: () => openSummary(n),
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        openSummary(n, { newTab: true });
      }
    },
    onContextMenu: (e: MouseEvent) => openMenu(e, n),
    onPointerDown: (e: ReactPointerEvent) => {
      const draggedItems = selectedIds.has(n.id) ? selection : [n];
      startMainAddDrag(e, n.id, n.title || "Empty note", {
        allowMain: n.kind !== "file",
        onTrash: () => {
          setSelection(draggedItems);
          void trashSystemSelection();
        },
      });
    },
  });

  // rubber-band selection on EMPTY space (items own their gestures/drags):
  // pointer capture on the scroll host, live hit-test against [data-note-id]
  const itemById = useMemo(() => new Map(items.map((n) => [n.id, n])), [items]);
  const marqueeStart = useRef<{ host: HTMLDivElement; x: number; y: number } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeBase = useRef<NoteSummary[]>([]);
  const marqueeBaseFolders = useRef<string[]>([]);
  // Snapshot of every selectable cell in host CONTENT-space (scroll-invariant),
  // taken ONCE at pointer-down: a marquee drag doesn't reflow the list, so we
  // hit-test against this instead of re-running querySelectorAll +
  // getBoundingClientRect per element on EVERY pointermove (perf audit 2026-08).
  type MarqueeCell = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    noteId: string | undefined;
    folderPath: string | undefined;
  };
  const marqueeCells = useRef<MarqueeCell[]>([]);
  const marqueeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, [data-note-id]")) return;
    const host = e.currentTarget;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left + host.scrollLeft;
    const y = e.clientY - r.top + host.scrollTop;
    // measure every cell ONCE, in content-space, so scroll during the drag
    // doesn't invalidate the snapshot
    marqueeCells.current = [...host.querySelectorAll<HTMLElement>("[data-note-id], [data-folder-path]")].map(
      (el) => {
        const b = el.getBoundingClientRect();
        const left = b.left - r.left + host.scrollLeft;
        const top = b.top - r.top + host.scrollTop;
        return {
          left,
          top,
          right: left + b.width,
          bottom: top + b.height,
          noteId: el.dataset.noteId,
          folderPath: el.dataset.folderPath,
        };
      },
    );
    marqueeBase.current = e.metaKey ? selection : [];
    marqueeBaseFolders.current = e.metaKey ? folderSel : [];
    if (!e.metaKey) {
      setSelection([]);
      setFolderSel([]);
      anchorRef.current = null;
      folderAnchorRef.current = null;
    }
    marqueeStart.current = { host, x, y };
    setMarqueeRect({ left: x, top: y, width: 0, height: 0 });
    host.setPointerCapture(e.pointerId);
  };
  const marqueeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const start = marqueeStart.current;
    if (!start) return;
    const host = start.host;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left + host.scrollLeft;
    const y = e.clientY - r.top + host.scrollTop;
    const rect = {
      left: Math.min(start.x, x),
      top: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    };
    setMarqueeRect(rect);
    // Set-based dedup — this loop reruns per pointermove (Greptile, PR #18).
    // Hit-tests the pointer-down snapshot (marqueeCells), not a fresh DOM walk.
    const picked: NoteSummary[] = [...marqueeBase.current];
    const pickedIds = new Set(picked.map((n) => n.id));
    const pickedFolders: string[] = [...marqueeBaseFolders.current];
    const pickedFolderSet = new Set(pickedFolders);
    for (const cell of marqueeCells.current) {
      const hit =
        cell.left < rect.left + rect.width &&
        cell.right > rect.left &&
        cell.top < rect.top + rect.height &&
        cell.bottom > rect.top;
      if (!hit) continue;
      if (cell.folderPath) {
        if (!pickedFolderSet.has(cell.folderPath)) {
          pickedFolderSet.add(cell.folderPath);
          pickedFolders.push(cell.folderPath);
        }
        continue;
      }
      const n = cell.noteId ? itemById.get(cell.noteId) : undefined;
      if (n && !pickedIds.has(n.id)) {
        pickedIds.add(n.id);
        picked.push(n);
      }
    }
    setSelection(picked);
    setFolderSel(pickedFolders);
  };
  const marqueeUp = () => {
    marqueeStart.current = null;
    setMarqueeRect(null);
  };
  const scrollProps = {
    onPointerDown: marqueeDown,
    onPointerMove: marqueeMove,
    onPointerUp: marqueeUp,
    onPointerCancel: marqueeUp,
  };
  const marqueeNode = marqueeRect && <div className="fdr-marquee" style={marqueeRect} />;

  // Finder's list layout: each expanded folder's children render DIRECTLY
  // under its row, indented one step deeper.
  const renderListRows = (path: string, depth: number): ReactNode => {
    const l =
      depth === 0
        ? listing
        : sortFolderListing(
            listFolderContents(items, path, folderSeed, pathOf, hiddenLanes),
            sort.key,
            sort.dir,
          );
    return (
      <>
        {l.folders.map((f) => (
          <Fragment key={f.path}>
            <FolderListRow
              entry={f}
              depth={depth}
              open={expanded.has(f.path)}
              selected={folderSelSet.has(f.path)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  return next;
                })
              }
              onSelect={(e) => selectFolder(f.path, e)}
              onEnter={() => enter(f.path)}
            />
            {expanded.has(f.path) && renderListRows(f.path, depth + 1)}
          </Fragment>
        ))}
        {l.items.map((n) => (
          <button
            type="button"
            key={n.id}
            className={selectedIds.has(n.id) ? "fdr-row sel" : "fdr-row"}
            style={{ paddingLeft: 12 + depth * 18 }}
            data-note-id={n.id}
            title="Open"
            {...itemHandlers(n)}
          >
            <span className="fdr-name">
              {glyphForNote(n, { size: 14, className: "fdr-row-icon" })}
              {n.title || "Empty note"}
            </span>
            <span className="fdr-date">{longDateLabel(n.updatedAt)}</span>
            <span className="fdr-kind">{kindLabel(n)}</span>
          </button>
        ))}
      </>
    );
  };

  const empty = listing.folders.length === 0 && listing.items.length === 0;

  return (
    // Space = Quick Look on the single-selected item (Finder muscle memory;
    // the maintainer, 2026-07-29) — anywhere in the browser except a text input
    <div
      className="board allnotes system-browser"
      onKeyDown={(e) => {
        if (e.key !== " ") return;
        const t = e.target as HTMLElement;
        if (t.closest("input, textarea") || t.isContentEditable) return;
        const single = selection.length === 1 ? selection[0] : null;
        if (!single) return;
        e.preventDefault();
        useUiStore.getState().setPreviewItem(single);
      }}
    >
      <header className="board-head">
        {atRoot ? (
          <BackToNotes onClick={() => useUiStore.getState().setContentView("panes")} />
        ) : (
          <button
            type="button"
            className="fdr-up"
            aria-label="Back"
            onClick={() => enter(crumbs[crumbs.length - 2]?.path ?? root.prefix)}
          >
            <ChevronRight size={11} className="fdr-up-chev" />
          </button>
        )}
        {/* the trail lives in the BOTTOM path bar (Finder's home, the maintainer 2026-07-28); the header keeps where-am-I */}
        <h2 className="board-title">{crumbs[crumbs.length - 1]?.label ?? root.title}</h2>
        <span className="board-count">{items.length}</span>
        {isLibrary && (
          <button
            type="button"
            className="icobtn fdr-newbtn"
            aria-label="New folder here"
            title="New folder here"
            onClick={() => setNewFolder(true)}
          >
            <NewFolderGlyph size={15} />
          </button>
        )}
        {/* Empty Trash (2026-07-31): armed two-step, header-visible — every
            item still lands in the macOS Trash, so "forever" stays honest */}
        {isTrash &&
          trashCount > 0 &&
          (emptyArmed ? (
            <>
              <button type="button" className="ghostbtn quiet" onClick={() => setEmptyArmed(false)}>
                Keep
              </button>
              <button
                type="button"
                className="ghostbtn fdr-empty-confirm"
                disabled={emptying}
                onClick={runEmptyTrash}
              >
                {emptying
                  ? "Emptying…"
                  : `Delete ${trashCount} ${trashCount === 1 ? "item" : "items"} (recoverable in the macOS Trash)`}
              </button>
            </>
          ) : (
            <button type="button" className="ghostbtn" onClick={() => setEmptyArmed(true)}>
              Empty Trash…
            </button>
          ))}
        {/* the view switcher wears Finder's icons (the maintainer, 2026-07-28: "the
            proper icons people are used to"); the words live in the tooltips */}
        <div className="file-mode-tabs" role="tablist" aria-label="View" style={{ marginLeft: "auto" }}>
          {(
            [
              ["folders", "Icons", GridViewGlyph],
              ["list", "List", ListViewGlyph],
              ["columns", "Columns", ColumnsViewGlyph],
              ["gallery", "Gallery", GalleryViewGlyph],
            ] as const
          ).map(([m, label, ViewGlyph]) => (
            <button
              key={m}
              type="button"
              className={mode === m ? "fsh-tab vicon on" : "fsh-tab vicon"}
              title={label}
              aria-label={`${label} view`}
              onClick={() => setMode(m)}
            >
              <ViewGlyph size={15} />
            </button>
          ))}
        </div>
      </header>

      <div className="allnotes-search">
        <SearchGlyph size={15} />
        <input
          type="text"
          value={query}
          placeholder={`Search ${root.title}…`}
          aria-label={`Search ${root.title}`}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {folderError && (
        <p className="fdr-error" role="alert">
          ⚠ {folderError}
        </p>
      )}
      {newFolder && (
        <div className="fdr-newfolder">
          <FolderGlyph size={14} className="fdr-row-icon folder" />
          <input
            autoFocus
            type="text"
            placeholder="Folder name"
            aria-label="New folder name"
            onKeyDown={(e) => {
              // a keystroke that handles the input unmounts it — the ensuing
              // blur must not double-commit or undo a cancel
              if (e.key === "Enter") {
                folderHandled.current = true;
                void commitNewFolder(e.currentTarget.value);
              } else if (e.key === "Escape") {
                folderHandled.current = true;
                setNewFolder(false);
              }
            }}
            onBlur={(e) => {
              if (folderHandled.current) {
                folderHandled.current = false;
                return;
              }
              void commitNewFolder(e.currentTarget.value);
            }}
          />
        </div>
      )}

      {searching ? (
        hits.length === 0 && folderHits.length === 0 ? (
          <div className="list-empty">
            <p className="be-title">No matches</p>
            <p className="be-sub">Try a different search.</p>
          </div>
        ) : (
          <div className="board-scroll" {...scrollProps}>
            {marqueeNode}
            <SearchFolderHits
              folders={folderHits}
              onOpen={(path) => {
                setQuery("");
                setCwd(path);
              }}
            />
            <ul className="recent-list">
              {hits.map((n) => (
                <NoteListRow
                  key={n.id}
                  note={n}
                  selected={selectedIds.has(n.id)}
                  onOpen={(note, newTab) => openSummary(note, { newTab })}
                  onContextMenu={openMenu}
                />
              ))}
            </ul>
          </div>
        )
      ) : empty ? (
        atRoot ? (
          <div className="list-empty">
            <Character name="rest" size={104} className="be-quokka" />
            <p className="be-title">Nothing here</p>
            <p className="be-sub">{root.title} is empty.</p>
          </div>
        ) : (
          <div className="list-empty">
            <p className="be-title">This folder is empty</p>
          </div>
        )
      ) : mode === "folders" ? (
        <div className="board-scroll" {...scrollProps} onContextMenu={bgMenu}>
          {marqueeNode}
          <div className="fdr-grid">
            {listing.folders.map((f) => (
              <button
                type="button"
                key={f.path}
                data-folder-path={f.path}
                className={folderSelSet.has(f.path) ? "fdr-tile sel" : "fdr-tile"}
                title="Open folder"
                onClick={(e) => selectFolder(f.path, e)}
                onDoubleClick={() => enter(f.path)}
              >
                <FolderGlyph size={44} className="fdr-tile-icon folder" />
                <span className="fdr-tile-name">{f.name}</span>
                <span className="fdr-tile-sub">{f.itemCount === 1 ? "1 item" : `${f.itemCount} items`}</span>
              </button>
            ))}
            {listing.items.map((n) => (
              <ItemTile key={n.id} n={n} selected={selectedIds.has(n.id)} handlers={itemHandlers(n)} />
            ))}
          </div>
        </div>
      ) : mode === "gallery" ? (
        <GalleryView
          listing={listing}
          selectedIds={selectedIds}
          folderSel={lastFolderSel}
          onSelectItem={(n) => selectItem(n, { metaKey: false, shiftKey: false })}
          onSelectFolder={(path) => {
            setSelection([]);
            setFolderSel([path]);
            folderAnchorRef.current = path;
          }}
          onOpenItem={(n) => openSummary(n)}
          onEnterFolder={enter}
          onItemMenu={openMenu}
          onBgMenu={bgMenu}
        />
      ) : mode === "columns" ? (
        <div className="board-scroll fdrc-scroll">
          <div className="fdrc-row">
            {[root.prefix, ...colPath].map((path, depth) => {
              const col = listFolderContents(items, path, folderSeed, pathOf, hiddenLanes);
              const openChild = colPath[depth];
              return (
                <div key={path} className="fdrc-col">
                  {col.folders.map((f) => (
                    <button
                      type="button"
                      key={f.path}
                      className={`fdrc-item folder${openChild === f.path ? " open" : ""}`}
                      onClick={() => {
                        // clicking a folder OPENS the next column (Finder's law)
                        setColPath([...colPath.slice(0, depth), f.path]);
                        setSelection([]);
                        setFolderSel([]);
                      }}
                    >
                      <FolderGlyph size={14} className="fdr-row-icon folder" />
                      <span className="fdrc-name">{f.name}</span>
                      <ChevronRight size={10} className="fdrc-chev" />
                    </button>
                  ))}
                  {col.items.map((n) => (
                    <button
                      type="button"
                      key={n.id}
                      className={selectedIds.has(n.id) ? "fdrc-item sel" : "fdrc-item"}
                      data-note-id={n.id}
                      title="Open"
                      onClick={(e) => selectItem(n, e, col.items)}
                      onDoubleClick={() => openSummary(n)}
                      onContextMenu={(e) => openMenu(e, n)}
                    >
                      {glyphForNote(n, { size: 14, className: "fdr-row-icon" })}
                      <span className="fdrc-name">{n.title || "Empty note"}</span>
                      <span className="fdrc-kind">{kindLabel(n)}</span>
                    </button>
                  ))}
                  {col.folders.length === 0 && col.items.length === 0 && <p className="fdrc-empty">Empty</p>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="board-scroll" {...scrollProps} onContextMenu={bgMenu}>
          {marqueeNode}
          <div className="fdr-list">
            <div className="fdr-cols">
              <button type="button" className="fdr-col name" onClick={() => sortBy("name")}>
                Name{sort.key === "name" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
              <button type="button" className="fdr-col" onClick={() => sortBy("date")}>
                Date Modified{sort.key === "date" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
              <button type="button" className="fdr-col kind" onClick={() => sortBy("kind")}>
                Kind{sort.key === "kind" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
            </div>
            {renderListRows(cwd, 0)}
          </div>
        </div>
      )}

      {/* — the Finder path bar, at the BOTTOM where people expect it (the maintainer,
          2026-07-28); every segment navigates, the selected item is the leaf — */}
      {!searching && (
        <nav className="fdr-pathbar" aria-label="Folder path">
          {pathTrail.map((c, i) => (
            <span key={c.path} className="fdr-crumb-seg">
              {i > 0 && <ChevronRight size={9} className="fdr-crumb-sep" aria-hidden="true" />}
              <button
                type="button"
                className="fdr-crumb"
                onClick={() => {
                  if (mode === "columns") setColPath(c.path === root.prefix ? [] : colChainTo(c.path));
                  else enter(c.path);
                }}
              >
                {i === 0 ? null : <FolderGlyph size={12} className="fdr-crumb-glyph" />}
                {c.label}
              </button>
            </span>
          ))}
          {pathLeaf && (
            <span className="fdr-crumb-seg">
              <ChevronRight size={9} className="fdr-crumb-sep" aria-hidden="true" />
              <span className="fdr-crumb leaf">{pathLeaf}</span>
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

// ——— Gallery — Finder's fourth view (the maintainer, 2026-07-28): one BIG preview of
// the highlighted entry over a horizontal filmstrip of the folder's contents.
// ←/→ walk the strip, ⏎ opens (or enters a folder), double-click likewise. ———

type GalleryEntry = { kind: "folder"; f: FolderEntry } | { kind: "item"; n: NoteSummary };

function GalleryStage({ n }: { n: NoteSummary }) {
  const thumb = useThumb(n);
  if (thumb) return <img className="fdrg-preview" src={thumb} alt={n.title} draggable={false} />;
  return (
    <div className="fdrg-big">
      {glyphForNote(n, { size: 84, className: "fdr-tile-icon" })}
      <span className="fdr-tile-name">{n.title || "Empty note"}</span>
      <span className="fdr-tile-sub">
        {kindLabel(n)} · {longDateLabel(n.updatedAt)}
      </span>
    </div>
  );
}

function GalleryCell({
  n,
  selected,
  ...handlers
}: {
  n: NoteSummary;
  selected: boolean;
} & ItemHandlers) {
  const thumb = useThumb(n);
  return (
    <button
      type="button"
      className={selected ? "fdrg-cell sel" : "fdrg-cell"}
      data-note-id={n.id}
      title={n.title || "Empty note"}
      {...handlers}
    >
      {thumb ? (
        <img src={thumb} alt="" loading="lazy" draggable={false} />
      ) : (
        glyphForNote(n, { size: 26, className: "fdr-tile-icon" })
      )}
    </button>
  );
}

function GalleryView({
  listing,
  selectedIds,
  folderSel,
  onSelectItem,
  onSelectFolder,
  onOpenItem,
  onEnterFolder,
  onItemMenu,
  onBgMenu,
}: {
  listing: FolderListing;
  selectedIds: ReadonlySet<string>;
  folderSel: string | null;
  onSelectItem: (n: NoteSummary) => void;
  onSelectFolder: (path: string) => void;
  onOpenItem: (n: NoteSummary) => void;
  onEnterFolder: (path: string) => void;
  onItemMenu: (e: MouseEvent, n: NoteSummary) => void;
  onBgMenu: (e: MouseEvent) => void;
}) {
  const entries: GalleryEntry[] = [
    ...listing.folders.map((f) => ({ kind: "folder" as const, f })),
    ...listing.items.map((n) => ({ kind: "item" as const, n })),
  ];
  const current = folderSel
    ? entries.find((e) => e.kind === "folder" && e.f.path === folderSel)
    : (entries.find((e) => e.kind === "item" && selectedIds.has(e.n.id)) ?? entries[0]);
  const idx = current ? entries.indexOf(current) : -1;
  // the implicit first-entry preview must BE the selection (Greptile, PR #1):
  // the stage read entries[0] while the path bar read the empty selection —
  // out of sync until the first explicit click. Promote it once on entry.
  const hasExplicit = folderSel !== null || entries.some((e) => e.kind === "item" && selectedIds.has(e.n.id));
  useEffect(() => {
    if (hasExplicit) return;
    const first = entries[0];
    if (!first) return;
    if (first.kind === "folder") onSelectFolder(first.f.path);
    else onSelectItem(first.n);
    // entries' identity churns per render; length + the explicit flag are the
    // real triggers, and the select callbacks are stable in behavior
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasExplicit, entries.length]);
  const select = (entry: GalleryEntry | undefined) => {
    if (!entry) return;
    if (entry.kind === "folder") onSelectFolder(entry.f.path);
    else onSelectItem(entry.n);
  };
  const activate = () => {
    if (!current) return;
    if (current.kind === "folder") onEnterFolder(current.f.path);
    else onOpenItem(current.n);
  };
  // keep the highlighted cell in view as ←/→ walk the strip
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector(".fdrg-cell.sel")
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [idx]);
  return (
    <div
      className="fdrg"
      tabIndex={0}
      role="listbox"
      aria-label="Gallery"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          select(entries[Math.min(idx + 1, entries.length - 1)]);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          select(entries[Math.max(idx - 1, 0)]);
        } else if (e.key === "Enter") {
          e.preventDefault();
          activate();
        }
      }}
      onContextMenu={onBgMenu}
    >
      <div className="fdrg-stage" onDoubleClick={activate}>
        {current?.kind === "item" ? (
          <GalleryStage n={current.n} />
        ) : current ? (
          <div className="fdrg-big">
            <FolderGlyph size={96} className="fdr-tile-icon folder" />
            <span className="fdr-tile-name">{current.f.name}</span>
            <span className="fdr-tile-sub">
              {current.f.itemCount === 1 ? "1 item" : `${current.f.itemCount} items`}
            </span>
          </div>
        ) : (
          <p className="fdrc-empty">Empty</p>
        )}
      </div>
      <div className="fdrg-strip" ref={stripRef}>
        {entries.map((entry) =>
          entry.kind === "folder" ? (
            <button
              key={entry.f.path}
              type="button"
              className={entry === current ? "fdrg-cell sel" : "fdrg-cell"}
              title={entry.f.name}
              onClick={() => onSelectFolder(entry.f.path)}
              onDoubleClick={() => onEnterFolder(entry.f.path)}
            >
              <FolderGlyph size={30} className="fdr-tile-icon folder" />
            </button>
          ) : (
            <GalleryCell
              key={entry.n.id}
              n={entry.n}
              selected={entry === current}
              onClick={() => onSelectItem(entry.n)}
              onDoubleClick={() => onOpenItem(entry.n)}
              onContextMenu={(e) => onItemMenu(e, entry.n)}
            />
          ),
        )}
      </div>
    </div>
  );
}
