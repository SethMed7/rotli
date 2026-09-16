// Captures-view actions. Registered from ./actions.ts with everything else;
// kept here so the Captures surface's commands sit beside their store.

import { useCaptureSelection } from "../state/captureSelection";
import { useUiStore } from "../state/ui";
import { registerAction } from "./registry";

export function registerCaptureActions(): void {
  registerAction({
    id: "captures.selectAll",
    title: "Select all captures",
    defaultChord: "Meta+A",
    enabled: () => useUiStore.getState().contentView === "board",
    run: () => useCaptureSelection.getState().selectAll(),
  });
}
