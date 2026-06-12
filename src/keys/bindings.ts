// The rebind layer — a Zustand map of chord OVERRIDES keyed by action id
// (UI state only; defaults live on the actions themselves in the registry).
// An entry present with null = explicitly unbound. In-memory for Stage 1;
// Phase 2 persists it to .rotli/.

import { create } from "zustand";

interface BindingsState {
  overrides: Record<string, string | null>;
  setOverride: (actionId: string, chord: string | null) => void;
}

export const useBindingsStore = create<BindingsState>((set) => ({
  overrides: {},
  setOverride: (actionId, chord) =>
    set((s) => ({ overrides: { ...s.overrides, [actionId]: chord } })),
}));

/** Resolve an action's current chord from an overrides snapshot. */
export function resolveChord(
  overrides: Record<string, string | null>,
  actionId: string,
  defaultChord: string | null,
): string | null {
  return actionId in overrides ? (overrides[actionId] ?? null) : defaultChord;
}
