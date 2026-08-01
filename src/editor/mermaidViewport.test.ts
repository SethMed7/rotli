import { describe, expect, test } from "bun:test";

import {
  MERMAID_MAX_SCALE,
  MERMAID_MIN_SCALE,
  clampMermaidScale,
  fitMermaidViewport,
  panMermaidViewport,
  zoomMermaidViewportAt,
} from "./mermaidViewport";

describe("Mermaid viewport", () => {
  test("zoom is bounded and keeps the anchor stationary", () => {
    const doubled = zoomMermaidViewportAt({ x: 10, y: 20, scale: 1 }, 2, { x: 110, y: 120 });
    expect(doubled).toEqual({ x: -90, y: -80, scale: 2 });
    expect(clampMermaidScale(100)).toBe(MERMAID_MAX_SCALE);
    expect(clampMermaidScale(0)).toBe(MERMAID_MIN_SCALE);
    expect(clampMermaidScale(Number.NaN)).toBe(1);
  });

  test("pan changes position without changing scale", () => {
    expect(panMermaidViewport({ x: 20, y: 30, scale: 1.25 }, { x: -5, y: 8 })).toEqual({
      x: 15,
      y: 38,
      scale: 1.25,
    });
  });

  test("fit centers content and accounts for padding", () => {
    const fitted = fitMermaidViewport({ x: 1000, y: 600 }, { x: 800, y: 400 }, 40);
    expect(fitted.x).toBeCloseTo(40);
    expect(fitted.y).toBeCloseTo(70);
    expect(fitted.scale).toBeCloseTo(1.15);
  });

  test("fit falls back safely for unmeasurable content", () => {
    expect(fitMermaidViewport({ x: 0, y: 600 }, { x: 800, y: 400 })).toEqual({
      x: 0,
      y: 0,
      scale: 1,
    });
  });

  test("fit does not over-enlarge a small diagram", () => {
    expect(fitMermaidViewport({ x: 1200, y: 800 }, { x: 200, y: 100 }).scale).toBe(2);
  });
});
