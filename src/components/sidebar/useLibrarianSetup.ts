// The sidebar's Librarian asks about its own lane once and wears a dot while
// that lane isn't set up (services/librarianSetup.ts decides).

import { useEffect } from "react";

import { librarianLanesProbe, librarianSetupStepNow } from "../../services/librarianSetup";
import { checkLibrarianLane, useSetupDetection } from "../../state/setupDetection";
import { useUiStore } from "../../state/ui";

export function useLibrarianSetupStep(): string | null {
  const on = useUiStore((s) => s.brainEnabled);
  const lane = useUiStore((s) => s.organizerModel);
  const detections = useSetupDetection((s) => s.detections);
  const local = useSetupDetection((s) => s.local);
  const localChecked = useSetupDetection((s) => s.localChecked);
  const native = librarianLanesProbe();
  useEffect(() => {
    if (on && native) checkLibrarianLane(lane);
  }, [on, native, lane]);
  return librarianSetupStepNow({ on, native, lane, evidence: { detections, local, localChecked } });
}

/** Settings → Librarian, where the lane is chosen and the step is spelled out. */
export function openLibrarianSettings(): void {
  const ui = useUiStore.getState();
  ui.setSettingsPaneRequest("brain");
  ui.setSettingsOpen(true);
}
