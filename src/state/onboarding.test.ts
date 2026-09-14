import { expect, test } from "bun:test";

import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  onboardingRequired,
  resetAndReonboard,
  startingAppearance,
  windowBehaviorOnSkip,
} from "./onboarding";
import { useUiStore } from "./ui";

test("first run has one canonical six-step progress map", () => {
  expect(ONBOARDING_TOTAL_STEPS).toBe(6);
  expect(Object.values(ONBOARDING_STEP_NUMBER)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("native development receives onboarding while the browser twin does not", () => {
  expect(onboardingRequired(true, false, "", "0.80.0")).toBe(true);
  expect(onboardingRequired(false, false, "", "0.80.0")).toBe(false);
});

test("completed current onboarding stays out of the way", () => {
  expect(onboardingRequired(true, true, "0.80.0", "0.80.0")).toBe(false);
  expect(onboardingRequired(true, true, "0.79.0", "0.80.0")).toBe(true);
});

test("Reset & re-onboard lands on Rotli Light, the one appearance default", async () => {
  useUiStore.setState({ theme: "dark", themeFamily: "midnight", accentColor: "rose", onboarded: true });
  await resetAndReonboard();
  const state = useUiStore.getState();
  expect(DEFAULT_APPEARANCE).toMatchObject({ theme: "light", themeFamily: "warm", accentColor: "default" });
  expect(state).toMatchObject({ ...DEFAULT_APPEARANCE, onboarded: false, onboardingPhase: "preferences" });
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

test("skipping setup resets window behavior only on a true first run, never on an upgrade", () => {
  // a fresh install: nothing persisted yet, so skip lands on the visitor defaults
  expect(windowBehaviorOnSkip(false, "")).toEqual({ stayOpen: false, showInDock: false });
  // a 0.x version bump re-onboards an onboarded install: Stay open survives
  expect(windowBehaviorOnSkip(true, "0.94.0")).toEqual({});
  // an install from before the version gate (onboarded, no recorded version)
  expect(windowBehaviorOnSkip(true, "")).toEqual({});
  // Reset & re-onboard already put the flags back itself; skip leaves them be
  expect(windowBehaviorOnSkip(false, "0.94.0")).toEqual({});
});
