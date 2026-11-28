// The one appearance default: Rotli Light with the theme's own accent. First
// run, Skip, Reset & re-onboard, and a fresh install all start here; the ui
// store's initial state reads it too, so there is no second copy to drift.
// Literal-typed on purpose: ui.ts imports this file, so it cannot import the
// store's unions back without a module cycle.

import { hostThemeFamily } from "../host/registry";
import type { ThemeFamily } from "./themeChoices";

export const DEFAULT_ACCENT_HUE = 210;

export const DEFAULT_APPEARANCE = {
  theme: "light",
  themeFamily: "warm",
  syntaxPalette: "rotli",
  accentColor: "default",
  accentHue: DEFAULT_ACCENT_HUE,
  boardBackground: "theme",
} as const;

/** The appearance a fresh start uses: Rotli's default, on the theme family a
 * host chose when one did (docs/architecture/host-seams.md). Read at each use,
 * never kept, so it is read only after a host registers. */
export function defaultAppearance(): Omit<typeof DEFAULT_APPEARANCE, "themeFamily"> & {
  themeFamily: ThemeFamily;
} {
  return { ...DEFAULT_APPEARANCE, themeFamily: hostThemeFamily() ?? DEFAULT_APPEARANCE.themeFamily };
}
