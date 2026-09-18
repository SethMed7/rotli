// The rendered geometry of a list/task line — pure numbers, kept out of
// livePreview (which is DOM/CM-bound) so the shape is unit-testable and lives in
// ONE place. Mirrored by .rotli-marker / .rotli-check in styles/editor.css.
//
// The shape (the maintainer, 2026-08-01, comparing rotli to Obsidian):
//   • every nesting level shifts the WHOLE item right by exactly one STEP, so
//     depth reads as a clean ladder instead of loose, drifting spacing;
//   • the marker (bullet/number/checkbox) hangs in a narrow column right next to
//     its text — the glyph hugs the words, never adrift at the far left — and
//     wrapped lines align under the text, not under the marker;
//   • NO vertical indent-guide rules. Obsidian draws a thin line per level;
//     rotli never does ("I don't like the lines when you do the tab"). This
//     module only ever emits padding/indent — no borders, no backgrounds.

/** One nesting level, in em (a step wider than the marker column, so levels are
 * legible without the item drifting away from its parent). */
export const STEP_EM = 1.5;

/** The hanging column a bullet/number sits in: the glyph plus its gap to the
 * text. Mirrors `.rotli-marker { width }`. */
export const MARKER_EM = 1.15;

/** A numbered run sizes its column to its WIDEST marker, and every item in the
 * run uses it, so the numbers share a left edge and the text a left edge (the
 * owner, 2026-09-18: first a list jumped right as it crossed ten; then, with a
 * right-aligned column, "1." sat indented — "the first number should always
 * align"). Runs renumber in sequence, so the widest is the last item.
 *
 * One character keeps the glyph column every bullet uses, so a short list looks
 * as it always has. Mirrors `.rotli-marker.num` / `.two` / `.wide`. */
export const NUMBER_EM = 1.75;

/** Three or more characters ("100.", "iii."). */
export const WIDE_MARKER_EM = 2.35;

export type NumberColumn = "one" | "two" | "wide";

/** The column for a run whose widest ordinal has `widest` characters. */
export function numberColumn(widest: number): NumberColumn {
  return widest >= 3 ? "wide" : widest === 2 ? "two" : "one";
}

export function numberColumnEm(column: NumberColumn): number {
  return column === "wide" ? WIDE_MARKER_EM : column === "two" ? NUMBER_EM : MARKER_EM;
}

/** A checkbox needs a wider column than a glyph — `.rotli-check` is a 1.1em box
 * with a 0.5em gap, so a task hangs by that instead and its wrapped lines still
 * land under its text. */
export const CHECK_EM = 1.6;

/** A single-choice radio uses the same box-plus-gap geometry as a task. */
export const CHOICE_EM = 1.6;

/** A compact answer panel needs breathing room before its hanging control.
 * Kept in px so the panel gutter follows Rotli's 4-point spacing scale while
 * the marker column continues to scale with editor typography. */
export const GROUP_INSET_PX = 12;

/** Two 1.1em result buttons, their small internal gap, and the gap before the
 * row text. Mirrors `.rotli-result` in styles/editor.css. */
export const RESULT_EM = 2.9;

/** em values are authored by hand, so trim float noise (1.5 * 3 + 1.15) before
 * it reaches a style attribute. */
const em = (n: number): string => String(Number(n.toFixed(4)));

/**
 * The inline style for a list/task line at `depth` (0 = top level). `markerEm`
 * is the hanging marker column — MARKER_EM for bullets/numbers, CHECK_EM for
 * tasks.
 */
export function listStyle(depth: number, markerEm: number = MARKER_EM, insetPx: number = 0): string {
  const padding = `${em(depth * STEP_EM + markerEm)}em`;
  const padded = insetPx > 0 ? `calc(${padding} + ${insetPx}px)` : padding;
  return `padding-left:${padded};text-indent:-${em(markerEm)}em`;
}
