import { beforeEach, describe, expect, test } from "bun:test";

import type { LeafNode, Tab } from "../types";
import { findLeaf, isPreviewTab, keepTabsFor, usePanesStore } from "./panes";

const tab = (id: string): Tab => ({ id, surfaceKind: "note", noteId: `n-${id}` });

const leaf = (id: string, tabIds: string[]): LeafNode => ({
  kind: "leaf",
  id,
  tabs: tabIds.map(tab),
  activeTabId: tabIds[0] ?? "",
});

// preview tabs (the maintainer, 2026-07-28: "every click shouldn't open a new tab") —
// browsing reuses ONE preview tab; re-clicking the same item keeps it; edits
// keep it; ⌘T still appends a permanent tab.
describe("preview tabs", () => {
  beforeEach(() => {
    usePanesStore.setState({ root: leaf("p1", ["A"]), focusedPaneId: "p1" });
  });

  test("clicking through notes reuses the one preview tab", () => {
    usePanesStore.getState().openNote("n-B"); // appends a PREVIEW tab
    usePanesStore.getState().openNote("n-C"); // replaces it in place
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(2);
    const previews = pane?.tabs.filter(isPreviewTab) ?? [];
    expect(previews).toHaveLength(1);
    expect(previews[0]?.surfaceKind === "note" && previews[0].noteId).toBe("n-C");
  });

  test("clicking the item shown in the preview tab again KEEPS it", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openNote("n-B"); // click it again → permanent
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.some(isPreviewTab)).toBe(false);
    usePanesStore.getState().openNote("n-C"); // next browse gets a NEW preview
    expect(findLeaf(usePanesStore.getState().root, "p1")?.tabs).toHaveLength(3);
  });

  test("an edit keeps the preview tab wherever the item is open", () => {
    usePanesStore.getState().openNote("n-B");
    keepTabsFor("n-B");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.some(isPreviewTab)).toBe(false);
  });

  test("⌘T / ⌘-click appends a permanent tab and leaves the preview alone", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openNote("n-C", { newTab: true });
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(3);
    expect(pane?.tabs.filter(isPreviewTab)).toHaveLength(1); // n-B stays preview
  });

  test("boards and files browse through the same preview slot as notes", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openCanvas("storage/plan.excalidraw");
    usePanesStore.getState().openFile("storage/ref.pdf");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(2); // A + the one preview slot
    const preview = pane?.tabs.find(isPreviewTab);
    expect(preview?.surfaceKind).toBe("file");
  });

  test("chat and activity always open as kept tabs", () => {
    usePanesStore.getState().openChat("c-1");
    usePanesStore.getState().openActivity();
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.map((t) => t.surfaceKind)).toEqual(["note", "chat", "activity"]);
    expect(pane?.tabs.some(isPreviewTab)).toBe(false);
  });
});
