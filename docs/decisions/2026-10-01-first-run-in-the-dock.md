# A new install lives in the Dock

**Date:** 2026-10-01 · **Status:** accepted

## Context

Rotli began as a "visitor": menu bar only, never in the Dock or ⌘Tab, hiding
when you click away. Setup asked how the window should live. Testers of the
2026-10-01 build lost the app mid-setup ("I lost the app!!! … I finally found
it in the dock"), asked for "Stay with me" as the default ("don't use the dock
first — offer it as an option"), and found setup "a lot of work before using
the app". The owner cut setup to four screens and chose the default.

## Decision

- A true first run (never onboarded, no recorded onboarding version) starts
  with **Stay with me**: in the Dock and ⌘Tab, staying open like any app
  (`FIRST_RUN_WINDOW`, `firstRunWindow` in `src/state/onboarding.ts`).
- It is in the Dock from setup's first screen, and that is saved at once, so
  a quit mid-setup relaunches in the Dock too. Settings → Reset & re-onboard
  returns to the same default.
- An existing install keeps its own choice; nothing is migrated.
- The menu-bar visitor stays a choice in Settings → General. Rust still
  starts as a menu-bar app; the saved setting decides the Dock at boot.

## Consequences

Rotli is findable like any app from the first minute. A person who wants the
quiet visitor turns it on once in Settings.
