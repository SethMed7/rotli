// Whether the sidebar shows the Vault view (the vault's folders as they are on
// disk, services/vaultTree.ts) instead of Main or a named view. Off by default;
// an app setting on this Mac (state/appExtras.ts).

import { create } from "zustand";

export const useVaultView = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: false,
  setOn: (on) => set({ on }),
}));
