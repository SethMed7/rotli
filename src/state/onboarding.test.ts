import { expect, test } from "bun:test";

import { onboardingRequired } from "./onboarding";

test("native development receives onboarding while the browser twin does not", () => {
  expect(onboardingRequired(true, false, "", "0.80.0")).toBe(true);
  expect(onboardingRequired(false, false, "", "0.80.0")).toBe(false);
});

test("completed current onboarding stays out of the way", () => {
  expect(onboardingRequired(true, true, "0.80.0", "0.80.0")).toBe(false);
  expect(onboardingRequired(true, true, "0.79.0", "0.80.0")).toBe(true);
});
