import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { THEME_FAMILIES } from "../../state/ui";
import {
  OnboardingIntro,
  OnboardingScenery,
  introWanted,
  onboardingSceneName,
  onboardingScenery,
} from "../onboarding/onboardingScenery";
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

// First run wears the same scenery (onboarding/onboardingScenery.tsx).
describe("first run's scenery", () => {
  test("Welcome is always the island; after it, the chosen family's own scene", () => {
    for (const family of THEME_FAMILIES) expect(onboardingSceneName(family, true)).toBe("island");
    expect(onboardingSceneName("warm", false)).toBe("island");
    expect(onboardingSceneName("ocean", false)).toBe("ocean");
    expect(onboardingSceneName("midnight", false)).toBe("midnight");
  });

  test("every family's backdrop is painted only with its tokens, on the ground line", () => {
    for (const family of THEME_FAMILIES) {
      for (const welcome of [true, false]) {
        const { name, sky, horizon } = onboardingScenery(family, welcome);
        expect(name).toBe(onboardingSceneName(family, welcome));
        noOwnColor(renderToStaticMarkup(<svg>{sky}</svg>));
        const floor = renderToStaticMarkup(<svg>{horizon}</svg>);
        expect(floor).toMatch(/sc-(ground|sand)/);
        noOwnColor(floor);
      }
    }
    // the island is Rotli's own shore: sea and a lighthouse
    expect(renderToStaticMarkup(<svg>{onboardingScenery("ocean", true).horizon}</svg>)).toContain("sc-light");
    expect(renderToStaticMarkup(<OnboardingScenery welcome />)).toContain('data-scenery="island"');
  });

  test("the intro is the island, with no color of its own, and only for a fresh Welcome", () => {
    const markup = renderToStaticMarkup(<OnboardingIntro onDone={() => {}} />);
    expect(markup).toContain("sc-sea");
    expect(markup).toContain("onb-intro-isle");
    noOwnColor(markup.replace(/<span class="onb-intro-quokka">[\s\S]*?<\/span>/, ""));
    expect(introWanted(false)).toBe(false);
  });
});
