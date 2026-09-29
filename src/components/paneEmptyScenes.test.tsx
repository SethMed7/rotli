import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { THEME_FAMILIES } from "../state/ui";
import { PANE_SCENES } from "./paneEmptyScenes";

describe("the empty pane's scenes", () => {
  test("every theme family has its own scene, each with a pose for the quokka", () => {
    const names = THEME_FAMILIES.map((family) => PANE_SCENES[family]?.name);
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(THEME_FAMILIES.length);
    for (const family of THEME_FAMILIES) expect(PANE_SCENES[family].pose).toBeTruthy();
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
