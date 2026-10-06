// The app-settings keys this build recognises. Anything else in the file is
// carried through untouched (a newer build's knob survives an older one), so
// this list is the one place a key becomes "ours". A seam beside persist.ts,
// which sits at its size ceiling.

export const APP_SETTINGS_KEYS = new Set([
  // pinned sites (2026-10-01): name, https address, slot, and store id
  "pinnedSites",
  // the sidebar's scenery and icons (2026-10-01)
  "sidebarLook",
  // what the titlebar sun cycles, and the editor's image outline (state/appearanceLook.ts)
  "themeCycle",
  "themeCyclePicks",
  "outlineImages",
  "v",
  "theme",
  "themeFamily",
  // Retired independent System pair. System now follows the OS within the one
  // selected theme family.
  "matchLightFamily",
  "matchDarkFamily",
  "syntaxPalette",
  "boardBackground",
  "accentColor",
  "accentHue",
  "quokkaStyle",
  "quokkaCustomHue",
  "quokkaLineColor",
  // Retired native color-well key: recognized so it migrates once and is not
  // preserved forever as an unknown setting.
  "quokkaCustomColor",
  "quokkaAccessory",
  "quokkaAccessoryHue",
  // Retired 2026-10-02: the companion switch and its idle mood. The chat
  // buddy is always there and picks its own pose; recognized so an old file's
  // values are dropped on the next write, never carried forever.
  "quokkaCompanionEnabled",
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
  "taskArchiveAge",
  "chatWelcomeStyle",
  "chatNaming",
  "hotkeyPeek",
  "appIcon",
  "onboarded",
  "onboardingVersion",
  "lastSeenVersion",
  "onboardingPhase",
  "bindings",
  // Ambient audio (src/lib/ambient.ts): on or off, the track, playing or not.
  "ambient",
  // What the person hid from the chrome (src/lib/hideable.ts).
  "hidden",
  // Which sidebar fronts are on and where Rotli opens (src/lib/sidebarFronts.ts).
  "sidebarFronts",
  // The sidebar shows the vault's folders as on disk (services/vaultTree.ts).
  "vaultView",
  // Hand to AI opens in the mode chosen last (state/handToAiMode.ts).
  "handToAiMode",
]);
