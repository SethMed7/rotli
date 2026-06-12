// UI state only (the Zustand law). Data lives behind src/services/.

import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

/** Theme family (Seth, 2026-06-12): "warm" is the kit brand pair (Light/Dark,
 * the default); "mono" is the simple pair — Paper (white & black) and Charcoal
 * (the breve/SM-suite dark). Liquid glass is NOT a theme — it is a MODE layered
 * over whichever theme is active (glassMode below). */
export type ThemeFamily = "warm" | "mono";

/** The four solid themes, in the order the titlebar sun cycles them. */
export const SOLID_THEMES: { family: ThemeFamily; mode: "light" | "dark"; label: string }[] = [
  { family: "warm", mode: "light", label: "Warm Light" },
  { family: "warm", mode: "dark", label: "Warm Dark" },
  { family: "mono", mode: "light", label: "Paper" },
  { family: "mono", mode: "dark", label: "Charcoal" },
];

/** The glass hue: Seth's sunset-edge blue · the same band in pink · the two
 * rotli colors. Cycled from the titlebar while glass is live. */
export type GlassTint = "dusk" | "blush" | "clay" | "olive";

export const GLASS_TINTS: { value: GlassTint; label: string }[] = [
  { value: "dusk", label: "Dusk" },
  { value: "blush", label: "Blush" },
  { value: "clay", label: "Clay" },
  { value: "olive", label: "Olive" },
];

/** What sits behind the glass: the tinted field, a bundled wallpaper, or the
 * user's own image (custom — an object URL, in-memory for Stage 1). */
export type GlassBackground = "field" | "dusk" | "blush" | "linen" | "cocoa" | "custom";

export const GLASS_BACKGROUNDS: { value: Exclude<GlassBackground, "custom">; label: string }[] = [
  { value: "field", label: "Tint field" },
  { value: "dusk", label: "Dusk waves" },
  { value: "blush", label: "Blush waves" },
  { value: "linen", label: "Linen hills" },
  { value: "cocoa", label: "Cocoa night" },
];

/** What the notes canvas is made of while glass is live. */
export type GlassCanvas = "glass" | "linen" | "white" | "cocoa";

export const GLASS_CANVASES: { value: GlassCanvas; label: string }[] = [
  { value: "glass", label: "Glass" },
  { value: "linen", label: "Linen" },
  { value: "white", label: "White" },
  { value: "cocoa", label: "Cocoa" },
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

  /** Liquid glass — a mode OVER the active theme, toggled in Settings. While
   * on, the resolved light/dark of the chosen theme picks glass-light/dark
   * and the titlebar sun becomes the tint cycler. */
  glassMode: boolean;
  setGlassMode: (on: boolean) => void;

  /** Liquid-glass hue; meaningful while glassMode is on. */
  glassTint: GlassTint;
  setGlassTint: (tint: GlassTint) => void;
  cycleGlassTint: () => void;

  /** What sits behind the glass (glassMode only). */
  glassBackground: GlassBackground;
  setGlassBackground: (bg: GlassBackground) => void;
  /** Object URL of an uploaded image; in-memory, gone on quit (Stage 1). */
  customBackground: string | null;
  setCustomBackground: (url: string | null) => void;

  /** The writing canvas inside glass: glass like everything else, or a real
   * paper surface (linen / white / cocoa) — write on paper, the rest stays
   * glass. Toggled from the Aa panel. */
  glassCanvas: GlassCanvas;
  setGlassCanvas: (canvas: GlassCanvas) => void;

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
  // the titlebar sun: Warm Light → Warm Dark → Paper → Charcoal (Seth's law);
  // a "system" setting resolves to its current mode before stepping on
  cycleTheme: () =>
    set((s) => {
      const mode =
        s.theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light"
          : s.theme;
      const i = SOLID_THEMES.findIndex((t) => t.family === s.themeFamily && t.mode === mode);
      const next = SOLID_THEMES[(i + 1) % SOLID_THEMES.length];
      return next ? { themeFamily: next.family, theme: next.mode } : s;
    }),

  themeFamily: "warm",
  setThemeFamily: (family) => set({ themeFamily: family }),

  glassMode: false,
  setGlassMode: (on) => set({ glassMode: on }),

  glassTint: "dusk",
  setGlassTint: (tint) => set({ glassTint: tint }),

  glassBackground: "field",
  setGlassBackground: (bg) => set({ glassBackground: bg }),
  customBackground: null,
  setCustomBackground: (url) => set({ customBackground: url }),

  glassCanvas: "glass",
  setGlassCanvas: (canvas) => set({ glassCanvas: canvas }),
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
