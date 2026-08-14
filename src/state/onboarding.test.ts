import { expect, test } from "bun:test";

import { ONBOARDING_STEP_NUMBER, ONBOARDING_TOTAL_STEPS, onboardingRequired } from "./onboarding";

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
