// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family picks which token set the mode resolves
// into (warm → light/dark, mono → paper/charcoal).

import type { AccentColor, SyntaxPalette, ThemeFamily, ThemeSetting } from "./ui";

type DataTheme = "light" | "dark" | "paper" | "charcoal";

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

export function resolveTheme(family: ThemeFamily, mode: "light" | "dark"): DataTheme {
  if (family === "mono") return mode === "light" ? "paper" : "charcoal";
  return mode;
}

function setDataTheme(value: DataTheme): void {
  document.documentElement.dataset.theme = value;
}

export function applySyntaxPalette(value: SyntaxPalette): void {
  document.documentElement.dataset.syntaxPalette = value;
}

/** The primary color rides a data attribute beside the theme — "default"
 * removes it so each theme's own accent truth applies. */
export function applyAccent(value: AccentColor): void {
  if (value === "default") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = value;
}

function detachSystemListener(): void {
  if (media && onChange) media.removeEventListener("change", onChange);
  media = null;
  onChange = null;
}

/** When following the system, each OS appearance can map to a theme in EITHER
 * family (Seth, 2026-06-15) — light → matchLightFamily, dark → matchDarkFamily. */
export interface MatchFamilies {
  light: ThemeFamily;
  dark: ThemeFamily;
}

/** Returns the detach so callers (the App effect) get a real cleanup — the
 * last "system" listener must not survive a root unmount. */
export function applyTheme(
  setting: ThemeSetting,
  family: ThemeFamily,
  match: MatchFamilies = { light: family, dark: family },
): () => void {
  detachSystemListener();
  if (setting === "system") {
    const forOs = (dark: boolean) => resolveTheme(dark ? match.dark : match.light, dark ? "dark" : "light");
    media = window.matchMedia("(prefers-color-scheme: dark)");
    onChange = (event) => setDataTheme(forOs(event.matches));
    setDataTheme(forOs(media.matches));
    media.addEventListener("change", onChange);
  } else {
    setDataTheme(resolveTheme(family, setting));
  }
  return detachSystemListener;
}
