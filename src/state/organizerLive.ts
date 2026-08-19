// The ambient "the Librarian is working" signal (the maintainer, 2026-07-31: "I need a
// visual way to see that it is working"). One tiny store fed by the daemon's
// progress events (app.tsx) and the Organize auto-adopter, read by the
// sidebar's footer button — so the work is visible from ANYWHERE in the app,
// not only when the Librarian surface happens to be open. Titles only, never
// content — the same boundary every surface keeps.

import { create } from "zustand";

interface OrganizerLiveState {
  /** A cycle or an adopt batch is touching the vault right now. */
  active: boolean;
  /** The note title it's looking at (when the daemon narrated one). */
  current: string | null;
  setLive: (active: boolean, current?: string | null) => void;
}

export const useOrganizerLive = create<OrganizerLiveState>((set) => ({
  active: false,
  current: null,
  setLive: (active, current = null) => set({ active, current }),
}));
