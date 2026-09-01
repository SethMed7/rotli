/** Provider-account safety policy shared by every Breve one-shot script. */
export const CLOUD_PROVIDER_POLICY_MESSAGE =
  "Cloud model execution is unavailable. Breve does not use subscription-authenticated Claude, Codex, Antigravity, or Gemini lanes.";

/** Always throws. A separate function makes the fail-closed boundary easy to test. */
export function refuseCloudProviderExecution(): never {
  throw new Error(CLOUD_PROVIDER_POLICY_MESSAGE);
}
