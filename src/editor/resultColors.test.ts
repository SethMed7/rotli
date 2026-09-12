import { expect, test } from "bun:test";

import {
  colorEdge,
  colorValue,
  isResultColorName,
  RESULT_COLOR_NAMES,
  rotateColors,
  selectedInk,
} from "./resultColors";

test("every named color maps to a theme token and readable ink; hex passes through", () => {
  for (const name of RESULT_COLOR_NAMES) {
    expect(colorValue(name)).toMatch(/^var\(--/);
    expect(selectedInk(name)).toMatch(/^var\(--/);
  }
  const amber = `#${"E3B341"}`;
  const navy = `#${"102030"}`;
  expect(colorValue(amber)).toBe(amber);
  expect(selectedInk(amber)).toMatch(/cocoa/);
  expect(selectedInk(navy)).toMatch(/linen/);
});

test("black and white get a border edge of their own; others use their color", () => {
  expect(colorEdge("white")).toBe("var(--border)");
  expect(colorEdge("black")).toBe("var(--border)");
  expect(colorEdge("blue")).toBe(colorValue("blue"));
  expect(isResultColorName("pink")).toBe(true);
  expect(isResultColorName("teal")).toBe(false);
});

test("rotation fills empty slots with distinct colors, skips hand-picked ones, and repeats only when spent", () => {
  expect(rotateColors([null, null, null])).toEqual(["blue", "purple", "orange"]);
  expect(rotateColors(["blue", null, "orange", null])).toEqual(["blue", "purple", "orange", "cyan"]);
  const spent = rotateColors(Array.from({ length: 10 }, () => null));
  expect(new Set(spent.slice(0, 9)).size).toBe(9);
  expect(spent[9]).toBe(spent[0]);
  expect(rotateColors([])).toEqual([]);
});
