// What a heading's section OWNS — the fold math, kept free of CodeMirror so the
// nesting rules are provable without a DOM (the same split mermaidFlowLayout.ts
// uses against its editor).
//
// A section runs from the END of its heading line to just before the next
// heading of the SAME OR HIGHER level: folding an H2 takes its H3s with it and
// never swallows the H2 that follows. A `#` inside a fenced block is code, not
// a heading — the law the rest of the editor already follows.

/** A line reduced to what the fold math needs. */
export interface FoldLine {
  /** 1–6 for a heading, 0 for anything else (including a `#` inside a fence). */
  level: number;
  from: number;
  to: number;
}

/** A heading needs a space AND text — "#" and "#nospace" are prose. */
const HEADING = /^(#{1,6}) \S/;

/** Classify every line once: heading level, or 0. Fence-aware. */
export function foldLines(lines: readonly string[], offsets: readonly number[]): FoldLine[] {
  const out: FoldLine[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    const from = offsets[i] ?? 0;
    if (text.trimStart().startsWith("```")) {
      fenced = !fenced;
      out.push({ level: 0, from, to: from + text.length });
      continue;
    }
    const m = fenced ? null : HEADING.exec(text);
    out.push({ level: m ? (m[1]?.length ?? 0) : 0, from, to: from + text.length });
  }
  return out;
}

/**
 * The range a heading on line `index` folds away, or null when it owns nothing
 * (the next line already starts a sibling, or it isn't a heading at all —
 * either way there must be no fold affordance to press).
 *
 * The range starts at the heading's line END so the heading itself stays
 * visible: that is the point — see the outline, hide the prose.
 */
export function headingFoldRange(
  lines: readonly FoldLine[],
  index: number,
): { from: number; to: number } | null {
  const head = lines[index];
  if (!head || head.level === 0) return null;
  let end = head.to;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.level > 0 && line.level <= head.level) break; // a sibling/shallower heading ends it
    end = line.to;
  }
  return end > head.to ? { from: head.to, to: end } : null;
}
