import { describe, expect, test } from "bun:test";

import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  REONBOARD_BEFORE,
  finishLeadsTo,
  firstRunWindow,
  isFirstRun,
  onboardingRequired,
  reonboardingFor,
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

test("a completed onboarding doesn't run again by itself: only reonboardingFor reopens it", () => {
  // Updates used to re-onboard on every 0.x version change; now only a fresh
  // install, Settings → Reset & re-onboard, or a release that requires it
  // (REONBOARD_BEFORE) runs setup.
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

// 1.8.0 re-onboarding (the owner, 2026-10-09: everyone sees the new setup
// once, then what's new): anyone set up before REONBOARD_BEFORE runs it again.
describe("reonboardingFor", () => {
  test("someone set up before 1.8.0 goes through setup again, keeping where they were set up", () => {
    expect(reonboardingFor(true, "1.7.1")).toEqual({
      onboarded: false,
      onboardingPhase: "preferences",
      onboardingVersion: "1.7.1",
    });
    expect(reonboardingFor(true, "0.95.1")?.onboardingVersion).toBe("0.95.1");
  });

  test("an install too old to have recorded a version is returning, not a first run", () => {
    const due = reonboardingFor(true, "");
    expect(due?.onboardingVersion).toBe("0.0.0");
    expect(isFirstRun(false, due?.onboardingVersion ?? "")).toBe(false);
  });

  test("once is enough: set up on 1.8.0 or later, mid-setup, or a first run is left alone", () => {
    expect(reonboardingFor(true, "1.8.0")).toBeNull();
    expect(reonboardingFor(true, "1.9.2")).toBeNull();
    expect(reonboardingFor(false, "1.7.1")).toBeNull(); // already going through it again
    expect(reonboardingFor(false, "")).toBeNull(); // a first run
    expect(REONBOARD_BEFORE).toBe("1.8.0");
  });
});

describe("finishLeadsTo", () => {
  test("a first run ends at the welcome; anyone returning ends at what's new", () => {
    expect(finishLeadsTo("")).toBe("welcome");
    expect(finishLeadsTo("1.7.1")).toBe("whatsNew");
    expect(finishLeadsTo("0.0.0")).toBe("whatsNew");
  });
});
