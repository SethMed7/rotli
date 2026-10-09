// First run's finish (the owner, 2026-10-01): the person's window takes
// effect, the welcome opens, and the thank-you card leads to the tour, after
// which a note at Settings says what else is there (state/settingsHint.ts).
// Someone returning — re-onboarded for 1.8.0, or Reset & re-onboard — already
// knows the app: their setup ends at this release's what's new instead
// (the owner, 2026-10-09: "when done with the onboarding … the change logs").

import { setDockVisible, setHideOnBlur } from "../lib/tauri";
import { highlightsFor, WHATS_NEW } from "../lib/whatsNew";
import { finishLeadsTo } from "../state/onboarding";
import { useOnboardingThanks } from "../state/onboardingThanks";
import { flushSettingsNow } from "../state/persist";
import { armSettingsHint } from "../state/settingsHint";
import { useUiStore } from "../state/ui";
import { showWhatsNew } from "../state/whatsNew";
import { openSeededWelcome } from "./welcome";

export function finishFirstRun(appVersion: string): void {
  const ui = useUiStore.getState();
  const leadsTo = finishLeadsTo(ui.onboardingVersion);
  ui.setOnboarded(true);
  if (leadsTo === "welcome") {
    openSeededWelcome();
    useOnboardingThanks.getState().show();
    armSettingsHint();
  } else {
    // seen as it shows, like the launch card (components/whatsNewDialog.tsx)
    useUiStore.setState({ lastSeenVersion: appVersion });
    if (highlightsFor(WHATS_NEW, appVersion)) showWhatsNew(appVersion);
  }
  ui.setOnboardingVersion(appVersion);
  ui.setOnboardingPhase("preferences");
  void setHideOnBlur(!ui.stayOpen);
  void setDockVisible(ui.showInDock);
  void flushSettingsNow().catch(() => {});
}
