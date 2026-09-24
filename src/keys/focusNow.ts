// What an action run is aimed at, read imperatively (the hook forms are for
// components). Shared by ./actions.ts and the seams beside it.

import { windowSurface } from "../state/chatWindowStore";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";

/** The Quick Note window has no pane tree: its one editor registers under
 * this pane id, and "the focused note" there is the note it has open. */
export const QUICK_PANE_ID = "quick";

/** This webview is the Quick Note window — read from the window itself, with
 * the pinned pane id as the fallback. */
export const inQuickWindow = (): boolean =>
  windowSurface() === "quick" || usePanesStore.getState().focusedPaneId === QUICK_PANE_ID;

/** Note chords stand down while Breve owns the content area (main only —
 * the Quick Note window is always a note). */
export const notesWorkspaceActive = (): boolean =>
  inQuickWindow() || useUiStore.getState().sidebarMode !== "breve";

/** The focused pane's active tab noteId — or, in the Quick Note window, its
 * open note. null when there is no resolvable note (the maintainer,
 * 2026-06-13: the lifecycle chords target this note). */
export function focusedNoteIdNow(): string | null {
  if (inQuickWindow()) return useUiStore.getState().quickActiveId;
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  if (!leaf) return null;
  const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
  return tab && tab.surfaceKind === "note" ? tab.noteId : null;
}
