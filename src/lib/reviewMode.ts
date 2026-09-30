/** The fresh-onboarding browser fixture is available only in a development build. */
export function isOnboardingReview(native: boolean, development: boolean, search: string): boolean {
  return !native && development && new URLSearchParams(search).has("onboarding");
}

/** Whether first-run setup is showing: the Mac app (or the development
 * `?onboarding` review) before setup is done. The app decides what to show
 * with it, and ambient audio holds back to setup's previews with it. */
export function setupShows(
  native: boolean,
  development: boolean,
  search: string,
  onboarded: boolean,
): boolean {
  return (native || isOnboardingReview(native, development, search)) && !onboarded;
}
