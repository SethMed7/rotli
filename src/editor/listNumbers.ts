// Ordered lists keep counting on their own. Markdown renders "1. 1. 1." as
// 1, 2, 3 and "1. 2. 4." as 1, 2, 3 — the editor shows the SOURCE number, so a
// deleted "8." left "9. 10." on screen, a Tab-nested run showed "1. 1. 1.",
// and the toolbar's numbered toggle wrote "1." on every line (Seth, 2026-09-03).
// One policy, applied as a transaction filter: after any user edit, every
// ordered run the edit touched is renumbered in the same transaction (one
// undo step, caret mapped through). A run is the consecutive same-indent
// ordered items; deeper items ride along, anything shallower or non-list ends
// it. A top-level run keeps its first number (a list may start at 5); a nested
// run always starts at 1.

import { EditorState, type Text, Transaction, type TransactionSpec } from "@codemirror/state";

import { parseBlock } from "./render";

export interface NumberChange {
  from: number;
  to: number;
  insert: string;
}

interface OrderedLine {
  indent: number;
  numberFrom: number;
  numberTo: number;
  value: number;
}

const ORDERED_KINDS = new Set(["numbered", "task", "result", "choice"]);

/** The ordered marker on a line, or null. Indent is in columns (tab = 2). */
function orderedLineOf(text: string, lineFrom: number): OrderedLine | null {
  const block = parseBlock(text);
  if (!ORDERED_KINDS.has(block.kind) || !block.marker) return null;
  const indentChars = /^[ \t]*/.exec(text)?.[0] ?? "";
  const digits = /^\d+/.exec(text.slice(indentChars.length));
  if (!digits) return null;
  return {
    indent: block.indent ?? 0,
    numberFrom: lineFrom + indentChars.length,
    numberTo: lineFrom + indentChars.length + digits[0].length,
    value: Number(digits[0]),
  };
}

/** True for a line that neither ends nor belongs to a run: a deeper list item
 * (any kind) or an indented continuation under one. */
function ridesAlong(text: string, indent: number): boolean {
  if (text.trim() === "") return false;
  const columns = (/^[ \t]*/.exec(text)?.[0] ?? "").replace(/\t/g, "  ").length;
  return columns > indent;
}

/** Renumber the ordered run that contains `lineNumber` (1-based). Returns the
 * digit replacements, empty when the run is already consecutive. */
export function renumberRunAt(doc: Text, lineNumber: number): NumberChange[] {
  const line = doc.line(lineNumber);
  const here = orderedLineOf(line.text, line.from);
  if (!here) return [];
  // walk up to the run's first item
  let first = lineNumber;
  for (let n = lineNumber - 1; n >= 1; n--) {
    const l = doc.line(n);
    const item = orderedLineOf(l.text, l.from);
    if (item && item.indent === here.indent) {
      first = n;
      continue;
    }
    if (item && item.indent < here.indent) break;
    if (!item && !ridesAlong(l.text, here.indent)) break;
  }
  const start = orderedLineOf(doc.line(first).text, doc.line(first).from)!;
  let value = here.indent > 0 ? 1 : Math.max(1, start.value);
  const changes: NumberChange[] = [];
  for (let n = first; n <= doc.lines; n++) {
    const l = doc.line(n);
    const item = orderedLineOf(l.text, l.from);
    if (item && item.indent === here.indent) {
      if (item.value !== value)
        changes.push({ from: item.numberFrom, to: item.numberTo, insert: String(value) });
      value++;
      continue;
    }
    if (item && item.indent < here.indent) break;
    if (!item && !ridesAlong(l.text, here.indent)) break;
  }
  return changes;
}

/** Renumber every ordered run touching the given line range, at every indent
 * level present in it. Runs are visited once each. */
export function renumberLines(doc: Text, fromLine: number, toLine: number): NumberChange[] {
  const seen = new Set<number>();
  const changes: NumberChange[] = [];
  const lo = Math.max(1, fromLine);
  const hi = Math.min(doc.lines, toLine);
  for (let n = lo; n <= hi; n++) {
    const l = doc.line(n);
    const item = orderedLineOf(l.text, l.from);
    if (!item) continue;
    const key = item.indent;
    // one visit per (indent, run): the run's changes cover its later lines
    if (seen.has(key * 1_000_000 + n)) continue;
    const run = renumberRunAt(doc, n);
    for (const c of run) changes.push(c);
    // mark every same-indent line of this run as visited
    for (let m = n; m <= hi; m++) {
      const t = doc.line(m);
      const it = orderedLineOf(t.text, t.from);
      if (it && it.indent < key) break;
      if (!it && !ridesAlong(t.text, key)) break;
      if (it && it.indent === key) seen.add(key * 1_000_000 + m);
    }
  }
  return changes.sort((a, b) => a.from - b.from);
}

/** The line range a transaction touched in its NEW document, widened by one
 * line each side so a deleted line's neighbours rejoin their run. */
export function touchedLines(tr: Transaction): { from: number; to: number } | null {
  let from = Number.POSITIVE_INFINITY;
  let to = 0;
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    from = Math.min(from, tr.newDoc.lineAt(fromB).number);
    to = Math.max(to, tr.newDoc.lineAt(toB).number);
  });
  if (!Number.isFinite(from)) return null;
  return { from: from - 1, to: to + 1 };
}

/** The editor extension: user edits (typing, deleting, pasting, indenting,
 * toggles) get their ordered runs renumbered inside the same transaction.
 * Programmatic loads and undo/redo pass through untouched — undo must
 * restore the exact prior text, and an external reload must not dirty the
 * buffer. */
export const listNumbering = EditorState.transactionFilter.of(
  (tr): TransactionSpec | readonly TransactionSpec[] => {
    if (!tr.docChanged) return tr;
    const user = tr.annotation(Transaction.userEvent);
    if (!user || user.startsWith("undo") || user.startsWith("redo")) return tr;
    const range = touchedLines(tr);
    if (!range) return tr;
    const changes = renumberLines(tr.newDoc, range.from, range.to);
    if (changes.length === 0) return tr;
    return [tr, { changes, sequential: true }];
  },
);
