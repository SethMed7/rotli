// The right-click context menu (Seth, 2026-07-01). A tiny store holding the one
// open menu (position + item specs). Item specs carry their own closures, so any
// surface can build a menu with its own hooks and hand it here; a single
// <ContextMenu> host renders it. Drill-in submenus (e.g. "Move to…") nest specs.

import { create } from "zustand";

export type MenuSpec =
  | {
      kind: "action";
      label: string;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** A leading ✓ / ★ state marker for toggles. */
      checked?: boolean;
    }
  | { kind: "sep" }
  | { kind: "drill"; label: string; items: MenuSpec[]; disabled?: boolean };

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuSpec[] } | null;
  open: (x: number, y: number, items: MenuSpec[]) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null }),
}));
