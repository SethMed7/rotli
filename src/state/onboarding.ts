// Reset & re-onboard (the maintainer, 2026-06-19): wipe the user-tunable settings —
// hotkeys, window behavior, Dock policy, theme — back to their defaults and drop
// the `onboarded` flag, so the first-run flow runs again. The persistence layer
// (state/persist.ts) writes the reset state on the next debounce; the OS-side
// pieces (global chords, activation policy, hide-on-blur) are re-applied here
// because clearing the in-memory overrides alone wouldn't un-register a custom
// global chord or flip the Dock back.

import type { QuokkaAccessory } from "../brand/quokka";
import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
import { DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE } from "../lib/privateBrowser";
import { setDockVisible, setGlobalShortcut, setHideOnBlur } from "../lib/tauri";
import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import { useUiStore } from "./ui";

/** First run's four screens (the owner, 2026-10-01, after testers' "too many
 * steps"): you and your theme, your vault, the Librarian, your shortcuts. The
 * window, music, quokka, and models wait in the app: Settings, the sidebar
 * player, and Chat offer them where they're used. */
export const ONBOARDING_STEP_NUMBER = {
  you: 1,
  vault: 2,
  librarian: 3,
  shortcuts: 4,
} as const;

export const ONBOARDING_TOTAL_STEPS = Object.keys(ONBOARDING_STEP_NUMBER).length;

/** What every first run starts from: Rotli Light and a quokka wearing nothing,
 * even when a personalized install is re-onboarded from Settings. */
export function startingAppearance(): typeof DEFAULT_APPEARANCE & { quokkaAccessory: QuokkaAccessory } {
  return { ...DEFAULT_APPEARANCE, quokkaAccessory: "none" };
}

/** A new install's window (the owner, 2026-10-01, after testers lost the app
 * behind other windows): in the Dock and ⌘Tab, staying open like any app. The
 * menu-bar visitor remains a choice in Settings → General. */
export const FIRST_RUN_WINDOW = { stayOpen: true, showInDock: true } as const;

/** Whether this is a true first run: never onboarded, no recorded onboarding
 * version (Settings → Reset & re-onboard keeps the version it had). */
export function isFirstRun(onboarded: boolean, onboardingVersion: string): boolean {
  return !onboarded && onboardingVersion === "";
}

/** The window flags a true first run starts with. An install re-onboarded
 * from Settings keeps its own Stay open / Dock choice: resetting it made the
 * window hide on the next Finder click. */
export function firstRunWindow(
  onboarded: boolean,
  onboardingVersion: string,
): { stayOpen?: true; showInDock?: true } {
  return isFirstRun(onboarded, onboardingVersion) ? { ...FIRST_RUN_WINDOW } : {};
}

/** Setup runs only on a true first run (or after Settings → Reset & re-onboard).
 * An app update never re-onboards: the 0.x version gate that did is retired
 * with 1.0.0. `onboardingVersion` still records where setup was completed. */
export function onboardingRequired(native: boolean, onboarded: boolean): boolean {
  return native && !onboarded;
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

  // window behavior + Dock → defaults (in the Dock, staying open)
  await setHideOnBlur(false).catch(() => {});
  await setDockVisible(true).catch(() => {});

  // theme + the General flags + the gate → defaults, in one store write
  useUiStore.setState({
    ...DEFAULT_APPEARANCE,
    ...FIRST_RUN_WINDOW,
    privateBrowserSearchEngine: DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
    remoteAgentRelayUrl: "",
    onboarded: false,
    onboardingPhase: "preferences",
  });
}
