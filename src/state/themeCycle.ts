// What one click on the titlebar sun does. Three modes: `family` flips light
// and dark inside the current family (the default), `picks` walks a chosen
// subset of the fourteen environments, `all` walks every one in catalog
// order. Pure: the choices, a tolerant reader for each saved value, and the
// next environment.

import { SOLID_THEMES, type ThemeFamily } from "./themeChoices";

export const THEME_CYCLES = ["family", "picks", "all"] as const;
export type ThemeCycle = (typeof THEME_CYCLES)[number];
export const DEFAULT_THEME_CYCLE: ThemeCycle = "family";

type Mode = "light" | "dark";
export interface SolidTheme {
  family: ThemeFamily;
  mode: Mode;
}

/** One environment's saved id: `<family>-<mode>`, e.g. `ocean-dark`. */
export const solidThemeId = (t: SolidTheme): string => `${t.family}-${t.mode}`;

const CATALOG_IDS = SOLID_THEMES.map(solidThemeId);

/** The saved mode read tolerantly: anything unknown is the default. */
export function parseThemeCycle(value: unknown): ThemeCycle {
  return THEME_CYCLES.includes(value as ThemeCycle) ? (value as ThemeCycle) : DEFAULT_THEME_CYCLE;
}

/** The saved picks read tolerantly: unknown ids and repeats drop out, and the
 * rest keep catalog order, so the sun walks them the way Appearance lists them. */
export function parseThemeCyclePicks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter((v): v is string => typeof v === "string"));
  return CATALOG_IDS.filter((id) => chosen.has(id));
}

/** The environment a click lands on. A `system` setting resolves to the mode
 * the Mac shows now before stepping. Fewer than two valid picks is not a
 * cycle, so `picks` then behaves like `family`. */
export function nextTheme(
  current: { theme: "light" | "dark" | "system"; themeFamily: ThemeFamily },
  systemDark: boolean,
  cycle: ThemeCycle,
  picks: readonly string[],
): SolidTheme {
  const mode: Mode = current.theme === "system" ? (systemDark ? "dark" : "light") : current.theme;
  const here = SOLID_THEMES.findIndex((t) => t.family === current.themeFamily && t.mode === mode);
  const valid = parseThemeCyclePicks(picks);
  if (cycle === "all") return toSolid(SOLID_THEMES[(here + 1) % SOLID_THEMES.length]);
  if (cycle === "picks" && valid.length >= 2) {
    // the first pick after the current environment in catalog order, wrapping
    const order = valid.map((id) => CATALOG_IDS.indexOf(id));
    const after = order.find((index) => index > here) ?? order[0];
    return toSolid(SOLID_THEMES[after ?? 0]);
  }
  return { family: current.themeFamily, mode: mode === "light" ? "dark" : "light" };
}

function toSolid(t: (typeof SOLID_THEMES)[number] | undefined): SolidTheme {
  return { family: t?.family ?? "warm", mode: t?.mode ?? "light" };
}

/** An environment's display name (Warm Light, Paper, Midnight…). */
export function solidThemeLabel(t: SolidTheme): string {
  return SOLID_THEMES.find((s) => s.family === t.family && s.mode === t.mode)?.label ?? t.mode;
}
