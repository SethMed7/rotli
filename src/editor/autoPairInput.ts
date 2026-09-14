// The editor side of auto-pairing: CodeMirror's input handler runs the pure
// rule in autoPair.ts for a single typed character at a single caret. Fenced
// code is left exactly as typed. Registered outside the view-mode compartment,
// so raw Markdown pairs the same way.

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { autoPairEdit } from "./autoPair";
import { lineInFence, scanFences } from "./fences";

export const autoPair = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || from !== to || view.composing) return false;
  const { state } = view;
  if (state.selection.ranges.length !== 1 || state.readOnly) return false;
  const line = state.doc.lineAt(from);
  const col = from - line.from;
  const edit = autoPairEdit(line.text, col, text, line.text.charAt(col));
  if (!edit || lineInFence(line.from, scanFences(state.doc))) return false;
  view.dispatch({
    changes: { from, to: from + edit.replace, insert: edit.insert },
    selection: EditorSelection.cursor(from + edit.cursorOffset),
    scrollIntoView: true,
    userEvent: "input.type",
  });
  return true;
});
