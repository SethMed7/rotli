// UI state only (the Zustand law). Data lives behind src/services/.

import { create } from "zustand";

export type ThemeSetting = "light" | "dark" | "system";

/** The folders rail selection: the two smart rows or a real folder id. */
export const ALL_NOTES = "all";
export const RECENT = "recent";

interface UiState {
  /** Explicit three-way setting. "system" mirrors the OS only while selected;
   * the default is "light" so demos are deterministic. */
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  cycleTheme: () => void;

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
}

export const useUiStore = create<UiState>((set) => ({
  theme: "light",
  setTheme: (theme) => set({ theme }),
  cycleTheme: () =>
    set((s) => ({
      theme: s.theme === "light" ? "dark" : s.theme === "dark" ? "system" : "light",
    })),

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
}));
