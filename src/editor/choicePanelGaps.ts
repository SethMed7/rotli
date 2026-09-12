// Where a multi-choice panel opens and closes, as document positions. Pure on
// purpose (no @codemirror/view import): the field that turns these into block
// spacer widgets lives beside it, and this half is what the unit tests exercise.

import type { Text } from "@codemirror/state";

import { parseBlock } from "./render";

const CANDIDATE = /^\s*(?:-|\d+\.) \[##/;

type Row = { variant: "prompt" | "multi"; indent: number } | null;

function rowOf(doc: Text, number: number): Row {
  if (number < 1 || number > doc.lines) return null;
  const text = doc.line(number).text;
  if (!CANDIDATE.test(text)) return null;
  const block = parseBlock(text);
  if (block.kind !== "choice") return null;
  if (block.choiceVariant !== "prompt" && block.choiceVariant !== "multi") return null;
  return { variant: block.choiceVariant, indent: block.indent ?? 0 };
}

export interface PanelEdge {
  /** Document position of the gap: a line start (above) or line end (below). */
  pos: number;
  side: "above" | "below";
}

/** The same grouping live preview draws: a prompt always opens a panel; a
 * `[##]` row opens one unless a same-indent prompt or `[##]` row precedes it,
 * and closes one unless a same-indent `[##]` row follows. */
export function panelEdges(doc: Text): PanelEdge[] {
  const edges: PanelEdge[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const row = rowOf(doc, number);
    if (!row) continue;
    const previous = rowOf(doc, number - 1);
    const next = rowOf(doc, number + 1);
    const first = row.variant === "prompt" || previous === null || previous.indent !== row.indent;
    const last = next === null || next.variant !== "multi" || next.indent !== row.indent;
    const line = doc.line(number);
    if (first) edges.push({ pos: line.from, side: "above" });
    if (last) edges.push({ pos: line.to, side: "below" });
  }
  return edges;
}
