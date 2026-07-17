import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mainHasNote } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { findLeaf, usePanesStore } from "../state/panes";
import type { LeafNode, PaneNode } from "../types";
import {
  closeTabWithDraftCleanup,
  markDocumentDraftChanged,
  trackNewDocumentDraft,
} from "./draftComposition";

const FILE_ID = "storage/rotli/untitled-regression.docx";

function pane(): LeafNode {
  return {
    kind: "leaf",
    id: "draft-pane",
    activeTabId: "document-tab",
    tabs: [
      {
        id: "note-tab",
        surfaceKind: "note",
        noteId: "existing-note",
        viewState: { cursor: 0, scroll: 0 },
      },
      {
        id: "document-tab",
        surfaceKind: "file",
        fileId: FILE_ID,
        viewState: { cursor: 0, scroll: 0 },
      },
    ],
  };
}

describe("document draft tab lifecycle", () => {
  let previousRoot: PaneNode;
  let previousFocus: string;
  let previousManifest: ReturnType<typeof useMainStore.getState>["manifest"];
  let previousSetTree: ReturnType<typeof useMainStore.getState>["setTree"];

  beforeEach(() => {
    const panes = usePanesStore.getState();
    previousRoot = panes.root;
    previousFocus = panes.focusedPaneId;
    const main = useMainStore.getState();
    previousManifest = main.manifest;
    previousSetTree = main.setTree;
    usePanesStore.setState({ root: pane(), focusedPaneId: "draft-pane" });
    useMainStore.setState({
      manifest: { version: 1, tree: [{ note: FILE_ID }] },
      setTree: (tree) => useMainStore.setState({ manifest: { version: 1, tree } }),
    });
  });

  afterEach(() => {
    usePanesStore.setState({ root: previousRoot, focusedPaneId: previousFocus });
    useMainStore.setState({ manifest: previousManifest, setTree: previousSetTree });
  });

  test("closing the final untouched document tab removes its Main reference", async () => {
    trackNewDocumentDraft(FILE_ID);
    closeTabWithDraftCleanup("draft-pane", "document-tab");

    expect(findLeaf(usePanesStore.getState().root, "draft-pane")?.tabs).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mainHasNote(useMainStore.getState().manifest.tree, FILE_ID)).toBe(false);
  });

  test("a document with a content mutation remains in Main when its tab closes", async () => {
    trackNewDocumentDraft(FILE_ID);
    markDocumentDraftChanged(FILE_ID);
    closeTabWithDraftCleanup("draft-pane", "document-tab");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mainHasNote(useMainStore.getState().manifest.tree, FILE_ID)).toBe(true);
  });
});
