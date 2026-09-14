import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { LeafNode, PaneNode } from "../types";
import { findLeaf, usePanesStore } from "./panes";
import { useUiStore } from "./ui";

const leaf = (id: string, tabIds: string[]): LeafNode => ({
  kind: "leaf",
  id,
  tabs: tabIds.map((tabId) => ({ id: tabId, surfaceKind: "note", noteId: `note-${tabId}` })),
  activeTabId: tabIds[0] ?? "",
});
const tabIds = (paneId: string): string[] =>
  (findLeaf(usePanesStore.getState().root, paneId)?.tabs ?? []).map((t) => t.id);

// The System browser (contentView "system") replaces the pane tree. Every tab
// or pane chord must bring the panes back — otherwise ⌘W, ⌘1-9, ⌃Tab, ⌘D and
// ⌘⌥W fire against tabs nobody can see.
describe("tab and pane chords leave the System browser", () => {
  const two = (): PaneNode => ({
    kind: "split",
    id: "s",
    dir: "row",
    children: [leaf("p1", ["A", "B"]), leaf("p2", ["C"])],
    sizes: [0.5, 0.5],
  });
  const showSystem = () => useUiStore.setState({ contentView: "system" });
  const view = () => useUiStore.getState().contentView;
  beforeEach(() => {
    Object.assign(window, { innerWidth: 4000, innerHeight: 4000 });
    usePanesStore.setState({ root: two(), focusedPaneId: "p1", closedTabs: [] });
    showSystem();
  });
  afterEach(() => useUiStore.setState({ contentView: "panes" }));

  test("activateTab and cycleTab (⌘1-9, ⌃Tab)", () => {
    usePanesStore.getState().activateTab("p1", "B");
    expect(view()).toBe("panes");
    showSystem();
    usePanesStore.getState().cycleTab(1);
    expect(view()).toBe("panes");
  });

  test("closeTabById then reopenClosedTab (⌘W, ⌘⇧T)", () => {
    usePanesStore.getState().closeTabById("p1", "B");
    expect(view()).toBe("panes");
    showSystem();
    usePanesStore.getState().reopenClosedTab();
    expect(view()).toBe("panes");
  });

  test("splitRight and splitDown (⌘D, ⌘⇧D)", () => {
    usePanesStore.getState().splitRight();
    expect(view()).toBe("panes");
    showSystem();
    usePanesStore.getState().splitDown();
    expect(view()).toBe("panes");
  });

  test("closePane (⌘⌥W)", () => {
    usePanesStore.getState().closePane();
    expect(view()).toBe("panes");
  });

  test("a no-op chord (nothing to reopen) leaves the System browser showing", () => {
    usePanesStore.getState().reopenClosedTab();
    expect(view()).toBe("system");
  });

  test("trashing an open asset from the System browser force-closes its tab without leaving", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [leaf("x", ["A"]).tabs[0]!, { id: "f", surfaceKind: "file", fileId: "storage/x.pdf" }],
        activeTabId: "A",
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeFileTabs("storage/x.pdf");
    expect(tabIds("p1")).toEqual(["A"]);
    expect(view()).toBe("system");
  });
});
