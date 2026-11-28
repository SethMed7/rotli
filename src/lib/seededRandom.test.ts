import { expect, test } from "bun:test";

import { seededRandom } from "./seededRandom";

test("the same seed gives the same sequence, in [0, 1)", () => {
  const a = seededRandom(20261124);
  const b = seededRandom(20261124);
  const first = Array.from({ length: 50 }, a);
  expect(Array.from({ length: 50 }, b)).toEqual(first);
  expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  expect(Array.from({ length: 50 }, seededRandom(7))).not.toEqual(first);
});
