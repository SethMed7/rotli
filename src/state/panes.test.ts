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

// The standard editor open model (Seth, 2026-07-03): clicking a file in the
// sidebar ACTIVATES its open tab if there is one, else opens a NEW tab — it must
// never REPLACE the tab you're working in. ⌘-click / ⌘T force a fresh tab.
describe("openNote — reuse-or-new-tab, never replace", () => {
  const count = (paneId: string): number => findLeaf(usePanesStore.getState().root, paneId)?.tabs.length ?? 0;
  const activeNoteId = (paneId: string): string | null => {
    const l = findLeaf(usePanesStore.getState().root, paneId);
    const t = l?.tabs.find((x) => x.id === l.activeTabId);
    return t && t.surfaceKind === "note" ? t.noteId : null;
  };

  beforeEach(() => {
    // one open tab, note "n-A" (the leaf helper builds noteId = `n-${id}`)
    usePanesStore.setState({ root: leaf("p1", ["A"]), focusedPaneId: "p1" });
  });

  test("opening a DIFFERENT file opens a new tab (never replaces the current one)", () => {
    usePanesStore.getState().openNote("n-B");
    expect(count("p1")).toBe(2);
    expect(activeNoteId("p1")).toBe("n-B");
  });

  test("opening an ALREADY-open file activates its tab and adds none", () => {
    usePanesStore.getState().openNote("n-B"); // → tabs n-A, n-B
    usePanesStore.getState().openNote("n-A"); // click the already-open n-A
    expect(count("p1")).toBe(2);
    expect(activeNoteId("p1")).toBe("n-A");
  });

  test("clicking the current file again is a no-op (stays put)", () => {
    usePanesStore.getState().openNote("n-A");
    expect(count("p1")).toBe(1);
    expect(activeNoteId("p1")).toBe("n-A");
  });

  test("⌘-click / newTab forces a fresh tab even when the file is already open", () => {
    usePanesStore.getState().openNote("n-A", { newTab: true });
    expect(count("p1")).toBe(2);
    expect(activeNoteId("p1")).toBe("n-A");
  });

  test("an embedded file's Open in tab action adds a file tab without replacing the note", () => {
    usePanesStore.getState().openFile("storage/rotli/sample.docx", { newTab: true });
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(2);
    expect(pane?.tabs[0]?.surfaceKind).toBe("note");
    const active = pane?.tabs.find((tab) => tab.id === pane.activeTabId);
    expect(active?.surfaceKind).toBe("file");
    if (active?.surfaceKind === "file") expect(active.fileId).toBe("storage/rotli/sample.docx");
  });

  test("fills the pristine startup placeholder (empty noteId) — no ghost tab", () => {
    // the real fs app boots with one note tab whose target is "" (initialNoteId)
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [{ id: "seed", surfaceKind: "note", noteId: "", viewState: { cursor: 0, scroll: 0 } }],
        activeTabId: "seed",
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().openNote("n-fresh");
    expect(count("p1")).toBe(1); // filled the placeholder, did NOT append
    expect(activeNoteId("p1")).toBe("n-fresh");
  });
});

describe("closeFileTabs — remove a trashed asset from every pane", () => {
  const fileTab = (id: string, fileId: string): Tab => ({
    id,
    surfaceKind: "file",
    fileId,
    viewState: { cursor: 0, scroll: 0 },
  });

  test("closes every matching file tab and preserves unrelated work", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [
          tab("A"),
          fileTab("doc-1", "storage/rotli/sample.docx"),
          fileTab("doc-2", "storage/rotli/sample.docx"),
        ],
        activeTabId: "doc-2",
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeFileTabs("storage/rotli/sample.docx");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.map((item) => item.id)).toEqual(["A"]);
    expect(pane?.activeTabId).toBe("A");
  });

  test("replaces the final file tab with a pristine note placeholder", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [fileTab("doc", "storage/rotli/sample.docx")],
        activeTabId: "doc",
      },
      focusedPaneId: "p1",
    });
    usePanesStore.getState().closeFileTabs("storage/rotli/sample.docx");
    const [remaining] = findLeaf(usePanesStore.getState().root, "p1")?.tabs ?? [];
    expect(remaining?.surfaceKind).toBe("note");
    if (remaining?.surfaceKind === "note") expect(remaining.noteId).toBe("");
  });
});
