// Transient memex UI state (zustand). The durable config is owned by Rust
// (corpus.json) and read via the useMemexConfig query — this store only holds the
// in-flight ONBOARDING choice (recorded in the "Your brain" step, committed by
// App.tsx on finish, exactly like the dock/behavior choices).

import { create } from "zustand";

/** "use" — adopt an existing memex AS the corpus · "init" — scaffold a new memex
 * AS the corpus · "later" — keep a plain ~/Documents/rotli notes folder. */
export type MemexChoiceKind = "use" | "init" | "later";

export interface PendingMemexChoice {
  kind: MemexChoiceKind;
  /** "use": the existing memex root to adopt. "init": the empty folder to scaffold in. */
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
