/**
 * Composition boundary for disposable document drafts. Presentation reports
 * explicit close intent and content mutations; this module joins that intent
 * to pane state, the managed-file lifecycle adapter, and Main's projection.
 */
import { evictDocument } from "../editor/model";
import { corpusDiscardBlank, corpusMoveFileToSink } from "../lib/tauri";
import { invalidateMemex } from "../memex/useMemex";
import { invalidateNotes } from "../services/hooks";
import { removeFromMain } from "../services/mainTree";
import { claimClosedNoteDrafts } from "../services/noteDrafts";
import { useMainStore } from "../state/main";
import { dropNavEntry } from "../state/navHistory";
import { findLeaf, keepTabsFor, leaves, tabsRightOf, usePanesStore } from "../state/panes";
import { removeQuickNote } from "../state/quick";
import { useUiStore } from "../state/ui";
import type { Tab } from "../types";
import { PristineDocumentDrafts } from "./draftLifecycle";
import { deleteParkedDocument, unregisterLiveDocument } from "./session";

const drafts = new PristineDocumentDrafts();

export function trackNewDocumentDraft(fileId: string): void {
  drafts.track(fileId);
}

export function markDocumentDraftChanged(fileId: string): void {
  drafts.markChanged(fileId);
  keepTabsFor(fileId); // an edited preview tab becomes a kept tab
}

function fileIdOf(tab: Tab | undefined): string | null {
  return tab?.surfaceKind === "file" ? tab.fileId : null;
}

function noteIdOf(tab: Tab | undefined): string | null {
  return tab?.surfaceKind === "note" ? tab.noteId : null;
}

function openFileIds(): string[] {
  return leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.flatMap((tab) => (tab.surfaceKind === "file" ? [tab.fileId] : [])),
  );
}

function openNoteIds(): string[] {
  return leaves(usePanesStore.getState().root).flatMap((leaf) =>
    leaf.tabs.flatMap((tab) => (tab.surfaceKind === "note" ? [tab.noteId] : [])),
  );
}

/** Hard-discard a blank note (the ephemeral-note lifecycle): evict the shared
 * buffer FIRST so the pending 400 ms sync can't resurrect the file, then let
 * Rust verify blankness and remove it — never into the in-app Trash. A Rust
 * refusal means content exists somewhere this session didn't see: keeping the
 * note is exactly right, so refusal is silent. */
export async function discardBlankNote(noteId: string): Promise<void> {
  evictDocument(noteId);
  try {
    await corpusDiscardBlank(noteId);
  } catch {
    return;
  }
  removeQuickNote(noteId);
  dropNavEntry(noteId); // Forward must never reopen a note that no longer exists
  const { manifest, setTree } = useMainStore.getState();
  setTree(removeFromMain(manifest.tree, noteId));
  await Promise.all([invalidateNotes(), invalidateMemex()]);
}

function discardClosedNoteCandidates(noteIds: string[]): void {
  for (const noteId of claimClosedNoteDrafts(noteIds, openNoteIds())) {
    void discardBlankNote(noteId);
  }
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
        `Couldn’t discard the untouched document — ${error instanceof Error ? error.message : String(error)}`,
      );
  }
}

function discardClosedCandidates(fileIds: string[]): void {
  for (const fileId of drafts.claimClosed(fileIds, openFileIds())) {
    void discardDocument(fileId);
  }
}

/** Close one explicit tab and discard a session-created document/note only if
 * this close actually removed its final tab and no content mutation ever
 * occurred. */
export function closeTabWithDraftCleanup(paneId: string, tabId: string): void {
  const panes = usePanesStore.getState();
  const tab = findLeaf(panes.root, paneId)?.tabs.find((t) => t.id === tabId);
  const fileId = fileIdOf(tab);
  const noteId = noteIdOf(tab);
  panes.closeTabById(paneId, tabId);
  if (fileId) discardClosedCandidates([fileId]);
  if (noteId) discardClosedNoteCandidates([noteId]);
}

export function closeOtherTabsWithDraftCleanup(paneId: string, keepTabId: string): void {
  const leaf = findLeaf(usePanesStore.getState().root, paneId);
  if (!leaf) return;
  for (const tab of leaf.tabs) {
    if (tab.id !== keepTabId) closeTabWithDraftCleanup(paneId, tab.id);
  }
}

/** "Close tabs to the right" — trims the session tail from the anchor onward
 * (the standard editor gesture; P0 sweep 2026-07-28). Same draft hygiene. */
export function closeTabsRightWithDraftCleanup(paneId: string, anchorTabId: string): void {
  const leaf = findLeaf(usePanesStore.getState().root, paneId);
  if (!leaf) return;
  for (const id of tabsRightOf(leaf, anchorTabId)) closeTabWithDraftCleanup(paneId, id);
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
  const noteIds = leaf.tabs.flatMap((tab) => (tab.surfaceKind === "note" ? [tab.noteId] : []));
  panes.closePane();
  discardClosedCandidates(fileIds);
  discardClosedNoteCandidates(noteIds);
}
