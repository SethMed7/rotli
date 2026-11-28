// The custom-theme engine's fixed inputs. Every value that mirrors a
// stylesheet (ALPHA, LABELS, ACCENT_PRESETS) is pinned to that stylesheet by
// policy.test.ts, so the engine measures what Rotli actually paints.

export type Mode = "light" | "dark";
export const MODES: readonly Mode[] = ["light", "dark"];

/** The engine and file-format version together. v1 is frozen by
 * goldens.json: the same seeds always give the same tokens. */
export const ENGINE_VERSION = 1;

export type ContrastLevel = "soft" | "standard" | "high";
export const CONTRAST_LEVELS: readonly ContrastLevel[] = ["soft", "standard", "high"];

/** `aim` is what text on the page reaches for and `page` what it must reach.
 * `main` is the floor for every kind of text on the page and on a card (every
 * other text pair is held to 4.5). `ui` is the accent's floor on the page and
 * on a card (3 elsewhere). */
export const LEVELS: Readonly<
  Record<ContrastLevel, { aim: number; page: number; main: number; ui: number }>
> = {
  soft: { aim: 9, page: 7, main: 4.5, ui: 3 },
  standard: { aim: 12, page: 9, main: 4.5, ui: 3 },
  high: { aim: 15, page: 11, main: 7, ui: 4.5 },
};

/** An own-key check: "constructor" or "__proto__" is not a level. */
export function asContrastLevel(value: unknown): ContrastLevel {
  return typeof value === "string" && (CONTRAST_LEVELS as readonly string[]).includes(value)
    ? (value as ContrastLevel)
    : "standard";
}

/** A light page stays light and a dark page stays dark; nothing neon. */
export const PAGE_BAND: Readonly<Record<Mode, { l: readonly [number, number]; c: number }>> = {
  light: { l: [0.9, 0.99], c: 0.04 },
  dark: { l: [0.11, 0.26], c: 0.05 },
};

/** The alphas base.css and canvas.css paint with (policy.test.ts pins them). */
export const ALPHA = {
  selected: 0.11,
  selectedHover: 0.15,
  selection: 0.3,
  hov: { light: 0.07, dark: 0.08 },
  act: { light: 0.11, dark: 0.13 },
  boardContainer: 0.22,
  boardAccent: 0.85,
  borderStrong: 0.24,
  disabled: 0.5,
} as const;

export const LABEL_NAMES = ["blue", "green", "violet", "rose", "amber", "orange", "cyan", "brown"] as const;
export type LabelName = (typeof LABEL_NAMES)[number];

/** The label palette as themes.css ships it, the starting point per scheme. */
export const LABELS: Readonly<Record<Mode, Readonly<Record<LabelName, string>>>> = {
  light: {
    blue: "#2f6fae",
    green: "#3f7d51",
    violet: "#6a5ab2",
    rose: "#ad5470",
    amber: "#9a6f1e",
    orange: "#b8621f",
    cyan: "#1f7f8f",
    brown: "#6f4a2c",
  },
  dark: {
    blue: "#78b7e3",
    green: "#8fc9a0",
    violet: "#b3a6ee",
    rose: "#e3a0b3",
    amber: "#dfb15f",
    orange: "#e79a5c",
    cyan: "#7ccfdc",
    brown: "#b98a66",
  },
};

export const ACCENT_PRESET_NAMES = ["blue", "green", "violet", "rose", "amber"] as const;
export type AccentPresetName = (typeof ACCENT_PRESET_NAMES)[number];

/** The five Primary-color presets (`data-accent`), as themes.css paints them. */
export const ACCENT_PRESETS: Readonly<Record<AccentPresetName, Readonly<Record<Mode, string>>>> = {
  blue: { light: "#2f6fae", dark: "#78b7e3" },
  green: { light: "#3f7d51", dark: "#8fc9a0" },
  violet: { light: "#6a5ab2", dark: "#b3a6ee" },
  rose: { light: "#ad5470", dark: "#e3a0b3" },
  amber: { light: "#9a6f1e", dark: "#dfb15f" },
};

/** What Excalidraw draws a default stroke with, per scheme. */
export const BOARD_INK: Readonly<Record<Mode, string>> = { light: "#1e1e1e", dark: "#d3d3d3" };
/** The chat buddy's automatic line colour, per scheme (themes.css). */
export const QUOKKA_LINE: Readonly<Record<Mode, string>> = { light: "#111214", dark: "#ffffff" };

/** Text against secondary text: the step that keeps the two apart. */
export const HIERARCHY = 1.5;
/** A hairline only has to be a visible seam (the built-ins sit near 1.2). */
export const SEAM = 1.15;

export const SCENE_NAMES = ["morning", "noon", "afternoon", "evening"] as const;
/** The welcome scenes' sky hue and detail hue. */
export const SCENES: Readonly<Record<(typeof SCENE_NAMES)[number], readonly [number, number]>> = {
  morning: [55, 40],
  noon: [225, 85],
  afternoon: [45, 35],
  evening: [300, 80],
};
