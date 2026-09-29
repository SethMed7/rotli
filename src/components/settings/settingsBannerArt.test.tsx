import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { THEME_FAMILIES } from "../../state/ui";
import { SETTINGS_BACKDROPS } from "./settingsBackdropArt";
import { BANNER_BACKDROPS, BANNER_MOTIFS } from "./settingsBannerArt";

const noOwnColor = (markup: string) => {
  expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(markup).not.toMatch(/\b(fill|stroke)="(?!none)/);
  expect(markup).not.toMatch(/rgba?\(|hsla?\(/);
};

describe("Settings banners", () => {
  test("every theme family has a backdrop, painted only with the theme's tokens", () => {
    for (const family of THEME_FAMILIES) {
      const markup = renderToStaticMarkup(<svg>{BANNER_BACKDROPS[family]}</svg>);
      expect(markup).toMatch(/sc-(ground|sand)/);
      noOwnColor(markup);
    }
  });

  test("every pane's motif is drawn, and none carries a color of its own", () => {
    for (const [motif, art] of Object.entries(BANNER_MOTIFS)) {
      const markup = renderToStaticMarkup(<svg>{art}</svg>);
      expect(markup.length, motif).toBeGreaterThan(40);
      noOwnColor(markup);
    }
  });

  test("every theme family has page scenery, a sky and a horizon, with no color of its own", () => {
    for (const family of THEME_FAMILIES) {
      const { sky, horizon } = SETTINGS_BACKDROPS[family];
      noOwnColor(renderToStaticMarkup(<svg>{sky}</svg>));
      const floor = renderToStaticMarkup(<svg>{horizon}</svg>);
      expect(floor).toMatch(/sc-(ground|sand)/);
      noOwnColor(floor);
    }
  });
});
