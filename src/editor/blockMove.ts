// Moving a block (blockHandles.ts): the pure text plan, so it unit-tests
// without a DOM. A block is a run of consecutive non-blank lines; blocks are
// separated by one or more blank lines. A move takes the block out together
// with the gap after it (or, for the last block, the gap before it), and puts
// it back before another block — or after the last one — with one blank line
// between it and its new neighbour. Nothing else in the note changes.

/** One replacement over the ORIGINAL document: CodeMirror maps a single
 * change exactly, where a cut plus a separately-offset insert would land the
 * insert at the wrong place (the 2026-09-23 bug: a block dragged down split
 * the text it landed in mid-word). */
export interface BlockMovePlan {
  from: number;
  to: number;
  insert: string;
  /** Where the moved block starts once the plan is applied. */
  movedAt: number;
}

/** Where a dragged block goes: before the block starting at an offset, or
 * after the note's last block. */
export type BlockMoveTarget = { before: number } | "end";

interface Span {
  from: number;
  to: number;
}

/** Every block in the note, in order: [first char, end of last line). */
export function blockSpans(doc: string): Span[] {
  const spans: Span[] = [];
  let lineStart = 0;
  let open: Span | null = null;
  while (lineStart <= doc.length) {
    const newline = doc.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? doc.length : newline;
    const blank = doc.slice(lineStart, lineEnd).trim().length === 0;
    if (blank) open = null;
    else if (open) open.to = lineEnd;
    else {
      open = { from: lineStart, to: lineEnd };
      spans.push(open);
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return spans;
}

/** Plan moving the block that starts at `sourceFrom` to `target`. Null when
 * there is nothing to do: no such block, or it would land where it is. */
export function planBlockMove(
  doc: string,
  sourceFrom: number,
  target: BlockMoveTarget,
): BlockMovePlan | null {
  const spans = blockSpans(doc);
  const index = spans.findIndex((span) => span.from === sourceFrom);
  if (index === -1) return null;
  const source = spans[index]!;
  const next = spans[index + 1];
  const previous = spans[index - 1];
  const last = spans[spans.length - 1]!;
  const text = doc.slice(source.from, source.to);

  // what leaves: the block and the gap after it; the last block takes the gap
  // before it instead, so the note never ends in the removed block's gap
  const removal: Span = next
    ? { from: source.from, to: next.from }
    : { from: previous ? previous.to : source.from, to: source.to };

  let at: number;
  let insert: string;
  if (target === "end") {
    if (!next) return null; // already the last block
    at = last.to;
    insert = `\n\n${text}`;
  } else {
    if (target.before === source.from || target.before === next?.from) return null;
    if (!spans.some((span) => span.from === target.before)) return null;
    at = target.before;
    insert = `${text}\n\n`;
  }

  // apply both edits to the span they cover, later edit first
  const from = Math.min(removal.from, at);
  const to = Math.max(removal.to, at);
  let middle = doc.slice(from, to);
  const cut = (s: string) => s.slice(0, removal.from - from) + s.slice(removal.to - from);
  const put = (s: string) => s.slice(0, at - from) + insert + s.slice(at - from);
  middle = at >= removal.to ? cut(put(middle)) : put(cut(middle));
  const movedAt = (at >= removal.to ? at - (removal.to - removal.from) : at) + (target === "end" ? 2 : 0);
  return { from, to, insert: middle, movedAt };
}
