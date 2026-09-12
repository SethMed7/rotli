import { beforeEach, describe, expect, test } from "bun:test";

import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { commitPaneDrop } from "./paneDropDrag";

const noteIds = (paneId: string): string[] =>
  (findLeaf(usePanesStore.getState().root, paneId)?.tabs ?? []).map((t) =>
    t.surfaceKind === "note" ? t.noteId : t.surfaceKind,
  );

describe("commitPaneDrop — a sidebar note lands on a pane", () => {
  beforeEach(() => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [{ id: "A", surfaceKind: "note", noteId: "n-A" }],
        activeTabId: "A",
      },
      focusedPaneId: "p1",
      draggingTab: null,
      dropPreview: null,
    });
    (globalThis as { window?: unknown }).window ??= {};
    (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 2400;
    (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 1400;
  });

  test("the pane center or its strip opens the note as a new tab in THAT pane", () => {
    commitPaneDrop("n-B", { kind: "zone", leafId: "p1", zone: "center" });
    commitPaneDrop("n-C", { kind: "strip", paneId: "p1", index: 0 });
    expect(noteIds("p1")).toEqual(["n-A", "n-B", "n-C"]);
    expect(leaves(usePanesStore.getState().root)).toHaveLength(1);
  });

  test("a pane edge carves a split that holds only the dropped note", () => {
    commitPaneDrop("n-B", { kind: "zone", leafId: "p1", zone: "right" });
    const panes = leaves(usePanesStore.getState().root);
    expect(panes).toHaveLength(2);
    expect(noteIds("p1")).toEqual(["n-A"]);
    expect(noteIds(panes[1]?.id ?? "")).toEqual(["n-B"]);
  });

  test("nothing happens off the panes", () => {
    commitPaneDrop("n-B", null);
    expect(noteIds("p1")).toEqual(["n-A"]);
  });
});
