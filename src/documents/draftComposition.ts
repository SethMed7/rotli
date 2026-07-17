/**
 * Composition boundary for disposable document drafts. Presentation reports
 * explicit close intent and content mutations; this module joins that intent
 * to pane state, the managed-file lifecycle adapter, and Main's projection.
 */
import { corpusMoveFileToSink } from "../lib/tauri";
import { invalidateMemex } from "../memex/useMemex";
import { invalidateNotes } from "../services/hooks";
import { removeFromMain } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { Tab } from "../types";
import { deleteParkedDocument, unregisterLiveDocument } from "./session";
import { PristineDocumentDrafts } from "./draftLifecycle";

const drafts = new PristineDocumentDrafts();

export function trackNewDocumentDraft(fileId: string): void {
  drafts.track(fileId);
}

export function markDocumentDraftChanged(fileId: string): void {
  drafts.markChanged(fileId);
}

function fileIdOf(tab: Tab | undefined): string | null {
  return tab?.surfaceKind === "file" ? tab.fileId : null;
}

function openFileIds(): string[] {
  return leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.flatMap((tab) => (tab.surfaceKind === "file" ? [tab.fileId] : [])),
  );
}

async function discardDocument(fileId: string): Promise<void> {
  unregisterLiveDocument(fileId);
  deleteParkedDocument(fileId);
  try {
    await corpusMoveFileToSink(fileId, "Trash");
    const { manifest, setTree } = useMainStore.getState();
    setTree(removeFromMain(manifest.tree, fileId));
    await Promise.all([invalidateNotes(), invalidateMemex()]);
  } catch (error) {
    useUiStore
      .getState()
      .setRowActionError(
        `Couldn’t discard the untouched document — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
  }
}

function discardClosedCandidates(fileIds: string[]): void {
  for (const fileId of drafts.claimClosed(fileIds, openFileIds())) {
    void discardDocument(fileId);
  }
}

/** Close one explicit tab and discard a session-created document only if this
 * close actually removed its final tab and no content mutation ever occurred. */
export function closeTabWithDraftCleanup(paneId: string, tabId: string): void {
  const panes = usePanesStore.getState();
  const fileId = fileIdOf(findLeaf(panes.root, paneId)?.tabs.find((tab) => tab.id === tabId));
  panes.closeTabById(paneId, tabId);
  if (fileId) discardClosedCandidates([fileId]);
}

export function closeOtherTabsWithDraftCleanup(paneId: string, keepTabId: string): void {
  const leaf = findLeaf(usePanesStore.getState().root, paneId);
  if (!leaf) return;
  for (const tab of leaf.tabs) {
    if (tab.id !== keepTabId) closeTabWithDraftCleanup(paneId, tab.id);
  }
}

export function closeFocusedTabWithDraftCleanup(): void {
  const panes = usePanesStore.getState();
  const leaf = findLeaf(panes.root, panes.focusedPaneId) ?? leaves(panes.root)[0];
  if (leaf) closeTabWithDraftCleanup(leaf.id, leaf.activeTabId);
}

export function closeFocusedPaneWithDraftCleanup(): void {
  const panes = usePanesStore.getState();
  const leaf = findLeaf(panes.root, panes.focusedPaneId) ?? leaves(panes.root)[0];
  if (!leaf) return;
  const fileIds = leaf.tabs.flatMap((tab) => (tab.surfaceKind === "file" ? [tab.fileId] : []));
  panes.closePane();
  discardClosedCandidates(fileIds);
}
