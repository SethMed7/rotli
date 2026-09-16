// What this Mac already has for AI — registered local models and signed-in
// official clients — detected once, from the FIRST setup screen, so the Models
// step (six screens later) opens already knowing instead of showing
// "Checking…". One store, one idempotent start; installs and removals on the
// Models step refresh the local list.

import { create } from "zustand";

import { PROVIDER_IDS, type ProviderId } from "../ai/models";
import { type ChatModelInfo, type CliDetect, chatModels, cliDetect } from "../lib/tauri";

export type Detections = Partial<Record<ProviderId, CliDetect>>;

interface SetupDetectionState {
  started: boolean;
  local: ChatModelInfo[];
  detections: Detections;
}

export const useSetupDetection = create<SetupDetectionState>(() => ({
  started: false,
  local: [],
  detections: {},
}));

const NOT_INSTALLED: CliDetect = { installed: false, authenticated: false, version: null };

/** A client the app may call right now: installed and signed in. */
export function providerReady(detection: CliDetect | undefined): boolean {
  return !!detection?.installed && detection.authenticated;
}

/** Re-read the registered local models (after an install, removal, or default change). */
export function refreshLocalModels(): Promise<void> {
  return Promise.resolve()
    .then(chatModels)
    .then((local) => useSetupDetection.setState({ local }))
    .catch(() => useSetupDetection.setState({ local: [] }));
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
