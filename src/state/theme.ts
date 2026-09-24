import { useSyncExternalStore } from "react";
// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family picks which token set the mode resolves
// into. Warm and mono retain their historic data-theme names; newer families
// use explicit `<family>-<mode>` names.

import type { AccentColor, SyntaxPalette, ThemeFamily, ThemeSetting } from "./ui";

export type DataTheme =
  | "light"
  | "dark"
  | "paper"
  | "charcoal"
  | "ocean-light"
  | "ocean-dark"
  | "grove-light"
  | "grove-dark"
  | "iris-light"
  | "iris-dark"
  | "blossom-light"
  | "blossom-dark"
  | "midnight-light"
  | "midnight-dark";

export const DARK_DATA_THEMES: readonly DataTheme[] = [
  "dark",
  "charcoal",
  "ocean-dark",
  "grove-dark",
  "iris-dark",
  "blossom-dark",
  "midnight-dark",
];

export function isDarkDataTheme(theme: string | undefined): boolean {
  return DARK_DATA_THEMES.includes(theme as DataTheme);
}

// ── the applied theme as an external store (ARCHITECTURE.md "React
// synchronization boundary": one named hook over useSyncExternalStore, the
// useNow.ts shape). `data-theme` on <html> is the single truth every webview
// applies; components read it here instead of each owning a MutationObserver
// or re-reading matchMedia (which misses an OS flip in System mode).
const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

/** The applied `data-theme` value, read once (non-React callers; React
 * consumers use useDataTheme / useIsDarkTheme for a live value). */
export function readDataTheme(): string {
  return typeof document === "undefined" ? "light" : (document.documentElement.dataset.theme ?? "light");
}

function subscribeDataTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  if (themeListeners.size === 1 && typeof document !== "undefined") {
    themeObserver = new MutationObserver(() => {
      for (const fn of themeListeners) fn();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = null;
    }
  };
}

/** The applied `data-theme` value, live. */
export function useDataTheme(): string {
  return useSyncExternalStore(subscribeDataTheme, readDataTheme, () => "light");
}

/** Whether the applied theme is a dark environment, live across all fourteen. */
export function useIsDarkTheme(): boolean {
  return isDarkDataTheme(useDataTheme());
}

let media: MediaQueryList | null = null;
let onChange: ((event: MediaQueryListEvent) => void) | null = null;

export function resolveTheme(family: ThemeFamily, mode: "light" | "dark"): DataTheme {
  if (family === "mono") return mode === "light" ? "paper" : "charcoal";
  if (family === "warm") return mode;
  return `${family}-${mode}`;
}

/** System only selects the active half of the chosen family. It never owns a
 * second theme mapping, so changing a family has one predictable result in all
 * three appearance modes. */
export function resolveThemeSetting(
  setting: ThemeSetting,
  family: ThemeFamily,
  systemDark: boolean,
): DataTheme {
  const mode = setting === "system" ? (systemDark ? "dark" : "light") : setting;
  return resolveTheme(family, mode);
}

function setDataTheme(value: DataTheme): void {
  document.documentElement.dataset.theme = value;
}

export function applySyntaxPalette(value: SyntaxPalette): void {
  document.documentElement.dataset.syntaxPalette = value;
}

/** The primary color rides a data attribute beside the theme — "default"
 * removes it so each theme's own accent truth applies. */
export function applyAccent(value: AccentColor, hue = 210): void {
  const safeHue = Number.isFinite(hue) && hue >= 0 && hue <= 359 ? Math.round(hue) : 210;
  document.documentElement.style.setProperty("--accent-hue", String(safeHue));
  if (value === "default") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = value;
}

function detachSystemListener(): void {
  if (media && onChange) media.removeEventListener("change", onChange);
  media = null;
  onChange = null;
}

/** Returns the detach so callers (the App effect) get a real cleanup — the
 * last "system" listener must not survive a root unmount. */
export function applyTheme(setting: ThemeSetting, family: ThemeFamily): () => void {
  detachSystemListener();
  if (setting === "system") {
    const forOs = (dark: boolean) => resolveThemeSetting(setting, family, dark);
    media = window.matchMedia("(prefers-color-scheme: dark)"); // the listener needs the object
    onChange = (event) => setDataTheme(forOs(event.matches));
    setDataTheme(forOs(media.matches));
    media.addEventListener("change", onChange);
  } else {
    setDataTheme(resolveTheme(family, setting));
  }
  return detachSystemListener;
}
