// UI state only (the Zustand law). Data lives behind src/services/.

import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

/** Theme family (Seth, 2026-06-12): "warm" is the kit brand pair (Light/Dark,
 * the default); "mono" is the simple pair — Paper (white & black) and Charcoal
 * (the breve/SM-suite dark); "glass" is liquid glass — translucent chrome over
 * a tinted wash, one hue at a time. The mode setting picks within the family. */
export type ThemeFamily = "warm" | "mono" | "glass";

/** The glass hue: Seth's sunset-edge blue · the same band in pink · the two
 * rotli colors. Cycled from the titlebar while glass is live. */
export type GlassTint = "dusk" | "blush" | "clay" | "olive";

export const GLASS_TINTS: { value: GlassTint; label: string }[] = [
  { value: "dusk", label: "Dusk" },
  { value: "blush", label: "Blush" },
  { value: "clay", label: "Clay" },
  { value: "olive", label: "Olive" },
];

/** The folders rail selection: the two smart rows or a real folder id. */
export const ALL_NOTES = "all";
export const RECENT = "recent";

interface UiState {
  /** Explicit three-way setting. "system" mirrors the OS only while selected;
   * the default is "light" so demos are deterministic. */
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycleTheme: () => void;

  /** Which token family the mode resolves into (warm = kit default). */
  themeFamily: ThemeFamily;
  setThemeFamily: (family: ThemeFamily) => void;

  /** Liquid-glass hue; meaningful while themeFamily is "glass". */
  glassTint: GlassTint;
  setGlassTint: (tint: GlassTint) => void;
  cycleGlassTint: () => void;

  /** Rails collapse state — remembered per window (in-memory, Stage 1). */
  foldersCollapsed: boolean;
  listCollapsed: boolean;
  toggleFolders: () => void;
  toggleList: () => void;
  setFoldersCollapsed: (collapsed: boolean) => void;
  setListCollapsed: (collapsed: boolean) => void;

  /** Folders-rail selection (window-level). */
  selectedFolderId: string;
  setSelectedFolderId: (id: string) => void;

  /** The identity module-switcher popover (r5, approved). */
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;

  /** The bottom-center resident slot's visibility — 1c's focus mode hides
   * the format bar through this flag. */
  formatBarVisible: boolean;
  setFormatBarVisible: (visible: boolean) => void;

  /** ⌘K — the only overlay that dims (r3 frame F). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  /** Settings as its own surface in the window (r1 frame F); Esc returns. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** ⌥⌘F focus mode (r3 frame E): chrome leaves, one centered column. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;

  /** Open transient close-callbacks, top = last. Esc (app.hide, the one
   * registry dispatcher) closes the topmost transient before the window —
   * the quokka rule, without ad-hoc keydown listeners. */
  transients: (() => void)[];
  registerTransient: (close: () => void) => () => void;
  closeTopTransient: () => boolean;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: "light",
  setTheme: (theme) => set({ theme }),
  cycleTheme: () =>
    set((s) => ({
      theme: s.theme === "light" ? "dark" : s.theme === "dark" ? "system" : "light",
    })),

  themeFamily: "warm",
  setThemeFamily: (family) => set({ themeFamily: family }),

  glassTint: "dusk",
  setGlassTint: (tint) => set({ glassTint: tint }),
  cycleGlassTint: () =>
    set((s) => {
      const i = GLASS_TINTS.findIndex((t) => t.value === s.glassTint);
      const next = GLASS_TINTS[(i + 1) % GLASS_TINTS.length];
      return next ? { glassTint: next.value } : s;
    }),

  foldersCollapsed: false,
  listCollapsed: false,
  toggleFolders: () => set((s) => ({ foldersCollapsed: !s.foldersCollapsed })),
  toggleList: () => set((s) => ({ listCollapsed: !s.listCollapsed })),
  setFoldersCollapsed: (collapsed) => set({ foldersCollapsed: collapsed }),
  setListCollapsed: (collapsed) => set({ listCollapsed: collapsed }),

  selectedFolderId: ALL_NOTES,
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),

  switcherOpen: false,
  setSwitcherOpen: (open) => set({ switcherOpen: open }),

  formatBarVisible: true,
  setFormatBarVisible: (visible) => set({ formatBarVisible: visible }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  focusMode: false,
  setFocusMode: (on) => set({ focusMode: on }),

  transients: [],
  registerTransient: (close) => {
    set((s) => ({ transients: [...s.transients, close] }));
    return () => set((s) => ({ transients: s.transients.filter((t) => t !== close) }));
  },
  closeTopTransient: () => {
    const top = get().transients[get().transients.length - 1];
    if (!top) return false;
    top();
    return true;
  },
}));
