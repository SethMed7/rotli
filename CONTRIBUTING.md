# Contributing to Rotli

Rotli is a local-first Tauri application. Contributions must preserve user file
ownership, security boundaries, native macOS behavior, and the four application
environments. AI-assisted contributors must also follow `AGENTS.md`.

## Prerequisites

- macOS on Apple Silicon for the complete desktop workflow
- Bun at the exact version in [`.bun-version`](.bun-version) (`packageManager`
  mirrors it in both JavaScript manifests)
- Rustup; entering the checkout installs the exact channel and clippy component
  from [`rust-toolchain.toml`](rust-toolchain.toml)
- The Tauri v2 macOS prerequisites

Install JavaScript dependencies once:

```sh
bun install --frozen-lockfile
```

Rotli's three `bunfig.toml` files also make a plain `bun install` frozen, so a
wrong runtime cannot silently replace the reviewed dependency graph. If Bun
reports `Unknown lockfile version`, stop and compare `bun --version` with
`.bun-version`. For the official-script installation, install Rotli's exact pin
and retry:

```sh
curl -fsSL https://bun.com/install | bash -s "bun-v$(cat .bun-version)"
bun --version
bun install --frozen-lockfile
```

Use the package manager that installed Bun instead when applicable; do not
accept or commit a downgraded lockfile.

## Development surfaces

```sh
bun run dev        # browser-only frontend with demo/in-memory behavior
bun run dev:app    # supervised native rotli (dev); choose a disposable vault
```

Browser mode cannot validate the native titlebar, menu-bar lifecycle,
filesystem permissions, Keychain, updater, launch agents, or the managed Breve
scheduler. Native development may display the production-selected vault as a
read-only boot fallback, but its explicit choice lives in the isolated
`corpus.dev.json`. Choose a disposable folder unless real development writes to
that exact folder have been reviewed and authorized.

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
~50ms on the same tree). Use `bun run format` for the formatter-owned trees;
the package scripts and staged hook pass the root config explicitly so nested
or ambient configuration cannot change the result. Oxlint likewise owns
type-aware tsgolint and its zero-warning ceiling in `.oxlintrc.json`; the
tooling regression suite exercises the actual Oxc binaries. Use
`bun run lint:serial` when memory pressure or interleaved parallel logs impede
diagnosis; it runs the same checks as `lint`. Keep unrelated format churn out
of behavioral commits. Run
`git config blame.ignoreRevsFile .git-blame-ignore-revs` once locally so
historical format-only changes stay out of blame (GitHub honors it automatically).

rustfmt is deliberately and permanently not used. Re-measured 2026-07-17
(rustfmt 1.9.0): a full reformat rewrites thousands of diff lines at any width
configuration (~3,200–4,900 across `max_width` 90–110) — the churn is
structural rewrapping, not line width — while only ~300 of ~18,500 Rust lines
exceed 100 columns. `cargo clippy --all-targets -- -D warnings` is the Rust
gate; do not run `cargo fmt` or commit its output.

Type correctness and linting are separate layers: `bun run typecheck`
(`tsc --noEmit` over `src` plus the strict Vite/build-policy scope),
`check:e2e-types`, and `check:breve-runtime`, followed by the oxlint layer
below. The first two and the independent TypeScript 6 cross-check are in
`lint`; the Breve TypeScript 7 pass is in `test:regression`, so `bun run check`
holds all four scopes on both implementations.
`tsc` is `typescript@7`, the Go port, which since 7.0.0 IS stock TypeScript
rather than a preview alongside it. The `@typescript/native-preview` (`tsgo`)
package was retired 2026-08-01 when `typescript@7.0.2` shipped the same engine
under the name everything already resolves: measured on this repo, `tsgo`
0.33s vs `typescript@7` 0.35s over `src` — the same number twice — against
3.5s for the JavaScript implementation. Both accept `-p` and `--noEmit`
identically and both were verified clean on all three tsconfigs before the
swap.

**Two TypeScripts, on purpose.** `devDependencies` carries `typescript`
(`~7.0.2`) AND `typescript6` (`npm:typescript@~6.0.3`), and the second one is
not legacy debt — it is load-bearing in three places:

- **The second opinion.** `bun run typecheck:tsc6` runs the same four scopes
  (`src`, Vite/build policy, E2E, and Breve) on the last JavaScript TypeScript. A cross-check
  is only worth its runtime if it is an INDEPENDENT implementation; now that
  `tsc` is the Go port, 6.x is the only thing left that qualifies. All lanes
  must stay green. When the two disagree, fix the code unless the divergence is
  demonstrably a compiler bug, and record it here.
- **`check:naming`** imports the syntactic AST API from `typescript6`.
  `typescript@7`'s `exports["."]` resolves to `lib/version.cjs`, so a default
  import yields `{version, versionMajorMinor}` and no `createSourceFile` at
  all; the AST moved to an explicitly `unstable/` subpath. Importing the alias
  keeps the guard on a stable API instead of chasing an unstable one.
- **Editors.** `typescript@7` ships no `tsserver`, so VS Code's stock "Use
  Workspace Version" target (`node_modules/typescript/lib`) cannot serve an
  editor at all. `.vscode/settings.json` therefore points `typescript.tsdk` at
  `node_modules/typescript6/lib`, which does ship `tsserver.js` (verified
  responding at 6.0.3). Editors get 6.x language service; the gate runs 7.
  That split is expected on the 7 line, not a misconfiguration — if you want
  7-native editor feedback, that is the `@typescript/native-preview` VS Code
  extension's job, not the workspace TS version's.

Note both packages install a `tsc` bin and `typescript` wins
`node_modules/.bin/tsc`, which is why the 6 lanes call
`node_modules/typescript6/bin/tsc` by explicit path rather than relying on
`PATH` order.
Dead weight is mechanical, not a review chore: `check:knip` (`knip.json`) fails
the `lint` chain on an unreferenced file, export, or dependency and on an import
or binary that was never declared. It runs with `ignoreExportsUsedInFile`, so
"exported but only read inside its own module" is a style call left to review,
while "referenced nowhere at all" is a gate.
Lint rules live in `.oxlintrc.json` (oxlint; migrated from ESLint 2026-07-31 —
measured on this repo at 7.0s ESLint vs ~0.5s oxlint `--type-aware`). The
hand-picked layer stays deliberately minimal (floating/misused promises,
`no-explicit-any`, react-hooks, and a ban on bun:test's `it` alias: the suite
spells every test `test(...)`), and as of 2026-08-01 it sits on top of oxlint's
whole `correctness` category — measured before adoption, as this config
demands. `scripts/` joined the same gate 2026-08-13 after its complete six-item
debt was paid; the Vite build policy moved from untyped MJS into the strict
node config at the same time. The original correctness measurement found 80 findings across 9 rules; 62 were fixed, 13
are permitted by a rule option (`no-misused-spread` with `allow: ["string"]`,
because `[...text]` code-point iteration is a documented contract here), and
one rule is deferred: `await-thenable`, 18 findings, every one the
`await expect(...).rejects/.resolves` idiom. oxlint is literally right there —
bun's matcher enforces eagerly and returns a non-thenable — but the `await` is
the portable jest/vitest spelling and is what keeps those assertions enforcing
if bun ever aligns with jest, so stripping it from 18 security assertions to
satisfy a linter was the wrong trade. Every other correctness rule is at zero
and now guards for free.
React Compiler stays out of the production transform, but its Rules-of-React
analysis runs in lint-only mode through `check:react-compiler`. The first
measurement found 63 diagnostics; the six render-purity findings and one
render-time mutation were fixed immediately. The remaining 56 are recorded by
file and category in `scripts/react-compiler-baseline.json`. That baseline is a
ratchet, not an exemption list: a file/category count may fall, but any increase
fails `lint`. This lets effect/ref debt retire incrementally without hiding it
under inline suppressions or changing runtime code generation.
The type-aware rules run through the `oxlint-tsgolint` sidecar,
which is preview-quality: it misreads comma-expression arrow bodies as
misused promises (three suppressed sites in `src/state/persist.test.ts` —
re-measure on oxlint upgrades and drop the suppressions when fixed; still
reproducing 2026-08-01 on oxlint 1.76.0 + oxlint-tsgolint 7.0.2001, both
latest, so the three stay).
Identifier casing (typescript-eslint's `naming-convention`, adopted
2026-07-18 at a measured 0 real violations) has no oxlint equivalent and is
held by `scripts/check-naming.mjs` (`check:naming`). Propose additions in a
PR; the config must not grow silently.
TypeScript went `~5.8.3` → `~6.0.3` → `~7.0.2` across two PRs on 2026-08-01,
and neither step required a single code change: all three project scopes, the
full `lint` chain, 1010 unit / 28 tooling / 34 Breve tests, the build and all
61 e2e specs passed unedited on both. The `~5.8.3` pin had been justified by
typescript-eslint 8.x crashing on TS 7, but tsgolint removed that carrier, so
by the end only conservatism held it.
What the 7 step actually cost was not compile errors but the assumption that
`typescript` is one package with one job. It is now two — see "Two TypeScripts,
on purpose" above — because on the 7 line the compiler, the language service,
and the programmatic AST stopped shipping together. `~7.0.2` is the gate and
what editors and generic resolution see; `typescript6` supplies the
independent cross-check, the `check:naming` AST, and the editor's tsserver.
Keep both pins `~` (patch-only) and re-measure the three roles above before
either moves.
The old "Biome as the long-term two-package footprint" plan is superseded by
this migration.
`breve-runtime/` is IN the lint scope as of 2026-08-01 — its long-standing
deferral (76 findings, last re-measured 2026-07-17) is retired because the debt
was paid, not waived. The 71 `any`s became real types: the shapes Breve reads
off wires it does not own (signal-cli envelopes, the local model's generate
response, the file-backed watcher/creator/pending rows, and `mail.ts`'s own
stdout contract) now live in `breve-runtime/scripts/wire-types.ts`, and
`errText` gives caught values one honest rendering instead of `[object Object]`
in `failures.log`. Typing them is what exposed the two real bugs the `any` had
been hiding: `mail.ts read <uid>` built its output row from imapflow's `false`
return for a uid the mailbox does not hold, and the Signal dispatcher indexed
`voiceAtt.id` on a branch the compiler could not prove was reachable. Because
`breve-runtime/` keeps hand-aligned column tables, it stays OUTSIDE oxfmt —
lint fixes there must not reformat whole files. Git hooks are deliberately MINIMAL: the tracked
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

Two failures that looked like successes, both worth knowing because neither
announced itself:

- **A lapsed review bot reads as a passing review.** Greptile and Cursor Bugbot
  post an ordinary comment when credits or entitlement run out, and
  `gh pr view --json reviews` shows it exactly like any other review. Read the
  body before trusting a green PR. When no automated reviewer is running, say so
  in the PR rather than letting the absence pass silently.
- **A pipeline reports its last stage, not its failure.** `release.sh --publish |
  tail` returned 0 for a release Apple had rejected, because `tail` succeeded.
  `set -e` inside the script had correctly aborted before publishing; the exit
  code just never reached the caller. Redirect long-running scripts to a log and
  check `$?`. The same trap applies to `git commit | tail && git push`.

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
