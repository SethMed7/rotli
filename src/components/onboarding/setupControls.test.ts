import { describe, expect, test } from "bun:test";

import { setupChoiceIndex, setupChoiceTargetIndex } from "./setupControls";

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

  test("arrows and numbers still use the selected card before the group has focus", () => {
    expect(setupChoiceTargetIndex("ArrowRight", -1, 1, 4)).toBe(2);
    expect(setupChoiceTargetIndex("ArrowLeft", -1, 0, 4)).toBe(3);
    expect(setupChoiceTargetIndex("3", -1, 0, 4)).toBe(2);
  });

  test("unrelated keys stay available to the focused control", () => {
    expect(setupChoiceIndex("Enter", 0, 2)).toBeNull();
    expect(setupChoiceIndex("Tab", 0, 2)).toBeNull();
  });
});
