// The ordered-marker grammar every list consumer reads.

import { describe, expect, test } from "bun:test";

import { formatOrdinal, nextOrderedMarker, ORDERED_MARKER_SOURCE, parseOrderedMarker } from "./listMarkers";

describe("numeric markers", () => {
  test("parse the marker at the start of the text", () => {
    expect(parseOrderedMarker("12. x")).toEqual({ marker: "12.", ordinal: "12", value: 12, style: "number" });
    expect(parseOrderedMarker("1.")).toEqual({ marker: "1.", ordinal: "1", value: 1, style: "number" });
    expect(parseOrderedMarker("x 1. y")).toBeNull();
    expect(parseOrderedMarker("1) y")).toBeNull();
  });

  test("the next marker counts up; ordinals format as digits", () => {
    expect(nextOrderedMarker("3.")).toBe("4.");
    expect(nextOrderedMarker("- ")).toBeNull();
    expect(formatOrdinal("9", 10)).toBe("10");
  });

  test("the source matches a marker, not a decimal", () => {
    const re = new RegExp(`^${ORDERED_MARKER_SOURCE} `);
    expect(re.test("2. two")).toBe(true);
    expect(re.test("2.5 is a number")).toBe(false);
  });
});

describe("lettered markers", () => {
  test("one ASCII letter parses in its case; a–z count 1–26", () => {
    expect(parseOrderedMarker("a. x")).toEqual({ marker: "a.", ordinal: "a", value: 1, style: "lower" });
    expect(parseOrderedMarker("C. x")).toEqual({ marker: "C.", ordinal: "C", value: 3, style: "upper" });
    expect(parseOrderedMarker("z.")?.value).toBe(26);
  });

  test("two letters, non-ASCII letters, and roman numerals beyond one letter are not markers", () => {
    expect(parseOrderedMarker("ab. x")).toBeNull();
    expect(parseOrderedMarker("é. x")).toBeNull();
    expect(parseOrderedMarker("iv. x")).toBeNull();
  });

  test("letters count up in their case and stop past z", () => {
    expect(nextOrderedMarker("a.")).toBe("b.");
    expect(nextOrderedMarker("Y.")).toBe("Z.");
    expect(nextOrderedMarker("z.")).toBeNull();
    expect(formatOrdinal("q", 27)).toBeNull();
    expect(formatOrdinal("A", 4)).toBe("D");
  });
});
