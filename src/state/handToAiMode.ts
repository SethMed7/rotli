// Which Hand to AI mode the card opens in: the one chosen last. Basic by
// default, and anything unreadable is Basic. An app setting on this Mac
// (state/appExtras.ts), never part of a note or the vault.

import { create } from "zustand";

export type HandToAiMode = "basic" | "refined";

export function parseHandToAiMode(value: unknown): HandToAiMode {
  return value === "refined" ? "refined" : "basic";
}

export const useHandToAiMode = create<{ mode: HandToAiMode; setMode: (mode: HandToAiMode) => void }>(
  (set) => ({
    mode: "basic",
    setMode: (mode) => set({ mode }),
  }),
);
