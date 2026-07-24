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
      checkedMark?: "check" | "star";
    }
  | { kind: "sep" }
  | { kind: "drill"; label: string; items: MenuSpec[]; disabled?: boolean; danger?: boolean };

/** Reserve the familiar macOS checkmark gutter only when the visible menu
 * actually contains toggle state. Drill rows share the same gutter so labels
 * never jump sideways within one menu; ordinary menus stay flush. */
export function menuUsesCheckGutter(items: MenuSpec[]): boolean {
  return items.some((item) => item.kind === "action" && "checked" in item);
}

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuSpec[]; returnFocus?: () => void } | null;
  /** `returnFocus` runs when the menu closes — a keyboard opener (the sidebar's
   * "m" key) hands the cursor back to its row so focus never strands. */
  open: (x: number, y: number, items: MenuSpec[], opts?: { returnFocus?: () => void }) => void;
  close: () => void;
}

export const useContextMenu = create<ContextMenuState>((set, get) => ({
  menu: null,
  open: (x, y, items, opts) =>
    set({ menu: { x, y, items, ...(opts?.returnFocus ? { returnFocus: opts.returnFocus } : {}) } }),
  close: () => {
    const rf = get().menu?.returnFocus;
    set({ menu: null });
    rf?.();
  },
}));
