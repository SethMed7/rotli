---
name: verify
description: Run Rotli's canonical proof chain — the same phases every agent (Claude, Codex, Cursor, Antigravity) runs before handoff. Use before declaring any change complete.
---

# Verify a change

Run the phases in order. `docs/development/testing.md` owns the full command
map and evidence levels; never invent alternative commands.

1. **Focused loop** while iterating: `bun test <file>` plus the relevant
   `check:*` script.
2. **Static gate**: `bun run lint` — typecheck (both implementations), format,
   structure, docs, naming, knip, oxlint.
3. **Behavior**: `bun run test:regression` — unit, evals, Breve, design system.
4. **Rust**: `cargo test --manifest-path src-tauri/Cargo.toml`.
5. **Build proof**: `NODE_OPTIONS=--max-old-space-size=4096 bun run build`.

`bun run check` runs phases 2–3 together. Report exact results in the handoff;
a passing typecheck alone is never completion proof (AGENTS.md owns that law).
