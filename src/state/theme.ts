// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family (warm / mono) picks which token set the
// mode resolves into: warm → light/dark (the frozen kit), mono → paper/charcoal
// (src/styles/themes.css).

import type { ThemeFamily, ThemeSetting } from "./ui";

type DataTheme = "light" | "dark" | "paper" | "charcoal";

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

function resolve(family: ThemeFamily, mode: "light" | "dark"): DataTheme {
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

export function applyTheme(setting: ThemeSetting, family: ThemeFamily): void {
  detachSystemListener();
  if (setting === "system") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    onChange = (event) => setDataTheme(resolve(family, event.matches ? "dark" : "light"));
    setDataTheme(resolve(family, media.matches ? "dark" : "light"));
    media.addEventListener("change", onChange);
    return;
  }
  setDataTheme(resolve(family, setting));
}
