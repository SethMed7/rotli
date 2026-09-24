// The ⌘⇧A request to toggle a pane's Aa panel (2026-09-24). The panel's open
// state stays local to each editor; this carries only "the editor in this
// pane: toggle", numbered so an editor mounted later never acts on an old one.

import { create } from "zustand";

export interface AaPanelRequest {
  paneId: string;
  nonce: number;
}

export const useAaPanelRequest = create<{ request: AaPanelRequest | null }>(() => ({ request: null }));

export function toggleAaPanel(paneId: string): void {
  useAaPanelRequest.setState((state) => ({ request: { paneId, nonce: (state.request?.nonce ?? 0) + 1 } }));
}
