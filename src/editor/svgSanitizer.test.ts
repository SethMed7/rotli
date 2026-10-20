import { describe, expect, test } from "bun:test";

import { hasForbiddenControlChar, svgAttributeAllowed } from "./svgSanitizer";

describe("strict SVG attribute policy", () => {
  test("rejects event handlers, resource links, styles, and namespaced attributes", () => {
    expect(svgAttributeAllowed("onload", "run()", null)).toBe(false);
    expect(svgAttributeAllowed("href", "https://example.test/a", null)).toBe(false);
    expect(svgAttributeAllowed("style", "fill:url(https://example.test/a)", null)).toBe(false);
    expect(svgAttributeAllowed("href", "#local", "http://www.w3.org/1999/xlink")).toBe(false);
  });

  test("allows ordinary geometry and local paint references only", () => {
    expect(svgAttributeAllowed("viewBox", "0 0 20 20", null)).toBe(true);
    expect(svgAttributeAllowed("fill", "currentColor", null)).toBe(true);
    expect(svgAttributeAllowed("fill", "url(#gradient)", null)).toBe(true);
    expect(svgAttributeAllowed("fill", "url(https://example.test/paint)", null)).toBe(false);
    expect(svgAttributeAllowed("clip-path", "url(#clip)", null)).toBe(true);
    expect(svgAttributeAllowed("clip-path", "url(data:image/svg+xml,x)", null)).toBe(false);
  });
});

describe("attribute control characters", () => {
  // The character class the check replaced, rebuilt from escapes for comparison.
  const formerClass = new RegExp(["[", "\\u0000-\\u0008", "\\u000B\\u000C", "\\u000E-\\u001F", "]"].join(""));

  test("matches the former character class on every UTF-16 code unit", () => {
    for (let code = 0; code <= 0xffff; code++) {
      const ch = String.fromCharCode(code);
      expect([code, hasForbiddenControlChar(ch)]).toEqual([code, formerClass.test(ch)]);
    }
  });

  test("rejects a control character anywhere and keeps tab, newline, and normal text", () => {
    expect(svgAttributeAllowed("viewBox", "0 0\u000020 20", null)).toBe(false);
    expect(svgAttributeAllowed("viewBox", "0 0 20 20\u001F", null)).toBe(false);
    expect(svgAttributeAllowed("viewBox", "\u000B0 0 20 20", null)).toBe(false);
    expect(svgAttributeAllowed("viewBox", "0\t0\n20\r20", null)).toBe(true);
    expect(svgAttributeAllowed("viewBox", "0 0 20 20 \u007F\u2028é😀", null)).toBe(true);
    expect(hasForbiddenControlChar("")).toBe(false);
  });
});
