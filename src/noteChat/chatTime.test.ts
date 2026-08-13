import { describe, expect, test } from "bun:test";

import { formatChatTime } from "./chatTime";

describe("chat timestamps", () => {
  test("keeps legacy date-only messages honest", () => {
    expect(formatChatTime("2026-08-12", "12")).toBe("2026-08-12");
  });

  test("supports both user-selected clocks", () => {
    const value = "2026-08-12T19:04:00.000Z";
    const twelve = formatChatTime(value, "12");
    const twentyFour = formatChatTime(value, "24");
    expect(twelve).toMatch(/\d{1,2}:04\s[AP]M/i);
    expect(twentyFour).toMatch(/\d{2}:04/);
  });
});
