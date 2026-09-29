// The thank-you card after onboarding (2026-09-28): open or not. Session
// state only; the card itself is components/onboarding/thanksDialog.tsx.

import { createOpenFlagStore } from "./openFlag";

export const useOnboardingThanks = createOpenFlagStore();
