import { describe, expect, test } from "bun:test";

import type { Tab } from "../types";
import { findLeaf, usePanesStore } from "./panes";

const tab = (id: string): Tab => ({ id, surfaceKind: "note", noteId: `n-${id}` });

// Round Three 2026-09-26: a trashed note keeps its id, so its tab kept
// resolving. Trash closes it like a trashed file, in every pane.
describe("closeNoteTabs — remove a trashed note from every pane", () => {
  test("closes the note's tabs in every pane and preserves unrelated work", () => {
    usePanesStore.setState({
      root: {
        kind: "split",
        id: "s1",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [
          { kind: "leaf", id: "p1", tabs: [tab("A"), tab("B")], activeTabId: "B" },
          {
            kind: "leaf",
            id: "p2",
            tabs: [tab("C"), { id: "B2", surfaceKind: "note", noteId: "n-B" }],
            activeTabId: "B2",
          },
        ],
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeNoteTabs("n-B");
    const root = usePanesStore.getState().root;
    expect(findLeaf(root, "p1")?.tabs.map((item) => item.id)).toEqual(["A"]);
    expect(findLeaf(root, "p2")?.tabs.map((item) => item.id)).toEqual(["C"]);
  });

  test("replaces the final note tab with a pristine placeholder", () => {
    usePanesStore.setState({
      root: { kind: "leaf", id: "p1", tabs: [tab("A")], activeTabId: "A" },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeNoteTabs("n-A");
    const [remaining] = findLeaf(usePanesStore.getState().root, "p1")?.tabs ?? [];
    expect(remaining?.surfaceKind).toBe("note");
    if (remaining?.surfaceKind === "note") expect(remaining.noteId).toBe("");
  });

  test("a trashed board's canvas tab closes too (its id changes in Trash)", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [tab("A"), { id: "board", surfaceKind: "canvas", boardId: "wiki/plan.excalidraw" }],
        activeTabId: "board",
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeNoteTabs("wiki/plan.excalidraw");
    expect(findLeaf(usePanesStore.getState().root, "p1")?.tabs.map((item) => item.id)).toEqual(["A"]);
  });

  test("only the trashed note's tabs close", () => {
    usePanesStore.setState({
      root: { kind: "leaf", id: "p1", tabs: [tab("A"), tab("B")], activeTabId: "A" },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeNoteTabs("n-missing");
    expect(findLeaf(usePanesStore.getState().root, "p1")?.tabs.map((item) => item.id)).toEqual(["A", "B"]);
  });
});
