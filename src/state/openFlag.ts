// A dialog that is either open or not: the one-flag store the web dialogs
// share (connect a folder, chat on the web). Session state only.

import { create } from "zustand";

export interface OpenFlagState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

export function createOpenFlagStore() {
  return create<OpenFlagState>((set) => ({
    open: false,
    show: () => set({ open: true }),
    hide: () => set({ open: false }),
  }));
}
