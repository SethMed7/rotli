// Tuck a playing browser tab into the sidebar player, and bring it back
// (2026-09-28). The tab leaves its pane but its page lives on, hidden: its
// surface skips the close (lib/privateBrowser.ts "retained"), and when the tab
// returns the new surface shows the same page instead of loading it again.

import {
  adoptPrivateBrowserTab,
  forgetPrivateBrowserTab,
  retainPrivateBrowserTab,
} from "../lib/privateBrowser";
import { privateBrowserClose, privateBrowserSetVisible } from "../lib/tauri";
import { forgetTabMedia } from "../state/ambient";
import { useMediaDock } from "../state/mediaDock";
import { usePanesStore } from "../state/panes";
import { findLeaf, leaves, updateLeaf } from "../state/paneTree";
import { useUiStore } from "../state/ui";

/** Tuck a browser tab into the player; false when one is already there or
 * the tab isn't open. */
export function tuckTab(tabId: string): boolean {
  if (useMediaDock.getState().tabId) return false;
  const leaf = leaves(usePanesStore.getState().root).find((l) =>
    l.tabs.some((tab) => tab.id === tabId && tab.surfaceKind === "browser"),
  );
  if (!leaf) return false;
  retainPrivateBrowserTab(tabId);
  useMediaDock.setState({ tabId });
  void privateBrowserSetVisible(tabId, false).catch(() => {});
  usePanesStore.getState().closeTabById(leaf.id, tabId, { record: false });
  return true;
}

/** The tucked tab back in the focused pane, as it was: same page, still playing. */
export function bringBackTab(): void {
  const tabId = useMediaDock.getState().tabId;
  if (!tabId) return;
  const ui = useUiStore.getState();
  ui.setSidebarMode("notes");
  if (useUiStore.getState().sidebarMode !== "notes") return; // Breve kept the mode
  ui.setContentView("panes");
  const panes = usePanesStore.getState();
  const leaf = findLeaf(panes.root, panes.focusedPaneId) ?? leaves(panes.root)[0];
  if (!leaf) return;
  usePanesStore.setState({
    root: updateLeaf(panes.root, leaf.id, (current) => ({
      ...current,
      tabs: [...current.tabs, { id: tabId, surfaceKind: "browser" }],
      activeTabId: tabId,
    })),
    focusedPaneId: leaf.id,
  });
  // the page stays retained until the new surface adopts it
  useMediaDock.setState({ tabId: null });
}

/** Close the tucked tab for good: its page goes, and its sound with it. */
export function closeTuckedTab(): void {
  const tabId = useMediaDock.getState().tabId;
  if (!tabId) return;
  adoptPrivateBrowserTab(tabId);
  void privateBrowserClose(tabId).catch(() => {});
  forgetPrivateBrowserTab(tabId);
  forgetTabMedia(tabId);
  useMediaDock.setState({ tabId: null });
}
