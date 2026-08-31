// Reset & re-onboard (the maintainer, 2026-06-19): wipe the user-tunable settings —
// hotkeys, window behavior, Dock policy, theme — back to their defaults and drop
// the `onboarded` flag, so the first-run flow runs again. The persistence layer
// (state/persist.ts) writes the reset state on the next debounce; the OS-side
// pieces (global chords, activation policy, hide-on-blur) are re-applied here
// because clearing the in-memory overrides alone wouldn't un-register a custom
// global chord or flip the Dock back.

import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
import { DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE } from "../lib/privateBrowser";
import { setDockVisible, setGlobalShortcut, setHideOnBlur } from "../lib/tauri";
import { DEFAULT_ACCENT_HUE, useUiStore } from "./ui";

export const ONBOARDING_STEP_NUMBER = {
  welcome: 1,
  appearance: 2,
  behavior: 3,
  shortcuts: 4,
  vault: 5,
  models: 6,
} as const;

export const ONBOARDING_TOTAL_STEPS = Object.keys(ONBOARDING_STEP_NUMBER).length;

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function onboardingRequired(
  native: boolean,
  onboarded: boolean,
  onboardingVersion: string,
  requiredVersion: string,
): boolean {
  return native && (!onboarded || compareVersions(onboardingVersion, requiredVersion) < 0);
}

export async function resetAndReonboard(): Promise<void> {
  // hotkeys → defaults: drop every override, then re-register each GLOBAL action
  // to its default accelerator OS-side (the dispatcher reads defaults for the
  // rest automatically once overrides are gone).
  useBindingsStore.setState({ overrides: {} });
  for (const action of allActions()) {
    if (!action.global) continue;
    await setGlobalShortcut(action.id, action.defaultChord ? toAccelerator(action.defaultChord) : null).catch(
      () => {},
    );
  }

  // window behavior + Dock → defaults (visitor, menu-bar-only)
  await setHideOnBlur(true).catch(() => {});
  await setDockVisible(false).catch(() => {});

  // theme + the General flags + the gate → defaults, in one store write
  useUiStore.setState({
    theme: "system",
    themeFamily: "mono",
    syntaxPalette: "rotli",
    accentColor: "default",
    accentHue: DEFAULT_ACCENT_HUE,
    stayOpen: false,
    showInDock: false,
    privateBrowserSearchEngine: DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
    remoteAgentRelayUrl: "",
    onboarded: false,
    onboardingPhase: "preferences",
  });
}
