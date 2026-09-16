// Rotli Web's "Connect a folder" dialog: one open flag, asked from the
// sidebar's Connect vault and from Settings → General. Session state only.

import { create } from "zustand";

interface WebVaultConnectState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export const useWebVaultConnect = create<WebVaultConnectState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
