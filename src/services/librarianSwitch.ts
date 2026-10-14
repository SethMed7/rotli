// The Librarian on or off for this vault, live: the saved setting and the
// running organizer at once. The debounced settings write alone left minutes
// of modeling after someone said no (pressure-test 2026-07-26), so every
// switch (Settings, setup's "Not now") goes through here.
//
// A folder connected in place is never organized (decision H,
// docs/design/vault-copy-and-obsidian-compatibility.md): the Librarian there
// is always off, and the only way to it is a copy Rotli makes. Rust refuses to
// organize such a folder on its own; this keeps the switch honest about it.

import { organizerSetBrain } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { openedInPlace } from "./vaultInPlace";

/** False in a folder connected in place: the Librarian can't be turned on there. */
export function librarianAllowed(): boolean {
  return !openedInPlace();
}

export function setLibrarianOn(on: boolean): void {
  const next = on && librarianAllowed();
  useUiStore.getState().setBrainEnabled(next);
  void organizerSetBrain(next).catch(() => {});
}

/** After settings load: a folder connected in place keeps the Librarian off,
 * whatever its settings file says (a hand edit, or a setting from before). */
export function holdLibrarianOffInPlace(): void {
  if (!librarianAllowed() && useUiStore.getState().brainEnabled) setLibrarianOn(false);
}
