// The pinned sites and which one's panel is open (src/lib/pinnedSites.ts has
// the rules). The pins are kept in the app settings on this Mac
// (state/appExtras.ts, `pinnedSites`); the open panel is this session's.

import { create } from "zustand";

import type { PinnedSite } from "../lib/pinnedSites";

export const usePinnedSites = create<{
  sites: PinnedSite[];
  /** The pin whose panel shows, or null. */
  open: string | null;
  /** This Mac keeps a store per site (null until asked). */
  supported: boolean | null;
  setSites: (sites: PinnedSite[]) => void;
  setOpen: (id: string | null) => void;
}>((set) => ({
  sites: [],
  open: null,
  supported: null,
  setSites: (sites) =>
    set((s) => ({ sites, open: sites.some((site) => site.id === s.open) ? s.open : null })),
  setOpen: (open) => set({ open }),
}));
