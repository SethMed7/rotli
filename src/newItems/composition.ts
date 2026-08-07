import { trackNewDocumentDraft } from "../documents/draftComposition";
import { corpusCreateBoard, corpusCreateManagedFile } from "../lib/tauri";
/** Composition root for item creation. Product rules stay in model/workflow. */
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "../services/createNote";
import { DEST, isHidden, isStorageLane, isVault } from "../services/destinations";
import { invalidateNotes } from "../services/hooks";
import { MAIN_ROOT, addNoteToMainAt, mainFolderIds, mainParentOfNote } from "../services/mainTree";
import { trackNewNoteDraft } from "../services/noteDrafts";
import { inboxFolderId } from "../services/notes";
import { assignItemToView, assignedView, viewTree } from "../services/viewTree";
import { useMainStore } from "../state/main";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import { useViewsStore } from "../state/views";
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
    if (kind === "markdown" || kind === "mermaid") {
      const selected = useUiStore.getState().selectedFolderId;
      const selectedMain = selected.startsWith(MAIN_ROOT);
      const routeFolder = selectedMain ? ALL_NOTES : selected;
      // a Mermaid diagram is a NOTE born with the starter flowchart fence —
      // the same body the slash command inserts (Seth, 2026-07-29)
      const body =
        kind === "mermaid"
          ? await import("../editor/slashActions").then(
              (m) => `# Diagram\n\n\`\`\`mermaid\n${m.MERMAID_STARTER}\n\`\`\`\n`,
            )
          : "";
      const id = await createRoutedNote({
        selectedFolderId: routeFolder,
        isSmart: routeFolder === ALL_NOTES || routeFolder === RECENT,
        localFallback: inboxFolderId,
        body,
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
    throw new Error("a board needs a name before it can be created");
  },
};

/** The named view (if any) whose OWN tree carries a folder with this rendered
 * id — folder ids share one grammar ("main:<path>") across Main and every
 * view, so a Main folder mirrored into a view matches by id. Seth, 2026-07-29:
 * "if I put a file in a folder that is part of a view it should be seen in
 * that view." */
export function viewContainingFolder(folderId: string): string | null {
  if (folderId === MAIN_ROOT) return null;
  const manifest = useViewsStore.getState().manifest;
  for (const view of manifest.views) {
    if (mainFolderIds(view.tree).includes(folderId)) return view.name;
  }
  return null;
}

/** Assign `itemId` to the view that mirrors `parent`, when one does. Runs
 * AFTER the Main write (assignItemToView wipes other memberships first). */
export function inheritFolderView(itemId: string, parent: string): void {
  const view = viewContainingFolder(parent);
  if (!view) return;
  const views = useViewsStore.getState();
  views.setManifest(assignItemToView(views.manifest, itemId, view, parent));
}

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
    } else {
      inheritFolderView(item.id, parent);
    }
  },
  open(item, options) {
    const panes = usePanesStore.getState();
    useUiStore.getState().setSidebarMode("notes");
    if (item.kind === "markdown" || item.kind === "mermaid") panes.openNote(item.id, options);
    else if (item.kind === "board") {
      panes.openCanvas(item.id, options);
    } else panes.openFile(item.id, options);
  },
};

export async function createManagedItem(
  kind: NewItemKind,
  options: { newTab?: boolean; open?: boolean; boardName?: string } = {},
): Promise<CreatedItem> {
  const boardName = options.boardName?.trim() ?? "";
  if (kind === "board" && !boardName) throw new Error("a board needs a name");
  const itemCreator: NewItemCreator =
    kind === "board"
      ? {
          async create() {
            const board = await corpusCreateBoard(resolvedPhysicalFolder(), boardName);
            return { id: board.id, kind: "board" };
          },
        }
      : creator;
  const item = await createNewItem({ creator: itemCreator, presenter }, kind, options);
  // Pristine-draft tracking lives HERE, where `open` is known: only an item the
  // user actually opened can be abandoned-blank. `open:false` creations (slash
  // embed targets) must never be tracked — a later open+close-unedited would
  // discard a file something else already embeds.
  if (options.open !== false) {
    // a mermaid item IS a markdown note — an abandoned blank tracks the same
    if (item.kind === "markdown" || item.kind === "mermaid") trackNewNoteDraft(item.id);
    else if (item.kind === "document") trackNewDocumentDraft(item.id);
  }
  return item;
}

/** Open the shared name-first lane used by chooser cards, menus, and hotkeys.
 * The file creator remains unavailable until the dialog supplies a name. */
export function requestManagedBoardCreation(options: { newTab?: boolean } = {}): void {
  useUiStore.getState().setBoardCreationRequest({ newTab: options.newTab ?? false });
}

/** Create a populated board atomically while preserving the same Main/view
 * filing and presentation policy used by every other creation entry point.
 * `besideNoteId` (Seth, 2026-07-29: a converted diagram lands "in the same
 * path I am in") files the board beside that note — same Main folder, same
 * named view — instead of reading the ambient selection. */
export function createManagedBoardWithBody(
  body: string,
  name: string,
  options: { newTab?: boolean; open?: boolean; besideNoteId?: string } = {},
): Promise<CreatedItem> {
  const populatedBoardCreator: NewItemCreator = {
    async create() {
      const board = await corpusCreateBoard(resolvedPhysicalFolder(), name, body);
      return { id: board.id, kind: "board" };
    },
  };
  const beside = options.besideNoteId;
  const filingPresenter: NewItemPresenter = beside
    ? {
        ...presenter,
        fileInMain(item) {
          const main = useMainStore.getState();
          const views = useViewsStore.getState();
          const view = assignedView(views.manifest, beside);
          if (view) {
            const parentInView = mainParentOfNote(viewTree(views.manifest, view), beside) ?? MAIN_ROOT;
            main.setTree(addNoteToMainAt(main.manifest.tree, item.id, MAIN_ROOT));
            views.setManifest(assignItemToView(views.manifest, item.id, view, parentInView));
            return;
          }
          const parent = mainParentOfNote(main.manifest.tree, beside) ?? MAIN_ROOT;
          main.setTree(addNoteToMainAt(main.manifest.tree, item.id, parent));
          inheritFolderView(item.id, parent);
        },
      }
    : presenter;
  return createNewItem({ creator: populatedBoardCreator, presenter: filingPresenter }, "board", options);
}
