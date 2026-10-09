import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { THEME_FAMILIES } from "../state/ui";
import { PANE_SCENES } from "./paneEmptyScenes";

describe("the empty pane's scenes", () => {
  test("every theme family has its own scene, and none stages a quokka", () => {
    const names = THEME_FAMILIES.map((family) => PANE_SCENES[family]?.name);
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(THEME_FAMILIES.length);
    // full-body characters live in Chat, Settings, and setup only
    for (const family of THEME_FAMILIES) expect("pose" in PANE_SCENES[family]).toBe(false);
  });

  test("a scene holds no color of its own: every paint comes from the theme's tokens", () => {
    for (const family of THEME_FAMILIES) {
      const markup = renderToStaticMarkup(<svg>{PANE_SCENES[family].art}</svg>);
      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(markup).not.toMatch(/\b(fill|stroke)="(?!none)/);
      expect(markup).not.toMatch(/rgba?\(|hsla?\(/);
    }
  });
});
