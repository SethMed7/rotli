// The folder window's sidebar: the folder's own tree, every branch open by
// default, and one click opens an item in a tab. Loading, error, and empty
// each say what's happening.

import { type CSSProperties, useState } from "react";

import type { FolderListing } from "../../services/folderWindow";
import { usePanesStore } from "../../state/panes";
import type { NoteSummary } from "../../types";
import { ChevronRight, FolderGlyph } from "../glyphs";
import { glyphForNote } from "../noteGlyph";
import { type FolderBranch, folderTree } from "./folderTreeModel";

interface Listing {
  data: FolderListing | undefined;
  isPending: boolean;
  error: Error | null;
  refetch: () => unknown;
}

export function FolderTree({ root, listing }: { root: string; listing: Listing }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = (item: NoteSummary) => usePanesStore.getState().openSummary(item);
  const toggle = (id: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  if (listing.isPending) return <p className="folder-window-status">Reading the folder…</p>;
  if (listing.error || !listing.data)
    return (
      <div className="folder-window-status" role="alert">
        Couldn’t read this folder — {listing.error?.message ?? "no answer"}.{" "}
        <button type="button" className="folder-window-retry" onClick={() => void listing.refetch()}>
          Try again
        </button>
      </div>
    );
  const tree = folderTree(root, listing.data.folders, listing.data.notes);
  if (tree.folders.length === 0 && tree.items.length === 0)
    return <p className="folder-window-status">Nothing here Rotli opens yet: no notes, boards, or files.</p>;

  const branch = (node: FolderBranch, depth: number) => (
    <>
      {node.folders.map((folder) => {
        const isOpen = !closed.has(folder.id);
        return (
          <div key={folder.id} role="treeitem" aria-expanded={isOpen} aria-selected={false}>
            <button
              type="button"
              className="frow folder-window-row"
              style={{ "--depth": depth } as CSSProperties}
              onClick={() => toggle(folder.id)}
            >
              <ChevronRight
                size={10}
                className={isOpen ? "folder-window-caret open" : "folder-window-caret"}
              />
              <FolderGlyph size={14} />
              <span className="fname">{folder.name}</span>
            </button>
            {isOpen && <div role="group">{branch(folder, depth + 1)}</div>}
          </div>
        );
      })}
      {node.items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="treeitem"
          aria-selected={false}
          className="frow folder-window-row folder-window-item"
          style={{ "--depth": depth } as CSSProperties}
          onClick={() => open(item)}
        >
          {glyphForNote(item, { size: 14 })}
          <span className="fname">{item.title}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="sb-rows" role="tree" aria-label="Folder contents">
      {branch(tree, 0)}
    </div>
  );
}
