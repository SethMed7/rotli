// The sidebar's look: its scenery and its icons (src/lib/sidebarLook.ts has
// the rules). Kept in the app settings on this Mac (state/appExtras.ts,
// `sidebarLook`).

import { create } from "zustand";

import { DEFAULT_SIDEBAR_LOOK, type SidebarLook } from "../lib/sidebarLook";

export const useSidebarLook = create<{ look: SidebarLook; setLook: (change: Partial<SidebarLook>) => void }>(
  (set) => ({
    look: DEFAULT_SIDEBAR_LOOK,
    setLook: (change) => set((s) => ({ look: { ...s.look, ...change } })),
  }),
);
