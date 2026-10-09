// First run's phases (state/onboarding.ts has the screens): you and your
// theme (preferences), your vault, the Librarian, your shortcuts; and the
// window a new install starts with. Pure, so the settings reader, the UI
// store, and setup share them.

/** A new install's window (the owner, 2026-10-01, after testers lost the app
 * behind other windows): in the Dock and ⌘Tab, staying open like any app. The
 * menu-bar visitor remains a choice in Settings → General. */
export const FIRST_RUN_WINDOW = { stayOpen: true, showInDock: true } as const;

/** "skipped": the person skipped setup with no vault yet, so the app asks for
 * one folder in a prompt and nothing else (the owner, 2026-10-06). Saved, so a
 * relaunch asks the same way instead of showing setup's vault step. */
export type OnboardingPhase = "preferences" | "vault" | "librarian" | "shortcuts" | "skipped";

/** A saved phase, read tolerantly. "models" (setup before 2026-10-01, whose
 * last screen chose models and the Librarian) resumes at the Librarian. */
export function onboardingPhaseOf(value: unknown): OnboardingPhase {
  if (value === "models") return "librarian";
  return value === "vault" || value === "librarian" || value === "shortcuts" || value === "skipped"
    ? value
    : "preferences";
}
