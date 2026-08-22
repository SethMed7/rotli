# Bun 1.4 architecture audit — 2026-08-21

Rotli is pinned to the immutable Bun 1.4.0 stable release. This audit records
the promotion from 1.3.14 and the changes that are useful without weakening
Rotli's Tauri, local-first, or durable-scheduler boundaries.

## Adopted from Bun 1.3

- `test:unit` uses `bun test --parallel --isolate src`. Bun 1.3.13 gives every
  test file a fresh global and distributes files across worker processes. The
  complete unit suite passed with 1,395 tests across 159 files before this
  became the default.
- `test:changed` uses Bun's import-graph-aware `--changed` filter for fast local
  verification. It is an iteration command, not a replacement for the full
  regression and release gates.

## Adopted from Bun 1.4

- **Text lockfile v2:** all three independent install roots declare version 2.
  Bun therefore validates external tarball integrity and rejects unsafe paths
  in Git dependencies while parsing the reviewed lockfiles. `check:structure`
  prevents any root from drifting back to version 1.
- **Script-free isolated installs:** every root sets `ignoreScripts = true` and
  `linker = "isolated"`. Fresh app, site, and production Breve installs passed
  without lifecycle hooks; the app and site production builds and the full
  repository check also passed. A tooling smoke loads Transformers and Kokoro
  through their public packages and performs a real Sharp encode/decode so
  native or generated dependencies cannot silently become unusable.
- **Parallel validation:** the independent read-only tasks in `bun run lint`
  now use Bun's parallel script runner. The measured local pass fell from 9.04
  seconds to 6.44 seconds while retaining every named check. `lint:serial`
  preserves the identical one-at-a-time path for constrained machines and
  easier failure-log diagnosis.
- **Dependency evidence:** Linux CI blocks on `bun dedupe --check` across all
  lockfiles, rejects exact drift in the reviewed Unknown-license baseline, and
  retains Bun's combined production-license inventory for 30 days. License
  metadata is review evidence, not a substitute for the still required
  Rust/assets/package SBOM.
- **Native Vite 8 controls:** production configuration now uses
  `build.rolldownOptions` directly instead of the deprecated Rollup
  compatibility alias. Two ineffective dynamic imports were made honestly
  static; every future Rolldown/Oxc warning fails the build except the one
  exact JSXGraph eval warning whose unreachable compiler path has a separate
  mechanical guard.
- **Config-owned Oxc behavior:** Oxlint's type-aware and zero-warning policies
  live in `.oxlintrc.json`, Oxfmt always receives its committed config, and
  executable tooling tests prove both the tsgolint sidecar and import sorting.

## Keep under evaluation

- **Bun.Image:** Bun 1.4 can replace Sharp for ordinary resize/encode pipelines,
  but Rotli's character masks and provider checks inspect and rewrite raw RGBA
  pixels. The current API does not remove that need, so carrying two image
  paths would add complexity without removing the native dependency. Revisit if
  Bun.Image exposes the required raw-pixel pipeline.
- **Bun.WebView:** useful for an additional lightweight WebKit smoke lane on
  macOS. It does not prove Tauri titlebar, filesystem, Keychain, updater,
  scheduler, or native drag behavior and therefore cannot replace Playwright or
  human native review.
- **Shared global install store:** a warm install was materially faster, but a
  full check against the shared store lost TypeScript 7 library and peer type
  resolution through its symlink layout. Keep `globalStore = false`; ordinary
  isolated installs already improved clean-install time without that failure.
  This disables the shared isolated package store, not Bun's package-download
  cache, so repeated downloads still benefit without accepting the broken
  resolution topology.

## Do not adopt for Rotli's runtime boundary

- **Bun.cron:** Bun supports local-time in-process callbacks and persistent
  operating-system jobs. The persistent form would install scheduler state
  outside Rotli and recreate the legacy ownership Breve replaced; the
  in-process form does not provide Rotli's durable missed-run and cross-process
  delivery policy. Breve remains local-time, durable, singleton-locked,
  catch-up aware, and supervised by the Tauri app with explicit parent-death
  and process-group handling.
- **Bun bundler metafiles:** `--metafile-md` is useful for Bun.build graphs, but
  Rotli's production UI is a Vite/Tauri build. A second production bundler would
  create competing resolution and CSS behavior. Use Vite/Rolldown evidence unless
  the production build itself is deliberately migrated.

## Architecture takeaway

Bun's move from Zig to Rust reinforces Rotli's existing split: Rust owns native,
security-sensitive effects while TypeScript owns product policy and presentation
behind narrow ports. The relevant lesson is not a rewrite; it is to keep
language-independent behavior tests, make ownership explicit, and use isolated
review for large boundary changes.

## Bun 1.4 promotion — 2026-08-21

Bun 1.4.0 became stable on August 20, 2026. Rotli promotes that exact release
across `.bun-version`, the app, site, and Breve manifests, Bun's type
definitions, CI, release evidence, and Cloudflare's site-build configuration.
The earlier macOS arm64 preview reported `1.4.0-canary.1+4c689909e`; it was
evaluation evidence only and never became a repository pin.

`bun-types@1.4.0` was published with the runtime and was still inside Rotli's
three-day release-age window during this promotion. The reviewed lockfile
refresh admitted that one dev-only toolchain companion with a one-time resolver
override. Subsequent installs stay frozen against the reviewed lock and obey
the repository's script-free isolated-install policy.

Rotli adopted the stable pieces immediately: all three independent install
roots now enforce a three-day minimum release age, lockfile v2, script-free
isolated installs, and a project-local package store. The Tauri development
supervisor runs under `--no-orphans`, and one repository-owned audit command
covers all three lockfiles. `check:structure` mechanically holds the pins,
install policy, lockfile versions, parallel lint fan-out, supervisor flag, and
CI evidence wiring.

The 1.4 operations remain guarded by the minimum-version check in the
repository-owned `bun run deps` adapter and are now available on the default
toolchain. Combined audit repair plans, dedupe checks, prune previews, license
inventories, and root-explicit package diffs are read-only. Their mutating
counterparts require one explicit root and `--apply`, and audit repair never
crosses declared dependency ranges. The preview probe
found seven compatible package-version repairs covering fourteen root findings,
five dedupe candidates, and five stale installed packages. The result also
proved why mutation stays separate: dedupe proposed moving `internmap` from
2.0.3 to the already locked 1.0.1, while the audit plan left exact transitive
pins in Excalidraw, Univer, ExcelJS, Transformers, and Chevrotain blocked for
review.

The reviewed maintenance pass then applied compatible repair and convergence to
all three roots. It removed 21 reported findings, every dedupe candidate, and
188 stale installed packages; the post-pass plans report no compatible repair,
dedupe, or prune work remaining. Residual advisories remain documented rather
than forcing cross-range upgrades.

The promotion keeps the existing Vite/Tauri production build and adopts Bun's
isolated linker without its incompatible shared global store. Frozen installs
for every root and the full JavaScript/Rust/build proof chain remain mandatory
handoff evidence; a preview binary never counts as release evidence.

## Promotion evidence

The official macOS arm64 Bun 1.4.0 binary (`34cbb9a40`) accepted frozen app,
site, and production Breve installs. The static and regression gates, 423 Rust
tests, root production build, Astro diagnostics and production build, and
dedupe checks over all three lockfiles passed. Bun reported one resolved version
per package across the app (845), site (397), and Breve (106) graphs.

Sources: [Bun 1.4](https://bun.com/blog/bun-v1.4),
[Bun 1.3.14](https://bun.com/blog/bun-v1.3.14),
[Bun 1.3.13](https://bun.com/blog/bun-v1.3.13),
[Bun 1.3.12](https://bun.com/blog/bun-v1.3.12),
[Bun 1.3.8](https://bun.com/blog/bun-v1.3.8), and
[Bun's Rust rewrite](https://bun.com/blog/bun-in-rust). Package-manager
sources: [`bun audit`](https://bun.com/docs/pm/cli/audit),
[`bun pm diff` and licenses](https://bun.com/docs/pm/cli/pm),
[`bun dedupe`](https://bun.com/docs/pm/cli/dedupe), and
[`bun prune`](https://bun.com/docs/pm/cli/prune), plus
[`Bun.cron`](https://bun.com/docs/runtime/cron).
