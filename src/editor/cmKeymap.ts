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
//   In a TABLE (Seth, 2026-07-01): Tab/⇧Tab hop to the next/previous cell
//   (crossing rows), ↑/↓ hop rows in the same column, Enter moves to the same
//   cell of the next row, Tab past the last cell APPENDS a row, and Enter on
//   the last row exits below the table — so the pipes never need
//   hand-navigation and Enter can't split a row.

import { EditorSelection } from "@codemirror/state";
import type { Command, EditorView, KeyBinding } from "@codemirror/view";
import {
  type CellRef,
  type TableBlock,
  addRowBelow,
  cellSpansOf,
  nextCell,
  scanTables,
  tableToText,
} from "./tables";

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

// ─── table cell navigation ───────────────────────────────────────────────────

interface TableCtx {
  t: TableBlock;
  /** The caret's cell (row -1 = header) — null when the caret sits on the
   * delimiter line (no cells there; the commands special-case it). */
  ref: CellRef | null;
}

/** The table + cell under the caret, or null (multi-line selections bail so a
 * selected table still indents/deletes like plain text). */
function tableCtxAt(view: EditorView): TableCtx | null {
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  if (view.state.doc.lineAt(sel.anchor).number !== line.number) return null;
  const t = scanTables(view.state.doc).find((x) => line.from >= x.from && line.from <= x.to);
  if (!t) return null;
  const rel = line.number - view.state.doc.lineAt(t.from).number; // 0 head, 1 delim, 2.. data
  if (rel === 1) return { t, ref: null };
  const spans = cellSpansOf(line.text);
  const hit = spans.findIndex((s) => sel.head <= line.from + s.end);
  const col = hit === -1 ? Math.max(0, spans.length - 1) : hit; // past the last pipe → last cell
  return { t, ref: { row: rel === 0 ? -1 : rel - 2, col } };
}

/** Select a cell's content (typing replaces it, the Crepe/Excel feel). */
function selectCell(view: EditorView, t: TableBlock, ref: CellRef): void {
  const headLine = view.state.doc.lineAt(t.from);
  const line = view.state.doc.line(headLine.number + (ref.row === -1 ? 0 : ref.row + 2));
  const spans = cellSpansOf(line.text);
  const sp = spans[Math.min(ref.col, Math.max(0, spans.length - 1))];
  if (!sp) return;
  view.dispatch({
    selection: EditorSelection.range(line.from + sp.start, line.from + sp.end),
    scrollIntoView: true,
    userEvent: "select",
  });
}

/** Rewrite the whole table with a row appended and land in its first cell. */
function appendRow(view: EditorView, t: TableBlock): void {
  const text = tableToText(addRowBelow(t, t.rows.length - 1));
  const lastLineStart = text.lastIndexOf("\n") + 1;
  const sp = cellSpansOf(text.slice(lastLineStart))[0];
  const at = t.from + lastLineStart + (sp?.start ?? 2);
  view.dispatch({
    changes: { from: t.from, to: t.to, insert: text },
    selection: EditorSelection.cursor(at),
    scrollIntoView: true,
    userEvent: "input",
  });
}

const tableTab: Command = (view) => {
  const ctx = tableCtxAt(view);
  if (!ctx) return false;
  const { t, ref } = ctx;
  if (!ref) {
    // delimiter line → hop into the first data cell (or append one)
    if (t.rows.length > 0) selectCell(view, t, { row: 0, col: 0 });
    else appendRow(view, t);
    return true;
  }
  const next = nextCell(t, ref, 1);
  if (next) selectCell(view, t, next);
  else appendRow(view, t); // Tab past the last cell grows the table
  return true;
};

const tableShiftTab: Command = (view) => {
  const ctx = tableCtxAt(view);
  if (!ctx) return false;
  const { t, ref } = ctx;
  const prev = ref ? nextCell(t, ref, -1) : { row: -1, col: Math.max(0, t.header.length - 1) };
  if (prev) selectCell(view, t, prev);
  return true; // trap ⇧Tab inside a table either way
};

// ↑/↓ hop rows spreadsheet-style — vertical motion would otherwise skip the
// partial-table widgets and dump the caret past the whole table. At the edges
// (header up, last row down) they fall through to the default motion, which
// exits the table cleanly.
function tableArrow(dir: -1 | 1): Command {
  return (view) => {
    const ctx = tableCtxAt(view);
    if (!ctx) return false;
    const { t, ref } = ctx;
    const col = ref?.col ?? 0;
    const row = ref === null ? (dir === 1 ? 0 : -1) : ref.row + dir; // delim → its neighbours
    if (row < -1 || row >= t.rows.length) return false; // edge → default motion exits
    selectCell(view, t, { row, col });
    return true;
  };
}

const tableEnter: Command = (view) => {
  const ctx = tableCtxAt(view);
  if (!ctx) return false;
  const { t, ref } = ctx;
  const nextRow = ref === null || ref.row === -1 ? 0 : ref.row + 1;
  if (nextRow < t.rows.length) {
    selectCell(view, t, { row: nextRow, col: ref?.col ?? 0 });
    return true;
  }
  // last row → exit below the table (never split a row with a newline)
  const after = t.to >= view.state.doc.length ? null : view.state.doc.lineAt(t.to + 1);
  if (after) {
    view.dispatch({ selection: EditorSelection.cursor(after.from), scrollIntoView: true });
  } else {
    view.dispatch({
      changes: { from: t.to, insert: "\n" },
      selection: EditorSelection.cursor(t.to + 1),
      scrollIntoView: true,
      userEvent: "input",
    });
  }
  return true;
};

export const rotliKeymap: KeyBinding[] = [
  // table nav first — inside a table these own the keys, elsewhere they pass
  { key: "Enter", run: tableEnter },
  { key: "Tab", run: tableTab, shift: tableShiftTab },
  { key: "ArrowUp", run: tableArrow(-1) },
  { key: "ArrowDown", run: tableArrow(1) },
  { key: "Enter", run: enterContinueList },
  { key: "Tab", run: tabIndent, shift: tabOutdent },
  { key: "Space", run: taskOnSpace },
];
