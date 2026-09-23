// Rotli Web's "Notes kept in this browser" offer. Two counters, never a flag
// (review of #63): `requested` goes up each time Settings → General asks, so a
// repeat click always looks again; `settled` goes up each time the offer
// finishes (copied, quietly cleared, or closed), so Settings re-reads whether
// anything is left. Session state only.

import { create } from "zustand";

interface LegacyNotesOfferState {
  requested: number;
  settled: number;
  request: () => void;
  settle: () => void;
}

export const useLegacyNotesOffer = create<LegacyNotesOfferState>((set) => ({
  requested: 0,
  settled: 0,
  request: () => set((s) => ({ requested: s.requested + 1 })),
  settle: () => set((s) => ({ settled: s.settled + 1 })),
}));
