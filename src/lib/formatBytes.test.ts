import { expect, test } from "bun:test";

import { formatBytes } from "./formatBytes";

test("bytes, then KB and MB with one decimal below ten", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1023)).toBe("1023 B");
  expect(formatBytes(46 * 1024)).toBe("46 KB");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(130 * 1024 * 1024)).toBe("130 MB");
});

test("a size nobody can measure reads as an em dash, never a guess", () => {
  expect(formatBytes(Number.NaN)).toBe("—");
  expect(formatBytes(-5)).toBe("—");
});
