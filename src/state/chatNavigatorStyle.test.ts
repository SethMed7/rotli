import { describe, expect, test } from "bun:test";

import { navigatorChoices, resolveNavigatorStyle } from "./chatNavigatorStyle";

describe("Tesven's navigator trail", () => {
  test("Tesven offers hexagons in place of both quokka trails, in light and dark", () => {
    for (const theme of ["tesven-light", "tesven-dark"]) {
      expect(navigatorChoices(theme)).toEqual(["lines", "dots", "hexes"]);
      expect(resolveNavigatorStyle("paws", theme)).toBe("hexes");
      expect(resolveNavigatorStyle("ears", theme)).toBe("hexes");
      expect(resolveNavigatorStyle("lines", theme)).toBe("lines");
      expect(resolveNavigatorStyle("dots", theme)).toBe("dots");
    }
  });

  test("every other theme keeps the quokka trails and never shows hexagons", () => {
    for (const theme of ["light", "dark", "paper", "ocean-dark", "midnight-light", undefined]) {
      expect(navigatorChoices(theme)).toEqual(["lines", "dots", "paws", "ears"]);
      expect(resolveNavigatorStyle("hexes", theme)).toBe("paws");
      expect(resolveNavigatorStyle("ears", theme)).toBe("ears");
    }
  });
});

describe("a host with no mascot", () => {
  test("offers no quokka trail, and a stored one falls back to the quiet lines", () => {
    for (const theme of ["light", "ocean-dark", undefined]) {
      expect(navigatorChoices(theme, false)).toEqual(["lines", "dots"]);
      expect(resolveNavigatorStyle("paws", theme, false)).toBe("lines");
      expect(resolveNavigatorStyle("ears", theme, false)).toBe("lines");
      expect(resolveNavigatorStyle("hexes", theme, false)).toBe("lines");
      expect(resolveNavigatorStyle("dots", theme, false)).toBe("dots");
    }
  });
});
