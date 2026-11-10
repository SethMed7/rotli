// The conflict copies the person is told about (eighth and ninth reviews of
// pull request 267): saveQueue.ts adds one per copy when a note takes the
// other app's text; the sidebar notice reads them; opening the copy or
// dismissing the notice clears it. Kept in the UI store, persisted in the
// vault's settings.json, so a copy made at quit is still pointed to after the
// restart.

import { type CopiedAside, useUiStore } from "../state/ui";

/** The conflict copies the person hasn't opened or dismissed, read once. */
export const copiedAside = (): CopiedAside[] => useUiStore.getState().copiedAside;

export const useCopiedAside = (): CopiedAside[] => useUiStore((state) => state.copiedAside);

/** The person opened the copy, or dismissed the notice. */
export function dismissCopiedAside(copyId: string): void {
  const told = useUiStore.getState().copiedAside;
  if (told.some((entry) => entry.copyId === copyId))
    useUiStore.getState().setCopiedAside(told.filter((entry) => entry.copyId !== copyId));
}
