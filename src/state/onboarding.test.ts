import { expect, test } from "bun:test";

import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  firstRunWindow,
  onboardingRequired,
  resetAndReonboard,
  startingAppearance,
} from "./onboarding";
import { useUiStore } from "./ui";

test("first run is four screens: you, your vault, the Librarian, your shortcuts", () => {
  expect(ONBOARDING_TOTAL_STEPS).toBe(4);
  expect(ONBOARDING_STEP_NUMBER).toEqual({ you: 1, vault: 2, librarian: 3, shortcuts: 4 });
});

test("native development receives onboarding while the browser twin does not", () => {
  expect(onboardingRequired(true, false)).toBe(true);
  expect(onboardingRequired(false, false)).toBe(false);
});

test("a completed onboarding never runs again, whatever version the app updates to", () => {
  // Updates used to re-onboard on every 0.x version change; only a fresh
  // install (or Settings → Reset & re-onboard) runs setup now.
  expect(onboardingRequired(true, true)).toBe(false);
});

test("Reset & re-onboard lands on Rotli Light, the one appearance default", async () => {
  useUiStore.setState({ theme: "dark", themeFamily: "midnight", accentColor: "rose", onboarded: true });
  await resetAndReonboard();
  const state = useUiStore.getState();
  expect(DEFAULT_APPEARANCE).toMatchObject({ theme: "light", themeFamily: "warm", accentColor: "default" });
  expect(state).toMatchObject({ ...DEFAULT_APPEARANCE, onboarded: false, onboardingPhase: "preferences" });
  // the window's defaults too: in the Dock, staying open
  expect(state).toMatchObject({ stayOpen: true, showInDock: true });
});

test("first run starts in Rotli Light with a bare quokka, whatever the install had chosen", () => {
  useUiStore.setState({
    theme: "dark",
    themeFamily: "iris",
    quokkaAccessory: "bucket-hat",
    accentColor: "rose",
  });
  useUiStore.setState(startingAppearance());
  expect(useUiStore.getState()).toMatchObject({
    theme: "light",
    themeFamily: "warm",
    accentColor: "default",
    quokkaAccessory: "none",
  });
});

test("a new install is in the Dock and stays open; nothing else has its window choice changed", () => {
  // a fresh install: nothing persisted yet (testers lost the menu-bar-only app)
  expect(firstRunWindow(false, "")).toEqual({ stayOpen: true, showInDock: true });
  // an onboarded install keeps its own choice
  expect(firstRunWindow(true, "0.94.0")).toEqual({});
  // an install from before the version gate (onboarded, no recorded version)
  expect(firstRunWindow(true, "")).toEqual({});
  // Reset & re-onboard already put the flags back itself
  expect(firstRunWindow(false, "0.94.0")).toEqual({});
});
