// What an action run is aimed at, read imperatively (the hook forms are for
// components). Shared by ./actions.ts and the seams beside it.

import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";

/** Note chords stand down while Breve owns the content area. */
export const notesWorkspaceActive = (): boolean => useUiStore.getState().sidebarMode !== "breve";

/** The focused pane's active tab noteId. null when the pane has no resolvable
 * tab (the maintainer, 2026-06-13: the lifecycle chords target this note). */
export function focusedNoteIdNow(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  if (!leaf) return null;
  const tab = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
  return tab && tab.surfaceKind === "note" ? tab.noteId : null;
}
