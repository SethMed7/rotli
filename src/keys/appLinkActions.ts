// App-level actions that open something outside Rotli. Registered from
// ./actions.ts with everything else; kept here so actions.ts stays under its
// size ceiling.

import { guideOs } from "../ai/connectorGuides";
import { feedbackUrl } from "../lib/feedback";
import { appVersion, openUrl } from "../lib/tauri";
import { CHANGELOG_URL, latestHighlights, WHATS_NEW } from "../lib/whatsNew";
import { stopAllSound } from "../services/ambient";
import { showWhatsNew } from "../state/whatsNew";
import { registerAction } from "./registry";

export function registerAppLinkActions(): void {
  // the same prefilled issue as Settings → About Rotli (version + OS only)
  registerAction({
    id: "app.feedback",
    title: "Send feedback",
    defaultChord: null,
    run: () =>
      void appVersion()
        .catch(() => null)
        .then((version) => openUrl(feedbackUrl(version, guideOs(navigator.platform || navigator.userAgent)))),
  });
  // the newest release's highlights again (the card shows once on its own)
  registerAction({
    id: "app.whatsNew",
    title: "What’s new in Rotli",
    defaultChord: null,
    run: () => {
      const latest = latestHighlights(WHATS_NEW);
      if (latest) showWhatsNew(latest.version);
    },
  });
  registerAction({
    id: "app.changelog",
    title: "Open the full changelog",
    defaultChord: null,
    run: () => void openUrl(CHANGELOG_URL),
  });
  // the safety valve: whatever is sounding, from wherever, stops (2026-09-28)
  registerAction({
    id: "app.stopSound",
    title: "Stop all sound",
    defaultChord: null,
    run: stopAllSound,
  });
}
