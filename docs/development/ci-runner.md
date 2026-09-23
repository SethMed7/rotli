# GitHub-hosted CI runners

The `Regression suite` in [`.github/workflows/regression.yml`](../../.github/workflows/regression.yml)
runs on explicitly versioned GitHub-hosted images. Rotli does not maintain a
self-hosted CI service, runner registration token, or long-lived runner machine.

Keep the workflow name exactly `Regression suite`. The release gate queries it
by name for the exact source commit.

## Lanes

| Job | Runner | Proof |
| --- | --- | --- |
| Quality and production builds | `ubuntu-24.04` | Script-free isolated frozen installs for app, site, and Breve; lockfile convergence; exact Unknown-license baseline; retained license inventory; `bun run check`; Vite/Rolldown and Astro production builds |
| Browser E2E | `ubuntu-24.04` | E2E typecheck, Playwright Chromium install, and the browser suite |
| Dependency vulnerability audit | `ubuntu-24.04` | `bun audit` and RustSec; current accepted transitive findings remain advisory and are tracked in [`security.md`](security.md) |
| Rust | `macos-15` | `cargo clippy --all-targets -- -D warnings` and `cargo test` against the shipped operating-system branches |

A **Change scope** job ([`scripts/ci-scope.ts`](../../scripts/ci-scope.ts))
runs first. When every changed path is under `site/`, under `docs/`, or a root
Markdown file, Browser E2E, the dependency audit, and both Rust lanes are
skipped: a website or docs change proves nothing about the app, and a skipped
job counts as a passing required check. Quality (which checks and builds the
site too) and the secret scan run on every change. The gated lanes run unless
the scope job explicitly answered `app=false`, so a missing base commit, an
empty or failed diff, a manual run, or a failed scope job runs everything.

Linux carries every portable Bun, TypeScript, Vite, Astro, Playwright, and
dependency check. Rust stays on macOS because the crate contains macOS-gated
code and a Linux build would prove a different binary. GitHub bills macOS
minutes at roughly ten times the Linux rate, so the macOS job must remain
limited to native Rust proof unless a new macOS-only invariant requires more.

Signing, notarization, updater signing, and publication never run in this
workflow. Those operations remain local responsibilities of
[`scripts/release.sh`](../../scripts/release.sh), and no CI job receives Apple or
updater signing credentials.

## Cross-platform build probe (manual)

[`.github/workflows/cross-platform-build.yml`](../../.github/workflows/cross-platform-build.yml)
is a second, `workflow_dispatch`-only workflow. It runs an unsigned
`tauri build` on `macos-15`, `windows-2022`, and `ubuntu-24.04` (bundles chosen
on the CLI, so `tauri.conf.json` stays macOS-shaped) and uploads whatever
bundled. It is expected to fail on Windows and Linux until the punch-list in
[`cross-platform-feasibility.md`](../design/cross-platform-feasibility.md) is
worked, which is why it never runs on push or pull request and is not part of
the release gate. It receives no signing credentials.

## Reproducibility and permissions

- Use exact hosted image labels (`ubuntu-24.04` and `macos-15`), not `*-latest`.
- Pin every third-party action to a full reviewed commit SHA and retain its
  release tag in a comment.
- Install Bun from the root `.bun-version`; keep all three manifests'
  `packageManager` fields identical to it. Let Rustup consume
  `rust-toolchain.toml` rather than selecting a moving stable channel in
  workflow YAML.
- Install JavaScript dependencies from committed v2 lockfiles. Every root's
  bunfig enforces script-free isolated resolution with the shared global store
  disabled; CI must not override that policy.
- Block on `bun run deps dedupe-check` and `bun run deps licenses-check`, then
  retain the combined production dependency-license inventory as
  `dependency-licenses` for 30 days. The license check ratchets Bun's Unknown
  group in both directions: additions require review and removed entries must
  leave the baseline. This evidence supplements the release SBOM rather than
  replacing it.
- Keep the workflow token read-only. Audit results belong in the job log and do
  not need permission to create a separate check run.
- Keep `concurrency.cancel-in-progress` enabled so a superseded branch commit
  does not consume runner time or present stale evidence.
- Never add signing, notary, updater, Keychain, memex, or production secrets to
  regression CI.

## Running and diagnosing the suite

Pushes to `main` and `dev`, pull requests, and manual dispatches run the same workflow.
To request and watch a run without changing source:

```sh
gh workflow run "Regression suite" --repo SethMed7/rotli --ref main
gh run watch --repo SethMed7/rotli --branch main
```

A pull request is green only when all four jobs conclude `success`. The
dependency scanners are currently non-blocking because their accepted findings
have explicit paths and rationale in [`security.md`](security.md); review their
annotations on every change instead of treating a green advisory job as a clean
dependency tree.

CI does not prove native visual quality, signing/notarization, real Keychain or
filesystem behavior, updater delivery, scheduler installation, or external
provider delivery. Handoffs must identify the required human-native smoke
separately.

## How releases use CI

Publication requires a completed successful `Regression suite` run on `main`
for the exact source commit. `scripts/release.sh --publish` reads the workflow's
conclusion value and applies these rules:

- `success` permits the release process to continue;
- missing or pending evidence blocks publication;
- a completed red conclusion blocks publication; and
- `ROTLI_RELEASE_ALLOW_RED=1` is the explicit emergency override for a completed
  red result. It does not turn missing or pending evidence into proof.

`--require-ci` remains accepted for explicitness and compatibility, but required
CI is the default. The conclusion check can be exercised without building,
signing, notarizing, tagging, or publishing:

```sh
bash scripts/release.sh --check-ci-only
bash scripts/release.sh --check-ci-only=<full-commit-sha>
```

The no-value form checks `HEAD`; the full-SHA form diagnoses historical or
pre-release evidence without changing the commit that a real publication would
use. Run either from a clean worktree. The candidate's check must pass before a
release starts. Preserve the workflow name unless the release lookup is changed
in the same reviewed pull request.

## Retired self-hosted infrastructure

The former Railway Linux image and spare-Mac registration runbook were retired
after the hosted workflow completed successfully on both a pull-request commit
and its squash merge on `main`. The repository no longer contains `ci/runner/`.
No Railway service or GitHub self-hosted runner is required. If an old external
service or offline runner entry still exists, delete the service, revoke its
runner-registration PAT, and remove the runner entry in repository settings;
those external operations require target-specific maintainer authorization.
