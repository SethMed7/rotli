import { describe, expect, test } from "bun:test";

import { setupChoiceIndex } from "./setupControls";

describe("setup choice keyboard navigation", () => {
  test("arrows select the adjacent choice and wrap at both ends", () => {
    expect(setupChoiceIndex("ArrowRight", 0, 3)).toBe(1);
    expect(setupChoiceIndex("ArrowDown", 2, 3)).toBe(0);
    expect(setupChoiceIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(setupChoiceIndex("ArrowUp", 1, 3)).toBe(0);
  });

  test("visible number keys select directly but modified digits do not", () => {
    expect(setupChoiceIndex("2", 0, 4)).toBe(1);
    expect(setupChoiceIndex("2", 0, 4, true)).toBeNull();
  });

  test("unrelated keys stay available to the focused control", () => {
    expect(setupChoiceIndex("Enter", 0, 2)).toBeNull();
    expect(setupChoiceIndex("Tab", 0, 2)).toBeNull();
  });
});
