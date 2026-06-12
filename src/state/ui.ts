// UI state only (the Zustand law). Data lives behind src/services/.

import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

interface UiState {
  /** Explicit three-way setting. "system" mirrors the OS only while selected;
   * the default is "light" so demos are deterministic. */
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycleTheme: () => void;

  /** Rail visibility flags — the rails themselves arrive in 1a. */
  foldersRailOpen: boolean;
  noteListOpen: boolean;
  toggleFoldersRail: () => void;
  toggleNoteList: () => void;

  /** The identity module-switcher popover (r5, approved). */
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: "light",
  setTheme: (theme) => set({ theme }),
  cycleTheme: () =>
    set((s) => ({
      theme: s.theme === "light" ? "dark" : s.theme === "dark" ? "system" : "light",
    })),

  foldersRailOpen: true,
  noteListOpen: true,
  toggleFoldersRail: () => set((s) => ({ foldersRailOpen: !s.foldersRailOpen })),
  toggleNoteList: () => set((s) => ({ noteListOpen: !s.noteListOpen })),

  switcherOpen: false,
  setSwitcherOpen: (open) => set({ switcherOpen: open }),
}));
