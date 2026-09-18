import { expect, test } from "bun:test";

import { placeMenu } from "./menuPlacement";

const viewport = { width: 1200, height: 800 };
const menu = { width: 220, height: 300 };

test("with room, the menu opens right and down from the pointer", () => {
  expect(placeMenu({ x: 100, y: 100 }, menu, viewport)).toEqual({ left: 100, top: 100 });
});

test("near the right edge it flips to END at the pointer, never sliding over it", () => {
  const placed = placeMenu({ x: 1100, y: 100 }, menu, viewport);
  expect(placed.left).toBe(1100 - 220);
  expect(placed.left + menu.width).toBeLessThanOrEqual(1100);
});

test("near the bottom it flips up", () => {
  expect(placeMenu({ x: 100, y: 700 }, menu, viewport).top).toBe(700 - 300);
});

test("a menu that fits on neither side stays on screen", () => {
  const tall = { width: 220, height: 780 };
  const placed = placeMenu({ x: 100, y: 400 }, tall, viewport);
  // 800 tall, 780 of menu: pinned a pad above the bottom edge
  expect(placed.top).toBe(12);
  expect(placed.top).toBeGreaterThanOrEqual(8);
  expect(placed.top + tall.height).toBeLessThanOrEqual(viewport.height);
});
