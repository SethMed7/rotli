// The editor of a note that was just opened. openNote places the tab in the
// focused pane, but its CodeMirror view mounts on a later frame; a drop that
// opened the note (a sidebar row, 2026-09-17) waits here for the view and
// gives up after a moment rather than forever.

import { EditorView } from "@codemirror/view";

import { noteIdFacet } from "./livePreview";

const MAX_FRAMES = 90; // ~1.5 s at 60 Hz

function focusedEditorFor(noteId: string): EditorView | null {
  const host = document.querySelector<HTMLElement>(".pane.focused .cm-editor");
  const view = host ? EditorView.findFromDOM(host) : null;
  return view && view.state.facet(noteIdFacet) === noteId ? view : null;
}

export async function awaitEditorFor(noteId: string): Promise<EditorView | null> {
  for (let frame = 0; frame < MAX_FRAMES; frame += 1) {
    const view = focusedEditorFor(noteId);
    if (view) return view;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  return null;
}
