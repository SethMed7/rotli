import { expect, test } from "bun:test";

import { isOnboardingReview } from "./reviewMode";

test("onboarding review cannot replace a native or production vault", () => {
  expect(isOnboardingReview(false, true, "?onboarding")).toBe(true);
  expect(isOnboardingReview(true, true, "?onboarding")).toBe(false);
  expect(isOnboardingReview(false, false, "?onboarding")).toBe(false);
  expect(isOnboardingReview(false, true, "")).toBe(false);
});
