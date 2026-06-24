// Focus mode's paragraph dimming (r3 frame E), as a CodeMirror plugin: the
// active PARAGRAPH (the contiguous non-blank block around the caret) stays lit,
// every other line dims. The title line (line 1) never dims. Added/removed via
// a compartment in CmEditor — present only while focus mode is on. Typewriter
// centering lives in CmEditor (it scrolls, it doesn't decorate).

import type { Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

function buildDim(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = view.state.doc;
  const active = doc.lineAt(view.state.selection.main.head);
  let startN = active.number;
  while (startN > 1 && doc.line(startN - 1).text.trim() !== "") startN--;
  let endN = active.number;
  while (endN < doc.lines && doc.line(endN + 1).text.trim() !== "") endN++;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number !== 1 && (line.number < startN || line.number > endN)) {
        decos.push(Decoration.line({ class: "rotli-dim" }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(decos, true);
}

export const focusDim = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDim(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildDim(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
