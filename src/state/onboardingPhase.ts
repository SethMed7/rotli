// First run's phases (state/onboarding.ts has the screens): you and your
// theme (preferences), your vault, the Librarian, your shortcuts. Pure, so the
// settings reader and the UI store share one parser.

export type OnboardingPhase = "preferences" | "vault" | "librarian" | "shortcuts";

/** A saved phase, read tolerantly. "models" (setup before 2026-10-01, whose
 * last screen chose models and the Librarian) resumes at the Librarian. */
export function onboardingPhaseOf(value: unknown): OnboardingPhase {
  if (value === "models") return "librarian";
  return value === "vault" || value === "librarian" || value === "shortcuts" ? value : "preferences";
}
