// First run's finish (the owner, 2026-10-01): the person's window takes
// effect, the welcome opens, and the thank-you card leads to the tour, after
// which a note at Settings says what else is there (state/settingsHint.ts).

import { setDockVisible, setHideOnBlur } from "../lib/tauri";
import { useOnboardingThanks } from "../state/onboardingThanks";
import { flushSettingsNow } from "../state/persist";
import { armSettingsHint } from "../state/settingsHint";
import { useUiStore } from "../state/ui";
import { openSeededWelcome } from "./welcome";

export function finishFirstRun(appVersion: string): void {
  const ui = useUiStore.getState();
  ui.setOnboarded(true);
  openSeededWelcome();
  useOnboardingThanks.getState().show();
  armSettingsHint();
  ui.setOnboardingVersion(appVersion);
  ui.setOnboardingPhase("preferences");
  void setHideOnBlur(!ui.stayOpen);
  void setDockVisible(ui.showInDock);
  void flushSettingsNow().catch(() => {});
}
