# Contributing to Rotli

Rotli is a local-first Tauri application. Contributions must preserve user file
ownership, security boundaries, native macOS behavior, and the four application
environments. AI-assisted contributors must also follow `AGENTS.md`.

## Prerequisites

- macOS on Apple Silicon for the complete desktop workflow
- Bun 1.3.3 or the version pinned by CI
- A current stable Rust toolchain
- The Tauri v2 macOS prerequisites

Install JavaScript dependencies once:

```sh
bun install --frozen-lockfile
```

## Development surfaces

```sh
bun run dev        # browser-only frontend with demo/in-memory behavior
bun run tauri dev  # native application; manage this process yourself
```

Browser mode cannot validate the native titlebar, menu-bar lifecycle,
filesystem permissions, Keychain, updater, launch agents, or the managed Breve
scheduler. Never point development work at production data unless that exact
operation has been reviewed and authorized.

## Repository map

- `src/`: React presentation plus capability modules and frontend adapters
- `src-tauri/src/`: Rust host, filesystem, security, provider, and runtime edges
- `breve-runtime/`: the versioned runtime Rotli installs and supervises
- `src/brand/`: canonical embedded colors, typography, icons, and logo assets
- `scripts/`: deterministic checks, build support, release tooling, and audits
- `docs/architecture/`: current architectural contracts and audit reports
- `docs/archive/`: historical material, not implementation authority

Start at `docs/README.md` for the complete source-of-truth map.

Project CARL provides bounded architecture recall to Claude and Codex through
the tracked MCP configurations. It is optional for human development and never
replaces the current contracts. See
`docs/architecture/ai-context-architecture.md` before changing its domains.
Claude asks for one-time approval of the shared project server; Codex loads it
only after the repository is trusted.

## Making a change

1. Inspect the current implementation and its tests.
2. Preserve unrelated dirty-worktree changes.
3. Keep dependency direction and data ownership consistent with
   `docs/architecture/clean-architecture.md`.
4. Put vendor integrations behind a narrow adapter.
5. Add focused tests for changed behavior and failure states.
6. Update the document that owns the changed contract.
7. Add a changelog entry when users will notice the change.

Source filenames use camelCase. Product CSS uses semantic tokens from
`src/brand/`; raw colors outside the brand definition layer fail CI. Markdown is
the only surface with slash commands and embed syntax.

## Required validation

```sh
bun run check
cargo test --manifest-path src-tauri/Cargo.toml
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

Run focused tests while iterating. UI changes require human review in the actual
desktop app across Warm Light, Warm Dark, Paper, and Charcoal, plus keyboard,
empty, loading, error, disabled, and narrow-window states.

For file capabilities, verify the workspace invariant in
`docs/architecture/memex-data-contract.md`: images and video are the only
preview-only surfaces. Other formats need edit/save behavior or an explicit
local conversion workflow before the UI describes them as supported.

## Commits and releases

Keep commits scoped and explain behavior, not implementation trivia. Never
include local `.rotli/` state, credentials, generated Carl sessions, personal
memex content, or production configuration. Release tooling mutates external
state and must only be used as part of an explicitly authorized release.
