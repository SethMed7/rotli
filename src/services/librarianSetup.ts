// Whether the Librarian is on but its lane can't work yet: no local model, or
// a client not installed or signed in (the owner, 2026-10-02: someone who chose
// before anything was set up finishes from the sidebar's Librarian). Only the
// Mac app has clients and local models to ask about.

import {
  type LaneEvidence,
  type LibrarianChoice,
  librarianLaneStatus,
  librarianSetupStep,
} from "../ai/librarianLane";
import { isTauri } from "../lib/tauri";

export const librarianLanesProbe = (): boolean => isTauri();

/** The step left: none while it's off, on the web, or still being checked. */
export function librarianSetupStepNow(state: {
  on: boolean;
  native: boolean;
  lane: LibrarianChoice;
  evidence: LaneEvidence;
}): string | null {
  if (!state.on || !state.native) return null;
  return librarianSetupStep(state.lane, librarianLaneStatus(state.lane, state.evidence));
}
