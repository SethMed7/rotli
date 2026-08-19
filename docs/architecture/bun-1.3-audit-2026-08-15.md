# Bun 1.3 architecture audit — 2026-08-15

Rotli is pinned to Bun 1.3.14. This audit compares the current repository with
the Bun 1.3.8–1.3.14 releases and records the changes that are useful without
weakening Rotli's Tauri, local-first, or durable-scheduler boundaries.

## Adopt now

- `test:unit` uses `bun test --parallel --isolate src`. Bun 1.3.13 gives every
  test file a fresh global and distributes files across worker processes. The
  complete unit suite passed with 1,395 tests across 159 files before this
  became the default.
- `test:changed` uses Bun's import-graph-aware `--changed` filter for fast local
  verification. It is an iteration command, not a replacement for the full
  regression and release gates.

## Keep under evaluation

- **Bun.Image:** 1.3.14 can replace Sharp for ordinary resize/encode pipelines,
  but Rotli's character masks and provider checks inspect and rewrite raw RGBA
  pixels. The current API does not remove that need, so carrying two image
  paths would add complexity without removing the native dependency. Revisit if
  Bun.Image exposes the required raw-pixel pipeline.
- **Bun.WebView:** useful for an additional lightweight WebKit smoke lane on
  macOS. It does not prove Tauri titlebar, filesystem, Keychain, updater,
  scheduler, or native drag behavior and therefore cannot replace Playwright or
  human native review.
- **Isolated install global store:** potentially valuable for CI and local warm
  installs, but it remains experimental and packages with trusted lifecycle
  scripts fall back to per-project copies. Rotli also stages a separate frozen
  Breve graph. Do not enable it until both install graphs and rollback behavior
  have been measured.

## Do not adopt for Rotli's runtime boundary

- **Bun.cron:** the in-process callback is UTC and intentionally process-bound.
  Breve scheduling is local-time, durable, singleton-locked, catch-up aware, and
  supervised by the Tauri app with explicit parent-death and process-group
  handling. Replacing that contract with Bun.cron would erase required policy.
- **Bun bundler metafiles:** `--metafile-md` is useful for Bun.build graphs, but
  Rotli's production UI is a Vite/Tauri build. A second production bundler would
  create competing resolution and CSS behavior. Use Vite/Rollup evidence unless
  the production build itself is deliberately migrated.

## Architecture takeaway

Bun's move from Zig to Rust reinforces Rotli's existing split: Rust owns native,
security-sensitive effects while TypeScript owns product policy and presentation
behind narrow ports. The relevant lesson is not a rewrite; it is to keep
language-independent behavior tests, make ownership explicit, and use isolated
review for large boundary changes.

## Bun 1.4 package-manager preview — 2026-08-18

The package-manager documentation now describes `bun audit fix`, `bun dedupe`,
`bun prune`, `bun pm diff`, and `bun pm licenses`. Stable remains 1.3.14, so
Rotli did not replace its exact release pin with the mutable `canary` tag. The
official macOS arm64 canary tested here reported
`1.4.0-canary.1+4c689909e`; its frozen dry-run installs accepted the app, site,
and Breve lockfiles.

Rotli adopted the stable pieces immediately: all three independent install
roots now enforce a three-day minimum release age, the Tauri development
supervisor runs under `--no-orphans`, and one repository-owned audit command
covers all three lockfiles. `check:structure` mechanically holds the pins, age
gates, supervisor flag, and CI wiring.

The 1.4-only operations live behind the version-gated `bun run deps` adapter.
Combined audit repair plans, dedupe checks, prune previews, license inventories,
and root-explicit package diffs are read-only. Their mutating counterparts
require one explicit root and `--apply`, and audit repair never crosses declared
dependency ranges. The probe
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

Promotion to Bun 1.4 requires an immutable stable release, synchronized
`.bun-version` and all manifest pins, frozen installs for every root, the full
JavaScript/Rust/build proof chain, and a reviewed update to this audit. A
passing preview never counts as release evidence.

Sources: [Bun 1.3.14](https://bun.com/blog/bun-v1.3.14),
[Bun 1.3.13](https://bun.com/blog/bun-v1.3.13),
[Bun 1.3.12](https://bun.com/blog/bun-v1.3.12),
[Bun 1.3.8](https://bun.com/blog/bun-v1.3.8), and
[Bun's Rust rewrite](https://bun.com/blog/bun-in-rust). Package-manager preview
sources: [`bun audit`](https://bun.com/docs/pm/cli/audit),
[`bun pm diff` and licenses](https://bun.com/docs/pm/cli/pm),
[`bun dedupe`](https://bun.com/docs/pm/cli/dedupe), and
[`bun prune`](https://bun.com/docs/pm/cli/prune).
