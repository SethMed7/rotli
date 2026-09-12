import { expect, test } from "bun:test";

import { colorChoices, colorHotkey, colorPickAt } from "./colorPickState";

test("a colon inside a result or toggle bracket opens the picker with the typed letters", () => {
  expect(colorPickAt("- [True:", 8)).toEqual({ from: 8, to: 8, query: "" });
  expect(colorPickAt("- [True:gr", 10)).toEqual({ from: 8, to: 10, query: "gr" });
  expect(colorPickAt("- [True:green][False:re", 23)).toMatchObject({ query: "re" });
  expect(colorPickAt("- [:blue|:pi", 12)).toMatchObject({ from: 10, query: "pi" });
  expect(colorPickAt("1. [Yes:", 8)).toMatchObject({ query: "" });
});

test("the first box typed at the start of a line opens the picker before Space expands the row", () => {
  expect(colorPickAt("[True:gre", 9)).toEqual({ from: 6, to: 9, query: "gre" });
  expect(colorPickAt("  [Yes:", 7)).toMatchObject({ from: 7, query: "" });
  expect(colorPickAt("[:", 2)).toMatchObject({ query: "" });
  expect(colorPickAt("Some [note:", 11)).toBeNull();
});

test("prose, links, closed brackets, hex values, and code stay quiet", () => {
  expect(colorPickAt("see [note:", 10)).toBeNull();
  expect(colorPickAt("- [True:green] done at 10:", 26)).toBeNull();
  expect(colorPickAt("- [True:#E3", 11)).toBeNull();
  expect(colorPickAt("- `[True:", 9)).toBeNull();
  expect(colorPickAt("- [True:green", 8)).toBeNull();
});

test("choices keep rainbow order, filter by prefix, and number keys map to the first ten", () => {
  expect(colorChoices("").join(" ")).toBe(
    "red orange yellow green cyan blue purple pink brown black white neutral accent",
  );
  expect(colorChoices("b")).toEqual(["blue", "brown", "black"]);
  expect(colorChoices("zz")).toEqual([]);
  expect([0, 8, 9, 10].map(colorHotkey)).toEqual(["1", "9", "0", null]);
});
