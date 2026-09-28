// ⌘B / ⌘I / the format bar over the live selection (2026-09-28): a caret
// toggles the mark on its own line, as before; a selection is marked line by
// line (commands.ts `toggleInlineMarkLines`), so a selection that ends at the
// start of the next line — a whole line picked with the mouse — marks that
// line's text instead of dropping `****` in front of the next one.

import { EditorSelection, type EditorState, type Line, type TransactionSpec } from "@codemirror/state";

import { type InlineMark, toggleInlineMark, toggleInlineMarkLines } from "./commands";

export function markSelectionSpec(state: EditorState, mark: InlineMark): TransactionSpec | null {
  const r = state.selection.main;
  if (r.empty) {
    const line = state.doc.lineAt(r.head);
    const col = r.head - line.from;
    const res = toggleInlineMark(line.text, col, col, mark);
    return {
      changes: { from: line.from, to: line.to, insert: res.line },
      selection: EditorSelection.range(line.from + res.selStart, line.from + res.selEnd),
    };
  }
  const lines: Line[] = [];
  for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
    lines.push(state.doc.line(n));
  }
  const spans = lines.map((line) => ({
    text: line.text,
    start: Math.max(r.from, line.from) - line.from,
    end: Math.min(r.to, line.to) - line.from,
  }));
  const edits = toggleInlineMarkLines(spans, mark);
  const first = edits[0];
  const last = edits.at(-1);
  if (!first || !last) return null; // nothing but markers and blank space selected
  // where each edited line starts in the new document
  let shift = 0;
  const starts = edits.map((edit) => {
    const line = lines[edit.index]!;
    const at = line.from + shift;
    shift += edit.line.length - line.length;
    return at;
  });
  return {
    changes: edits.map((edit) => {
      const line = lines[edit.index]!;
      return { from: line.from, to: line.to, insert: edit.line };
    }),
    selection: EditorSelection.range(starts[0]! + first.selStart, starts.at(-1)! + last.selEnd),
  };
}
