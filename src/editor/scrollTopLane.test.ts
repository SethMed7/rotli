import { expect, test } from "bun:test";

import { scrollTopClashes } from "./scrollTopLane";

test("the arrow keeps its corner while the bar leaves the lane free", () => {
  expect(scrollTopClashes(900, 400)).toBe(false);
  expect(scrollTopClashes(532, 400)).toBe(false);
});

test("the arrow rises once the centered bar would reach its corner", () => {
  expect(scrollTopClashes(530, 400)).toBe(true);
  expect(scrollTopClashes(340, 250)).toBe(true);
});

test("no bar, no clash", () => {
  expect(scrollTopClashes(300, 0)).toBe(false);
});
