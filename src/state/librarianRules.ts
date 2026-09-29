// The vault's Librarian rules (src/lib/librarianRules.ts), as a store: loaded
// from and saved to `.rotli/settings.json` with the other vault settings
// (persist.ts); the Rust organizer and corpus read the same file.

import { create } from "zustand";

import { DEFAULT_LIBRARIAN_RULES, type LibrarianRules } from "../lib/librarianRules";

export const useLibrarianRules = create<{ rules: LibrarianRules; setRules: (rules: LibrarianRules) => void }>(
  (set) => ({
    rules: DEFAULT_LIBRARIAN_RULES,
    setRules: (rules) => set({ rules }),
  }),
);
