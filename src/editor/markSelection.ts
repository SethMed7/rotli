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
  const only = edits.length === 1 ? edits[0] : undefined;
  if (edits.length === 0) return null; // nothing but markers and blank space selected
  const changes = state.changes(edits.map((edit) => narrowChange(lines[edit.index]!, edit.line)));
  if (only) {
    // one line: select its text inside the marks, as a caret-line toggle does
    const at = changes.mapPos(lines[only.index]!.from, -1);
    return { changes, selection: EditorSelection.range(at + only.selStart, at + only.selEnd) };
  }
  // several lines: keep the whole selection, marks included, so pressing the
  // same mark again finds every line wrapped and takes it off (PR 119 review, 2026-09-28)
  return { changes, selection: EditorSelection.range(changes.mapPos(r.from, -1), changes.mapPos(r.to, 1)) };
}

/** A line's rewrite as only the part that changed (the shared start and end
 * trimmed), so a position beside a new mark maps to the right side of it. */
function narrowChange(line: Line, next: string): { from: number; to: number; insert: string } {
  const old = line.text;
  let head = 0;
  while (head < old.length && head < next.length && old[head] === next[head]) head++;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  return { from: line.from + head, to: line.to - tail, insert: next.slice(head, next.length - tail) };
}
