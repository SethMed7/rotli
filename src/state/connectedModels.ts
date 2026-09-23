// The model lists the connected clients reported (Rust `cli_models`), per
// lane. `loading` only until a lane first answers; a later refresh keeps the
// last answer on screen. `error` means the client couldn't list (not signed
// in, an older Rotli Helper) and the built-in catalog stands in. Keyed by the
// provider id (ai/models.ts ProviderId) — kept a plain string here so the
// catalog seam can read this store without a module cycle.

import { create } from "zustand";

import type { DiscoveredModel } from "../lib/cliModelTypes";

export type DiscoveryStatus = "loading" | "ready" | "error";

export interface LaneDiscovery {
  status: DiscoveryStatus;
  models: readonly DiscoveredModel[];
  /** When the lane last answered (ms), for the refresh window. */
  at: number;
}

export type DiscoveryLanes = Partial<Record<string, LaneDiscovery>>;

export const useConnectedModels = create<{ lanes: DiscoveryLanes }>(() => ({ lanes: {} }));

export function setLaneDiscovery(provider: string, lane: LaneDiscovery): void {
  useConnectedModels.setState((state) => ({ lanes: { ...state.lanes, [provider]: lane } }));
}

/** The lists as they stand — what the catalog accessors read by default. */
export function currentDiscovery(): DiscoveryLanes {
  return useConnectedModels.getState().lanes;
}
