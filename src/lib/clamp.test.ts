import { describe, expect, test } from "bun:test";
import { clamp } from "./clamp";

describe("clamp", () => {
  test("passes through values inside the band", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test("clamps both edges", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
    expect(clamp(0.01, 0.05, 8)).toBe(0.05); // the zoom band's fractional floor
  });

  test("hi wins on an inverted band (caller bug, but deterministic)", () => {
    expect(clamp(5, 10, 0)).toBe(0);
  });
});
