// The ⌘⇧A request to toggle a pane's Aa panel (2026-09-24). The panel's open
// state stays local to each editor; this carries only "the editor in this
// pane: toggle", numbered so an editor mounted later never acts on an old one.

import { create } from "zustand";

export interface AaPanelRequest {
  paneId: string;
  nonce: number;
}

export const useAaPanelRequest = create<{ request: AaPanelRequest | null }>(() => ({ request: null }));

/** What an editor does with the latest request: toggle its panel, mark
 * another pane's request seen, wait (its Aa chip is not mounted yet — the note
 * is still loading — so the press is kept, not lost), or ignore an old one.
 * Pure for tests. */
export function aaRequestStep(
  request: AaPanelRequest | null,
  seenNonce: number,
  paneId: string,
  chipReady: boolean,
): "toggle" | "consume" | "wait" | "ignore" {
  if (!request || request.nonce <= seenNonce) return "ignore";
  if (request.paneId !== paneId) return "consume";
  return chipReady ? "toggle" : "wait";
}

export function toggleAaPanel(paneId: string): void {
  useAaPanelRequest.setState((state) => ({ request: { paneId, nonce: (state.request?.nonce ?? 0) + 1 } }));
}
