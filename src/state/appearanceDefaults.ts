// The one appearance default: Rotli Light with the theme's own accent. First
// run, Skip, Reset & re-onboard, and a fresh install all start here; the ui
// store's initial state reads it too, so there is no second copy to drift.
// Literal-typed on purpose: ui.ts imports this file, so it cannot import the
// store's unions back without a module cycle.

export const DEFAULT_ACCENT_HUE = 210;

export const DEFAULT_APPEARANCE = {
  theme: "light",
  themeFamily: "warm",
  syntaxPalette: "rotli",
  accentColor: "default",
  accentHue: DEFAULT_ACCENT_HUE,
} as const;
