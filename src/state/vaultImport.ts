// "Work on a copy" (docs/design/vault-copy-and-obsidian-compatibility.md,
// slice 3): the one dialog's state. A caller asks how to open a folder that
// already holds notes; the person answers in the dialog; a copy then shows its
// progress, and ends open or with what went wrong. Session-only.

import { create } from "zustand";

export type VaultOpenChoice = "copy" | "in-place" | "cancel";

export interface VaultCopyDone {
  destination: string;
  files: number;
  skipped: string[];
  /** "foreign": the copy kept another tool's memex.json, so it opened protected. */
  marked?: "imported" | "alreadyRotli" | "foreign";
}

export type VaultImportStep =
  | { kind: "idle" }
  | { kind: "choose"; label: string; source: string; notes: number }
  | { kind: "copying"; label: string; files: number; totalFiles: number; bytes: number; totalBytes: number }
  | { kind: "done"; label: string; report: VaultCopyDone }
  | { kind: "failed"; label: string; message: string };

interface VaultImportState {
  step: VaultImportStep;
  /** Resolves the open question (set while `choose` shows). */
  answer: ((choice: VaultOpenChoice) => void) | null;
  set: (step: VaultImportStep) => void;
  ask: (question: { label: string; source: string; notes: number }) => Promise<VaultOpenChoice>;
  choose: (choice: VaultOpenChoice) => void;
}

export const useVaultImport = create<VaultImportState>((set, get) => ({
  step: { kind: "idle" },
  answer: null,
  set: (step) => set({ step }),
  ask: (question) => {
    get().answer?.("cancel"); // a question already open is answered "not now"
    return new Promise<VaultOpenChoice>((resolve) =>
      set({ step: { kind: "choose", ...question }, answer: resolve }),
    );
  },
  choose: (choice) => {
    const answer = get().answer;
    set({ answer: null, step: choice === "copy" ? get().step : { kind: "idle" } });
    answer?.(choice);
  },
}));
