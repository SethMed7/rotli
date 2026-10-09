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
import { compareVersions } from "../lib/whatsNew";
import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import { FIRST_RUN_WINDOW, type OnboardingPhase } from "./onboardingPhase";
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

/** Setup runs on a true first run, after Settings → Reset & re-onboard, and
 * once for everyone set up before REONBOARD_BEFORE (reonboardingFor). An app
 * update otherwise never re-onboards. `onboardingVersion` records where setup
 * was completed. */
export function onboardingRequired(native: boolean, onboarded: boolean): boolean {
  return native && !onboarded;
}

/** 1.8.0 re-onboards everyone once (the owner, 2026-10-09): settings leaked
 * across earlier setups, and everyone should see the new setup, then what's
 * new. Bump this to require it again in a later release. */
export const REONBOARD_BEFORE = "1.8.0";

/** What a launch changes to run setup once more for someone set up before
 * REONBOARD_BEFORE — or null. Nothing they chose is reset: setup opens on
 * their own theme and vault, Skip setup keeps everything, and finishing ends
 * at what's new (finishLeadsTo). An install too old to have recorded a version
 * is stamped 0.0.0, so it stays returning rather than a first run. Mid-setup
 * (not onboarded) is left alone, which makes it once. */
export function reonboardingFor(
  onboarded: boolean,
  onboardingVersion: string,
  before: string = REONBOARD_BEFORE,
): { onboarded: false; onboardingPhase: OnboardingPhase; onboardingVersion: string } | null {
  if (!onboarded) return null;
  if (onboardingVersion !== "" && compareVersions(onboardingVersion, before) >= 0) return null;
  return {
    onboarded: false,
    onboardingPhase: "preferences",
    onboardingVersion: onboardingVersion || "0.0.0",
  };
}

/** Where finishing setup leads: a first run to the welcome note and the
 * thank-you card; anyone returning (re-onboarded, or Reset & re-onboard) to
 * this release's what's new. */
export function finishLeadsTo(onboardingVersion: string): "welcome" | "whatsNew" {
  return onboardingVersion === "" ? "welcome" : "whatsNew";
}

/** Applies reonboardingFor as settings load (persist.ts hydrate) — the Mac
 * app's main window only; Rotli Web never runs setup. `markForWrite` tells the
 * settings writer to save: it starts from this already-changed state, so
 * without it a quit on setup's first screen left `onboarded: true` on disk.
 * True when applied. */
export function applyReonboarding(nativeMain: boolean, markForWrite: () => void): boolean {
  if (!nativeMain) return false;
  const ui = useUiStore.getState();
  const again = reonboardingFor(ui.onboarded, ui.onboardingVersion);
  if (!again) return false;
  useUiStore.setState(again);
  markForWrite();
  return true;
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
    ...startingAppearance(),
    ...FIRST_RUN_WINDOW,
    privateBrowserSearchEngine: DEFAULT_PRIVATE_BROWSER_SEARCH_ENGINE,
    remoteAgentRelayUrl: "",
    onboarded: false,
    onboardingPhase: "preferences",
  });
}
