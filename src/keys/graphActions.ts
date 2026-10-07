// The Graph view's actions (exploration 2026-10-05). Registered from
// ./actions.ts; kept here so actions.ts stays under its size ceiling. No
// default chord and no sidebar row — the graph adds no chrome; ⌘K reaches it,
// and a person can bind a chord in Settings → Hotkeys.

import { openGraph } from "../state/graph";
import { activeTabOf, findLeaf, usePanesStore } from "../state/panes";
import { registerAction } from "./registry";

export function registerGraphActions(): void {
  registerAction({
    id: "view.graph",
    title: "Graph of all notes",
    defaultChord: null,
    keywords: ["graph", "links", "map", "connections", "network"],
    run: () => openGraph(),
  });
  registerAction({
    id: "view.graphAround",
    title: "Show this note in the graph",
    defaultChord: null,
    keywords: ["graph", "local graph", "links", "backlinks", "neighbors"],
    enabled: () => focusedNoteId() !== null,
    run: () => {
      const noteId = focusedNoteId();
      if (noteId) openGraph({ kind: "around", noteId, depth: 1 });
    },
  });
}

/** The note in the focused pane, if a note is what it shows. */
function focusedNoteId(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId);
  const tab = leaf ? activeTabOf(leaf) : null;
  return tab?.surfaceKind === "note" ? tab.noteId : null;
}
