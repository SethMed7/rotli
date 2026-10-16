// Settings → General → "Open in Rotli" in Finder (docs/design/open-in-rotli.md,
// stage 3), behind a service so presentation never reaches lib/tauri.

import { isTauri } from "../lib/tauri";

export { finderQuickActionSet, finderQuickActionStatus, type QuickActionStatus } from "../lib/finderBridge";

/** Only the Mac app can add a Quick Action (a browser preview has no shell). */
export function quickActionAvailable(): boolean {
  return isTauri();
}
