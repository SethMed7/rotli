// The rendered list ladder (the maintainer, 2026-08-01, next to Obsidian): one clean step
// per nesting level, the marker hugging its text in a narrow hanging column, and
// never a vertical indent-guide rule.

import { describe, expect, test } from "bun:test";

import {
  CHECK_EM,
  CHOICE_EM,
  GROUP_INSET_PX,
  MARKER_EM,
  RESULT_EM,
  STEP_EM,
  listStyle,
} from "./listGeometry";

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

  test("a multiple-choice option hangs by its radio control", () => {
    const s = listStyle(1, CHOICE_EM);
    expect(hangEm(s)).toBe(CHOICE_EM);
    expect(padEm(s)).toBeCloseTo(STEP_EM + CHOICE_EM, 5);
  });

  test("a grouped multi-choice row keeps an even panel inset without losing its hanging column", () => {
    const style = listStyle(0, CHOICE_EM, GROUP_INSET_PX);
    expect(style).toBe(`padding-left:calc(${CHOICE_EM}em + ${GROUP_INSET_PX}px);text-indent:-${CHOICE_EM}em`);
  });

  test("a two-choice result hangs by both buttons", () => {
    const s = listStyle(2, RESULT_EM);
    expect(hangEm(s)).toBe(RESULT_EM);
    expect(padEm(s)).toBeCloseTo(2 * STEP_EM + RESULT_EM, 5);
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

test("an ordered marker of two or more digits hangs in the wide column", async () => {
  const { MARKER_EM, WIDE_MARKER_EM, isWideMarker, numberMarkerEm } = await import("./listGeometry");
  expect(isWideMarker("1.")).toBe(false);
  expect(isWideMarker("9)")).toBe(false);
  expect(isWideMarker("10.")).toBe(true);
  expect(isWideMarker("iii.")).toBe(true);
  expect(numberMarkerEm("3.")).toBe(MARKER_EM);
  expect(numberMarkerEm("12.")).toBe(WIDE_MARKER_EM);
});
