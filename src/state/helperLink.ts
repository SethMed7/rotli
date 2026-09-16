// Rotli Web: the pairing with Rotli Helper on this computer. `link` is the
// port and token the user pasted; `reachable` is the last health answer.
// Hydrated at boot from the browser vault, so surfaces can ask synchronously.

import { create } from "zustand";

import type { HelperLink } from "../lib/helperPairing";

interface HelperLinkState {
  link: HelperLink | null;
  /** null = not checked yet this session */
  reachable: boolean | null;
  hydrated: boolean;
  setLink: (link: HelperLink | null) => void;
  setReachable: (reachable: boolean | null) => void;
}

export const useHelperLink = create<HelperLinkState>((set) => ({
  link: null,
  reachable: null,
  hydrated: false,
  setLink: (link) => set({ link, hydrated: true }),
  setReachable: (reachable) => set({ reachable }),
}));

/** Paired with a helper (whether or not it answered yet). */
export function helperLinked(): boolean {
  return useHelperLink.getState().link !== null;
}
