// Drop a sidebar note onto the panes, "just like I would with different tabs".
// The hit test is the tab drag's own (lib/tabDrag.panePreviewAt), so the pane
// paints the same dropzones; the commit opens the note as a new tab in that
// pane (its strip or center) or carves a split on an edge through the
// tab-detach path.

import { type DropPreview, leaves, usePanesStore } from "../state/panes";

/** Open `noteId` where the preview points: a new tab in that pane, or a new
 * split on its edge. A lone tab in an empty pane stays put on an edge drop. */
export function commitPaneDrop(noteId: string, preview: DropPreview): void {
  if (!preview) return;
  const leafId = preview.kind === "strip" ? preview.paneId : preview.leafId;
  const store = usePanesStore.getState();
  store.focusPane(leafId);
  store.openNote(noteId, { newTab: true });
  if (preview.kind === "strip" || preview.zone === "center") return;
  const leaf = leaves(usePanesStore.getState().root).find((pane) => pane.id === leafId);
  const tab = leaf?.tabs.find((candidate) => candidate.surfaceKind === "note" && candidate.noteId === noteId);
  if (tab) usePanesStore.getState().detachTab(leafId, tab.id, leafId, preview.zone);
}
