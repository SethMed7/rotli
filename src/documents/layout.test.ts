import { describe, expect, test } from "bun:test";
import { documentFitZoom } from "./layout";

describe("documentFitZoom", () => {
  test("keeps a full-size page when the pane can contain it", () => {
    expect(documentFitZoom(1200, 1200)).toBe(1);
  });

  test("shrinks the whole page to prevent horizontal panning", () => {
    expect(documentFitZoom(684, 1200)).toBeCloseTo(0.75);
  });

  test("fits page height instead of opening on an oversized blank region", () => {
    expect(documentFitZoom(1600, 822)).toBeCloseTo(0.75);
  });

  test("has a stable fallback and readable lower bound", () => {
    expect(documentFitZoom(0)).toBe(1);
    expect(documentFitZoom(20)).toBe(0.1);
  });
});
