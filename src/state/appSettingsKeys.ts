// The app-settings keys this build recognises. Anything else in the file is
// carried through untouched (a newer build's knob survives an older one), so
// this list is the one place a key becomes "ours". A seam beside persist.ts,
// which sits at its size ceiling.

export const APP_SETTINGS_KEYS = new Set([
  "v",
  "theme",
  "themeFamily",
  // Retired independent System pair. System now follows the OS within the one
  // selected theme family.
  "matchLightFamily",
  "matchDarkFamily",
  "syntaxPalette",
  "accentColor",
  "accentHue",
  "quokkaCompanionEnabled",
  "quokkaStyle",
  "quokkaCustomHue",
  "quokkaLineColor",
  // Retired native color-well key: recognized so it migrates once and is not
  // preserved forever as an unknown setting.
  "quokkaCustomColor",
  "quokkaAccessory",
  "quokkaAccessoryHue",
  "quokkaIdlePose",
  "chatNavigatorStyle",
  "sidebarSide",
  "sidebarReveal",
  "stayOpen",
  "showInDock",
  "tabLayout",
  "privateBrowserSearchEngine",
  "remoteAgentRelayUrl",
  "paneVaultMode",
  "userName",
  "timeFormat",
  "chatWelcomeStyle",
  "chatNaming",
  "hotkeyPeek",
  "appIcon",
  "onboarded",
  "onboardingVersion",
  "onboardingPhase",
  "bindings",
]);
