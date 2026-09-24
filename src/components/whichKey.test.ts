import { expect, test } from "bun:test";

import { mapsOn, pickRangeRows } from "./whichKey";

test("the map lists what fires on the surface: its own, opted in, and shared", () => {
  expect(mapsOn({ surface: "quick" }, "quick")).toBe(true);
  // ⌘⇧L is main's, opted into the Quick Note: it must show there
  expect(mapsOn({ surface: "main", also: ["quick"] }, "quick")).toBe(true);
  expect(mapsOn({ surface: "main", shared: true }, "quick")).toBe(true);
  expect(mapsOn({ surface: "main" }, "quick")).toBe(false);
  expect(mapsOn({ surface: "main", global: true }, "main")).toBe(false);
});

test("the picker jumps collapse per half only while all nine are bound", () => {
  const all = pickRangeRows((row) => (row <= 9 ? `⌘${row}` : `⇧⌘${row - 9}`));
  expect(all.ranges.map((r) => r.chord)).toEqual(["⌘1–⌘9", "⇧⌘1–⇧⌘9"]);
  expect(all.singles).toEqual([]);
});

test("after a rebinding every still-bound jump stays on the map", () => {
  // row 1 unbound, row 12 unbound: nothing bound may vanish
  const some = pickRangeRows((row) => (row === 1 || row === 12 ? null : `k${row}`));
  expect(some.ranges).toEqual([]);
  expect(some.singles).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18]);
});
