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
- `docs/security/`: threat boundaries, assets, abuse cases, and residual risk
- `docs/operations/`: release, supply-chain, support, and diagnostic contracts
- `docs/decisions/`: cross-boundary architecture decision records
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
   [`ARCHITECTURE.md`](ARCHITECTURE.md).
4. Put vendor integrations behind a narrow adapter.
5. Add focused tests for changed behavior, failure states, and boundaries; add
   a deterministic eval for model behavior and E2E coverage for cross-surface
   interactions when applicable.
6. Update the document that owns the changed contract.
7. Add a changelog entry when users will notice the change.

Changes to a persistent format, CLI/MCP response, runtime protocol, or migration
must also follow
[`docs/architecture/compatibility-and-migrations.md`](docs/architecture/compatibility-and-migrations.md).
Cross-boundary decisions that are expensive to reverse use the lightweight ADR
process in [`docs/decisions/README.md`](docs/decisions/README.md).

[`SYNTAX.md`](SYNTAX.md) defines file, folder, identifier, Rust, IPC, CSS, and
test naming. [`DESIGN.md`](DESIGN.md) defines the product interaction contract.
`check:structure`, oxlint, oxfmt, and the design-system checks enforce their
mechanical rules. Markdown is the only surface with slash commands and embed
syntax.

Where a new surface, feature, vendor dependency, utility, Tauri command,
TS↔Rust shared constant, or CARL domain belongs — and which mechanical check
enforces each rule, including the dependency-conflict procedure — is defined in
[`docs/development/adding-things.md`](docs/development/adding-things.md).

## Formatting and linting

oxfmt at `printWidth` 110 (`.oxfmtrc.json`) is the adopted TypeScript
formatter and `format:check` is part of `lint`. It replaced Prettier
2026-07-31 with a measured 6-file / 19-line drift over 342 files (oxfmt
breaks long union types one-member-per-line; Prettier at 1.9s vs oxfmt at
~50ms on the same tree). Use `bun run format` for the formatter-owned trees,
and keep unrelated format churn out of behavioral commits. Run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once locally so
historical format-only changes stay out of blame (GitHub honors it automatically).

rustfmt is deliberately and permanently not used. Re-measured 2026-07-17
(rustfmt 1.9.0): a full reformat rewrites thousands of diff lines at any width
configuration (~3,200–4,900 across `max_width` 90–110) — the churn is
structural rewrapping, not line width — while only ~300 of ~18,500 Rust lines
exceed 100 columns. `cargo clippy --all-targets -- -D warnings` is the Rust
gate; do not run `cargo fmt` or commit its output.

Type correctness and linting are separate layers: `bun run typecheck`
(`tsgo --noEmit`, the compiler as source of truth — first step of `lint`, with
`check:e2e-types` and `check:breve-runtime` as the sibling tsgo lanes for
their trees) and the oxlint layer below. Editors get the same type feedback
live from the TS language server, independent of the lint gate.
`tsgo` is `@typescript/native-preview`, the Go port of `tsc` (measured on this
repo 2026-08-01: 3.5s → 0.8s over `src`). It is a PREVIEW compiler, so stock
`typescript` stays installed and `bun run typecheck:tsc` runs the identical
check on it — both must stay green. When the two disagree, fix the code unless
the divergence is demonstrably a `tsgo` bug, and record it here.
Dead weight is mechanical, not a review chore: `check:knip` (`knip.json`) fails
the `lint` chain on an unreferenced file, export, or dependency and on an import
or binary that was never declared. It runs with `ignoreExportsUsedInFile`, so
"exported but only read inside its own module" is a style call left to review,
while "referenced nowhere at all" is a gate.
Lint rules live in `.oxlintrc.json` (oxlint; migrated from ESLint 2026-07-31 —
measured on this repo at 7.0s ESLint vs ~0.5s oxlint `--type-aware`) and are
deliberately minimal (floating/misused promises, `no-explicit-any`,
react-hooks, and a ban on bun:test's `it` alias: the suite spells every test
`test(...)`). The type-aware rules run through the `oxlint-tsgolint` sidecar,
which is preview-quality: it misreads comma-expression arrow bodies as
misused promises (three suppressed sites in `src/state/persist.test.ts` —
re-measure on oxlint upgrades and drop the suppressions when fixed; still
reproducing 2026-08-01 on oxlint 1.76.0 + oxlint-tsgolint 7.0.2001, both
latest, so the three stay).
Identifier casing (typescript-eslint's `naming-convention`, adopted
2026-07-18 at a measured 0 real violations) has no oxlint equivalent and is
held by `scripts/check-naming.mjs` (`check:naming`). Propose additions in a
PR; the config must not grow silently. TypeScript's `~5.8.3` pin existed
because typescript-eslint 8.x crashes on TS 7; tsgolint removed that blocker,
so the pin is now only conservatism — revalidate the toolchain before bumping.
The old "Biome as the long-term two-package footprint" plan is superseded by
this migration.
`breve-runtime/scripts/` is measured but deferred at 76 findings (71
`no-explicit-any`, 4 `no-floating-promises`, 1 `no-misused-promises`;
re-measured 2026-07-17) — over the 15-site adoption threshold; revisit once
the `any` debt shrinks. Git hooks are deliberately MINIMAL: the tracked
`.githooks/pre-commit` runs only staged-file oxfmt (scoped to the
formatter-owned trees — src/, e2e/, scripts/, playwright.config.ts;
breve-runtime/ keeps hand-aligned tables and stays outside) + a conflict-marker
grep (sub-second — the old "measure lint latency first" concern is why
lint/tsc stay out of it). Enable once per clone with
`git config core.hooksPath .githooks`; full enforcement remains the `lint`
chain locally plus CI, and `git commit --no-verify` stays available for
genuine emergencies.

## Review learnings become guards

When a review (Greptile or otherwise) flags a CLASS of issue — not a one-off
typo — land a mechanical guard for that class in the same PR: a
`scripts/check-*.mjs` assertion, an oxlint restriction, a parity fixture, or a
hook line. Precedents: `check:security`'s tool local-vs-egress classification
(caught the next new tools automatically), the IPC contract check, and this
hook's formatting/conflict guards. A review that only fixes the instance
teaches nothing; the guard is the lesson.

## Required validation

Use these focused gates while iterating:

```sh
bun run lint             # types, code shape, architecture, IPC, structure, docs
bun run test:unit        # src/ behavior
bun run test:evals       # deterministic offline model/retrieval behavior
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
state and must only be used as part of an explicitly authorized release. Release
integrity, provenance, dependency exceptions, key custody, and rollback follow
[`docs/operations/release-and-supply-chain.md`](docs/operations/release-and-supply-chain.md).
