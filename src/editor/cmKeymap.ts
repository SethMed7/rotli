// The editor's text-grammar keys, as CodeMirror commands (the command chords —
// ⌘B, headings, etc. — stay in the global key registry and reach the editor
// through activeEditor()). Mirrors the old EditorSurface grammar exactly:
//   Enter   — carry the list marker onto the next line; on an EMPTY item clear
//             it (the exit ramp); numbered lists count up.
//   Tab     — indent (nest a list) by 2 spaces; only LIST lines nest, a plain
//             line gets a soft 2-space tab (the old "Tab on a paragraph shoved
//             invisible spaces and felt glitchy" is gone).
//   ⇧Tab    — outdent up to 2 leading spaces.
//   Space   — "[ ]"/"[]" at line start becomes a task.

import { EditorSelection } from "@codemirror/state";
import type { Command, KeyBinding } from "@codemirror/view";

/** The list grammar (column-0 markers, optional leading indent), identical to
 * the renderer's: bullets, numbered (count up), tasks (reset to unchecked),
 * quotes. Returns the marker for the NEXT line and whether the item is empty. */
function listPrefixOf(line: string): { prefixLen: number; next: string; empty: boolean } | null {
  const m = line.match(/^( *)((?:- \[[ xX]\] |- |\d+\. |> ))(.*)$/);
  if (!m) return null;
  const indent = m[1] ?? "";
  const prefix = m[2] ?? "";
  const content = m[3] ?? "";
  const num = prefix.match(/^(\d+)\. $/);
  const marker = num ? `${Number(num[1]) + 1}. ` : prefix.replace(/\[[xX]\]/, "[ ]");
  return {
    prefixLen: indent.length + prefix.length,
    next: indent + marker,
    empty: content.trim() === "",
  };
}

const enterContinueList: Command = (view) => {
  const range = view.state.selection.main;
  if (!range.empty) return false; // a selection-replacing Enter → default split
  const line = view.state.doc.lineAt(range.head);
  const list = listPrefixOf(line.text);
  if (!list) return false;
  if (list.empty) {
    // Enter on an empty list item exits the list (clears the marker)
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  }
  if (range.head - line.from >= list.prefixLen) {
    const insert = `\n${list.next}`;
    view.dispatch({
      changes: { from: range.head, insert },
      selection: EditorSelection.cursor(range.head + insert.length),
      scrollIntoView: true,
      userEvent: "input",
    });
    return true;
  }
  return false; // caret inside the marker → let the default newline run
};

const tabIndent: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  // a multi-line selection indents every line it spans
  if (startLine.number !== endLine.number) {
    const changes = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
      changes.push({ from: state.doc.line(n).from, insert: "  " });
    }
    view.dispatch({ changes, userEvent: "input.indent" });
    return true;
  }
  // a list line nests; a plain line gets a soft tab at the caret
  if (listPrefixOf(startLine.text)) {
    view.dispatch({ changes: { from: startLine.from, insert: "  " }, userEvent: "input.indent" });
  } else {
    view.dispatch(state.replaceSelection("  "));
  }
  return true;
};

const tabOutdent: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const changes = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const l = state.doc.line(n);
    const remove = l.text.startsWith("  ") ? 2 : l.text.startsWith(" ") ? 1 : 0;
    if (remove) changes.push({ from: l.from, to: l.from + remove });
  }
  if (changes.length > 0) view.dispatch({ changes, userEvent: "delete.dedent" });
  return true; // trap ⇧Tab so it never tabs focus out of the editor
};

const taskOnSpace: Command = (view) => {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const line = view.state.doc.lineAt(range.head);
  const before = line.text.slice(0, range.head - line.from);
  const m = /^(\s*)\[ ?\]$/.exec(before);
  if (!m) return false; // not a task shorthand → space types normally
  const prefix = `${m[1] ?? ""}- [ ] `;
  view.dispatch({
    changes: { from: line.from, to: range.head, insert: prefix },
    selection: EditorSelection.cursor(line.from + prefix.length),
    userEvent: "input",
  });
  return true;
};

export const rotliKeymap: KeyBinding[] = [
  { key: "Enter", run: enterContinueList },
  { key: "Tab", run: tabIndent, shift: tabOutdent },
  { key: "Space", run: taskOnSpace },
];
