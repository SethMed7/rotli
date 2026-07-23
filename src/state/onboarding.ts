// Reset & re-onboard (Seth, 2026-06-19): wipe the user-tunable settings —
// hotkeys, window behavior, Dock policy, theme — back to their defaults and drop
// the `onboarded` flag, so the first-run flow runs again. The persistence layer
// (state/persist.ts) writes the reset state on the next debounce; the OS-side
// pieces (global chords, activation policy, hide-on-blur) are re-applied here
// because clearing the in-memory overrides alone wouldn't un-register a custom
// global chord or flip the Dock back.

import { useBindingsStore } from "../keys/bindings";
import { toAccelerator } from "../keys/chords";
import { allActions } from "../keys/registry";
import { setDockVisible, setGlobalShortcut, setHideOnBlur } from "../lib/tauri";
import { useUiStore } from "./ui";

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
    theme: "light",
    themeFamily: "warm",
    matchLightFamily: "warm",
    matchDarkFamily: "warm",
    syntaxPalette: "rotli",
    stayOpen: false,
    showInDock: false,
    onboarded: false,
  });
}
