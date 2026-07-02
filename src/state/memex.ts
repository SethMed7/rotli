// Transient memex UI state (zustand). The durable config is owned by Rust
// (corpus.json) and read via the useMemexConfig query — this store only holds the
// in-flight ONBOARDING choice (recorded in the "Your brain" step, committed by
// App.tsx on finish, exactly like the dock/behavior choices).

import { create } from "zustand";

/** "use" — adopt an existing memex AS the corpus · "init" — scaffold a new memex
 * AS the corpus · "keep" — keep the CURRENT corpus exactly where it is (the
 * pre-seeded default on a 0.x re-onboard: committing it is a deliberate NO-OP,
 * so a mis-click can never relocate the corpus — #12, audit 2026-07) · "later"
 * — keep a plain ~/Documents/rotli notes folder. */
export type MemexChoiceKind = "use" | "init" | "keep" | "later";

export interface PendingMemexChoice {
  kind: MemexChoiceKind;
  /** "use": the existing memex root to adopt. "init": the empty folder to
   * scaffold in. "keep": the current corpus root (display only — never committed). */
  path?: string;
  label?: string;
}

interface MemexUiState {
  pendingChoice: PendingMemexChoice | null;
  setPendingChoice: (c: PendingMemexChoice | null) => void;
}

export const useMemexStore = create<MemexUiState>((set) => ({
  pendingChoice: null,
  setPendingChoice: (c) => set({ pendingChoice: c }),
}));
