/** Composition root for item creation. Product rules stay in model/workflow. */
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "../services/createNote";
import { DEST, isHidden, isVault } from "../services/destinations";
import { invalidateNotes } from "../services/hooks";
import {
  MAIN_ROOT,
  addNoteToMainAt,
  mainFolderIds,
  mainParentOfNote,
} from "../services/mainTree";
import { inboxFolderId } from "../services/notes";
import { useMainStore } from "../state/main";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import { corpusCreateBoard, corpusCreateManagedFile } from "../lib/tauri";
import type { NewItemKind } from "./model";
import { createNewItem, type CreatedItem, type NewItemCreator, type NewItemPresenter } from "./workflow";

function focusedItemId(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  const tab = leaf?.tabs.find((item) => item.id === leaf.activeTabId) ?? leaf?.tabs[0];
  if (!tab) return null;
  if (tab.surfaceKind === "note") return tab.noteId;
  if (tab.surfaceKind === "canvas") return tab.boardId;
  if (tab.surfaceKind === "file") return tab.fileId;
  return null;
}

function selectedMainFolder(): string | null {
  const selected = useUiStore.getState().selectedFolderId;
  return selected.startsWith(MAIN_ROOT) && selected !== MAIN_ROOT ? selected : null;
}

function mainParent(): string {
  const { manifest } = useMainStore.getState();
  const selected = selectedMainFolder();
  if (selected && mainFolderIds(manifest.tree).includes(selected)) return selected;
  const current = focusedItemId();
  return (current && mainParentOfNote(manifest.tree, current)) || MAIN_ROOT;
}

function resolvedPhysicalFolder(): string {
  const selected = useUiStore.getState().selectedFolderId;
  return selected === ALL_NOTES ||
    selected === RECENT ||
    selected.startsWith(MAIN_ROOT) ||
    isHidden(selected) ||
    isVault(selected)
    ? DEST.inbox
    : selected;
}

const creator: NewItemCreator = {
  async create(kind) {
    if (kind === "markdown") {
      const selected = useUiStore.getState().selectedFolderId;
      const selectedMain = selected.startsWith(MAIN_ROOT);
      const routeFolder = selectedMain ? ALL_NOTES : selected;
      const id = await createRoutedNote({
        selectedFolderId: routeFolder,
        isSmart: routeFolder === ALL_NOTES || routeFolder === RECENT,
        localFallback: inboxFolderId,
        body: "",
      });
      return { id, kind };
    }
    if (kind === "document") {
      const { createManagedDocument } = await import("../documents/composition");
      return { id: await createManagedDocument(), kind };
    }
    if (kind === "sheet") {
      const { createBlankWorkbookBase64 } = await import("../sheets/create");
      const base64 = await createBlankWorkbookBase64();
      return { id: await corpusCreateManagedFile(`untitled-${Date.now()}.xlsx`, base64), kind };
    }
    const board = await corpusCreateBoard(resolvedPhysicalFolder());
    return { id: board.id, kind };
  },
};

const presenter: NewItemPresenter = {
  async refresh() {
    await Promise.all([invalidateNotes(), invalidateMemex()]);
  },
  fileInMain(item) {
    const { manifest, setTree } = useMainStore.getState();
    setTree(addNoteToMainAt(manifest.tree, item.id, mainParent()));
  },
  open(item, options) {
    const panes = usePanesStore.getState();
    useUiStore.getState().setSidebarMode("notes");
    if (item.kind === "markdown") panes.openNote(item.id, options);
    else if (item.kind === "board") {
      panes.openCanvas(item.id, options);
      useUiStore.getState().setRenamingBoardId(item.id);
    } else panes.openFile(item.id, options);
  },
};

export async function createManagedItem(
  kind: NewItemKind,
  options: { newTab?: boolean; open?: boolean } = {},
): Promise<CreatedItem> {
  return createNewItem({ creator, presenter }, kind, options);
}
