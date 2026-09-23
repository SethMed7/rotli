// The "Write…" hint of an empty note. CodeMirror's placeholder() is an
// inline-block WIDGET, so an empty note's only line held no text and each
// engine drew the native caret from the widget box — Gecko (Zen, Firefox)
// put it above the hint (the owner, 2026-09-23). Here the line stays a plain
// empty line (CodeMirror gives it a <br>, so the caret has real line metrics
// everywhere) and the hint is painted by CSS behind it (editor.css).

import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

function hintFor(state: EditorState, text: string): DecorationSet {
  if (state.doc.length > 0) return Decoration.none;
  return Decoration.set(
    Decoration.line({ class: "rotli-empty-hint", attributes: { "data-hint": text } }).range(0),
  );
}

/** The empty-note hint, and the same words for assistive tech. */
export function emptyPlaceholder(text: string) {
  return [
    StateField.define<DecorationSet>({
      create: (state) => hintFor(state, text),
      update: (value, tr) => (tr.docChanged ? hintFor(tr.state, text) : value),
      provide: (field) => EditorView.decorations.from(field),
    }),
    EditorView.contentAttributes.of({ "aria-placeholder": text }),
  ];
}
