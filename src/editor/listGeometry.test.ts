// The rendered list ladder (Seth, 2026-08-01, next to Obsidian): one clean step
// per nesting level, the marker hugging its text in a narrow hanging column, and
// never a vertical indent-guide rule.

import { describe, expect, test } from "bun:test";

import { CHECK_EM, MARKER_EM, STEP_EM, listStyle } from "./listGeometry";

/** padding-left, in em, out of a style string. */
function padEm(style: string): number {
  return Number(/padding-left:([\d.]+)em/.exec(style)?.[1]);
}

/** the hanging pull-back, in em (text-indent is negative). */
function hangEm(style: string): number {
  return Number(/text-indent:-([\d.]+)em/.exec(style)?.[1]);
}

describe("list geometry", () => {
  test("a top-level item starts at the paragraph's left edge", () => {
    // padding-left cancels the hang exactly → the first line begins at 0 and
    // wrapped lines align under the text
    const s = listStyle(0);
    expect(padEm(s)).toBe(MARKER_EM);
    expect(hangEm(s)).toBe(MARKER_EM);
  });

  test("each nesting level shifts the whole item by exactly one step", () => {
    for (let depth = 0; depth < 4; depth++) {
      expect(padEm(listStyle(depth + 1)) - padEm(listStyle(depth))).toBeCloseTo(STEP_EM, 5);
      expect(hangEm(listStyle(depth))).toBe(MARKER_EM); // the marker column never grows with depth
    }
  });

  test("the step is wider than the marker column — the bullet hugs its text", () => {
    // a marker column narrower than the step is what keeps the glyph next to the
    // words instead of adrift at the far left of the level
    expect(MARKER_EM).toBeLessThan(STEP_EM);
  });

  test("a task hangs by the checkbox column so its wrapped lines still align", () => {
    const s = listStyle(1, CHECK_EM);
    expect(hangEm(s)).toBe(CHECK_EM);
    expect(padEm(s)).toBeCloseTo(STEP_EM + CHECK_EM, 5);
  });

  test("depth is spacing ONLY — no border, guide rule, or background", () => {
    for (let depth = 0; depth < 5; depth++) {
      const s = listStyle(depth);
      expect(s).toMatch(/^padding-left:[\d.]+em;text-indent:-[\d.]+em$/);
      expect(s).not.toMatch(/border|background|outline/);
    }
  });

  test("em values never leak float noise into the style attribute", () => {
    for (let depth = 0; depth < 8; depth++) {
      expect(listStyle(depth)).not.toMatch(/\d{6,}/);
    }
  });
});
