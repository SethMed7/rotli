import { describe, expect, test } from "bun:test";

import { daysSinceMidnight, relativeLabel } from "./dateLabels";

describe("date labels", () => {
  test("uses the supplied clock for deterministic relative labels", () => {
    const now = new Date(2026, 7, 18, 12, 0, 0).getTime();
    expect(relativeLabel(now - 5 * 60_000, now)).toBe("5m");
    expect(relativeLabel(now - 3 * 60 * 60_000, now)).toBe("3h");
  });

  test("counts local calendar boundaries from the supplied clock", () => {
    const now = new Date(2026, 7, 18, 0, 5, 0).getTime();
    const yesterday = new Date(2026, 7, 17, 23, 55, 0).getTime();
    expect(daysSinceMidnight(yesterday, now)).toBe(1);
  });
});
