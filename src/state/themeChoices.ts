// The theme families as the titlebar sun and Settings → Appearance present
// them: the solid environments in cycling order, and each family's name,
// blurb, and swatches. Data only; a seam beside ui.ts, which sits at its size
// ceiling (re-exported there so every importer is unchanged).

export const THEME_FAMILIES = ["warm", "mono", "ocean", "grove", "iris", "midnight"] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

/** Solid environments, in the order the titlebar sun cycles them. */
export const SOLID_THEMES: {
  family: ThemeFamily;
  mode: "light" | "dark";
  label: string;
}[] = [
  { family: "warm", mode: "light", label: "Warm Light" },
  { family: "warm", mode: "dark", label: "Warm Dark" },
  { family: "mono", mode: "light", label: "Paper" },
  { family: "mono", mode: "dark", label: "Charcoal" },
  { family: "ocean", mode: "light", label: "Ocean Light" },
  { family: "ocean", mode: "dark", label: "Ocean Dark" },
  { family: "grove", mode: "light", label: "Grove Light" },
  { family: "grove", mode: "dark", label: "Grove Dark" },
  { family: "iris", mode: "light", label: "Iris Light" },
  { family: "iris", mode: "dark", label: "Iris Dark" },
  { family: "midnight", mode: "light", label: "Moonlight" },
  { family: "midnight", mode: "dark", label: "Midnight" },
];

/** Settings/onboarding presentation. Each family is one theme with a light and
 * dark environment; System can choose two families independently. */
export const THEME_FAMILY_PRESENTATIONS: readonly {
  family: ThemeFamily;
  label: string;
  description: string;
  lightLabel: string;
  darkLabel: string;
}[] = [
  {
    family: "warm",
    label: "Rotli",
    description: "Clay and cream by day, cocoa at night.",
    lightLabel: "Warm Light",
    darkLabel: "Warm Dark",
  },
  {
    family: "mono",
    label: "Paper & Charcoal",
    description: "Paper in Light, Charcoal in Dark.",
    lightLabel: "Paper",
    darkLabel: "Charcoal",
  },
  {
    family: "ocean",
    label: "Ocean",
    description: "Airy blue by day, deep water at night.",
    lightLabel: "Ocean Light",
    darkLabel: "Ocean Dark",
  },
  {
    family: "grove",
    label: "Grove",
    description: "Soft green by day, forest at night.",
    lightLabel: "Grove Light",
    darkLabel: "Grove Dark",
  },
  {
    family: "iris",
    label: "Iris",
    description: "Lavender by day, inked violet at night.",
    lightLabel: "Iris Light",
    darkLabel: "Iris Dark",
  },
  {
    family: "midnight",
    label: "Midnight",
    description: "Cool white by day, near-black at night.",
    lightLabel: "Moonlight",
    darkLabel: "Midnight",
  },
];
