import { expect, test } from "bun:test";

import { resolveLine } from "./resolveLine";

const body = ["# Plan", "- [ ] call the bank", "", "- [ ] order cake", "- [ ] call the bank again"];

test("the reported line wins when it still holds the words", () => {
  expect(resolveLine(body, 3, "order cake")).toBe(3);
});

test("a note edited since the list was made resolves to the nearest line with those words", () => {
  expect(resolveLine(body, 2, "order cake")).toBe(3);
  expect(resolveLine(body, 5, "call the bank")).toBe(4);
  expect(resolveLine(body, 0, "call the bank")).toBe(1);
});

test("no such words, or none given, moves nothing", () => {
  expect(resolveLine(body, 1, "not here")).toBe(-1);
  expect(resolveLine(body, 1, "   ")).toBe(-1);
});
