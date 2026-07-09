// Pure math for dragging an image line to a new spot (livePreview's ImgWidget).
// Kept dependency-free so it's unit-testable: livePreview itself is DOM/CM-bound.
//
// CRITICAL COORDINATE LAW: every change in a single CM6 transaction addresses
// the ORIGINAL document — changes apply simultaneously, never sequentially. The
// old inline math subtracted the cut length from the insert position, which
// landed a downward drag one image-line above the drop point.

export interface LineSpan {
  /** Start of the block's first line. */
  from: number;
  /** End of the block's last line (before its newline). */
  to: number;
}

/** A drop target: the line-start offset to insert BEFORE, or the document end. */
export type DropTarget = number | "end";

/** Snap an insertion point out of an opaque block (table / fenced code) — a
 * line inserted mid-block would corrupt it, so the target moves to the block's
 * nearest edge. `target` must be a line-start offset. */
export function snapOutOfBlocks(
  target: number,
  blocks: LineSpan[],
  docLength: number,
): DropTarget {
  for (const b of blocks) {
    // a line-start strictly inside the block (b.from itself = "before" = fine)
    if (target > b.from && target <= b.to) {
      if (target - b.from <= b.to - target) return b.from;
      return b.to + 1 > docLength ? "end" : b.to + 1;
    }
  }
  return target;
}

export interface MovePlan {
  /** Original-coordinate changes for one CM dispatch. */
  changes: { from: number; to?: number; insert: string }[];
  /** POST-change offset of the moved line's start (for reselecting it). */
  insertedAt: number;
}

/** Plan moving the line at `src` so it sits before `target` (a line-start) or
 * at the document end. Returns null when the move is a no-op. */
export function planLineMove(
  src: LineSpan,
  target: DropTarget,
  docLength: number,
  text: string,
): MovePlan | null {
  const cutTo = Math.min(docLength, src.to + 1); // the line + its newline
  if (target === "end") {
    if (cutTo === docLength) return null; // already the last line
    return {
      changes: [
        { from: src.from, to: cutTo, insert: "" },
        { from: docLength, insert: `\n${text}` },
      ],
      insertedAt: docLength - (cutTo - src.from) + 1,
    };
  }
  if (target >= src.from && target <= cutTo) return null; // dropped onto itself
  return {
    changes: [
      { from: src.from, to: cutTo, insert: "" },
      { from: target, insert: `${text}\n` },
    ],
    insertedAt: target > src.from ? target - (cutTo - src.from) : target,
  };
}
