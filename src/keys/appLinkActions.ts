// App-level actions that open something outside Rotli. Registered from
// ./actions.ts with everything else; kept here so actions.ts stays under its
// size ceiling.

import { guideOs } from "../ai/connectorGuides";
import { feedbackUrl } from "../lib/feedback";
import { appVersion, openUrl } from "../lib/tauri";
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
}
