// The note at Settings after first run (the owner, 2026-10-01: "after user
// says thank you pop a little note out of the settings area post tour or
// immediately if they skip tour"). Setup arms it; the tour closing, finished
// or skipped, shows it once. Session state only: a later tour never re-shows it.

import { create } from "zustand";

import { useTourStore } from "./tour";
import { useUiStore } from "./ui";

export const useSettingsHint = create<{ armed: boolean; open: boolean }>(() => ({
  armed: false,
  open: false,
}));

/** Setup finished: show the note when the tour that follows closes. */
export function armSettingsHint(): void {
  useSettingsHint.setState({ armed: true, open: false });
}

export function dismissSettingsHint(): void {
  useSettingsHint.setState({ open: false });
}

useTourStore.subscribe((state, prev) => {
  // a tour starting again puts the note away; it never covers the tour
  if (state.step !== null) return dismissSettingsHint();
  if (prev.step !== null && useSettingsHint.getState().armed)
    useSettingsHint.setState({ armed: false, open: true });
});

// going to Settings is what the note asked: it has done its job
useUiStore.subscribe((state, prev) => {
  if (state.settingsOpen && !prev.settingsOpen) dismissSettingsHint();
});
