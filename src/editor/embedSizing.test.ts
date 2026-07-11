import { describe, expect, test } from "bun:test";
import {
  EMBED_MAX_HEIGHT,
  EMBED_MIN_HEIGHT,
  clampEmbedHeight,
  createEmbedSizeState,
  embedHeightLimit,
  fitExpandedEmbed,
  resizeEmbed,
  toggleEmbedExpanded,
} from "./embedSizing";

describe("embedded board sizing", () => {
  test("clamps drag heights to the usable viewport", () => {
    expect(clampEmbedHeight(40, 700)).toBe(EMBED_MIN_HEIGHT);
    expect(clampEmbedHeight(800, 700)).toBe(668);
    expect(embedHeightLimit(4_000)).toBe(EMBED_MAX_HEIGHT);
  });

  test("expand and collapse stay inline and restore the prior manual height", () => {
    const manuallySized = resizeEmbed(createEmbedSizeState(), 420, 900);
    const expanded = toggleEmbedExpanded(manuallySized, 900);

    expect(expanded).toEqual({ height: 868, collapsedHeight: 420, expanded: true });
    expect(toggleEmbedExpanded(expanded, 900)).toEqual({
      height: 420,
      collapsedHeight: 420,
      expanded: false,
    });
  });

  test("dragging an expanded board makes the dragged size its collapsed size", () => {
    const expanded = toggleEmbedExpanded(createEmbedSizeState(300), 800);
    expect(resizeEmbed(expanded, 510, 800)).toEqual({
      height: 510,
      collapsedHeight: 510,
      expanded: false,
    });
  });

  test("an expanded board follows pane height changes without losing its restore size", () => {
    const expanded = toggleEmbedExpanded(createEmbedSizeState(360), 900);
    expect(fitExpandedEmbed(expanded, 640)).toEqual({
      height: 608,
      collapsedHeight: 360,
      expanded: true,
    });
  });
});
