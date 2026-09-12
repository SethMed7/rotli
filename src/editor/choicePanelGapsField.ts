// Breathing room above and below a multi-choice panel as measured block
// widgets. A line margin is invisible to CodeMirror's height map and leaves
// every vertical motion and click below the panel one line off; block widgets
// are measured, but they may only come from a state field, never a view plugin.

import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

import { panelEdges } from "./choicePanelGaps";

class PanelGapWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const gap = document.createElement("div");
    gap.className = "rotli-choice-gap";
    gap.setAttribute("aria-hidden", "true");
    return gap;
  }

  ignoreEvent() {
    return false;
  }
}

const GAP = new PanelGapWidget();
const above = Decoration.widget({ widget: GAP, block: true, side: -1 });
const below = Decoration.widget({ widget: GAP, block: true, side: 1 });

function build(state: EditorState): DecorationSet {
  return Decoration.set(
    panelEdges(state.doc).map((edge) => (edge.side === "above" ? above : below).range(edge.pos)),
    true,
  );
}

export const choicePanelGaps = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) => (tr.docChanged ? build(tr.state) : value),
  provide: (field) => EditorView.decorations.from(field),
});
