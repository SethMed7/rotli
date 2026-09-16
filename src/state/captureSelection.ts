// Captures → Select all, asked from outside the board surface (⌘A while the
// board is the content view). The surface owns the selection itself; this
// store only carries the request, as a counter the surface follows.

import { create } from "zustand";

interface CaptureSelectionState {
  selectAllNonce: number;
  selectAll: () => void;
}

export const useCaptureSelection = create<CaptureSelectionState>((set) => ({
  selectAllNonce: 0,
  selectAll: () => set((s) => ({ selectAllNonce: s.selectAllNonce + 1 })),
}));
