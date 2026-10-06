// What this Mac already has for AI — registered local models and signed-in
// official clients — detected once, from the FIRST setup screen, so the
// Librarian screen and Chat's model chooser open already knowing instead of
// showing "Checking…". One store, one idempotent start; installs and removals
// in the chooser refresh the local list. The sidebar's Librarian asks about
// just its own lane (checkLibrarianLane), never every client.

import { create } from "zustand";

import type { LibrarianChoice } from "../ai/librarianLane";
import { PROVIDER_IDS, type ProviderId } from "../ai/models";
import { type ChatModelInfo, type CliDetect, chatModels, cliDetect } from "../lib/tauri";

export type Detections = Partial<Record<ProviderId, CliDetect>>;

interface SetupDetectionState {
  started: boolean;
  local: ChatModelInfo[];
  /** The local list has answered at least once ([] before it does means "not yet"). */
  localChecked: boolean;
  detections: Detections;
  /** The Librarian's lane was picked by the person, or suggested once: from
   * then on setup never changes it (a Back and return remounts the screen). */
  librarianChosen: boolean;
}

export const useSetupDetection = create<SetupDetectionState>(() => ({
  started: false,
  local: [],
  localChecked: false,
  detections: {},
  librarianChosen: false,
}));

export function settleLibrarianChoice(): void {
  useSetupDetection.setState({ librarianChosen: true });
}

const NOT_INSTALLED: CliDetect = { installed: false, authenticated: false, version: null };

/** A client the app may call right now: installed and signed in. */
export function providerReady(detection: CliDetect | undefined): boolean {
  return !!detection?.installed && detection.authenticated;
}

/** Re-read the registered local models (after an install, removal, or default change). */
export function refreshLocalModels(): Promise<void> {
  return Promise.resolve()
    .then(chatModels)
    .then((local) => useSetupDetection.setState({ local, localChecked: true }))
    .catch(() => useSetupDetection.setState({ local: [], localChecked: true }));
}

function record(provider: ProviderId, detection: CliDetect): void {
  useSetupDetection.setState((state) => ({ detections: { ...state.detections, [provider]: detection } }));
}

/** Ask again about one client — the setup walkthrough's "Check again". */
export function recheckProvider(provider: ProviderId): Promise<void> {
  return Promise.resolve()
    .then(() => cliDetect(provider))
    .then((detection) => record(provider, detection))
    .catch(() => record(provider, NOT_INSTALLED));
}

/** Kick off every probe once. Safe to call from any screen; later calls no-op. */
export function startSetupDetection(): void {
  if (useSetupDetection.getState().started) return;
  useSetupDetection.setState({ started: true });
  void refreshLocalModels();
  for (const provider of PROVIDER_IDS) {
    void Promise.resolve()
      .then(() => cliDetect(provider))
      .then((detection) => record(provider, detection))
      .catch(() => record(provider, NOT_INSTALLED));
  }
}

const laneChecked = new Set<LibrarianChoice>();

/** Ask once about the Librarian's own lane: the local list, or that one client. */
export function checkLibrarianLane(lane: LibrarianChoice): void {
  const state = useSetupDetection.getState();
  if (laneChecked.has(lane) || state.started) return;
  laneChecked.add(lane);
  void (lane === "local" ? refreshLocalModels() : recheckProvider(lane));
}
