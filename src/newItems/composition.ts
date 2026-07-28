/** Composition root for item creation. Product rules stay in model/workflow. */
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "../services/createNote";
import { DEST, isHidden, isStorageLane, isVault } from "../services/destinations";
import { invalidateNotes } from "../services/hooks";
import { MAIN_ROOT, addNoteToMainAt, mainFolderIds, mainParentOfNote } from "../services/mainTree";
import { inboxFolderId } from "../services/notes";
import { useMainStore } from "../state/main";
import { useViewsStore } from "../state/views";
import { assignItemToView, viewTree } from "../services/viewTree";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import { corpusCreateBoard, corpusCreateManagedFile } from "../lib/tauri";
import { trackNewDocumentDraft } from "../documents/draftComposition";
import { trackNewNoteDraft } from "../services/noteDrafts";
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
  const activeView = useUiStore.getState().activeView;
  const tree = activeView
    ? viewTree(useViewsStore.getState().manifest, activeView)
    : useMainStore.getState().manifest.tree;
  const selected = selectedMainFolder();
  if (selected && mainFolderIds(tree).includes(selected)) return selected;
  const current = focusedItemId();
  return (current && mainParentOfNote(tree, current)) || MAIN_ROOT;
}

function resolvedPhysicalFolder(): string {
  const selected = useUiStore.getState().selectedFolderId;
  return selected === ALL_NOTES ||
    selected === RECENT ||
    selected.startsWith(MAIN_ROOT) ||
    isHidden(selected) ||
    isStorageLane(selected) || // Assets is the managed binary lane — nothing is born there
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
    const parent = mainParent();
    const activeView = useUiStore.getState().activeView;
    const main = useMainStore.getState();
    // Main is the global shelf. A named-view folder is local to that view, so
    // new items land at Main's root while retaining the active view's nesting.
    main.setTree(addNoteToMainAt(main.manifest.tree, item.id, activeView ? MAIN_ROOT : parent));
    if (activeView) {
      const views = useViewsStore.getState();
      views.setManifest(assignItemToView(views.manifest, item.id, activeView, parent));
    }
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
  const item = await createNewItem({ creator, presenter }, kind, options);
  // Pristine-draft tracking lives HERE, where `open` is known: only an item the
  // user actually opened can be abandoned-blank. `open:false` creations (slash
  // embed targets) must never be tracked — a later open+close-unedited would
  // discard a file something else already embeds.
  if (options.open !== false) {
    if (item.kind === "markdown") trackNewNoteDraft(item.id);
    else if (item.kind === "document") trackNewDocumentDraft(item.id);
  }
  return item;
}

/** Create a populated board atomically while preserving the same Main/view
 * filing and presentation policy used by every other creation entry point. */
export function createManagedBoardWithBody(
  body: string,
  options: { newTab?: boolean; open?: boolean } = {},
): Promise<CreatedItem> {
  const populatedBoardCreator: NewItemCreator = {
    async create() {
      const board = await corpusCreateBoard(resolvedPhysicalFolder(), body);
      return { id: board.id, kind: "board" };
    },
  };
  return createNewItem({ creator: populatedBoardCreator, presenter }, "board", options);
}
