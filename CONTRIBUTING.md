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

Filenames follow one convention per tree, enforced by `check:structure`:
camelCase under `src/`; kebab-case under `scripts/`, `e2e/`, `docs/`, and
`breve-runtime/`. Product CSS uses semantic tokens from `src/brand/`; raw
colors (hex or `rgb()`/`hsl()`) outside the token-definition layer fail CI.
Markdown is the only surface with slash commands and embed syntax.

Where a new surface, feature, vendor dependency, utility, Tauri command,
TS↔Rust shared constant, or CARL domain belongs — and which mechanical check
enforces each rule, including the dependency-conflict procedure — is defined in
[`docs/development/adding-things.md`](docs/development/adding-things.md).

## Formatting and linting

Prettier at `printWidth` 110 is the adopted TypeScript formatter. The one-time
repository-wide reformat commit is pending diff review; until it lands, match
the surrounding style — wide lines are house style (~110-column soft limit) —
and never mix format-only churn into behavioral commits. When the reformat
lands, its SHA joins `.git-blame-ignore-revs` and `format:check` joins the
`lint` chain; run `git config blame.ignoreRevsFile .git-blame-ignore-revs`
once locally (GitHub honors the file automatically; local git does not).

rustfmt is deliberately and permanently not used. Re-measured 2026-07-17
(rustfmt 1.9.0): a full reformat rewrites thousands of diff lines at any width
configuration (~3,200–4,900 across `max_width` 90–110) — the churn is
structural rewrapping, not line width — while only ~300 of ~18,500 Rust lines
exceed 100 columns. `cargo clippy --all-targets -- -D warnings` is the Rust
gate; do not run `cargo fmt` or commit its output.

ESLint rules live in `eslint.config.mjs` and are deliberately minimal
(floating/misused promises, `no-explicit-any`, react-hooks, identifier casing
via `naming-convention` — adopted 2026-07-18 at a measured 0 real violations —
and a ban on bun:test's `it` alias: the suite spells every test `test(...)`).
Propose additions
in a PR; the config must not grow silently. TypeScript stays pinned `~5.8.3`
because typescript-eslint 8.x crashes on TS 7. Biome remains the preferred
long-term two-package footprint: re-benchmark when `noFloatingPromises` leaves
its nursery (at adoption time it missed 3 of 8 real floating-promise sites).
`breve-runtime/scripts/` is measured but deferred at 76 findings (71
`no-explicit-any`, 4 `no-floating-promises`, 1 `no-misused-promises`;
re-measured 2026-07-17) — over the 15-site adoption threshold; revisit once
the `any` debt shrinks. This repository has no git
hooks: enforcement is the `lint` chain locally plus CI. If a pre-commit hook
is ever added, measure eslint `projectService` per-commit latency first.

## Required validation

Use these focused gates while iterating:

```sh
bun run lint             # types, code shape, architecture, IPC, structure, docs
bun run test:unit        # src/ behavior
bun run test:breve       # Breve policy and concurrency regressions
bun run test:tooling     # linter/checker fixtures
bun run test:regression  # complete Bun/runtime/design regression suite
```

The command ownership, evidence levels, and CI lanes are defined in
[`docs/development/testing.md`](docs/development/testing.md).

Before handoff, run:

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
memex content, or production configuration. Generated, dependency,
machine-local, and secret material is never tracked; a new tool that writes a
cache or metadata ships its `.gitignore` entries in the same change (policy:
[`docs/development/adding-things.md`](docs/development/adding-things.md)). Release tooling mutates external
state and must only be used as part of an explicitly authorized release.
