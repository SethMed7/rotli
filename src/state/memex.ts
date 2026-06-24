// Transient memex UI state (zustand). The durable instance registry is owned by
// Rust (memex-instances.json) and read via the useMemexConfig query — this store
// only holds the in-flight onboarding choice (recorded in the "Memory" step,
// committed by App.tsx on finish, exactly like the dock/behavior choices) and the
// last validate.ts result surfaced in the Memory pane.

import { create } from "zustand";
import type { MemexValidateReport } from "../lib/tauri";

export type MemexChoiceKind = "merge" | "separate" | "later";

export interface PendingMemexChoice {
  kind: MemexChoiceKind;
  /** Merge: the detected memex root. Separate: the chosen empty folder. */
  path?: string;
  label?: string;
}

interface MemexUiState {
  pendingChoice: PendingMemexChoice | null;
  setPendingChoice: (c: PendingMemexChoice | null) => void;

  lastValidate: MemexValidateReport | null;
  setLastValidate: (r: MemexValidateReport | null) => void;
}

export const useMemexStore = create<MemexUiState>((set) => ({
  pendingChoice: null,
  setPendingChoice: (c) => set({ pendingChoice: c }),
  lastValidate: null,
  setLastValidate: (r) => set({ lastValidate: r }),
}));
