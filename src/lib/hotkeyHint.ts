// A chord written into a label, tooltip, or <kbd> hint. Rotli Web has no app
// hotkeys (featurePolicy `hotkeys`), so it names none: a hint for a key that
// does nothing — or does the browser's thing — is worse than no hint.

import { LAUNCH_FEATURES } from "./featurePolicy";

/** True where the build answers app hotkeys (the Mac app). */
export const SHOW_HOTKEYS: boolean = LAUNCH_FEATURES.hotkeys;

/** `text` (e.g. " — ⌘T") where hotkeys exist; "" on Rotli Web. */
export function hotkeyHint(text: string): string {
  return SHOW_HOTKEYS ? text : "";
}
