import { discardBlankNote, trackNewDocumentDraft } from "../documents/draftComposition";
import type { DocumentImage } from "../documents/model";
import {
  adoptPendingDocument,
  ensurePendingDocument,
  evictDocument,
  pendingNoteDocumentId,
} from "../editor/model";
import { MERMAID_STARTER } from "../editor/slashActions";
import { corpusCreateBoard, corpusCreateManagedFile } from "../lib/tauri";
/** Composition root for item creation. Product rules stay in model/workflow. */
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "../services/createNote";
import { DEST, isHidden, isStorageLane, isVault } from "../services/destinations";
import { invalidateNoteLists, primeNote } from "../services/hooks";
import { MAIN_ROOT, addNoteToMainAt, mainFolderIds, mainParentOfNote } from "../services/mainTree";
import { trackNewNoteDraft } from "../services/noteDrafts";
import { inboxFolderId, notesService } from "../services/notes";
import { assignItemToView, assignedView, viewTree } from "../services/viewTree";
import { useMainStore } from "../state/main";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { ALL_NOTES, RECENT, useUiStore } from "../state/ui";
import { useViewsStore } from "../state/views";
import { newItemDefinition, type NewItemKind } from "./model";
import { newItemParent } from "./placement";
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

function mainParent(): string {
  const activeView = useUiStore.getState().activeView;
  const tree = activeView
    ? viewTree(useViewsStore.getState().manifest, activeView)
    : useMainStore.getState().manifest.tree;
  return newItemParent(tree, focusedItemId());
}

interface FilingContext {
  parent: string;
  activeView: string | null;
}

/** A note created in the Quick Note window is a FULL note, not a capture: file
 * it into Main's root at birth, exactly as ⌘T files its note. Curated-in-Main is
 * the one rule that separates a full note from a Captures card (boardSurface,
 * sidebarHome), and Main hides the reference while the body is still blank, so
 * an untouched quick note never shows as an empty row. Runs in the MAIN window
 * (the manifest writer); the quick webview announces the id over IPC. */
export function fileQuickNoteInMain(noteId: string): void {
  fileItemInMain({ id: noteId, kind: "markdown" }, { parent: MAIN_ROOT, activeView: null });
  void invalidateNoteLists();
}

/** Snapshot creation placement before any file I/O yields. Chooser tabs close
 * before their async creator returns, and focus recovery can legitimately
 * change the ambient selection while that work is in flight. */
function currentFilingContext(): FilingContext {
  return { parent: mainParent(), activeView: useUiStore.getState().activeView };
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

function initialMarkdownBody(kind: NewItemKind): string {
  return kind === "mermaid" ? `# Diagram\n\n\`\`\`mermaid\n${MERMAID_STARTER}\n\`\`\`\n` : "";
}

const creator: NewItemCreator = {
  async create(kind) {
    if (kind === "markdown" || kind === "mermaid") {
      const selected = useUiStore.getState().selectedFolderId;
      const selectedMain = selected.startsWith(MAIN_ROOT);
      const routeFolder = selectedMain ? ALL_NOTES : selected;
      // a Mermaid diagram is a NOTE born with the starter flowchart fence —
      // the same body the slash command inserts (the maintainer, 2026-07-29)
      const body = initialMarkdownBody(kind);
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
      return {
        id: await corpusCreateManagedFile(`untitled-${Date.now()}.xlsx`, base64),
        kind,
      };
    }
    throw new Error("a board needs a name before it can be created");
  },
};

/** The named view (if any) whose OWN tree carries a folder with this rendered
 * id — folder ids share one grammar ("main:<path>") across Main and every
 * view, so a Main folder mirrored into a view matches by id. the maintainer, 2026-07-29:
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

function fileItemInMain(item: CreatedItem, context: FilingContext): void {
  const { parent, activeView } = context;
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
  // Presentation may intentionally precede structural refresh and filing. If
  // the chosen folder was collapsed while focus recovered from a chooser tab,
  // reveal the newly filed row once its identity is resolvable.
  if (parent !== MAIN_ROOT) useUiStore.getState().setDestExpanded(parent, true);
}

const presenter: NewItemPresenter = {
  async refresh() {
    await Promise.all([invalidateNoteLists(), invalidateMemex()]);
  },
  fileInMain(item) {
    fileItemInMain(item, currentFilingContext());
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
  options: { newTab?: boolean; open?: boolean; boardName?: string; pendingTabId?: string } = {},
): Promise<CreatedItem> {
  const boardName = options.boardName?.trim() ?? "";
  if (kind === "board" && !boardName) throw new Error("a board needs a name");
  const baseItemCreator: NewItemCreator =
    kind === "board"
      ? {
          async create() {
            const board = await corpusCreateBoard(resolvedPhysicalFolder(), boardName);
            return { id: board.id, kind: "board" };
          },
        }
      : creator;
  const filingContext = currentFilingContext();
  let pendingNotePrepared = false;
  let abandonedBlankMarkdown = false;
  let deferBlankMarkdownFiling = false;
  let blankMarkdownSaved = false;
  let deferredMainItem: CreatedItem | null = null;
  let filedDeferredItem = false;

  const maybeFileDeferredMarkdown = (): void => {
    if (!blankMarkdownSaved || !deferredMainItem || filedDeferredItem) return;
    filedDeferredItem = true;
    fileItemInMain(deferredMainItem, filingContext);
  };

  const trackOpenedNote = (item: CreatedItem): void => {
    if (item.kind !== "markdown") {
      trackNewNoteDraft(item.id);
      return;
    }
    deferBlankMarkdownFiling = true;
    trackNewNoteDraft(item.id, () => {
      blankMarkdownSaved = true;
      maybeFileDeferredMarkdown();
    });
  };

  const pendingTabId = options.pendingTabId;
  const itemCreator: NewItemCreator =
    pendingTabId && (kind === "markdown" || kind === "mermaid")
      ? {
          async create(requestedKind) {
            const item = await baseItemCreator.create(requestedKind);
            const latest = usePanesStore.getState();
            const stillOpen = leaves(latest.root).some((leaf) =>
              leaf.tabs.some(
                (tab) => tab.id === pendingTabId && tab.surfaceKind === "newItem" && tab.pendingNote === true,
              ),
            );
            if (!stillOpen) {
              if (item.kind === "markdown") abandonedBlankMarkdown = true;
              return item;
            }
            const note = await notesService.getNote(item.id);
            if (!note) throw new Error("the new note could not be read back after creation");
            // Reading the durable note can yield on a large vault. Respect a
            // close that happened during that read: the pending text belonged
            // to the explicitly closed view and the still-blank file is
            // discarded after the shared creation workflow settles.
            const afterRead = usePanesStore.getState();
            const remainedOpen = leaves(afterRead.root).some((leaf) =>
              leaf.tabs.some(
                (tab) => tab.id === pendingTabId && tab.surfaceKind === "newItem" && tab.pendingNote === true,
              ),
            );
            if (!remainedOpen) {
              if (item.kind === "markdown") abandonedBlankMarkdown = true;
              return item;
            }
            // Seed the durable query before the tab retargets: the real editor
            // replaces the pending editor with no blank/loading frame.
            primeNote(note);
            trackOpenedNote(item);
            pendingNotePrepared = true;
            adoptPendingDocument(pendingNoteDocumentId(pendingTabId), note);
            return item;
          },
        }
      : baseItemCreator;
  // Pristine-draft tracking lives HERE, where `open` is known: only an item the
  // user actually opened can be abandoned-blank. `open:false` creations (slash
  // embed targets) must never be tracked — a later open+close-unedited would
  // discard a file something else already embeds.
  // Track in the same synchronous presentation turn, not after refresh: the
  // user can close the now-immediate tab while the corpus refresh is pending.
  const draftTrackingPresenter: NewItemPresenter = {
    ...presenter,
    fileInMain(item) {
      if (item.kind === "markdown" && abandonedBlankMarkdown) return;
      if (item.kind === "markdown" && deferBlankMarkdownFiling) {
        deferredMainItem = item;
        maybeFileDeferredMarkdown();
        return;
      }
      fileItemInMain(item, filingContext);
    },
    open(item, openOptions) {
      let opened = true;
      if (options.pendingTabId) {
        opened = usePanesStore
          .getState()
          .resolvePendingItemTab(
            options.pendingTabId,
            item.kind === "markdown" || item.kind === "mermaid"
              ? { surfaceKind: "note", noteId: item.id }
              : item.kind === "board"
                ? { surfaceKind: "canvas", boardId: item.id }
                : { surfaceKind: "file", fileId: item.id },
          );
      } else {
        presenter.open(item, openOptions);
      }
      // Closing the optimistic tab before creation completes is explicit user
      // intent. A populated item is still created/filed, but a plain blank
      // Markdown file must not survive as an orphaned "Untitled" row.
      if (!opened) {
        if (item.kind === "markdown") abandonedBlankMarkdown = true;
        // A vault-policy refusal leaves the pending tab present; remove that
        // placeholder. A user-close already removed it and remains a no-op.
        if (options.pendingTabId) {
          evictDocument(pendingNoteDocumentId(options.pendingTabId));
          const latest = usePanesStore.getState();
          const owner = leaves(latest.root).find((leaf) =>
            leaf.tabs.some((tab) => tab.id === options.pendingTabId),
          );
          if (owner) latest.closeTabById(owner.id, options.pendingTabId, { record: false });
        }
        return;
      }
      // Mermaid is still a note and uses the same session-draft safety; its
      // populated starter body makes Rust's blank-discard backstop refuse it.
      if ((item.kind === "markdown" || item.kind === "mermaid") && !pendingNotePrepared)
        trackOpenedNote(item);
      else if (item.kind === "document") trackNewDocumentDraft(item.id);
    },
  };
  const item = await createNewItem(
    { creator: itemCreator, presenter: draftTrackingPresenter },
    kind,
    options,
  );
  if (item.kind === "markdown" && abandonedBlankMarkdown) await discardBlankNote(item.id);
  return item;
}

/** ⌘T's optimistic composition: append/activate a real tab synchronously, then
 * start the durable creator. Resolution retargets that exact tab; refresh and
 * Main/view filing remain background work. */
export function createManagedItemInTabOptimistically(kind: Exclude<NewItemKind, "board">): void {
  const panes = usePanesStore.getState();
  const pendingNote = kind === "markdown" || kind === "mermaid";
  const pending = panes.openPendingItemTab(
    kind === "markdown" ? "Untitled" : newItemDefinition(kind).label,
    pendingNote ? { note: true } : undefined,
  );
  if (pendingNote) {
    ensurePendingDocument(pendingNoteDocumentId(pending.tabId), initialMarkdownBody(kind));
  }
  void createManagedItem(kind, { newTab: true, pendingTabId: pending.tabId }).catch((error) => {
    // Remove only the placeholder this operation owns, wherever a tab drag may
    // have moved it. If the user already closed it, there is nothing to do.
    const latest = usePanesStore.getState();
    const owner = leaves(latest.root).find((leaf) => leaf.tabs.some((tab) => tab.id === pending.tabId));
    if (owner) latest.closeTabById(owner.id, pending.tabId, { record: false });
    if (pendingNote) evictDocument(pendingNoteDocumentId(pending.tabId));
    useUiStore
      .getState()
      .setRowActionError(
        `Couldn’t create the item — ${error instanceof Error ? error.message : String(error)}`,
      );
  });
}

/** Create a populated editable Word artifact while retaining the same refresh,
 * Main/view filing, and presentation policy as a toolbar-created document.
 * Populated artifacts are never tracked as discardable blank drafts. */
export function createManagedDocumentWithContent(
  title: string,
  body: string,
  options: {
    newTab?: boolean;
    open?: boolean;
    images?: DocumentImage[];
    rootId?: string;
  } = {},
): Promise<CreatedItem> {
  const populatedDocumentCreator: NewItemCreator = {
    async create() {
      const { createManagedDocumentFromMarkdown } = await import("../documents/composition");
      return {
        id: await createManagedDocumentFromMarkdown(title, body, Date.now(), options.images, options.rootId),
        kind: "document",
      };
    },
  };
  return createNewItem({ creator: populatedDocumentCreator, presenter }, "document", options);
}

/** Generated sheets retain the same refresh and Main/view filing policy as a
 * chooser-created item while letting their adapter supply populated bytes. */
export function createPopulatedManagedItem(
  kind: "document" | "sheet",
  createFile: () => Promise<string>,
): Promise<CreatedItem> {
  return createNewItem(
    {
      creator: { create: async () => ({ id: await createFile(), kind }) },
      presenter,
    },
    kind,
    { open: false },
  );
}

/** Register bytes created by a specialized adapter (for example a PDF export
 * and its editable Markdown source) with the shared refresh/Main/view policy. */
export async function registerPopulatedManagedItem(item: CreatedItem): Promise<CreatedItem> {
  await presenter.refresh();
  presenter.fileInMain(item);
  return item;
}

/** Open the shared name-first lane used by chooser cards, menus, and hotkeys.
 * The file creator remains unavailable until the dialog supplies a name. */
export function requestManagedBoardCreation(options: { newTab?: boolean } = {}): void {
  useUiStore.getState().setBoardCreationRequest({ newTab: options.newTab ?? false });
}

/** Create a populated board atomically while preserving the same Main/view
 * filing and presentation policy used by every other creation entry point.
 * `besideNoteId` (the maintainer, 2026-07-29: a converted diagram lands "in the same
 * path I am in") files the board beside that note — same Main folder, same
 * named view — instead of reading the ambient selection. */
export function createManagedBoardWithBody(
  body: string,
  name: string,
  options: {
    newTab?: boolean;
    open?: boolean;
    besideNoteId?: string;
    rootId?: string;
  } = {},
): Promise<CreatedItem> {
  const populatedBoardCreator: NewItemCreator = {
    async create() {
      // Chat/tool calls carry an explicit root capability. Do not re-read the
      // ambient sidebar selection after a long model run: it may now point at
      // another vault. `Storage` is a conventional lane and the Rust memex
      // adapter redirects it to storage/excalidraw.
      const folder = options.rootId
        ? options.rootId === "default"
          ? DEST.storage
          : `${options.rootId}:storage/excalidraw`
        : resolvedPhysicalFolder();
      const board = await corpusCreateBoard(folder, name, body);
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
