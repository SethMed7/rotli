#!/usr/bin/env bash
# release.sh — cut a signed + notarized rotli release.
#
# Mirrors voz's flow, adapted to Tauri + a headless hdiutil DMG (Tauri's own DMG
# bundler shells Finder/AppleScript and fails outside a GUI session). Steps:
#   gate → build the Developer-ID-signed .app + updater artifacts → notarize +
#   staple the .app → build the DMG (hdiutil) → sign + notarize + staple the DMG
#   → assemble latest.json → Gatekeeper check → [--publish] gh release.
#
# One-time prerequisites (already set up):
#   • a "Developer ID Application" cert in the login Keychain
#   • a notarytool keychain profile  (xcrun notarytool store-credentials rotli-notary …)
#   • the updater signing key at ~/.rotli-updater.key  (tauri signer generate)
# No secret ever lives in the repo — identity + creds come from the Keychain, the
# updater key from a path OUTSIDE the repo.
#
# Usage:
#   bash scripts/release.sh            # build + sign + notarize + validate (NO publish)
#   bash scripts/release.sh --publish  # the above, then gh release to rotli-releases + tag
#   bash scripts/release.sh --check-ci-only  # verify HEAD's hosted CI evidence, then exit
#   bash scripts/release.sh --check-ci-only=<full-sha>  # diagnose another commit without releasing it
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # repo root

# A release must be attributable to one exact reviewed source commit. Refuse
# before touching signing credentials or building artifacts when tracked or
# untracked source state is present.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  echo "✗ source tree is dirty — commit or remove every change before release."
  exit 1
fi
SOURCE_COMMIT="$(git rev-parse HEAD)"

# ── knobs (env-overridable; public defaults only) ─────────────────────────────
DEVID="${APPLE_SIGNING_IDENTITY:-}"
NOTARY_PROFILE="${ROTLI_NOTARY_PROFILE:-rotli-notary}"
RELEASES_REPO="${ROTLI_RELEASES_REPO:-SethMed7/rotli-releases}"
UPDATER_KEY="${ROTLI_UPDATER_KEY:-$HOME/.rotli-updater.key}"
ENTITLEMENTS="src-tauri/entitlements.plist"
PUBLISH=0
LAUNCH=0   # --launch unlocks a major≥1 version (the public 1.0 launch); see the guard below
REQUIRE_CI=1  # CI evidence is mandatory; --require-ci remains as an explicit/backward-compatible spelling
CHECK_CI_ONLY=0
CI_CHECK_COMMIT="$SOURCE_COMMIT"
for arg in "$@"; do
  case "$arg" in
    --publish)       PUBLISH=1 ;;
    --launch)        LAUNCH=1 ;;
    --require-ci)    REQUIRE_CI=1 ;;
    --check-ci-only) CHECK_CI_ONLY=1 ;;
    --check-ci-only=*)
      CHECK_CI_ONLY=1
      CI_CHECK_COMMIT="${arg#*=}"
      ;;
  esac
done

verify_ci_conclusion() {
  local source_commit="$1"
  local ci_runs
  local ci_conclusion

  echo "▸ verify CI conclusion for $source_commit"
  # Released commits are on main — asserted directly, so the run query can be
  # commit-scoped instead of "the newest 40 main runs" (which missed a run that
  # had just completed, 2026-09-03). gh's index can lag a fresh run by seconds;
  # a bounded retry covers that, and superseded (cancelled) runs never count.
  git fetch -q origin main 2>/dev/null || true
  if ! git merge-base --is-ancestor "$source_commit" origin/main 2>/dev/null; then
    echo "✗ $source_commit is not on origin/main — release from the promoted commit"
    return 1
  fi
  local attempt
  for attempt in 1 2 3 4 5; do
    ci_runs="$(gh run list --workflow "Regression suite" --commit "$source_commit" \
      --json headSha,status,conclusion,url --limit 20 2>/dev/null || echo '[]')"
    ci_conclusion="$(printf '%s' "$ci_runs" \
      | jq -r 'map(select(.conclusion != "cancelled")) | first | if . == null then "none" elif .status != "completed" then "pending" else (.conclusion // "unknown") end' \
      2>/dev/null || echo "none")"
    case "$ci_conclusion" in
      none|pending) sleep $((attempt * 10)) ;;
      *) break ;;
    esac
  done
  CI_RUN_URL="$(printf '%s' "$ci_runs" | jq -r 'map(select(.conclusion != "cancelled")) | first | .url // empty')"
  CI_RUN_RESULT="$ci_conclusion"
  case "$ci_conclusion" in
    success)
      [ -n "$CI_RUN_URL" ] || { echo "✗ successful Regression run has no immutable URL"; return 1; }
      echo "  ✓ Regression suite passed for this exact commit" ;;
    none|pending)
      echo "✗ no successful completed Regression run found for $source_commit ($ci_conclusion)"
      [ "$REQUIRE_CI" -eq 1 ] && { echo "  CI evidence is required before release publication"; return 1; }
      ;;
    *)
      # The only emergency escape is explicit and loud. It can override a
      # completed red conclusion, but never missing or still-pending evidence.
      if [ "${ROTLI_RELEASE_ALLOW_RED:-0}" = "1" ]; then
        [ -n "$CI_RUN_URL" ] || { echo "✗ completed Regression run has no immutable URL"; return 1; }
        echo "  ⚠ Regression concluded '$ci_conclusion' for $source_commit — OVERRIDDEN by ROTLI_RELEASE_ALLOW_RED=1"
      else
        echo "✗ Regression suite for $source_commit concluded '$ci_conclusion' — refusing to publish a red commit"
        echo "  Emergency override: ROTLI_RELEASE_ALLOW_RED=1"
        return 1
      fi ;;
  esac
}

if [ "$CHECK_CI_ONLY" -eq 1 ]; then
  if ! [[ "$CI_CHECK_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
    echo "✗ --check-ci-only requires a full lowercase 40-character commit SHA"
    exit 1
  fi
  verify_ci_conclusion "$CI_CHECK_COMMIT"
  exit 0
fi

if [ -z "$DEVID" ]; then
  echo "✗ APPLE_SIGNING_IDENTITY is required for a signed release"
  exit 1
fi

PINNED_BUN="$(tr -d '[:space:]' < .bun-version)"
PINNED_RUST="$(awk -F '"' '/^[[:space:]]*channel[[:space:]]*=/ { print $2; exit }' rust-toolchain.toml)"
command -v bun >/dev/null 2>&1 || {
  echo "✗ Bun $PINNED_BUN is required; install the version pinned in .bun-version"
  exit 1
}
ACTUAL_BUN="$(bun --version)"
[ "$ACTUAL_BUN" = "$PINNED_BUN" ] || {
  echo "✗ Bun version mismatch: expected $PINNED_BUN from .bun-version, found $ACTUAL_BUN"
  exit 1
}
command -v rustc >/dev/null 2>&1 || {
  echo "✗ Rust $PINNED_RUST is required; rustup reads rust-toolchain.toml automatically"
  exit 1
}
ACTUAL_RUST="$(rustc --version | awk '{ print $2 }')"
[ "$ACTUAL_RUST" = "$PINNED_RUST" ] || {
  echo "✗ Rust version mismatch: expected $PINNED_RUST from rust-toolchain.toml, found $ACTUAL_RUST"
  exit 1
}

VER="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("src-tauri/tauri.conf.json","utf8")).version)')"
PACKAGE_VER="$(bun -e 'console.log(JSON.parse(require("fs").readFileSync("package.json","utf8")).version)')"
CARGO_VER="$(awk '/^\[package\]/{p=1;next} p && /^version = /{gsub(/"/,"",$3);print $3;exit}' src-tauri/Cargo.toml)"
LOCK_VER="$(awk '/^\[\[package\]\]/{p=0} /^name = "rotli"$/{p=1;next} p && /^version = /{gsub(/"/,"",$3);print $3;exit}' src-tauri/Cargo.lock)"
if [ "$VER" != "$PACKAGE_VER" ] || [ "$VER" != "$CARGO_VER" ] || [ "$VER" != "$LOCK_VER" ]; then
  echo "✗ version mismatch: app=$VER package=$PACKAGE_VER cargo=$CARGO_VER lock=$LOCK_VER"
  exit 1
fi
grep -q "^## \\[$VER\\]" CHANGELOG.md || {
  echo "✗ CHANGELOG.md has no release heading for $VER"
  exit 1
}

# ── 1.0 guard ────────────────────────────────────────────────────────────────
# Version 1.x is RESERVED for the FIRST PUBLIC LAUNCH. Everything now is 0.x
# beta/dev. Refuse to build a major ≥ 1 unless --launch is passed explicitly, so
# no future session or stray version bump ever ships "1.0" by accident.
MAJOR="${VER%%.*}"
if [ "$MAJOR" -ge 1 ] && [ "$LAUNCH" -eq 0 ]; then
  echo "✗ version $VER has major ≥ 1 — RESERVED for the first live (1.0) launch."
  echo "  All current releases are 0.x beta/dev. If this truly IS the launch, run:"
  echo "    bash scripts/release.sh --publish --launch"
  exit 1
fi

APP="src-tauri/target/release/bundle/macos/rotli.app"
TARGZ="$APP.tar.gz"
SIG="$APP.tar.gz.sig"
# NOT "dist": dist/ is Tauri's frontendDist and gets EMBEDDED in the Rust
# binary. Staging the ~55 MB dmg/tar.gz feed there meant any `cargo build`
# without a fresh `vite build` (which clears dist/) would bake the previous
# release's artifacts into the app itself. Size-diet fix, 2026-07-31.
DIST="dist-release"
DMG="$DIST/rotli_${VER}_aarch64.dmg"
DL_URL="https://github.com/${RELEASES_REPO}/releases/download/v${VER}/rotli.app.tar.gz"

echo "▸ rotli $VER  (publish=$PUBLISH · signing identity configured · notary profile configured)"
[ -f "$UPDATER_KEY" ] || { echo "✗ updater key not found at $UPDATER_KEY"; exit 1; }
mkdir -p "$DIST"

# ── 0. gate ──────────────────────────────────────────────────────────────────
echo "▸ check"
bun run check

# ── 1. build the signed .app + updater artifacts (.tar.gz + .sig) ────────────
echo "▸ build (Developer-ID signed, updater artifacts on)"
bash scripts/predmg-clean.sh
export APPLE_SIGNING_IDENTITY="$DEVID"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$UPDATER_KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${ROTLI_UPDATER_KEY_PASSWORD:-}"
CI=true bun run tauri build --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":true}}'

[ -d "$APP" ] || { echo "✗ no .app at $APP"; exit 1; }

# ── 1a. the bundle must not absorb local development junk ────────────────────
# tauri.conf.json copies `../breve-runtime/` wholesale into Resources. That
# folder is also where Breve resolves its production deps at runtime
# (routines.rs `bun install --production`), so a machine that has ever run a
# Breve routine grows a gitignored `defaults/node_modules` — and the next
# release build sweeps it into the .app.
#
# This is not hypothetical: 0.78.0's first attempt shipped 462 MB of it, a
# 28 MB app became 491 MB, and Apple rejected notarization because
# onnxruntime-node's prebuilt .dylib/.node are unsigned. Ten minutes of Apple
# round-trip to learn something `find` answers instantly. Worse, without this
# the contents of a release depend on whether the releasing machine happens to
# have run the app — so check the BUILT BUNDLE, not the source tree: the output
# is the only place that catches every future variant of "junk got copied in."
STRAY_MODULES="$(find "$APP" -type d -name node_modules -prune 2>/dev/null || true)"
if [ -n "$STRAY_MODULES" ]; then
  echo "✗ the built .app contains node_modules — refusing to notarize."
  echo "$STRAY_MODULES" | sed 's/^/    /'
  echo "  These are bundled resources, not dependencies of the app. Prebuilt"
  echo "  native binaries inside them are unsigned and Apple will reject the"
  echo "  submission. Remove them and rebuild, e.g.:"
  echo "    rm -rf breve-runtime/defaults/node_modules"
  echo "  (safe: Breve's live runtime keeps its own copy under the memex's"
  echo "  .rotli/breve/, and breve-runtime/defaults/ is a tracked template.)"
  exit 1
fi

# Tauri signs the .app with the hardened runtime (signingIdentity + entitlements).
# We don't pre-check the flag — notarytool below is the real gate: Apple REJECTS a
# non-hardened app, so an Accepted result IS the hardened-runtime proof.
codesign --verify --strict --verbose=2 "$APP"

# ── 2. notarize + staple the .app ────────────────────────────────────────────
echo "▸ notarize the .app (notarytool --wait; a few minutes)"
ZIP="$DIST/rotli-app.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$APP"
rm -f "$ZIP"

# the updater feed must ship the FINAL stapled app (so an auto-updated install
# passes Gatekeeper even offline). Tauri made an initial .tar.gz during the build
# (pre-staple) — regenerate it from the stapled .app and re-sign with the updater key.
echo "▸ updater artifact (from the stapled .app)"
rm -f "$TARGZ" "$SIG"
# COPYFILE_DISABLE=1: macOS tar otherwise adds AppleDouble `._rotli.app` sidecar
# entries (xattrs/resource forks) that the Tauri updater fails to unpack.
( cd "$(dirname "$APP")" && COPYFILE_DISABLE=1 tar czf rotli.app.tar.gz rotli.app )
# TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD) are already exported above for the build,
# and `tauri signer sign` reads the key from them — so pass NEITHER -f nor -k here
# (clap errors if --private-key-path and the env's --private-key are both set).
bun run tauri signer sign "$TARGZ"
cp "$TARGZ" "$DIST/rotli.app.tar.gz"
cp "$SIG" "$DIST/rotli.app.tar.gz.sig"

# ── 3. build the DMG with hdiutil (headless), around the stapled .app ─────────
echo "▸ dmg (hdiutil, headless)"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/rotli.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "rotli $VER" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
rm -rf "$STAGE"

# ── 4. sign + notarize + staple the DMG ──────────────────────────────────────
echo "▸ sign + notarize the dmg"
codesign --force --timestamp -s "$DEVID" "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
xcrun stapler staple "$DMG"

# ── 5. the updater feed manifest ─────────────────────────────────────────────
echo "▸ latest.json"
NOTES="$(awk "/^## \[$VER\]/{f=1;next} /^## \[/{f=0} f" CHANGELOG.md | sed '/^[[:space:]]*$/d')"
[ -n "$NOTES" ] || NOTES="rotli $VER"
bun scripts/make-latest-json.mjs \
  --version "$VER" \
  --sig "$DIST/rotli.app.tar.gz.sig" \
  --url "$DL_URL" \
  --notes "$NOTES" \
  > "$DIST/latest.json"

# ── 6. Gatekeeper proof ──────────────────────────────────────────────────────
echo "▸ gatekeeper check"
xcrun stapler validate "$DMG"
spctl -a -vvv -t install "$DMG" 2>&1 || true   # informational; stapler validate is the gate

echo "✓ built + notarized:"
ls -lh "$DMG" "$DIST/rotli.app.tar.gz" "$DIST/latest.json"

# ── 7. publish (opt-in) ──────────────────────────────────────────────────────
if [ "$PUBLISH" -eq 1 ]; then
  echo "▸ verify exact source commit is pushed"
  git fetch origin main --tags
  [ "$(git rev-parse origin/main)" = "$SOURCE_COMMIT" ] || {
    echo "✗ origin/main is not the exact release commit $SOURCE_COMMIT"
    exit 1
  }
  if git rev-parse -q --verify "refs/tags/v$VER" >/dev/null; then
    echo "✗ source tag v$VER already exists"
    exit 1
  fi

  # ── exact-commit CI evidence (ROTLI_OPERATIONS: release gates on the CI
  # CONCLUSION VALUE, never an exit code). GitHub-hosted runners execute the
  # complete Regression suite on main; missing, pending, and red evidence block.
  verify_ci_conclusion "$SOURCE_COMMIT"

  echo "▸ release evidence"
  BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  MACOS_BUILD="macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)) $(uname -m)"
  bun scripts/make-release-evidence.mjs \
    --version "$VER" \
    --source-commit "$SOURCE_COMMIT" \
    --built-at "$BUILT_AT" \
    --macos "$MACOS_BUILD" \
    --ci-run "$CI_RUN_URL" \
    --ci-result "$CI_RUN_RESULT" \
    --artifact "$DMG" \
    --artifact "$DIST/rotli.app.tar.gz" \
    --artifact "$DIST/rotli.app.tar.gz.sig" \
    --artifact "$DIST/latest.json" \
    > "$DIST/release-evidence.json"

  git tag "v$VER" "$SOURCE_COMMIT"
  git push origin "v$VER"

  echo "▸ publish → $RELEASES_REPO (tag v$VER)"
  gh release create "v$VER" \
    "$DMG" "$DIST/rotli.app.tar.gz" "$DIST/rotli.app.tar.gz.sig" "$DIST/latest.json" \
    "$DIST/release-evidence.json" \
    --repo "$RELEASES_REPO" \
    --title "rotli $VER" \
    --notes "$NOTES"
  echo "✓ published rotli $VER"
else
  echo "ℹ not published. Re-run with --publish once $RELEASES_REPO exists to ship."
fi
