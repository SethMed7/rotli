// The System browser (Finder rework 2026-07-27, from Seth's screenshots):
// Library · Assets · Archive · Trash open HERE as a real Finder — you are IN
// one folder and see only its direct contents. "Folders" is the icon-grid
// view (double-click a folder to enter, double-click an item to open);
// "List" is the columned list (Name · Date Modified · Kind) with disclosure
// triangles. A breadcrumb climbs back up; search flattens across the root.
// Single click selects, double click opens — Finder conventions, zero friction.

import {
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
import { startMainAddDrag } from "../lib/mainAddDrag";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import { DEST } from "../services/destinations";
import { invalidateFolders, useFolders, useNotes, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import {
  type FolderEntry,
  type SystemSortKey,
  type SystemViewMode,
  breadcrumbOf,
  filterSystemItems,
  kindLabel,
  listFolderContents,
  rerootDiskPath,
  sortFolderListing,
} from "../services/systemBrowser";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { Character } from "./character";
import { ChevronRight, FolderGlyph, NewFolderGlyph, SearchGlyph, glyphForNote } from "./glyphs";
import { NoteListRow } from "./noteListRow";
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

export function SystemSurface({ rootId }: { rootId: string }) {
  const root = ROOTS[rootId] ?? { title: rootId, prefix: rootId };
  const isLibrary = rootId === "Brain";
  // Library = the projected wiki notes + the protected lane; every other root
  // is its own subtree straight from the notes service
  const destData = useNotes(isLibrary ? DEST.secure : rootId).data;
  const { notes: searchable } = useSearchableNotes();
  const items = useMemo<NoteSummary[]>(() => {
    const destItems = destData ?? [];
    if (!isLibrary) return destItems;
    const brain = searchable.map(projectNoteToBrain).filter((n): n is NoteSummary => n !== null);
    return [...brain, ...destItems];
  }, [isLibrary, destData, searchable]);

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
  // Columns (Seth, 2026-07-28, the Finder column view): a chain of opened
  // folders; each column lists one folder, clicking a folder opens the next
  const [colPath, setColPathState] = useState<string[]>(() => colPathMemo.get(rootId) ?? []);
  const setColPath = (chain: string[]) => {
    colPathMemo.set(rootId, chain);
    setColPathState(chain);
  };
  // Finder selection (Seth, 2026-07-28): the multi-selection lives in the ui
  // store so ⌘⌫'s registry action can trash it; the anchor drives ⇧ ranges;
  // a highlighted folder is its own single slot (folders don't trash).
  const selection = useUiStore((s) => s.systemSelection);
  const setSelection = useUiStore((s) => s.setSystemSelection);
  const selectedIds = useMemo(() => new Set(selection.map((n) => n.id)), [selection]);
  const anchorRef = useRef<string | null>(null);
  const [folderSel, setFolderSel] = useState<string | null>(null);
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
  const listing = useMemo(
    () => sortFolderListing(listFolderContents(items, cwd, folderSeed, pathOf), sort.key, sort.dir),
    [items, cwd, folderSeed, pathOf, sort],
  );
  const crumbs = useMemo(() => breadcrumbOf(cwd, root.prefix, root.title), [cwd, root.prefix, root.title]);
  const atRoot = cwd === root.prefix;

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
    setFolderSel(null);
    anchorRef.current = null;
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
      s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "date" ? -1 : 1 },
    );

  const visibleItems = searching ? hits : listing.items;
  const selectItem = (n: NoteSummary, e: { metaKey: boolean; shiftKey: boolean }, order?: NoteSummary[]) => {
    setFolderSel(null);
    if (e.metaKey) {
      // ⌘-click toggles
      const has = selectedIds.has(n.id);
      setSelection(has ? selection.filter((x) => x.id !== n.id) : [...selection, n]);
      anchorRef.current = n.id;
    } else if (e.shiftKey && anchorRef.current) {
      // ⇧-click ranges from the anchor within the visible order
      const span = order ?? visibleItems;
      const a = span.findIndex((v) => v.id === anchorRef.current);
      const b = span.findIndex((v) => v.id === n.id);
      if (a >= 0 && b >= 0) {
        setSelection(span.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else {
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
    onPointerDown:
      n.kind === "file"
        ? undefined
        : (e: ReactPointerEvent) => startMainAddDrag(e, n.id, n.title || "Empty note"),
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
  const marqueeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, [data-note-id]")) return;
    const host = e.currentTarget;
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left + host.scrollLeft;
    const y = e.clientY - r.top + host.scrollTop;
    marqueeBase.current = e.metaKey ? selection : [];
    if (!e.metaKey) {
      setSelection([]);
      setFolderSel(null);
      anchorRef.current = null;
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
    const picked: NoteSummary[] = [...marqueeBase.current];
    for (const el of host.querySelectorAll<HTMLElement>("[data-note-id]")) {
      const b = el.getBoundingClientRect();
      const bx = b.left - r.left + host.scrollLeft;
      const by = b.top - r.top + host.scrollTop;
      const hit =
        bx < rect.left + rect.width &&
        bx + b.width > rect.left &&
        by < rect.top + rect.height &&
        by + b.height > rect.top;
      if (!hit) continue;
      const n = el.dataset.noteId ? itemById.get(el.dataset.noteId) : undefined;
      if (n && !picked.some((x) => x.id === n.id)) picked.push(n);
    }
    setSelection(picked);
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
        : sortFolderListing(listFolderContents(items, path, folderSeed, pathOf), sort.key, sort.dir);
    return (
      <>
        {l.folders.map((f) => (
          <Fragment key={f.path}>
            <FolderListRow
              entry={f}
              depth={depth}
              open={expanded.has(f.path)}
              selected={folderSel === f.path}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  return next;
                })
              }
              onSelect={() => {
                setSelection([]);
                setFolderSel(f.path);
              }}
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
    <div className="board allnotes system-browser">
      <header className="board-head">
        {!atRoot && (
          <button
            type="button"
            className="fdr-up"
            aria-label="Back"
            title="Back"
            onClick={() => enter(crumbs[crumbs.length - 2]?.path ?? root.prefix)}
          >
            <ChevronRight size={11} className="fdr-up-chev" />
          </button>
        )}
        <nav className="fdr-crumbs" aria-label="Folder path">
          {crumbs.map((c, i) => (
            <span key={c.path} className="fdr-crumb-seg">
              {i > 0 && <ChevronRight size={9} className="fdr-crumb-sep" aria-hidden="true" />}
              {i === crumbs.length - 1 ? (
                <h2 className="board-title">{c.label}</h2>
              ) : (
                <button type="button" className="fdr-crumb" onClick={() => enter(c.path)}>
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </nav>
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
        <div className="file-mode-tabs" role="tablist" aria-label="View" style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className={mode === "folders" ? "fsh-tab on" : "fsh-tab"}
            onClick={() => setMode("folders")}
          >
            Folders
          </button>
          <button
            type="button"
            className={mode === "list" ? "fsh-tab on" : "fsh-tab"}
            onClick={() => setMode("list")}
          >
            List
          </button>
          <button
            type="button"
            className={mode === "columns" ? "fsh-tab on" : "fsh-tab"}
            onClick={() => setMode("columns")}
          >
            Columns
          </button>
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
        hits.length === 0 ? (
          <div className="list-empty">
            <p className="be-title">No matches</p>
            <p className="be-sub">Try a different search.</p>
          </div>
        ) : (
          <div className="board-scroll" {...scrollProps}>
            {marqueeNode}
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
        <div className="board-scroll" {...scrollProps}>
          {marqueeNode}
          <div className="fdr-grid">
            {listing.folders.map((f) => (
              <button
                type="button"
                key={f.path}
                className={folderSel === f.path ? "fdr-tile sel" : "fdr-tile"}
                title="Open folder"
                onClick={() => {
                  setSelection([]);
                  setFolderSel(f.path);
                }}
                onDoubleClick={() => enter(f.path)}
              >
                <FolderGlyph size={44} className="fdr-tile-icon folder" />
                <span className="fdr-tile-name">{f.name}</span>
                <span className="fdr-tile-sub">{f.itemCount === 1 ? "1 item" : `${f.itemCount} items`}</span>
              </button>
            ))}
            {listing.items.map((n) => (
              <button
                type="button"
                key={n.id}
                className={selectedIds.has(n.id) ? "fdr-tile sel" : "fdr-tile"}
                data-note-id={n.id}
                title="Open"
                {...itemHandlers(n)}
              >
                {glyphForNote(n, { size: 38, className: "fdr-tile-icon" })}
                <span className="fdr-tile-name">{n.title || "Empty note"}</span>
                <span className="fdr-tile-sub">
                  {n.kind ? `${kindLabel(n)} · ${longDateLabel(n.updatedAt)}` : longDateLabel(n.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : mode === "columns" ? (
        <div className="board-scroll fdrc-scroll">
          <div className="fdrc-row">
            {[root.prefix, ...colPath].map((path, depth) => {
              const col = listFolderContents(items, path, folderSeed, pathOf);
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
                        setFolderSel(null);
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
        <div className="board-scroll" {...scrollProps}>
          {marqueeNode}
          <div className="fdr-list">
            <div className="fdr-cols">
              <button type="button" className="fdr-col name" onClick={() => sortBy("name")}>
                Name{sort.key === "name" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
              <button type="button" className="fdr-col" onClick={() => sortBy("date")}>
                Date Modified{sort.key === "date" ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
              </button>
              <span className="fdr-col kind">Kind</span>
            </div>
            {renderListRows(cwd, 0)}
          </div>
        </div>
      )}
    </div>
  );
}

function FolderListRow({
  entry,
  depth,
  open,
  selected,
  onToggle,
  onSelect,
  onEnter,
}: {
  entry: FolderEntry;
  depth: number;
  open: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onEnter: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "fdr-row folder sel" : "fdr-row folder"}
      style={{ paddingLeft: 12 + depth * 18 }}
      title="Open folder"
      onClick={onSelect}
      onDoubleClick={onEnter}
    >
      <span className="fdr-name">
        {/* the disclosure triangle — pointer affordance; the row itself stays
            the accessible control (double-click enters, single selects) */}
        <span
          className={`fchev${open ? " open" : ""}`}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <ChevronRight size={10} />
        </span>
        <FolderGlyph size={14} className="fdr-row-icon folder" />
        {entry.name}
      </span>
      <span className="fdr-date">{entry.updatedAt === null ? "—" : longDateLabel(entry.updatedAt)}</span>
      <span className="fdr-kind">Folder</span>
    </button>
  );
}
