// The folders rail (gate r1/r2 frame A). Smart rows on top (All notes ·
// Recent), the folder tree under a section label, "New folder" at the bottom.
// Selection = peach tint; dark mode adds the 3px clay bar (one selection
// grammar — exactly where the r2 gate shows it).

import type { ReactNode } from "react";
import { useCreateFolder, useFolders, useNotes } from "../services/hooks";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import type { Folder } from "../types";
import { ClockGlyph, FileGlyph, FolderGlyph, PlusGlyph } from "./glyphs";

interface FolderRowProps {
  folder: Folder;
  depth: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
}

function FolderRow({ folder, depth, count, selected, onSelect }: FolderRowProps) {
  return (
    <button
      type="button"
      className={`frow${selected ? " sel" : ""}${depth > 0 ? " child" : ""}`}
      onClick={onSelect}
    >
      <FolderGlyph size={14.5} />
      <span className="fname">{folder.name}</span>
      <span className="count">{count}</span>
    </button>
  );
}

export function FoldersRail() {
  const folders = useFolders().data ?? [];
  const allNotes = useNotes().data ?? [];
  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const createFolder = useCreateFolder();

  // counts include descendants (a folder holds everything under it)
  const childrenOf = (parentId: string | null) =>
    folders.filter((f) => f.parentId === parentId);
  const countFor = (folderId: string): number => {
    const own = allNotes.filter((n) => n.folderId === folderId).length;
    return own + childrenOf(folderId).reduce((sum, child) => sum + countFor(child.id), 0);
  };

  const renderTree = (parentId: string | null, depth: number): ReactNode =>
    childrenOf(parentId).map((folder) => (
      <div key={folder.id}>
        <FolderRow
          folder={folder}
          depth={depth}
          count={countFor(folder.id)}
          selected={selectedFolderId === folder.id}
          onSelect={() => setSelectedFolderId(folder.id)}
        />
        {renderTree(folder.id, depth + 1)}
      </div>
    ));

  return (
    <nav className="folders" aria-label="Folders">
      <button
        type="button"
        className={`frow${selectedFolderId === ALL_NOTES ? " sel" : ""}`}
        onClick={() => setSelectedFolderId(ALL_NOTES)}
      >
        <FileGlyph size={14.5} />
        <span className="fname">All notes</span>
        <span className="count">{allNotes.length}</span>
      </button>
      <button
        type="button"
        className={`frow${selectedFolderId === RECENT ? " sel" : ""}`}
        onClick={() => setSelectedFolderId(RECENT)}
      >
        <ClockGlyph size={14.5} />
        <span className="fname">Recent</span>
        <span className="count">{Math.min(allNotes.length, 9)}</span>
      </button>
      <div className="fsec">Folders</div>
      {renderTree(null, 0)}
      <div className="grow" />
      <button
        type="button"
        className="newfolder"
        onClick={() => createFolder.mutate("New folder")}
      >
        <PlusGlyph size={14} />
        New folder
      </button>
    </nav>
  );
}
