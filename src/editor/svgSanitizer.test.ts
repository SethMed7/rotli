import { describe, expect, test } from "bun:test";
import { svgAttributeAllowed } from "./svgSanitizer";

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
