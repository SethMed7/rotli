---
name: write-an-e2e
description: Write, fix, or diagnose a Playwright spec for Rotli — the Mac-twin lane and the Rotli Web lane, what each can and cannot prove, and how to tell a flake from a bug. Use when adding a regression spec, when a spec fails only under the full suite, or when a user-facing change needs its web proof.
---

# Write an e2e

`docs/development/testing.md` owns the command map; this is the working craft.

## Two lanes

- **The browser twin** (`e2e/*.spec.ts`, `bun run test:e2e`): the app on
  the Vite dev server with the in-memory demo vault. Set `ROTLI_E2E_PORT` in
  a second checkout so two runs never share a server.
- **Rotli Web** (`e2e/web/*.spec.ts`, `bun run test:e2e:web`): the real
  web build under `/app/` on port 1435, with a vault in the browser's private
  folder (`startWithVault`, `startWithFolder` in the web support file).
  Playwright reuses any server already on 1435: never run two web lanes at
  once, and check the port if results look like someone else's build.
- Every user-facing change adds or extends a web test (ROADMAP §6).

## Rules

- Click real controls: open commands through the palette or a menu, never a
  ⌘-chord (Linux CI has no Meta key).
- Neither lane has native windows, Keychain, the private Browser, real OS
  drops, the Librarian's filer lane, or the Secure lane: prove those with
  unit or Rust tests plus a native checklist
  (the validate-in-the-native-app skill).
- Wait on the durable result, not a timer: poll the saved file
  (`readOpfsFile`), a count, or an attribute. `waitForTimeout` is for
  exploratory scripts only.
- A spec that seeds state goes through the app's own services, as
  `e2e/document-naming.spec.ts` seeds a board.

## A failure that only happens in the full suite

1. Run the spec alone, then under load:
   `--repeat-each=20 --workers=10`.
2. Record what you suspect before the reload or click (a test annotation), so
   the stress run tells a write race from a slow step.
3. Fix the cause: wait for the saved artifact, or give a genuinely slow
   step (a reload that reconnects a vault) a longer, commented timeout.
4. Say it was a flake in the PR, with the numbers. CI retries once; a green
   retry is not a fix.

## Unit tests beside it

- The canonical runner is `bun run test:unit` (`--isolate`): a plain
  `bun test src` shares modules between files and shows false failures.
- `mock.module` is process-wide: spread a SNAPSHOT of the real module
  (`{ ...live }`) and restore it in `afterAll`
  (`src/services/chatAutoTitle.test.ts` is the pattern).
- `@codemirror/view` cannot load under `bun test` (it needs a DOM): editor
  decorations are proven in Playwright.
