// moveTab regression locks (audit CMP-1): the hit-test hands moveTab a VISUAL
// strip slot — an index that counts the dragged tab itself. The same-pane
// reorder must land the tab exactly where the preview line showed, in both
// directions. (Cross-pane moves are exercised via the same clamped-splice path.)

import { beforeEach, describe, expect, test } from "bun:test";

import type { LeafNode, PaneNode, Tab } from "../types";
import { useNavHistory } from "./navHistory";
import {
  activeTabOf,
  boardTabOpen,
  clampSplitSizes,
  fileTabOpen,
  findLeaf,
  leaves,
  openNavTarget,
  sidebarItemId,
  tabsRightOf,
  usePanesStore,
  keepTabsFor,
} from "./panes";

const tab = (id: string): Tab => ({
  id,
  surfaceKind: "note",
  noteId: `n-${id}`,
});

const leaf = (id: string, tabIds: string[]): LeafNode => ({
  kind: "leaf",
  id,
  tabs: tabIds.map(tab),
  activeTabId: tabIds[0] ?? "",
});

const order = (paneId: string): string[] =>
  (findLeaf(usePanesStore.getState().root, paneId)?.tabs ?? []).map((t) => t.id);

describe("sidebarItemId — every content surface can light its sidebar row", () => {
  test("returns the durable item id for notes, boards, and surfaced files", () => {
    expect(sidebarItemId(tab("note"))).toBe("n-note");
    expect(
      sidebarItemId({
        id: "board-tab",
        surfaceKind: "canvas",
        boardId: "storage/plan.excalidraw",
      }),
    ).toBe("storage/plan.excalidraw");
    expect(
      sidebarItemId({
        id: "file-tab",
        surfaceKind: "file",
        fileId: "storage/reference.pdf",
      }),
    ).toBe("storage/reference.pdf");
  });

  test("meta surfaces do not claim a content row", () => {
    expect(sidebarItemId(null)).toBeNull();
    expect(
      sidebarItemId({
        id: "activity-tab",
        surfaceKind: "activity",
      }),
    ).toBeNull();
  });
});

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
        tabs: [{ id: "seed", surfaceKind: "note", noteId: "" }],
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

// paper-cut sweep 2026-07-27 (#6/#7): every content surface enters the
// Back/Forward trail (Activity stays out — the same meta-surface rule as
// sidebarItemId), and replay reuses an open tab in ANY pane instead of
// spawning a duplicate in whichever pane happens to hold focus.
describe("the nav trail records every content surface", () => {
  beforeEach(() => {
    usePanesStore.setState({ root: leaf("p1", ["A"]), focusedPaneId: "p1" });
    useNavHistory.setState({ stack: [], index: -1, suppress: false });
  });

  test("openCanvas records a canvas: entry", () => {
    usePanesStore.getState().openCanvas("storage/plan.excalidraw");
    expect(useNavHistory.getState().stack).toEqual(["canvas:storage/plan.excalidraw"]);
  });

  test("openFile records a file: entry", () => {
    usePanesStore.getState().openFile("storage/ref.pdf");
    expect(useNavHistory.getState().stack).toEqual(["file:storage/ref.pdf"]);
  });

  test("openChat records saved chats; a fresh null chat records nothing", () => {
    usePanesStore.getState().openChat(null);
    expect(useNavHistory.getState().stack).toEqual([]);
    usePanesStore.getState().openChat("daily");
    expect(useNavHistory.getState().stack).toEqual(["chat:daily"]);
  });

  test("bindChat records the newly-bound slug (the fresh chat gained identity)", () => {
    usePanesStore.getState().openChat(null);
    const tabId = findLeaf(usePanesStore.getState().root, "p1")!.activeTabId;
    usePanesStore.getState().bindChat("p1", tabId, "fresh-chat");
    expect(useNavHistory.getState().stack).toEqual(["chat:fresh-chat"]);
  });

  test("bindChat targets the sending tab even when another tab became active", () => {
    usePanesStore.getState().openChat(null);
    const sendingTabId = findLeaf(usePanesStore.getState().root, "p1")!.activeTabId;
    usePanesStore.getState().openChat(null);
    const activeTabId = findLeaf(usePanesStore.getState().root, "p1")!.activeTabId;

    usePanesStore.getState().bindChat("p1", sendingTabId, "first-chat");

    const pane = findLeaf(usePanesStore.getState().root, "p1")!;
    expect(pane.activeTabId).toBe(activeTabId);
    expect(pane.tabs.find((tab) => tab.id === sendingTabId)).toMatchObject({
      surfaceKind: "chat",
      chatSlug: "first-chat",
    });
    expect(pane.tabs.find((tab) => tab.id === activeTabId)).toMatchObject({
      surfaceKind: "chat",
      chatSlug: null,
    });
  });

  test("openActivity records nothing (meta surface)", () => {
    usePanesStore.getState().openActivity();
    expect(useNavHistory.getState().stack).toEqual([]);
  });

  test("closeFileTabs drops the file's trail entries (the file left the corpus)", () => {
    usePanesStore.getState().openFile("storage/gone.pdf");
    expect(useNavHistory.getState().stack).toEqual(["file:storage/gone.pdf"]);
    usePanesStore.getState().closeFileTabs("storage/gone.pdf");
    expect(useNavHistory.getState().stack).toEqual([]);
  });

  test("retargetNote / retargetChat / retargetBoard follow renames into the trail", () => {
    useNavHistory.setState({
      stack: ["wiki/_inbox/foo.md", "chat:old-slug", "canvas:old.excalidraw"],
      index: 2,
      suppress: false,
    });
    usePanesStore.getState().retargetNote("wiki/_inbox/foo.md", "wiki/projects/foo.md");
    usePanesStore.getState().retargetChat("old-slug", "new-slug");
    usePanesStore.getState().retargetBoard("old.excalidraw", "new.excalidraw");
    expect(useNavHistory.getState().stack).toEqual([
      "wiki/projects/foo.md",
      "chat:new-slug",
      "canvas:new.excalidraw",
    ]);
  });
});

describe("activateSurface + openNavTarget — replay reuses open tabs anywhere", () => {
  const twoPanes = (): void => {
    usePanesStore.setState({
      root: {
        kind: "split",
        id: "s1",
        dir: "row",
        children: [leaf("p1", ["A"]), leaf("p2", ["B"])],
        sizes: [0.5, 0.5],
      },
      focusedPaneId: "p1",
    });
    useNavHistory.setState({ stack: [], index: -1, suppress: false });
  };

  beforeEach(twoPanes);

  test("focuses the pane already showing the surface and adds no tab", () => {
    // note n-B lives in pane 2; pane 1 is focused
    expect(usePanesStore.getState().activateSurface("note", "n-B")).toBe(true);
    expect(usePanesStore.getState().focusedPaneId).toBe("p2");
    expect(order("p1")).toEqual(["A"]);
    expect(order("p2")).toEqual(["B"]);
  });

  test("returns false when the surface is nowhere open", () => {
    expect(usePanesStore.getState().activateSurface("note", "n-ZZ")).toBe(false);
    expect(usePanesStore.getState().focusedPaneId).toBe("p1");
  });

  test("openNavTarget prefers the existing tab over opening a duplicate", () => {
    openNavTarget("n-B");
    expect(usePanesStore.getState().focusedPaneId).toBe("p2");
    expect(order("p1")).toEqual(["A"]); // no duplicate tab spawned in pane 1
  });

  test("openNavTarget falls back to the right opener per kind", () => {
    openNavTarget("canvas:storage/plan.excalidraw");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    const active = pane?.tabs.find((t) => t.id === pane.activeTabId);
    expect(active?.surfaceKind).toBe("canvas");
  });
});

// P0 sweep 2026-07-28: Activity must APPEND like every surface (it was the one
// opener that mutated the active tab in place, eating the note you were on),
// Ctrl+Shift+Tab cycles backward, and "Close tabs to the right" needs a pure
// answer for which tabs fall.
describe("openActivity appends, never replaces", () => {
  beforeEach(() => {
    usePanesStore.setState({ root: leaf("p1", ["A"]), focusedPaneId: "p1" });
  });

  test("opening Activity keeps the note tab and adds an activity tab", () => {
    usePanesStore.getState().openActivity();
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.map((t) => t.surfaceKind)).toEqual(["note", "activity"]);
    expect(pane?.tabs.find((t) => t.id === pane.activeTabId)?.surfaceKind).toBe("activity");
  });

  test("a second open activates the existing Activity tab, adding none", () => {
    usePanesStore.getState().openActivity();
    usePanesStore.getState().activateTab("p1", "A");
    usePanesStore.getState().openActivity();
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.length).toBe(2);
    expect(pane?.tabs.find((t) => t.id === pane.activeTabId)?.surfaceKind).toBe("activity");
  });
});

describe("cycleTab walks both directions", () => {
  beforeEach(() => {
    usePanesStore.setState({ root: leaf("p1", ["A", "B", "C"]), focusedPaneId: "p1" });
  });

  test("backward from the first tab wraps to the last", () => {
    usePanesStore.getState().cycleTab(-1);
    expect(findLeaf(usePanesStore.getState().root, "p1")?.activeTabId).toBe("C");
  });

  test("forward still wraps front-to-back", () => {
    usePanesStore.getState().activateTab("p1", "C");
    usePanesStore.getState().cycleTab(1);
    expect(findLeaf(usePanesStore.getState().root, "p1")?.activeTabId).toBe("A");
  });
});

describe("tabsRightOf", () => {
  test("returns the ids strictly after the anchor, in strip order", () => {
    const l = leaf("p1", ["A", "B", "C", "D"]);
    expect(tabsRightOf(l, "B")).toEqual(["C", "D"]);
    expect(tabsRightOf(l, "D")).toEqual([]);
    expect(tabsRightOf(l, "zz")).toEqual([]);
  });
});

// boards slice 2026-07-28: while a board's own canvas tab is open anywhere,
// the ```board embed goes view-only — two live savers on one file silently
// overwrote each other's strokes.
describe("boardTabOpen", () => {
  test("sees a canvas tab for the board in any pane", () => {
    const root: PaneNode = {
      kind: "split",
      id: "s",
      dir: "row",
      children: [
        leaf("p1", ["A"]),
        {
          kind: "leaf",
          id: "p2",
          tabs: [
            {
              id: "c",
              surfaceKind: "canvas",
              boardId: "storage/plan.excalidraw",
            },
          ],
          activeTabId: "c",
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(boardTabOpen(root, "storage/plan.excalidraw")).toBe(true);
    expect(boardTabOpen(root, "storage/other.excalidraw")).toBe(false);
  });
});

// The chat-note split repro (Seth, 2026-07-30: "only the note should open to a
// new pane, not duplicate the chat"): splitting to the side must carve the new
// pane WITH exactly the passed tab — splitRight() alone duplicates the active
// tab, which is what put a chat copy beside the opened note.
describe("openToSide carves a pane holding ONLY the passed item", () => {
  beforeEach(() => {
    // bun's window has no layout — give the column-fit guard a wide viewport
    (window as { innerWidth: number }).innerWidth = 2400;
    const l = leaf("solo", ["A"]);
    usePanesStore.setState({ root: l, focusedPaneId: "solo" });
  });

  test("a note opens alone beside a chat tab — no duplicate of the source tab", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "solo",
        tabs: [{ id: "c", surfaceKind: "chat", chatSlug: "testing-gemma" }],
        activeTabId: "c",
      },
      focusedPaneId: "solo",
    });
    usePanesStore.getState().openToSide("note", "n-1");
    const all = leaves(usePanesStore.getState().root);
    expect(all).toHaveLength(2);
    const newPane = all.find((l) => l.id !== "solo")!;
    expect(newPane.tabs).toHaveLength(1);
    expect(newPane.tabs[0]).toMatchObject({ surfaceKind: "note", noteId: "n-1" });
  });

  test("a chat opens to the side as a chat tab (the row menu's Open to the right)", () => {
    usePanesStore.getState().openToSide("chat", "analyzing-why");
    const all = leaves(usePanesStore.getState().root);
    expect(all).toHaveLength(2);
    const newPane = all.find((l) => l.id !== "solo")!;
    expect(newPane.tabs).toHaveLength(1);
    expect(newPane.tabs[0]).toMatchObject({ surfaceKind: "chat", chatSlug: "analyzing-why" });
  });

  test("no room for a column → the item still opens HERE as a new tab (never a dead click)", () => {
    // a window too narrow for a second 320px pane (adversarial review, PR #15:
    // the refused split used to swallow the click AND record a phantom nav entry)
    (window as { innerWidth: number }).innerWidth = 500;
    usePanesStore.getState().openToSide("note", "n-2");
    const all = leaves(usePanesStore.getState().root);
    expect(all).toHaveLength(1);
    const pane = all[0]!;
    expect(pane.tabs.some((t) => t.surfaceKind === "note" && t.noteId === "n-2")).toBe(true);
    expect(pane.activeTabId).toBe(pane.tabs.find((t) => t.surfaceKind === "note" && t.noteId === "n-2")!.id);
  });
});

// audit 2026-07-30 correctness #2: the same dual-writer law for sheets — while
// a file's tab is open anywhere, the ```sheet embed goes view-only.
describe("fileTabOpen", () => {
  test("sees a file tab for the sheet in any pane", () => {
    const root: PaneNode = {
      kind: "split",
      id: "s",
      dir: "row",
      children: [
        leaf("p1", ["A"]),
        {
          kind: "leaf",
          id: "p2",
          tabs: [{ id: "f", surfaceKind: "file", fileId: "storage/budget.xlsx" }],
          activeTabId: "f",
        },
      ],
      sizes: [0.5, 0.5],
    };
    expect(fileTabOpen(root, "storage/budget.xlsx")).toBe(true);
    expect(fileTabOpen(root, "storage/other.xlsx")).toBe(false);
    // a note tab on the same id never counts — only file surfaces own the pen
    const noteLeaf: LeafNode = {
      kind: "leaf",
      id: "p3",
      tabs: [{ id: "n", surfaceKind: "note", noteId: "storage/budget.xlsx" }],
      activeTabId: "n",
    };
    expect(fileTabOpen(noteLeaf, "storage/budget.xlsx")).toBe(false);
  });
});

// slice 4 (2026-07-28): closing a pane must not discard your working set —
// its tabs MERGE into the geometric neighbor; an accidental ⌘W is undone by
// ⌘⇧T (a session closed-tab stack); and "open to the side" splits with the
// TARGET, never a duplicate of what you're on.
describe("closePane merges tabs into the neighbor", () => {
  test("the closing pane's tabs land in the neighbor and its active tab stays active", () => {
    usePanesStore.setState({
      root: {
        kind: "split",
        id: "s",
        dir: "row",
        children: [leaf("p1", ["A"]), leaf("p2", ["B", "C"])],
        sizes: [0.5, 0.5],
      },
      focusedPaneId: "p2",
    });
    usePanesStore.getState().closePane();
    const remaining = leaves(usePanesStore.getState().root);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.tabs.map((t) => t.id)).toEqual(["A", "B", "C"]);
    expect(remaining[0]?.activeTabId).toBe("B"); // what you were looking at survives
  });
});

describe("the closed-tab stack (⌘⇧T)", () => {
  beforeEach(() => {
    usePanesStore.setState({
      root: leaf("p1", ["A", "B", "C"]),
      focusedPaneId: "p1",
      closedTabs: [],
    });
  });

  test("⌘W then reopen restores the tab at its old slot", () => {
    usePanesStore.getState().closeTabById("p1", "B");
    expect(order("p1")).toEqual(["A", "C"]);
    usePanesStore.getState().reopenClosedTab();
    expect(order("p1")).toEqual(["A", "B", "C"]);
    expect(findLeaf(usePanesStore.getState().root, "p1")?.activeTabId).toBe("B");
  });

  test("reopen with an empty stack is a quiet no-op", () => {
    usePanesStore.getState().reopenClosedTab();
    expect(order("p1")).toEqual(["A", "B", "C"]);
  });

  test("a trashed file's force-closed tabs are NOT reopenable (the target is gone)", () => {
    usePanesStore.setState({
      root: {
        kind: "leaf",
        id: "p1",
        tabs: [tab("A"), { id: "doc", surfaceKind: "file", fileId: "storage/x.pdf" }],
        activeTabId: "A",
      },
      focusedPaneId: "p1",
      closedTabs: [],
    });
    usePanesStore.getState().closeFileTabs("storage/x.pdf");
    expect(usePanesStore.getState().closedTabs).toHaveLength(0);
  });
});

// Seth, 2026-07-28: "I should be able to close all tabs and have an empty
// state" — the lone pane may go EMPTY instead of silently refusing the close.
describe("closing the last tab of the lone pane", () => {
  beforeEach(() => {
    usePanesStore.setState({
      root: leaf("p1", ["A"]),
      focusedPaneId: "p1",
      closedTabs: [],
    });
  });

  test("empties the pane instead of no-oping, and ⌘⇧T brings the tab back", () => {
    usePanesStore.getState().closeTabById("p1", "A");
    const l = findLeaf(usePanesStore.getState().root, "p1");
    expect(l?.tabs).toEqual([]);
    expect(activeTabOf(l!)).toBeNull();
    usePanesStore.getState().reopenClosedTab();
    expect(order("p1")).toEqual(["A"]);
    expect(findLeaf(usePanesStore.getState().root, "p1")?.activeTabId).toBe("A");
  });

  test("opening a note into the empty pane starts a fresh tab", () => {
    usePanesStore.getState().closeTabById("p1", "A");
    usePanesStore.getState().openNote("n-new");
    const l = findLeaf(usePanesStore.getState().root, "p1");
    expect(l?.tabs).toHaveLength(1);
    expect(activeTabOf(l!)?.surfaceKind).toBe("note");
  });

  test("⌘W on the already-empty pane stays a quiet no-op", () => {
    usePanesStore.getState().closeTabById("p1", "A");
    usePanesStore.getState().closeTab();
    const l = findLeaf(usePanesStore.getState().root, "p1");
    expect(l?.tabs).toEqual([]);
    expect(usePanesStore.getState().closedTabs).toHaveLength(1); // only the real close recorded
  });
});

describe("openToSide", () => {
  test("splits right with the TARGET note — no duplicate of the current tab", () => {
    // the split-time floor check reads window metrics — give it room
    (window as unknown as { innerWidth: number }).innerWidth = 2000;
    usePanesStore.setState({ root: leaf("p1", ["A"]), focusedPaneId: "p1" });
    usePanesStore.getState().openToSide("note", "n-B");
    const all = leaves(usePanesStore.getState().root);
    expect(all).toHaveLength(2);
    const fresh = all.find((l) => l.id !== "p1");
    expect(fresh?.tabs).toHaveLength(1);
    const t = fresh?.tabs[0];
    expect(t?.surfaceKind).toBe("note");
    if (t?.surfaceKind === "note") expect(t.noteId).toBe("n-B");
    expect(usePanesStore.getState().focusedPaneId).toBe(fresh?.id ?? "missing");
  });
});

// preview tabs (Seth, 2026-07-28: "every click shouldn't open a new tab") —
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
    const previews = pane?.tabs.filter((t) => t.preview) ?? [];
    expect(previews).toHaveLength(1);
    expect(previews[0]?.surfaceKind === "note" && previews[0].noteId).toBe("n-C");
  });

  test("clicking the item shown in the preview tab again KEEPS it", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openNote("n-B"); // click it again → permanent
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.some((t) => t.preview)).toBe(false);
    usePanesStore.getState().openNote("n-C"); // next browse gets a NEW preview
    expect(findLeaf(usePanesStore.getState().root, "p1")?.tabs).toHaveLength(3);
  });

  test("an edit keeps the preview tab wherever the item is open", () => {
    usePanesStore.getState().openNote("n-B");
    keepTabsFor("n-B");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs.some((t) => t.preview)).toBe(false);
  });

  test("⌘T / ⌘-click appends a permanent tab and leaves the preview alone", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openNote("n-C", { newTab: true });
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(3);
    expect(pane?.tabs.filter((t) => t.preview)).toHaveLength(1); // n-B stays preview
  });

  test("boards and files browse through the same preview slot as notes", () => {
    usePanesStore.getState().openNote("n-B");
    usePanesStore.getState().openCanvas("storage/plan.excalidraw");
    usePanesStore.getState().openFile("storage/ref.pdf");
    const pane = findLeaf(usePanesStore.getState().root, "p1");
    expect(pane?.tabs).toHaveLength(2); // A + the one preview slot
    const preview = pane?.tabs.find((t) => t.preview);
    expect(preview?.surfaceKind).toBe("file");
  });
});

// The ONE size law for a split (Seth, 2026-08-01: "the way everything resizes
// and fits as a whole"). Both the divider drag and the live re-fit go through
// clampSplitSizes, so a pane can never be squeezed under the height its own
// chrome needs — and when the box genuinely cannot hold every child at the
// floor, the honest answer is an even split, not a crushed pane.
describe("clampSplitSizes — no pane below its floor", () => {
  const sum = (sizes: number[]) => sizes.reduce((a, b) => a + b, 0);

  test("leaves a split that already clears the floor alone", () => {
    expect(clampSplitSizes([0.5, 0.5], 0.25)).toEqual([0.5, 0.5]);
  });

  test("lifts an under-floor pane and takes it from the roomy sibling", () => {
    const out = clampSplitSizes([0.95, 0.05], 0.3);
    expect(out[1]).toBeCloseTo(0.3, 5);
    expect(out[0]).toBeCloseTo(0.7, 5);
    expect(sum(out)).toBeCloseTo(1, 5);
  });

  test("takes from the siblings with the most to spare, not evenly", () => {
    const out = clampSplitSizes([0.7, 0.25, 0.05], 0.2);
    expect(out.every((s) => s >= 0.2 - 1e-6)).toBe(true);
    expect(sum(out)).toBeCloseTo(1, 5);
    // the 0.7 pane gave up far more than the 0.25 one
    expect(0.7 - (out[0] ?? 0)).toBeGreaterThan(0.25 - (out[1] ?? 0));
  });

  test("a box too small for every child at the floor evens out instead of crushing", () => {
    expect(clampSplitSizes([0.9, 0.1], 0.6)).toEqual([0.5, 0.5]);
  });

  test("normalizes sizes that do not sum to 1", () => {
    const out = clampSplitSizes([2, 2], 0.25);
    expect(sum(out)).toBeCloseTo(1, 5);
    expect(out[0]).toBeCloseTo(0.5, 5);
  });

  test("is total for an empty split", () => {
    expect(clampSplitSizes([], 0.3)).toEqual([]);
  });
});
