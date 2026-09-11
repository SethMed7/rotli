/** The fresh-onboarding browser fixture is available only in a development build. */
export function isOnboardingReview(native: boolean, development: boolean, search: string): boolean {
  return !native && development && new URLSearchParams(search).has("onboarding");
}
