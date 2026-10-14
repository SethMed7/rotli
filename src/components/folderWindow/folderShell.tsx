// A folder opened from Finder, raw, in its own window (docs/design/
// open-in-rotli.md, stage 2): its tree on the left, tabs on the right, and
// "Add as vault" in the title strip. Same bundle (`index.html?window=folder`),
// but nothing of the vault reaches it — no switcher, Main, chats, Librarian,
// or Breve. Edits save in place; nothing is created, moved, or filed, and the
// window persists nothing (main stays the one writer).

import { useEffect, useState } from "react";

import { dispatch } from "../../keys/registry";
import {
  addFolderAsVault,
  attachFolderShell,
  dragFolderWindow,
  folderWindowName,
  folderWindowRoot,
  useFolderWindowListing,
  zoomFolderWindow,
} from "../../services/folderWindow";
import { leaves, usePanesStore } from "../../state/panes";
import { useUiStore } from "../../state/ui";
import { FolderGlyph } from "../glyphs";
import { SideWindowFrame } from "../sideWindowFrame";
import { FolderTree } from "./folderTree";

export function FolderShell() {
  const root = folderWindowRoot() ?? "";
  const name = folderWindowName();
  const listing = useFolderWindowListing(root);
  const setRowActionError = useUiStore((state) => state.setRowActionError);
  const empty = usePanesStore((state) => leaves(state.root).every((leaf) => leaf.tabs.length === 0));
  const [adding, setAdding] = useState(false);

  // this window starts with nothing open: no vault note, no blank draft
  useEffect(() => {
    useUiStore.getState().setContentView("panes");
    usePanesStore.setState({
      root: { kind: "leaf", id: "folder-pane", tabs: [], activeTabId: "" },
      focusedPaneId: "folder-pane",
    });
  }, []);

  useEffect(
    () =>
      attachFolderShell({
        closeTab: () => dispatch("tabs.close"),
        notice: (message) => useUiStore.getState().setRowActionError(message),
      }),
    [],
  );

  const addAsVault = () => {
    if (adding) return;
    setAdding(true);
    setRowActionError(null);
    // main asks how to open it, and closes this window once a vault opened
    addFolderAsVault()
      .then(() => setAdding(false))
      .catch((cause: unknown) => {
        setAdding(false);
        setRowActionError(
          `Couldn’t add this folder — ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
  };

  return (
    <SideWindowFrame
      className="folder-window"
      drag={dragFolderWindow}
      zoom={zoomFolderWindow}
      title={
        <>
          <FolderGlyph size={14} />
          <span>{name || "Folder"}</span>
        </>
      }
      actions={
        <button type="button" className="btn folder-window-add" disabled={adding} onClick={addAsVault}>
          {adding ? "Adding…" : "Add as vault"}
        </button>
      }
      rail={
        <>
          <p className="folder-window-note">
            Edits save to these files. Nothing else in this folder changes.
          </p>
          <FolderTree root={root} listing={listing} />
        </>
      }
      railLabel={`Files in ${name || "this folder"}`}
      railClassName="folder-window-rail"
      empty={empty ? { title: "Nothing open", body: "Pick a note, board, or file on the left." } : null}
    />
  );
}
