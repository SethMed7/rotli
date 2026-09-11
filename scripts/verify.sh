#!/usr/bin/env bash
# verify.sh — run locally what the Regression suite runs in CI.
#
# `bun run check` is the JavaScript/TypeScript gate, not the CI gate. CI runs
# four lanes; before this script existed, three of their steps had no local
# entry point at all — the Rust clippy gate, the Playwright suite, and every
# `site/` step. So a change could pass the documented local handoff and still
# turn `main` red, which is exactly how #118 landed a knip regression that only
# Linux could see.
#
# This script mirrors .github/workflows/regression.yml lane by lane. Keep the
# two in step: a lane added there is a lane added here.
#
# Usage:
#   bun run verify              # every lane, in CI's order
#   bun run verify quality      # one or more lanes: secrets | quality | e2e | rust
#
# Not covered, deliberately:
#   • the dependency-audit lane — advisory in CI, and `cargo install
#     cargo-audit` costs minutes. Run `bun audit` / `cargo audit` by hand.
#   • notarization and signing — release.sh owns those, and no CI runner or
#     verify run ever receives a signing credential.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

LANES=("$@")
[ ${#LANES[@]} -eq 0 ] && LANES=(secrets quality e2e rust)

wants() {
  local lane="$1"
  for requested in "${LANES[@]}"; do [ "$requested" = "$lane" ] && return 0; done
  return 1
}

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

# A lane that cannot run must never read as a lane that passed. Refuse loudly
# with the command that fixes it rather than skipping into a false green.
require() {
  local what="$1" fix="$2"
  [ -e "$what" ] || { echo "✗ missing $what"; echo "  run: $fix"; exit 1; }
}

if wants secrets; then
  step "secrets — proposed working-tree additions (Gitleaks 8.30.1)"
  bun run security:working
  # A clean checkout has no diff; check the latest commit as well. CI supplies
  # its exact PR/push base to the same script instead of guessing a range.
  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    bun run security:changes "$(git rev-parse HEAD^)" "$(git rev-parse HEAD)"
  else
    bun run security:changes 0000000000000000000000000000000000000000 "$(git rev-parse HEAD)"
  fi
fi

if wants quality; then
  # CI's first steps: a frozen install of every lockfile. Locally this is
  # what turns "my node_modules happen to work" into "the lockfile works"
  # (audit 2026-09-03: a lockfile drift was invisible to a green verify).
  step "quality — frozen installs (app, Breve defaults, site)"
  bun ci
  (cd breve-runtime/defaults && bun install --production --frozen-lockfile)
  [ -d site ] && (cd site && bun ci)

  step "quality — bun run check"
  bun run check

  step "quality — production build"
  NODE_OPTIONS=--max-old-space-size=4096 bun run build

  step "quality — dependency convergence and reviewed licenses"
  bun run deps dedupe-check
  bun run deps licenses-check

  if [ -d site ]; then
    step "quality — site check and builds (full + coming-soon modes)"
    # CI=true: astro offers to install @astrojs/check interactively, and a gate
    # must never wait on a prompt. The second build proves the production
    # holding page (SITE_MODE=coming-soon) still emits; see site/src/site.ts.
    (cd site && CI=true bun run check && CI=true bun run build && CI=true SITE_MODE=coming-soon bun run build)
  fi
fi

if wants e2e; then
  step "e2e — typecheck the Playwright scope"
  bun run check:e2e-types

  step "e2e — Playwright (chromium)"
  # CI installs chromium and fails without it; a lane that cannot run must
  # never read as a lane that passed (the rule at the top of this file).
  if ! bunx playwright install --dry-run chromium >/dev/null 2>&1; then
    echo "✗ chromium is not installed for Playwright"
    echo "  run: bunx playwright install chromium"
    exit 1
  fi
  # a stale `vite dev` on 1420 would make Playwright prove the wrong build
  if lsof -nP -iTCP:1420 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  ⚠ something already listens on :1420 — Playwright will reuse it (reuseExistingServer); stop it to prove THIS tree"
  fi
  bun run test:e2e
fi

if wants rust; then
  step "rust — clippy (warnings are errors)"
  cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

  step "rust — cargo test"
  cargo test --manifest-path src-tauri/Cargo.toml
fi

printf '\n\033[1m✓ verify passed\033[0m — lanes: %s\n' "${LANES[*]}"
echo "  Still not proven locally: native titlebar/menu-bar/Keychain/updater/scheduler"
echo "  behavior, real delivery, and the advisory dependency audit."
