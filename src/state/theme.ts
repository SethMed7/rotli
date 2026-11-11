import { useSyncExternalStore } from "react";
// Theme application. The setting is explicit (light / dark / system) — the app
// never silently follows the OS; "system" subscribes to matchMedia only while
// it is the chosen setting. The family picks which token set the mode resolves
// into. Warm and mono retain their historic data-theme names; newer families
// use explicit `<family>-<mode>` names.

import type { AccentColor, SyntaxPalette, ThemeFamily, ThemeSetting } from "./ui";

/** Every `data-theme` value, in one list (public/theme-boot.js's pattern is
 * pinned to exactly these by theme.test.ts). */
export const DATA_THEMES = [
  "light",
  "dark",
  "paper",
  "charcoal",
  "ocean-light",
  "ocean-dark",
  "grove-light",
  "grove-dark",
  "iris-light",
  "iris-dark",
  "blossom-light",
  "blossom-dark",
  "midnight-light",
  "midnight-dark",
] as const;

export type DataTheme = (typeof DATA_THEMES)[number];

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

/** Where the last applied theme waits for the next launch. public/theme-boot.js
 * reads the same key before the first paint, so a dark-theme window never
 * shows index.html's light ground while settings hydrate. */
export const LAST_THEME_KEY = "rotli.lastDataTheme";
/** With the System setting, the family's light and dark themes ("ocean-light
 * ocean-dark"): the boot script picks by the OS appearance at launch, which
 * may have changed since the theme above was applied. Absent otherwise. */
export const LAST_SYSTEM_PAIR_KEY = "rotli.lastSystemThemes";

let rememberThemes = false;

/** Turn the launch cache on where settings are durable (the Mac app, Rotli
 * Web). The in-memory browser twin restarts at its default on every load, so
 * a remembered theme there would paint one theme and then switch. Turned on
 * after hydration and before the first render, so the app's first applyTheme
 * is the first write. */
export function rememberAppliedTheme(on: boolean): void {
  rememberThemes = on;
}

function remember(key: string, value: string | null): void {
  if (!rememberThemes) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage refused (private mode, quota): the next launch paints light first
  }
}

function setDataTheme(value: DataTheme): void {
  document.documentElement.dataset.theme = value;
  remember(LAST_THEME_KEY, value);
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
  remember(
    LAST_SYSTEM_PAIR_KEY,
    setting === "system" ? `${resolveTheme(family, "light")} ${resolveTheme(family, "dark")}` : null,
  );
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
