---
name: verify
description: Run Rotli's canonical proof chain — the same phases every agent (Claude, Codex, Cursor, Antigravity) runs before handoff. Use before declaring any change complete.
---

# Verify a change

`bun run verify` is CI's local twin and the completion gate. `bun run check`
alone is NOT the gate: clippy, Playwright, and every `site/` step live outside
it, which is how a change can pass locally and turn `main` red.
`docs/development/testing.md` owns the full command map and evidence levels;
never invent alternative commands.

1. **Focused loop** while iterating: `bun test <file>` plus the relevant
   `check:*` script, and `bun run verify <lane>` to narrow —
   `secrets` (redacted proposed-diff and commit scan), `quality` (check + production build + `site/`), `e2e` (`check:e2e-types` +
   Playwright), `rust` (`cargo clippy -D warnings` + `cargo test`).
2. **Completion proof**: `bun run verify` — all four lanes, in CI's order. It
   refuses to skip a lane it cannot run rather than reporting a false green.

Report exact results in the handoff, including any lane you could not run and
what remains unproven in browser mode (native windows, Keychain, scheduler,
real drops). A passing typecheck alone is never completion proof (AGENTS.md
owns that law).
