// Align left / center / right over the live selection (alignedLine.ts has the
// grammar). Each paragraph line in the selection takes the alignment; a
// heading, list item, image line, table, fence, or raw HTML line is left as
// it is, because wrapping it in <p> would change what it is. A caret on an
// empty line starts an aligned paragraph there. Choosing the alignment a line
// already has changes nothing; left removes the tags.

import { type ChangeSpec, EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { ALIGN_CLOSE, type TextAlign, alignOpenTag, parseAlignedLine } from "./alignedLine";
import { lineInFence, scanFences } from "./fences";
import { imageSourceSpan } from "./imageSelection";
import { parseBlock } from "./render";
import { lineInTable, scanTables } from "./tables";

const HR_LINE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

/** Whether a line is a paragraph that may carry an alignment. */
export function canAlign(text: string): boolean {
  if (parseAlignedLine(text)) return true;
  if (text.trim() === "" || HR_LINE.test(text)) return false;
  if (/^\s*(?:<(?!u>)|\|)/.test(text)) return false; // raw HTML (not <u>) or a table row
  if (imageSourceSpan(text, 0)) return false;
  return parseBlock(text).kind === "para";
}

/** The smallest edits that give one line `align` (none when it already has it). */
export function lineAlignChanges(text: string, from: number, align: TextAlign): ChangeSpec[] {
  const aligned = parseAlignedLine(text);
  const end = from + text.length;
  if (!aligned) {
    return align === "left"
      ? []
      : [
          { from, insert: alignOpenTag(align) },
          { from: end, insert: ALIGN_CLOSE },
        ];
  }
  if (aligned.align === align) return [];
  if (align !== "left") return [{ from, to: from + aligned.open, insert: alignOpenTag(align) }];
  return [
    { from, to: from + aligned.open },
    { from: end - ALIGN_CLOSE.length, to: end },
  ];
}

export function alignSpec(state: EditorState, align: TextAlign): TransactionSpec | null {
  const { doc } = state;
  const r = state.selection.main;
  const first = doc.lineAt(r.from);
  let last = doc.lineAt(r.to);
  // a selection that ends at the very start of a line does not include it
  if (!r.empty && r.to === last.from && last.number > first.number) last = doc.line(last.number - 1);
  if (r.empty && first.text === "") {
    if (align === "left") return null;
    const open = alignOpenTag(align);
    return {
      changes: { from: first.from, insert: `${open}${ALIGN_CLOSE}` },
      selection: EditorSelection.cursor(first.from + open.length),
    };
  }
  const fences = scanFences(doc);
  const tables = scanTables(doc);
  const changes: ChangeSpec[] = [];
  for (let n = first.number; n <= last.number; n++) {
    const line = doc.line(n);
    if (lineInFence(line.from, fences) || lineInTable(line.from, tables) || !canAlign(line.text)) continue;
    changes.push(...lineAlignChanges(line.text, line.from, align));
  }
  if (changes.length === 0) return null;
  const set = state.changes(changes);
  if (r.empty) {
    // a caret at a line's end stays before the closing tag; anywhere else it
    // moves past an opening tag inserted in front of it
    return {
      changes: set,
      selection: EditorSelection.cursor(set.mapPos(r.head, r.head === first.to ? -1 : 1)),
    };
  }
  // a selection keeps the whole paragraphs, tags included, so the next choice
  // finds every line it covered
  const from = set.mapPos(r.from, -1);
  const to = set.mapPos(r.to, 1);
  return {
    changes: set,
    selection: r.anchor <= r.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from),
  };
}

/** The editor handle's Align command. */
export function applyTextAlign(view: EditorView | null, align: TextAlign): void {
  if (!view) return;
  const spec = alignSpec(view.state, align);
  if (spec) view.dispatch({ ...spec, scrollIntoView: true, userEvent: "input" });
  view.focus();
}

/** Enter inside an aligned paragraph starts the next paragraph with the same
 * alignment; Enter in an empty one ends the alignment, as an empty list item
 * ends its list. Null when Enter is not this command's to handle. */
export function alignedEnterSpec(state: EditorState): TransactionSpec | null {
  const r = state.selection.main;
  if (!r.empty) return null;
  const line = state.doc.lineAt(r.head);
  const aligned = parseAlignedLine(line.text);
  if (!aligned) return null;
  const col = r.head - line.from;
  if (col < aligned.open || col > line.length - ALIGN_CLOSE.length) return null;
  if (aligned.inner.trim() === "") {
    return { changes: { from: line.from, to: line.to }, selection: EditorSelection.cursor(line.from) };
  }
  const insert = `${ALIGN_CLOSE}\n${alignOpenTag(aligned.align)}`;
  return {
    changes: { from: r.head, insert },
    selection: EditorSelection.cursor(r.head + insert.length),
  };
}
