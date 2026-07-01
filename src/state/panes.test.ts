// moveTab regression locks (audit CMP-1): the hit-test hands moveTab a VISUAL
// strip slot — an index that counts the dragged tab itself. The same-pane
// reorder must land the tab exactly where the preview line showed, in both
// directions. (Cross-pane moves are exercised via the same clamped-splice path.)

import { beforeEach, describe, expect, test } from "bun:test";
import type { LeafNode, Tab } from "../types";
import { findLeaf, usePanesStore } from "./panes";

const tab = (id: string): Tab => ({
  id,
  surfaceKind: "note",
  noteId: `n-${id}`,
  viewState: { cursor: 0, scroll: 0 },
});

const leaf = (id: string, tabIds: string[]): LeafNode => ({
  kind: "leaf",
  id,
  tabs: tabIds.map(tab),
  activeTabId: tabIds[0] ?? "",
});

const order = (paneId: string): string[] =>
  (findLeaf(usePanesStore.getState().root, paneId)?.tabs ?? []).map((t) => t.id);

describe("moveTab — same-pane reorder (visual-slot semantics)", () => {
  beforeEach(() => {
    usePanesStore.setState({ root: leaf("p1", ["A", "B", "C"]), focusedPaneId: "p1" });
  });

  test("rightward: dropping A on the line between B and C lands [B, A, C]", () => {
    // the preview line between B and C is visual slot 2 (A itself counted)
    usePanesStore.getState().moveTab("p1", "A", "p1", 2);
    expect(order("p1")).toEqual(["B", "A", "C"]);
  });

  test("rightward to the very end lands last", () => {
    usePanesStore.getState().moveTab("p1", "A", "p1", 3);
    expect(order("p1")).toEqual(["B", "C", "A"]);
  });

  test("leftward: dropping C on the line before A lands [C, A, B]", () => {
    usePanesStore.getState().moveTab("p1", "C", "p1", 0);
    expect(order("p1")).toEqual(["C", "A", "B"]);
  });

  test("dropping a tab on its own slot is a no-op", () => {
    usePanesStore.getState().moveTab("p1", "B", "p1", 1);
    expect(order("p1")).toEqual(["A", "B", "C"]);
    usePanesStore.getState().moveTab("p1", "B", "p1", 2); // the line after itself
    expect(order("p1")).toEqual(["A", "B", "C"]);
  });

  test("active tab rides along untouched", () => {
    usePanesStore.setState({ root: { ...leaf("p1", ["A", "B", "C"]), activeTabId: "A" } });
    usePanesStore.getState().moveTab("p1", "A", "p1", 3);
    expect(findLeaf(usePanesStore.getState().root, "p1")?.activeTabId).toBe("A");
  });
});
