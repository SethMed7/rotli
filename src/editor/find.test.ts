import { describe, expect, test } from "bun:test";

import { findTextMatches, nextFindMatch } from "./find";

describe("active-file find", () => {
  test("finds every case-insensitive occurrence", () => {
    expect(findTextMatches("Alpha beta ALPHA", "alpha")).toEqual([
      { from: 0, to: 5 },
      { from: 11, to: 16 },
    ]);
  });

  test("wraps next and previous navigation", () => {
    const matches = findTextMatches("one two one", "one");
    expect(nextFindMatch(matches, 1, 1)).toBe(0);
    expect(nextFindMatch(matches, 0, -1)).toBe(1);
  });
});
