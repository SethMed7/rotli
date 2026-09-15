---
name: validate-in-the-native-app
description: Test Rotli behavior in the real macOS app without touching the owner's installed app or vault — an isolated development build, a synthetic vault, a registry backup, and computer-use evidence. Use when browser tests cannot prove a behavior (menu-bar chords, native windows, Keychain, scheduler, the Librarian).
---

# Validate in the native app

Browser mode proves no native titlebar, menu, filesystem, Keychain, updater, or
scheduler behavior (AGENTS.md). When a claim depends on those, test the real app
safely.

1. **Build the isolated development app.** It reads `*.dev.json` registries, so
   it never shares state with the installed app:

   ```sh
   ROTLI_BUILD_CHANNEL=stable bun run tauri build --debug --config src-tauri/tauri.dev.conf.json --bundles app
   ```

   The result is `Rotli (Dev).app` under src-tauri/target/debug/bundle/macos/.
2. **Back up the development registry** (`~/Library/Application Support/com.rotli.app/*.dev.json`)
   into ignored `_review/`, and restore it when you finish.
3. **Use a synthetic vault only**, such as a new folder on the Desktop. Never open
   the owner's real vault, and never launch, select, or quit the installed
   `/Applications/rotli.app`.
4. **Drive it with computer use** and record evidence on disk: screenshots,
   the note's frontmatter and body hash, `.rotli/brain-journal.jsonl`, and
   `.rotli/organizer.json`, all under `_review/`. Deny any permission dialog.
5. **Know the traps.**
   - The macOS Edit menu takes ⌘A, ⌘Z, and ⇧⌘Z before the web view sees a keydown.
   - The Librarian's Run now still waits out each note's quiet window.
   - Still screenshots cannot prove the absence of a one-frame flicker.
6. **Report honestly:** PASS, FAIL, or UNCLEAR per check, with evidence paths.
   Quit only the development app, then restore the registry.
