// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family picks which token set the mode resolves
// into: warm → light/dark (the frozen kit), mono → paper/charcoal, glass →
// glass-light/glass-dark with a data-glass-tint hue (src/styles/themes.css).

import type { GlassTint, ThemeFamily, ThemeSetting } from "./ui";

type DataTheme = "light" | "dark" | "paper" | "charcoal" | "glass-light" | "glass-dark";

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

function resolve(family: ThemeFamily, mode: "light" | "dark"): DataTheme {
  if (family === "mono") return mode === "light" ? "paper" : "charcoal";
  if (family === "glass") return mode === "light" ? "glass-light" : "glass-dark";
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

export function applyTheme(setting: ThemeSetting, family: ThemeFamily, tint: GlassTint): void {
  detachSystemListener();
  document.documentElement.dataset.glassTint = tint;
  if (setting === "system") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    onChange = (event) => setDataTheme(resolve(family, event.matches ? "dark" : "light"));
    setDataTheme(resolve(family, media.matches ? "dark" : "light"));
    media.addEventListener("change", onChange);
    return;
  }
  setDataTheme(resolve(family, setting));
}
