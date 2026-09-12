// The guided tour's step: transient (never persisted). It starts after
// first-run setup and from Settings → General or the ⌘K palette, and closing
// Settings first keeps the spotlit controls visible.

import { create } from "zustand";

import { useUiStore } from "./ui";

interface TourState {
  /** Current step index, or null when the tour is closed. */
  step: number | null;
  setStep: (step: number | null) => void;
}

export const useTourStore = create<TourState>((set) => ({
  step: null,
  setStep: (step) => set({ step }),
}));

/** Open the tour at its first step over the live workspace. */
export function startTour(): void {
  useUiStore.getState().setSettingsOpen(false);
  useTourStore.getState().setStep(0);
}
