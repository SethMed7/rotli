// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family picks which token set the mode resolves
// into (warm → light/dark, mono → paper/charcoal). Liquid glass is a MODE over
// the active theme: while on, the resolved light/dark picks glass-light/dark
// and data-glass-tint carries the hue (src/styles/themes.css).

import type { GlassTint, ThemeFamily, ThemeSetting } from "./ui";

type DataTheme = "light" | "dark" | "paper" | "charcoal" | "glass-light" | "glass-dark";

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

function resolve(family: ThemeFamily, glass: boolean, mode: "light" | "dark"): DataTheme {
  if (glass) return mode === "light" ? "glass-light" : "glass-dark";
  if (family === "mono") return mode === "light" ? "paper" : "charcoal";
  return mode;
}

function setDataTheme(value: DataTheme): void {
  document.documentElement.dataset.theme = value;
}

function detachSystemListener(): void {
  if (media && onChange) media.removeEventListener("change", onChange);
  media = null;
  onChange = null;
}

/** Returns the detach so callers (the App effect) get a real cleanup — the
 * last "system" listener must not survive a root unmount. */
export function applyTheme(
  setting: ThemeSetting,
  family: ThemeFamily,
  glass: boolean,
  tint: GlassTint,
): () => void {
  detachSystemListener();
  document.documentElement.dataset.glassTint = tint;
  if (setting === "system") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    onChange = (event) => setDataTheme(resolve(family, glass, event.matches ? "dark" : "light"));
    setDataTheme(resolve(family, glass, media.matches ? "dark" : "light"));
    media.addEventListener("change", onChange);
  } else {
    setDataTheme(resolve(family, glass, setting));
  }
  return detachSystemListener;
}
