// The ordered-marker grammar every list consumer reads.

import { describe, expect, test } from "bun:test";

import { formatOrdinal, nextOrderedMarker, ORDERED_MARKER_SOURCE, parseOrderedMarker } from "./listMarkers";

describe("numeric markers", () => {
  test("parse the marker at the start of the text", () => {
    expect(parseOrderedMarker("12. x")).toEqual({ marker: "12.", ordinal: "12", value: 12 });
    expect(parseOrderedMarker("1.")).toEqual({ marker: "1.", ordinal: "1", value: 1 });
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
