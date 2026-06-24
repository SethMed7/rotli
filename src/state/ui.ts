// UI state only (the Zustand law). Data lives behind src/services/.

import { inboxFolderId } from "../services/notes";
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
 * user's own image (custom — a data URL, persisted to .rotli/background.json
 * in the shell). */
export type GlassBackground = "field" | "dusk" | "blush" | "linen" | "cocoa" | "custom";

export const GLASS_BACKGROUNDS: { value: Exclude<GlassBackground, "custom">; label: string }[] = [
  { value: "field", label: "Tint field" },
  { value: "dusk", label: "Dusk waves" },
  { value: "blush", label: "Blush waves" },
  { value: "linen", label: "Linen hills" },
  { value: "cocoa", label: "Cocoa night" },
];

/** Frosted = the classic milky glass; clear = see the background through. */
export type GlassClarity = "frosted" | "clear";

/** Blur weight on the glass. */
export type GlassBlur = "soft" | "standard" | "heavy";

export const GLASS_BLURS: { value: GlassBlur; label: string }[] = [
  { value: "soft", label: "Soft" },
  { value: "standard", label: "Standard" },
  { value: "heavy", label: "Heavy" },
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

/** Sidebar width clamp — small enough to tuck away, never wide enough to eat
 * the editor (one rail now, not two — Seth, 2026-06-13). */
export const clampSidebarWidth = (px: number): number =>
  Math.min(460, Math.max(190, Math.round(px)));

/** The reserved destination ids the sidebar seeds open (Inbox + Brain) and the
 * persistence layer trusts as a valid folder selection before the first list
 * resolves (Seth, 2026-06-13). */
export const RESERVED_DESTS = ["Inbox", "Brain", "Storage", "Board", "Archive", "Trash"] as const;

interface UiState {
  /** Explicit three-way setting. "system" mirrors the OS only while selected;
   * the default is "light" so demos are deterministic. */
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycleTheme: () => void;

  /** Which token family the mode resolves into (warm = kit default). */
  themeFamily: ThemeFamily;
  setThemeFamily: (family: ThemeFamily) => void;

  /** When "Match the system" is on, which theme each OS appearance maps to —
   * decoupled from the active family so you can pair, say, Paper (light) with
   * Warm Dark (dark). A theme is (family, mode); these store the family, the
   * mode is fixed by the OS (Seth, 2026-06-15). */
  matchLightFamily: ThemeFamily;
  setMatchLightFamily: (family: ThemeFamily) => void;
  matchDarkFamily: ThemeFamily;
  setMatchDarkFamily: (family: ThemeFamily) => void;

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
  /** The uploaded image as a data URL — persist.ts keeps it across launches. */
  customBackground: string | null;
  setCustomBackground: (url: string | null) => void;

  /** Frosted (default) or clear — clear glass shows the background through. */
  glassClarity: GlassClarity;
  setGlassClarity: (clarity: GlassClarity) => void;
  /** How heavy the blur is. */
  glassBlur: GlassBlur;
  setGlassBlur: (blur: GlassBlur) => void;

  /** General: visitor (click-away hides, default) vs resident (stays open). */
  stayOpen: boolean;
  setStayOpen: (on: boolean) => void;
  /** General: show the app in the Dock (default off — menu bar only). */
  showInDock: boolean;
  setShowInDock: (on: boolean) => void;

  /** First-run gate: false until the user finishes (or skips) onboarding, or
   * after a manual "Reset & re-onboard". Persisted in settings.json; the
   * onboarding surface shows whenever this is false (Tauri only). */
  onboarded: boolean;
  setOnboarded: (done: boolean) => void;

  /** The Quick Note window's capped set (Seth, 2026-06-15): up to QUICK_MAX
   * note ids, in switcher order. The mutations + cross-webview sync live in
   * state/quick.ts; these are the raw fields the persistence layer reads. */
  quickNoteIds: string[];
  setQuickNoteIds: (ids: string[]) => void;
  /** Which quick note the window reopens on — "remember where I am". */
  quickActiveId: string | null;
  setQuickActiveId: (id: string | null) => void;
  /** Folder new quick notes (the "+") are created in. */
  quickFolder: string;
  setQuickFolder: (folder: string) => void;

  /** The writing canvas inside glass: glass like everything else, or a real
   * paper surface (linen / white / cocoa) — write on paper, the rest stays
   * glass. Toggled from the Aa panel. */
  glassCanvas: GlassCanvas;
  setGlassCanvas: (canvas: GlassCanvas) => void;

  /** The ONE sidebar — collapse state (remembered per window, persisted in the
   * shell) and width (px; drag the grip on its right edge). The two-rail era is
   * gone: folders + note-list collapse into a single navigator (Seth,
   * 2026-06-13). */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (px: number) => void;

  /** Which destinations in the sidebar tree are expanded, keyed by dest id —
   * Inbox + Brain open by default (Seth, 2026-06-13). */
  expandedDests: Record<string, boolean>;
  toggleDestExpanded: (id: string) => void;
  setDestExpanded: (id: string, open: boolean) => void;

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

  /** Spell-check: red squiggles under misspellings in the editor. On by
   * default (Seth, 2026-06-22); a Settings → Editor switch. Persisted. */
  spellcheck: boolean;
  setSpellcheck: (on: boolean) => void;

  /** Quick captures (⌥C) route to the active memex's inbox.md instead of the
   * Board. Off by default (the Board is the safe fallback). Persisted. */
  captureToBrainInbox: boolean;
  setCaptureToBrainInbox: (on: boolean) => void;

  /** ⌘K — the only overlay that dims (r3 frame F). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;

  /** Settings as its own surface in the window (r1 frame F); Esc returns. */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** The Board — quick captures collected as cards — as its own surface (like
   * Settings). Esc / "Back to notes" returns. Not persisted (a transient view). */
  boardOpen: boolean;
  setBoardOpen: (open: boolean) => void;

  /** The Chat front — named conversations over the connected memex (chats/) — as
   * its own surface (like Board). "Everything has a chat." Not persisted. */
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;

  /** A newer signed build is on the feed — set once by App.tsx's quiet on-mount
   * check (CARL rule 2: no auto-download, no modal). Just lets Settings → General
   * surface "Update available". Transient, not persisted (mirrors chatOpen). */
  updateAvailable: boolean;
  setUpdateAvailable: (on: boolean) => void;
  /** The version the feed offers, when known (e.g. "0.2.0"). */
  updateVersion: string | null;
  setUpdateVersion: (version: string | null) => void;

  /** The Memory browser — a READ-ONLY tour of the active memex's spine (wiki ·
   * self · chats · MAP · inbox) — as its own surface (like Chat). Not persisted. */
  memoryOpen: boolean;
  setMemoryOpen: (open: boolean) => void;

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

  matchLightFamily: "warm",
  setMatchLightFamily: (family) => set({ matchLightFamily: family }),
  matchDarkFamily: "warm",
  setMatchDarkFamily: (family) => set({ matchDarkFamily: family }),

  glassMode: false,
  setGlassMode: (on) => set({ glassMode: on }),

  glassTint: "dusk",
  setGlassTint: (tint) => set({ glassTint: tint }),

  glassBackground: "field",
  setGlassBackground: (bg) => set({ glassBackground: bg }),
  customBackground: null,
  setCustomBackground: (url) =>
    set((s) => {
      // uploads are data URLs now (persistable); revoke only a legacy blob —
      // a leaked object URL would pin the decoded image for the session
      if (s.customBackground?.startsWith("blob:") && s.customBackground !== url) {
        URL.revokeObjectURL(s.customBackground);
      }
      return { customBackground: url };
    }),

  glassClarity: "frosted",
  setGlassClarity: (clarity) => set({ glassClarity: clarity }),
  glassBlur: "standard",
  setGlassBlur: (blur) => set({ glassBlur: blur }),

  stayOpen: false,
  setStayOpen: (on) => set({ stayOpen: on }),
  showInDock: false,
  setShowInDock: (on) => set({ showInDock: on }),

  onboarded: false,
  setOnboarded: (done) => set({ onboarded: done }),

  quickNoteIds: [],
  setQuickNoteIds: (ids) => set({ quickNoteIds: ids }),
  quickActiveId: null,
  setQuickActiveId: (id) => set({ quickActiveId: id }),
  // "Inbox" on disk (fs mode); the seeded Inbox id in the browser
  quickFolder: inboxFolderId,
  setQuickFolder: (folder) => set({ quickFolder: folder }),

  glassCanvas: "glass",
  setGlassCanvas: (canvas) => set({ glassCanvas: canvas }),
  cycleGlassTint: () =>
    set((s) => {
      const i = GLASS_TINTS.findIndex((t) => t.value === s.glassTint);
      const next = GLASS_TINTS[(i + 1) % GLASS_TINTS.length];
      return next ? { glassTint: next.value } : s;
    }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  sidebarWidth: 240,
  setSidebarWidth: (px) => set({ sidebarWidth: clampSidebarWidth(px) }),

  expandedDests: { Inbox: true, Brain: true },
  toggleDestExpanded: (id) =>
    set((s) => ({ expandedDests: { ...s.expandedDests, [id]: !s.expandedDests[id] } })),
  setDestExpanded: (id, open) =>
    set((s) => ({ expandedDests: { ...s.expandedDests, [id]: open } })),

  selectedFolderId: ALL_NOTES,
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),

  switcherOpen: false,
  setSwitcherOpen: (open) => set({ switcherOpen: open }),

  formatBarVisible: true,
  setFormatBarVisible: (visible) => set({ formatBarVisible: visible }),

  spellcheck: true,
  setSpellcheck: (on) => set({ spellcheck: on }),

  captureToBrainInbox: false,
  setCaptureToBrainInbox: (on) => set({ captureToBrainInbox: on }),

  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  boardOpen: false,
  setBoardOpen: (open) => set({ boardOpen: open }),

  chatOpen: false,
  setChatOpen: (open) => set({ chatOpen: open }),

  updateAvailable: false,
  setUpdateAvailable: (on) => set({ updateAvailable: on }),
  updateVersion: null,
  setUpdateVersion: (version) => set({ updateVersion: version }),

  memoryOpen: false,
  setMemoryOpen: (open) => set({ memoryOpen: open }),

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
