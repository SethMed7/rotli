// Which release's What's new card is open (2026-09-28): null when none. Set on
// launch after an update (components/whatsNewDialog.tsx) or from the palette.
// Session state only; the "seen" mark is the persisted `lastSeenVersion`.

import { create } from "zustand";

export const useWhatsNew = create<{ version: string | null }>(() => ({ version: null }));

export function showWhatsNew(version: string): void {
  useWhatsNew.setState({ version });
}

export function hideWhatsNew(): void {
  useWhatsNew.setState({ version: null });
}
