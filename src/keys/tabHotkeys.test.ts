import { describe, expect, test } from "bun:test";

import { tabHotkeyAction } from "./tabHotkeys";

describe("tabHotkeyAction", () => {
  test("labels a short strip with its exact Command-number positions", () => {
    expect([0, 1, 2].map((index) => tabHotkeyAction(index, 3))).toEqual([
      "tabs.jump1",
      "tabs.jump2",
      "tabs.jump3",
    ]);
  });

  test("reserves Command-9 for the final tab after the eight direct positions", () => {
    expect(tabHotkeyAction(7, 10)).toBe("tabs.jump8");
    expect(tabHotkeyAction(8, 10)).toBeUndefined();
    expect(tabHotkeyAction(9, 10)).toBe("tabs.last");
  });
});
