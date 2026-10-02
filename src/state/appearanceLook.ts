// Two Appearance choices kept in the app settings on this Mac
// (state/appExtras.ts): what the titlebar sun cycles (`themeCycle`,
// `themeCyclePicks`; state/themeCycle.ts has the rules) and whether attached
// images in a note draw a quiet outline (`outlineImages`, off by default).

import { create } from "zustand";

import { systemPrefersDark } from "./systemScheme";
import type { ThemeFamily } from "./themeChoices";
import {
  DEFAULT_THEME_CYCLE,
  type SolidTheme,
  type ThemeCycle,
  nextTheme,
  parseThemeCycle,
  parseThemeCyclePicks,
} from "./themeCycle";

export interface AppearanceLook {
  themeCycle: ThemeCycle;
  themeCyclePicks: string[];
  outlineImages: boolean;
}

export const DEFAULT_APPEARANCE_LOOK: AppearanceLook = {
  themeCycle: DEFAULT_THEME_CYCLE,
  themeCyclePicks: [],
  outlineImages: false,
};

export const useAppearanceLook = create<
  AppearanceLook & { setLook: (change: Partial<AppearanceLook>) => void }
>((set) => ({
  ...DEFAULT_APPEARANCE_LOOK,
  setLook: (change) => set(change),
}));

/** The three keys read tolerantly from the app settings file's data. */
export function parseAppearanceLook(data: Record<string, unknown>): AppearanceLook {
  return {
    themeCycle: parseThemeCycle(data.themeCycle),
    themeCyclePicks: parseThemeCyclePicks(data.themeCyclePicks),
    outlineImages: data.outlineImages === true,
  };
}

/** A floating window takes the look from main's broadcast app settings text. */
export function applyAppearanceLookBroadcast(appSettings: string): void {
  try {
    const data: unknown = JSON.parse(appSettings);
    if (data && typeof data === "object") {
      useAppearanceLook.setState(parseAppearanceLook(data as Record<string, unknown>));
    }
  } catch {
    // an unreadable payload leaves the window's look as it was
  }
}

export function appearanceLookSnapshot(): AppearanceLook {
  const { themeCycle, themeCyclePicks, outlineImages } = useAppearanceLook.getState();
  return { themeCycle, themeCyclePicks, outlineImages };
}

/** Where the sun's next click lands, under the saved cycle and the Mac's mode now. */
export function nextThemeNow(current: {
  theme: "light" | "dark" | "system";
  themeFamily: ThemeFamily;
}): SolidTheme {
  const { themeCycle, themeCyclePicks } = useAppearanceLook.getState();
  return nextTheme(current, current.theme === "system" && systemPrefersDark(), themeCycle, themeCyclePicks);
}

/** The editor's image outline follows one root attribute (styles/editor.css). */
export function applyImageOutline(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.outlineImages = "true";
  else delete document.documentElement.dataset.outlineImages;
}
