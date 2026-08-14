import { describe, expect, test } from "bun:test";

import { isRetentionEligible, parseRetentionDays } from "./retentionPolicy";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

describe("automatic retention policy", () => {
  test("is disabled by null and rejects invalid day counts", () => {
    expect(isRetentionEligible({ updatedAt: NOW - 90 * DAY }, null, NOW)).toBe(false);
    expect(parseRetentionDays(0)).toBeNull();
    expect(parseRetentionDays(-1)).toBeNull();
    expect(parseRetentionDays(3651)).toBeNull();
    expect(parseRetentionDays("30")).toBeNull();
    expect(parseRetentionDays(30.9)).toBe(30);
  });

  test("selects an item only after the configured inactivity boundary", () => {
    expect(isRetentionEligible({ updatedAt: NOW - 29 * DAY }, 30, NOW)).toBe(false);
    expect(isRetentionEligible({ updatedAt: NOW - 30 * DAY }, 30, NOW)).toBe(true);
  });

  test("viewing is activity even when the durable file is old", () => {
    expect(isRetentionEligible({ updatedAt: NOW - 90 * DAY, viewedAt: NOW - 2 * DAY }, 30, NOW)).toBe(false);
  });

  test("pinned, open, and unreadable candidates fail closed", () => {
    expect(isRetentionEligible({ updatedAt: NOW - 90 * DAY, pinned: true }, 30, NOW)).toBe(false);
    expect(isRetentionEligible({ updatedAt: NOW - 90 * DAY, open: true }, 30, NOW)).toBe(false);
    expect(isRetentionEligible({ updatedAt: 0 }, 30, NOW)).toBe(false);
    expect(isRetentionEligible({ updatedAt: Number.NaN }, 30, NOW)).toBe(false);
  });
});
