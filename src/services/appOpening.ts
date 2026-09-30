// Where the app's opening plays (components/onboarding/appOpening.tsx): the
// Mac app, on each launch. `?opening` shows it in the browser twin (tests).

import { isTauri } from "../lib/tauri";

export function openingPlaysHere(search = window.location.search): boolean {
  return isTauri() || new URLSearchParams(search).has("opening");
}
