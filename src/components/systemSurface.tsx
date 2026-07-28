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
  useState,
} from "react";
import { longDateLabel } from "../lib/dateLabels";
import { startMainAddDrag } from "../lib/mainAddDrag";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import { DEST } from "../services/destinations";
import { useFolders, useNotes, useSearchableNotes } from "../services/hooks";
import {
  type FolderEntry,
  type SystemSortKey,
  type SystemViewMode,
  breadcrumbOf,
  filterSystemItems,
  kindLabel,
  listFolderContents,
  sortFolderListing,
} from "../services/systemBrowser";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { Character } from "./character";
import { ChevronRight, FolderGlyph, SearchGlyph, glyphForNote } from "./glyphs";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const listing = useMemo(
    () => sortFolderListing(listFolderContents(items, cwd, folderSeed), sort.key, sort.dir),
    [items, cwd, folderSeed, sort],
  );
  const crumbs = useMemo(() => breadcrumbOf(cwd, root.prefix, root.title), [cwd, root.prefix, root.title]);
  const atRoot = cwd === root.prefix;

  const enter = (path: string) => {
    setCwd(path);
    setSelectedId(null);
  };

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
    setSelectedId(revealNoteId);
    setCwd(noteDiskFolder(target));
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

  const itemHandlers = (n: NoteSummary) => ({
    onClick: () => setSelectedId(n.id),
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

  // Finder's list layout: each expanded folder's children render DIRECTLY
  // under its row, indented one step deeper.
  const renderListRows = (path: string, depth: number): ReactNode => {
    const l =
      depth === 0
        ? listing
        : sortFolderListing(listFolderContents(items, path, folderSeed), sort.key, sort.dir);
    return (
      <>
        {l.folders.map((f) => (
          <Fragment key={f.path}>
            <FolderListRow
              entry={f}
              depth={depth}
              open={expanded.has(f.path)}
              selected={selectedId === f.path}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.path)) next.delete(f.path);
                  else next.add(f.path);
                  return next;
                })
              }
              onSelect={() => setSelectedId(f.path)}
              onEnter={() => enter(f.path)}
            />
            {expanded.has(f.path) && renderListRows(f.path, depth + 1)}
          </Fragment>
        ))}
        {l.items.map((n) => (
          <button
            type="button"
            key={n.id}
            className={selectedId === n.id ? "fdr-row sel" : "fdr-row"}
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

      {searching ? (
        hits.length === 0 ? (
          <div className="list-empty">
            <p className="be-title">No matches</p>
            <p className="be-sub">Try a different search.</p>
          </div>
        ) : (
          <div className="board-scroll">
            <ul className="recent-list">
              {hits.map((n) => (
                <NoteListRow
                  key={n.id}
                  note={n}
                  selected={n.id === selectedId}
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
        <div className="board-scroll">
          <div className="fdr-grid">
            {listing.folders.map((f) => (
              <button
                type="button"
                key={f.path}
                className={selectedId === f.path ? "fdr-tile sel" : "fdr-tile"}
                title="Open folder"
                onClick={() => setSelectedId(f.path)}
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
                className={selectedId === n.id ? "fdr-tile sel" : "fdr-tile"}
                data-note-id={n.id}
                title="Open"
                {...itemHandlers(n)}
              >
                {glyphForNote(n, { size: 38, className: "fdr-tile-icon" })}
                <span className="fdr-tile-name">{n.title || "Empty note"}</span>
                <span className="fdr-tile-sub">{longDateLabel(n.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="board-scroll">
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
