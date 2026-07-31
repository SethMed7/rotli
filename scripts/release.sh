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

# ── knobs (env-overridable; safe defaults) ───────────────────────────────────
DEVID="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Seth Medina (TEAMID0000)}"
NOTARY_PROFILE="${ROTLI_NOTARY_PROFILE:-rotli-notary}"
RELEASES_REPO="${ROTLI_RELEASES_REPO:-SethMed7/rotli-releases}"
UPDATER_KEY="${ROTLI_UPDATER_KEY:-$HOME/.rotli-updater.key}"
ENTITLEMENTS="src-tauri/entitlements.plist"
PUBLISH=0
LAUNCH=0   # --launch unlocks a major≥1 version (the public 1.0 launch); see the guard below
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --launch)  LAUNCH=1 ;;
  esac
done

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

echo "▸ rotli $VER  (publish=$PUBLISH · identity: $DEVID · notary: $NOTARY_PROFILE)"
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
  git tag "v$VER" "$SOURCE_COMMIT"
  git push origin "v$VER"

  echo "▸ publish → $RELEASES_REPO (tag v$VER)"
  gh release create "v$VER" \
    "$DMG" "$DIST/rotli.app.tar.gz" "$DIST/rotli.app.tar.gz.sig" "$DIST/latest.json" \
    --repo "$RELEASES_REPO" \
    --title "rotli $VER" \
    --notes "$NOTES"
  echo "✓ published rotli $VER"
else
  echo "ℹ not published. Re-run with --publish once $RELEASES_REPO exists to ship."
fi
