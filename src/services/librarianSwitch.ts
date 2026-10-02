// The Librarian on or off for this vault, live: the saved setting and the
// running organizer at once. The debounced settings write alone left minutes
// of modeling after someone said no (pressure-test 2026-07-26), so every
// switch (Settings, setup's "Not now") goes through here.

import { organizerSetBrain } from "../lib/tauri";
import { useUiStore } from "../state/ui";

export function setLibrarianOn(on: boolean): void {
  useUiStore.getState().setBrainEnabled(on);
  void organizerSetBrain(on).catch(() => {});
}
