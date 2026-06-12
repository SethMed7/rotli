// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting.

import type { ThemeSetting } from "./ui";

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

function setDataTheme(value: "light" | "dark"): void {
  document.documentElement.dataset.theme = value;
}

function detachSystemListener(): void {
  if (media && onChange) media.removeEventListener("change", onChange);
  media = null;
  onChange = null;
}

export function applyTheme(setting: ThemeSetting): void {
  detachSystemListener();
  if (setting === "system") {
    media = window.matchMedia("(prefers-color-scheme: dark)");
    onChange = (event) => setDataTheme(event.matches ? "dark" : "light");
    setDataTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return;
  }
  setDataTheme(setting);
}
