// The custom theme this Mac uses: the `customTheme` app setting (which theme)
// plus what the theme feature found and painted (src/themes/composition.ts).
// `themeFamily` keeps the theme's base, so an older Rotli shows the base.

import { create } from "zustand";

import type { SeedNote } from "../brand/themeEngine/derive";
import type { CustomThemeSelection, ThemeEntry } from "../themes/model";

export interface CustomThemeState {
  selection: CustomThemeSelection | null;
  /** Every personal theme file, read. */
  entries: ThemeEntry[];
  /** Why the selected theme isn't showing (gone, unreadable, rejected). */
  notice: string | null;
  /** The colours Rotli moved in the applied theme to keep it readable. */
  moved: (SeedNote & { mode: "light" | "dark" })[];
  /** The applied theme came from a newer Rotli: read-only here. */
  readOnly: boolean;
  /** Bumped whenever what is painted changes. */
  rev: number;
  /** Theme files outlast a reload here (the Mac app). Elsewhere a theme lasts
   * the session: its selection isn't saved, so a reload starts on the family. */
  durable: boolean;
}

export const useCustomTheme = create<CustomThemeState>(() => ({
  selection: null,
  entries: [],
  notice: null,
  moved: [],
  readOnly: false,
  rev: 0,
  durable: false,
}));

/** The `customTheme` value to save: none where theme files don't last. */
export function savedCustomTheme(): CustomThemeSelection | null {
  const { durable, selection } = useCustomTheme.getState();
  return durable ? selection : null;
}

export const isCustomThemeSelected = (): boolean => useCustomTheme.getState().selection !== null;
