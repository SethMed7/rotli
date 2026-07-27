// The System browser (Seth, 2026-07-26): Library · Assets · Archive · Trash
// open HERE, Finder-style, instead of inline sidebar dropdowns — a surface
// people already understand: search on top, a Folders ⇄ List toggle, real
// folder structure (physical paths, never synthetic groupings), rows that
// open/right-click/drag exactly like every other list (NoteListRow).

import { useEffect, useMemo, useState } from "react";
import { noteDiskFolder, projectNoteToBrain } from "../lib/noteLocation";
import { DEST } from "../services/destinations";
import { useFolders, useNotes, useSearchableNotes } from "../services/hooks";
import { type SystemViewMode, filterSystemItems, groupSystemItems } from "../services/systemBrowser";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { Character } from "./character";
import { ChevronRight, SearchGlyph } from "./glyphs";
import { NoteListRow } from "./noteListRow";
import { useNoteMenu } from "./useNoteMenu";

/** Root id → the browser's title + the prefix its folder labels strip. */
const ROOTS: Record<string, { title: string; prefix: string }> = {
  Brain: { title: "Library", prefix: "wiki" },
  [DEST.storage]: { title: "Assets", prefix: "Storage" },
  [DEST.archive]: { title: "Archive", prefix: "Archive" },
  [DEST.trash]: { title: "Trash", prefix: "Trash" },
};

// per-root session memory for the view mode — the surface unmounts on every
// content-view switch, and a Finder that forgets its view feels broken
const modeMemo = new Map<string, SystemViewMode>();

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
  // collapsed folder paths (Folders mode) — per-mount, like Finder disclosure
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleFolder = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const openSummary = usePanesStore((s) => s.openSummary);
  const openMenu = useNoteMenu();
  // Empty directories are real (Finder truth) — seed the Library's folder list
  // so a folder with zero notes still renders. Library-only for now: other
  // roots' folder ids use disk-case paths that need their own mapping.
  const foldersData = useFolders().data;
  const folderSeed = useMemo(
    () => (isLibrary ? (foldersData ?? []).filter((f) => f.id.startsWith("wiki/")).map((f) => f.id) : []),
    [isLibrary, foldersData],
  );
  const groups = useMemo(
    () => groupSystemItems(items, root.prefix, query, folderSeed),
    [items, root.prefix, query, folderSeed],
  );
  const flat = useMemo(() => filterSystemItems(items, query), [items, query]);

  // "Show in Library" (the note menu / the editor's location chip): land on the
  // note's EXACT folder — clear any filter, un-collapse its group, mark the row,
  // and scroll it into view once the async items carry it (BoardSurface's
  // proven reveal pattern; two frames so the expanded group commits first).
  const revealNonce = useUiStore((s) => s.revealNonce);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!revealNonce) return;
    const { revealNoteId } = useUiStore.getState();
    if (!revealNoteId) return;
    const target = items.find((n) => n.id === revealNoteId);
    if (!target) return;
    setQuery("");
    setSelectedId(revealNoteId);
    const path = noteDiskFolder(target);
    setCollapsed((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
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
  }, [revealNonce, items]);

  return (
    <div className="board allnotes system-browser">
      <header className="board-head">
        <h2 className="board-title">{root.title}</h2>
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

      {(mode === "list" ? flat.length === 0 : groups.length === 0) ? (
        query.trim() !== "" ? (
          <div className="list-empty">
            <p className="be-title">No matches</p>
            <p className="be-sub">Try a different search.</p>
          </div>
        ) : (
          <div className="list-empty">
            <Character name="rest" size={104} className="be-quokka" />
            <p className="be-title">Nothing here</p>
            <p className="be-sub">{root.title} is empty.</p>
          </div>
        )
      ) : mode === "list" ? (
        <div className="board-scroll">
          <ul className="recent-list">
            {flat.map((n) => (
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
      ) : (
        <div className="board-scroll">
          {groups.map((g) => {
            const isRoot = g.label === "";
            const open = !collapsed.has(g.path);
            return (
              <section key={g.path || "(root)"} className="sysb-group">
                {!isRoot && (
                  <button
                    type="button"
                    className="sysb-folder"
                    aria-expanded={open}
                    onClick={() => toggleFolder(g.path)}
                  >
                    <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
                      <ChevronRight size={10} />
                    </span>
                    <span className="sysb-folder-name">{g.label}</span>
                    <span className="count">{g.items.length}</span>
                  </button>
                )}
                {(isRoot || open) && (
                  <ul className={isRoot ? "recent-list" : "recent-list sysb-nested"}>
                    {g.items.map((n) => (
                      <NoteListRow
                        key={n.id}
                        note={n}
                        selected={n.id === selectedId}
                        onOpen={(note, newTab) => openSummary(note, { newTab })}
                        onContextMenu={openMenu}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
