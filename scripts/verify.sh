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
#   bun run verify quality      # one or more lanes: quality | e2e | rust
#
# Not covered, deliberately:
#   • the dependency-audit lane — advisory in CI, and `cargo install
#     cargo-audit` costs minutes. Run `bun audit` / `cargo audit` by hand.
#   • notarization and signing — release.sh owns those, and no CI runner or
#     verify run ever receives a signing credential.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

LANES=("$@")
[ ${#LANES[@]} -eq 0 ] && LANES=(quality e2e rust)

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

if wants quality; then
  step "quality — bun run check"
  bun run check

  step "quality — production build"
  NODE_OPTIONS=--max-old-space-size=4096 bun run build

  if [ -d site ]; then
    # `site/node_modules` existing proves nothing — a half-installed tree is the
    # common case, and astro then fails deep inside a config import. Check that
    # every declared dependency actually resolves, and name the missing ones.
    MISSING="$(cd site && bun -e '
      const pkg = await Bun.file("package.json").json();
      const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      const { existsSync } = await import("node:fs");
      console.log(declared.filter((name) => !existsSync(`node_modules/${name}`)).join(" "));
    ')"
    if [ -n "$MISSING" ]; then
      echo "✗ site dependencies are not installed: $MISSING"
      echo "  run: (cd site && bun ci)"
      exit 1
    fi
    step "quality — site check, build, and deploy dry-run"
    # CI=true: astro offers to install @astrojs/check interactively, and a gate
    # must never wait on a prompt.
    (cd site && CI=true bun run check && CI=true bun run build && bun run deploy:dry-run)
  fi
fi

if wants e2e; then
  step "e2e — typecheck the Playwright scope"
  bun run check:e2e-types

  step "e2e — Playwright (chromium)"
  # CI installs chromium with its OS deps; locally it is a one-time setup.
  if ! bunx playwright install --dry-run chromium >/dev/null 2>&1; then
    echo "  (could not confirm the chromium install; continuing — Playwright reports its own missing-browser error)"
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
