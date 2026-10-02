import { expect, test } from "bun:test";

import { onboardingPhaseOf } from "./onboardingPhase";

test("a saved phase resumes where it was; the old Models screen resumes at the Librarian", () => {
  expect(onboardingPhaseOf("vault")).toBe("vault");
  expect(onboardingPhaseOf("librarian")).toBe("librarian");
  expect(onboardingPhaseOf("shortcuts")).toBe("shortcuts");
  expect(onboardingPhaseOf("models")).toBe("librarian");
  expect(onboardingPhaseOf("sound")).toBe("preferences");
  expect(onboardingPhaseOf(undefined)).toBe("preferences");
});
