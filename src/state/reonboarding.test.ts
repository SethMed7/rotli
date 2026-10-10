// The 1.8.0 launch gate (onboarding.ts applyReonboarding, run by persist.ts as
// settings load) and what it leaves on
// disk: the app settings it writes say "not onboarded" from the first frame,
// so a quit on setup's first screen re-runs setup instead of skipping it, and
// finishing stamps the release, so it runs once.

import { afterEach, expect, test } from "bun:test";

import { finishFirstRun } from "../services/firstRun";
import { applyReonboarding } from "./onboarding";
import { appSettingsSnapshot } from "./persist";
import { useUiStore } from "./ui";
import { useWhatsNew } from "./whatsNew";

const before = useUiStore.getState();
afterEach(() => {
  useUiStore.setState({
    onboarded: before.onboarded,
    onboardingVersion: before.onboardingVersion,
    onboardingPhase: before.onboardingPhase,
    lastSeenVersion: before.lastSeenVersion,
  });
  useWhatsNew.setState({ version: null });
});

const onDisk = () => JSON.parse(appSettingsSnapshot()) as Record<string, unknown>;

test("the Mac app's main window re-onboards someone set up on 1.7.1, and the settings it writes say so", () => {
  useUiStore.setState({ onboarded: true, onboardingVersion: "1.7.1", onboardingPhase: "preferences" });
  let marked = 0;
  expect(applyReonboarding(true, () => (marked += 1))).toBe(true);
  expect(marked).toBe(1); // the writer is told to save it
  expect(useUiStore.getState().onboarded).toBe(false);
  expect(onDisk()).toMatchObject({
    onboarded: false,
    onboardingVersion: "1.7.1",
    onboardingPhase: "preferences",
  });
});

test("elsewhere (Rotli Web, another window) or once set up on 1.8.0, nothing changes", () => {
  useUiStore.setState({ onboarded: true, onboardingVersion: "1.7.1" });
  const never = () => {
    throw new Error("nothing to write");
  };
  expect(applyReonboarding(false, never)).toBe(false);
  expect(useUiStore.getState().onboarded).toBe(true);
  useUiStore.setState({ onboarded: true, onboardingVersion: "1.8.0" });
  expect(applyReonboarding(true, never)).toBe(false);
  expect(useUiStore.getState().onboarded).toBe(true);
});

test("finishing the re-onboarding stamps 1.8.0 and opens its What's new, so it never runs again", () => {
  useUiStore.setState({ onboarded: true, onboardingVersion: "1.7.1" });
  applyReonboarding(true, () => {});
  finishFirstRun("1.8.0");
  expect(onDisk()).toMatchObject({ onboarded: true, onboardingVersion: "1.8.0", lastSeenVersion: "1.8.0" });
  expect(useWhatsNew.getState().version).toBe("1.8.0");
  expect(applyReonboarding(true, () => {})).toBe(false);
});
