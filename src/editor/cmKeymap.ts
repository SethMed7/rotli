// The editor's text-grammar keys, as CodeMirror commands (the command chords —
// ⌘B, headings, etc. — stay in the global key registry and reach the editor
// through activeEditor()). Mirrors the old EditorSurface grammar exactly:
//   Enter   — carry the list marker onto the next line; on an EMPTY item clear
//             it (the exit ramp); numbered lists count up.
//   Tab     — indent the LINE by 2 spaces (a list line nests); only fenced code
//             gets a soft 2-space tab at the caret, since indentation inside a
//             fence is the user's code.
//   ⇧Tab    — outdent up to 2 leading spaces.
//   Space   — "[]"/"[ ]"/"[/]"/"[x]" becomes a task; "[][]" becomes a yes/no result;
//             "()" becomes a one-of-many choice option.
//   In a TABLE (the maintainer, 2026-07-01): Tab/⇧Tab hop to the next/previous cell
//   (crossing rows), ↑/↓ hop rows in the same column, Enter moves to the same
//   cell of the next row, Tab past the last cell APPENDS a row, and Enter on
//   the last row exits below the table — so the pipes never need
//   hand-navigation and Enter can't split a row.

import { EditorSelection, type Line, type TransactionSpec } from "@codemirror/state";
import type { Command, EditorView, KeyBinding } from "@codemirror/view";

import { CHOICE_LINE_RE } from "./choiceState";
import { parseChoiceControlLine, parseChoicePromptLine, parseToggleLine, setToggleOn } from "./controlState";
import { lineInFence, scanFences } from "./fences";
import { imageSourceSpan } from "./imageSelection";
import { parseResultLine } from "./resultState";
import {
  type CellRef,
  type TableBlock,
  addRowBelow,
  cellSpansOf,
  nextCell,
  scanTables,
  tableToText,
} from "./tables";
import { MARK, markOf, TASK_LINE_RE, taskStateOf } from "./taskState";

/** Fenced code is grammar-free: no list continuation, no task shorthand, no
 * list indent — `[]` or `- item` inside a ``` fence is the user's code. */
function inFence(view: EditorView, line: Line): boolean {
  return lineInFence(line.from, scanFences(view.state.doc));
}

/** The list grammar (column-0 markers, optional leading indent), identical to
 * the renderer's: bullets, numbered (count up), tasks (reset to unchecked —
 * ordered tasks count up AND reset), quotes. Returns the marker for the NEXT
 * line and whether the item is empty. */
function listPrefixOf(line: string): { prefixLen: number; next: string; empty: boolean } | null {
  const parsedResult = parseResultLine(line);
  if (parsedResult) {
    const numbered = /^(\d+)\. $/.exec(parsedResult.marker);
    const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
    const controls = parsedResult.compact
      ? "[ ][ ]"
      : parsedResult.options.map((option) => `[${option.source}]`).join("");
    return {
      prefixLen: parsedResult.prefixLen,
      next: `${parsedResult.indent}${marker}${controls} `,
      empty: parsedResult.text.trim() === "",
    };
  }
  const toggle = parseToggleLine(line);
  if (toggle) {
    const numbered = /^(\d+)\. $/.exec(toggle.marker);
    const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
    const reset = setToggleOn(line, false);
    if (reset) {
      const control = reset.slice(
        toggle.indentSource.length + toggle.marker.length,
        reset.length - toggle.text.length,
      );
      return {
        prefixLen: toggle.prefixLen,
        next: `${toggle.indentSource}${marker}${control}`,
        empty: toggle.text.trim() === "",
      };
    }
  }
  const choiceControl = parseChoiceControlLine(line);
  if (choiceControl) {
    const numbered = /^(\d+)\. $/.exec(choiceControl.marker);
    const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
    const hashes = choiceControl.kind === "radio" ? "#" : "##";
    return {
      prefixLen: choiceControl.prefixLen,
      next: `${choiceControl.indentSource}${marker}[${hashes}] `,
      empty: choiceControl.text.trim() === "",
    };
  }
  const choicePrompt = parseChoicePromptLine(line);
  if (choicePrompt) {
    const numbered = /^(\d+)\. $/.exec(choicePrompt.marker);
    const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
    return {
      prefixLen: choicePrompt.prefixLen,
      next: `${choicePrompt.indentSource}${marker}[##] `,
      empty: choicePrompt.text.trim() === "",
    };
  }
  const choice = CHOICE_LINE_RE.exec(line);
  if (choice) {
    const indent = choice[1] ?? "";
    const numbered = /^(\d+)\. $/.exec(choice[2] ?? "");
    const marker = numbered ? `${Number(numbered[1]) + 1}. ` : "- ";
    return {
      prefixLen: choice[0].length,
      next: `${indent}${marker}( ) `,
      empty: line.slice(choice[0].length).trim() === "",
    };
  }
  const m = line.match(
    new RegExp(`^([ \\t]*)((?:\\d+\\. \\[${MARK}\\] |- \\[${MARK}\\] |- |\\d+\\. |> ))(.*)$`),
  );
  if (!m) return null;
  const indent = m[1] ?? "";
  const prefix = m[2] ?? "";
  const content = m[3] ?? "";
  const num = prefix.match(new RegExp(`^(\\d+)\\. (\\[${MARK}\\] )?$`));
  const marker = num ? `${Number(num[1]) + 1}. ${num[2] ? "[ ] " : ""}` : prefix.replace(/\[[/xX]\]/, "[ ]");
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
  if (inFence(view, line)) return false;
  const list = listPrefixOf(line.text);
  if (!list) return false;
  // caret inside/before the marker → let the default newline run (an Enter at
  // column 0 of an empty item must insert a line above, never eat the marker)
  if (range.head - line.from < list.prefixLen) return false;
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
  const insert = `\n${list.next}`;
  view.dispatch({
    changes: { from: range.head, insert },
    selection: EditorSelection.cursor(range.head + insert.length),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
};

/** A line's leading indent, tab-tolerant (a tab = one level = 2 columns).
 * Tab/⇧Tab NORMALIZE tab indents into the app's two-space grammar as part of
 * the gesture — foreign notes (external editors, LLM output) indent with tabs,
 * which the space-only grammar used to treat as immovable (the maintainer, 2026-07-28:
 * "shift tab on bullets is very buggy"). */
const leadingIndent = (text: string): string => /^[ \t]*/.exec(text)?.[0] ?? "";

const tabIndent: Command = (view) => {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  // a multi-line selection indents every line it spans (tabs normalized)
  if (startLine.number !== endLine.number) {
    const changes = [];
    for (let n = startLine.number; n <= endLine.number; n++) {
      const l = state.doc.line(n);
      const indent = leadingIndent(l.text);
      changes.push({
        from: l.from,
        to: l.from + indent.length,
        insert: `  ${indent.replace(/\t/g, "  ")}`,
      });
    }
    view.dispatch({ changes, userEvent: "input.indent" });
    return true;
  }
  // fenced code is grammar-free — indentation there is the user's code, so Tab
  // stays a soft tab at the caret
  if (inFence(view, startLine)) {
    view.dispatch(state.replaceSelection("  "));
    return true;
  }
  // every other line INDENTS (list or prose): ⇧Tab has always outdented any
  // line, so Tab has to be its mirror. Shoving two spaces in at the caret was
  // the bug the maintainer kept hitting (2026-08-01) — typing "test" and then pressing Tab
  // left "test  ", and the "- " typed next stranded at the end ("test  - ",
  // rendered literally, no bullet) instead of nesting the line.
  const indent = leadingIndent(startLine.text);
  const insert = `  ${indent.replace(/\t/g, "  ")}`;
  const spec: TransactionSpec = {
    changes: {
      from: startLine.from,
      to: startLine.from + indent.length,
      insert,
    },
    userEvent: "input.indent",
  };
  // the caret rides the shift — an insertion AT the caret (column 0, or an empty
  // line) would otherwise strand it BEFORE the new indent
  if (range.empty) spec.selection = EditorSelection.cursor(range.head + insert.length - indent.length);
  view.dispatch(spec);
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
    const indent = leadingIndent(l.text);
    if (!indent) continue;
    // normalize tabs → two-space levels, then drop one level
    const norm = indent.replace(/\t/g, "  ");
    const next = norm.slice(0, Math.max(0, norm.length - 2));
    if (next !== indent) changes.push({ from: l.from, to: l.from + indent.length, insert: next });
  }
  if (changes.length > 0) view.dispatch({ changes, userEvent: "delete.dedent" });
  return true; // trap ⇧Tab so it never tabs focus out of the editor
};

const listControlOnSpace: Command = (view) => {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const line = view.state.doc.lineAt(range.head);
  if (inFence(view, line)) return false; // code is code — never rewrite it
  const before = line.text.slice(0, range.head - line.from);
  // "()" + Space starts a Markdown-native single-choice group. Each row is
  // ordinary file truth; adjacency and matching indent define its siblings.
  const choice = /^(\s*)(?:- )?\( ?\)$/.exec(before);
  if (choice) {
    const prefix = `${(choice[1] ?? "").replace(/\t/g, "  ")}- ( ) `;
    view.dispatch({
      changes: { from: line.from, to: range.head, insert: prefix },
      selection: EditorSelection.cursor(line.from + prefix.length),
      userEvent: "input",
    });
    return true;
  }
  // "[][]" + Space makes a mutually exclusive yes/no result. As with the
  // task shorthand below, an optional existing bullet upgrades in place.
  const result = /^(\s*)(?:- )?\[ ?\]\[ ?\]$/.exec(before);
  if (result) {
    const prefix = `${(result[1] ?? "").replace(/\t/g, "  ")}- [ ][ ] `;
    view.dispatch({
      changes: { from: line.from, to: range.head, insert: prefix },
      selection: EditorSelection.cursor(line.from + prefix.length),
      userEvent: "input",
    });
    return true;
  }
  const labeledResult = /^(\s*)(?:- )?((?:\[[^\]\r\n]+\]){2,})$/.exec(before);
  if (labeledResult) {
    const indent = (labeledResult[1] ?? "").replace(/\t/g, "  ");
    const controls = labeledResult[2] ?? "";
    if (parseResultLine(`${indent}- ${controls} `)) {
      const prefix = `${indent}- ${controls} `;
      view.dispatch({
        changes: { from: line.from, to: range.head, insert: prefix },
        selection: EditorSelection.cursor(line.from + prefix.length),
        userEvent: "input",
      });
      return true;
    }
  }
  const hashChoice = /^(\s*)(?:- )?\[(##\?|##|#)\]$/.exec(before);
  if (hashChoice) {
    const prefix = `${(hashChoice[1] ?? "").replace(/\t/g, "  ")}- [${hashChoice[2]}] `;
    view.dispatch({
      changes: { from: line.from, to: range.head, insert: prefix },
      selection: EditorSelection.cursor(line.from + prefix.length),
      userEvent: "input",
    });
    return true;
  }
  const toggle = /^(\s*)(?:- )?(\[[^\]\r\n]*\|[^\]\r\n]*\])$/.exec(before);
  if (toggle) {
    const indent = (toggle[1] ?? "").replace(/\t/g, "  ");
    const candidate = `${indent}- ${toggle[2]} `;
    const prefix = setToggleOn(candidate, false);
    if (prefix) {
      view.dispatch({
        changes: { from: line.from, to: range.head, insert: prefix },
        selection: EditorSelection.cursor(line.from + prefix.length),
        userEvent: "input",
      });
      return true;
    }
  }
  // Any task-state token at line start — `[]`/`[ ]`, `[/]`, or `[x]` — may be
  // typed without its list marker. Space upgrades it to portable task source;
  // an optional existing bullet upgrades in place. Pasted tab indents normalize
  // to the two spaces the rest of the grammar speaks.
  const m = new RegExp(`^(\\s*)(?:- )?\\[(${MARK})?\\]$`).exec(before);
  if (!m) return false; // not a task shorthand → space types normally
  const mark = markOf(taskStateOf(m[2] ?? " "));
  const prefix = `${(m[1] ?? "").replace(/\t/g, "  ")}- [${mark}] `;
  view.dispatch({
    changes: { from: line.from, to: range.head, insert: prefix },
    selection: EditorSelection.cursor(line.from + prefix.length),
    userEvent: "input",
  });
  return true;
};

/** Arrow into an atomic task marker to edit its raw state character. The
 * blank mark is selected, so typing `/` is the direct open → in-progress path
 * without making every ordinary click abandon live preview. */
const taskMarkerArrowLeft: Command = (view) => {
  const range = view.state.selection.main;
  if (!range.empty) return false;
  const line = view.state.doc.lineAt(range.head);
  const task = TASK_LINE_RE.exec(line.text);
  if (!task || range.head !== line.from + task[0].length) return false;
  const markFrom = line.from + task[0].length - 3;
  view.dispatch({
    selection: EditorSelection.range(markFrom, markFrom + 1),
    scrollIntoView: true,
    userEvent: "select",
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
  // Every table line carries a pipe. Without this gate, Tab/Enter/arrows on an
  // ordinary bullet paid a whole-document table scan (plus its nested fence
  // scan) just to learn the caret is not in a table.
  if (!line.text.includes("|")) return null;
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

/** Whether a cell address exists in the SOURCE — a ragged (pasted/hand-edited)
 * row can have fewer cells than the header, and hopping must skip the holes or
 * Tab would reselect the same clamped cell forever. */
function cellExists(view: EditorView, t: TableBlock, ref: CellRef): boolean {
  if (ref.row === -1) return ref.col < t.header.length;
  const headLine = view.state.doc.lineAt(t.from);
  const line = view.state.doc.line(headLine.number + ref.row + 2);
  return ref.col < cellSpansOf(line.text).length;
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
  let next = nextCell(t, ref, 1);
  while (next && !cellExists(view, t, next)) next = nextCell(t, next, 1);
  if (next) selectCell(view, t, next);
  else appendRow(view, t); // Tab past the last cell grows the table
  return true;
};

const tableShiftTab: Command = (view) => {
  const ctx = tableCtxAt(view);
  if (!ctx) return false;
  const { t, ref } = ctx;
  let prev = ref ? nextCell(t, ref, -1) : { row: -1, col: Math.max(0, t.header.length - 1) };
  while (prev && !cellExists(view, t, prev)) prev = nextCell(t, prev, -1);
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

/** Entering an image widget with an arrow selects it as an object. A caret
 * already inside raw image source still uses CodeMirror's normal motion, so
 * direct Markdown editing remains available without a separate mode. */
function imageArrow(direction: "up" | "down" | "left" | "right"): Command {
  return (view) => {
    const current = view.state.selection.main;
    if (!current.empty) return false;
    const next =
      direction === "up" || direction === "down"
        ? view.moveVertically(current, direction === "down")
        : view.moveByChar(current, direction === "right");
    if (next.head === current.head) return false;
    const currentLine = view.state.doc.lineAt(current.head);
    const nextLine = view.state.doc.lineAt(next.head);
    if (nextLine.number === currentLine.number) return false;
    const image = imageSourceSpan(nextLine.text, nextLine.from);
    if (!image) return false;
    view.dispatch({
      selection: EditorSelection.range(image.from, image.to),
      scrollIntoView: true,
      userEvent: "select",
    });
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
    view.dispatch({
      selection: EditorSelection.cursor(after.from),
      scrollIntoView: true,
    });
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
  { key: "ArrowUp", run: imageArrow("up") },
  { key: "ArrowDown", run: imageArrow("down") },
  { key: "ArrowLeft", run: taskMarkerArrowLeft },
  { key: "ArrowLeft", run: imageArrow("left") },
  { key: "ArrowRight", run: imageArrow("right") },
  { key: "Enter", run: enterContinueList },
  { key: "Tab", run: tabIndent, shift: tabOutdent },
  { key: "Space", run: listControlOnSpace },
];
