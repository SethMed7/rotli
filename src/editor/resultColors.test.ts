import { expect, test } from "bun:test";

import { colorEdge, colorValue, isResultColorName, RESULT_COLOR_NAMES, selectedInk } from "./resultColors";

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
