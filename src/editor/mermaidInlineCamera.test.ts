// The inline Mermaid card and its fit agree on padding: a diagram the card was
// cut for renders at scale 1, centred — before, the fit padded 36px inside a
// card that only added 24px, so every inline chart shrank (2026-09-03).
import { describe, expect, test } from "bun:test";

import { INLINE_FIT_PADDING, inlineCardHeight, inlineFit } from "./mermaidInlineCamera";

describe("inline Mermaid card", () => {
  test("the card height is the diagram plus the fit padding, clamped", () => {
    expect(inlineCardHeight(174)).toBe(174 + INLINE_FIT_PADDING * 2);
    expect(inlineCardHeight(10)).toBe(160);
    expect(inlineCardHeight(5000)).toBe(460);
  });

  test("a diagram that fits its own card renders at natural size, centred", () => {
    const content = { x: 402, y: 174 };
    const fit = inlineFit({ x: 706, y: inlineCardHeight(content.y) }, content);
    expect(fit.scale).toBe(1);
    expect(fit.x).toBeCloseTo((706 - 402) / 2, 5);
    expect(fit.y).toBe(INLINE_FIT_PADDING);
  });

  test("a diagram taller than the card cap scales down to fit, never up past 2×", () => {
    const tall = inlineFit({ x: 706, y: 460 }, { x: 700, y: 500 });
    expect(tall.scale).toBeCloseTo((460 - INLINE_FIT_PADDING * 2) / 500, 5);
    const tiny = inlineFit({ x: 706, y: 160 }, { x: 40, y: 20 });
    expect(tiny.scale).toBe(2);
  });
});
