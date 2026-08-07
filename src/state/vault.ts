import { create } from "zustand";

export type VaultStatus = "checking" | "unconfigured" | "configured";

interface VaultState {
  status: VaultStatus;
  setStatus: (status: VaultStatus) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  status: "checking",
  setStatus: (status) => set({ status }),
}));
