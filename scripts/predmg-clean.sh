#!/usr/bin/env bash
# predmg-clean.sh — clear the wreckage a previous (or crashed) DMG build leaves
# behind so the next `tauri build` / `release.sh` doesn't trip over it.
#
# Two failure modes this fixes:
#   1) A stale read-write DMG volume still mounted (`/Volumes/dmg.XXXX` or a
#      half-built `/Volumes/rotli ...`) — hdiutil can't reuse it and the build
#      aborts with "Resource busy".
#   2) The `rw.*.dmg` scratch image hdiutil writes into the bundle dir, left
#      over from an interrupted run.
#
# Resilient by design: every step tolerates "nothing matched" so a clean tree is
# a no-op, never an error.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 1) detach any stale rotli / dmg scratch volumes (force; ignore failures)
hdiutil info 2>/dev/null \
  | grep -iE '/Volumes/(dmg\.|rotli)' \
  | awk '{print $1}' \
  | while read -r dev; do
      [ -n "$dev" ] && hdiutil detach -force "$dev" 2>/dev/null || true
    done || true   # no stale volumes ⇒ grep exits 1 under pipefail; tolerate it

# 2) remove the leftover read-write scratch image, if any
rm -f "$ROOT"/src-tauri/target/release/bundle/macos/rw.*.dmg 2>/dev/null || true

# 3) drop dependency trees under breve-runtime/. tauri.conf.json copies that
#    folder wholesale into the .app's Resources, and Breve resolves its own
#    production deps there at runtime (routines.rs `bun install --production`),
#    so a machine that has run a routine grows a gitignored node_modules the
#    next build would bundle. 0.78.0's first attempt shipped 462 MB of it: a
#    28 MB app became 491 MB and Apple rejected the notarization because
#    onnxruntime-node's prebuilt binaries are unsigned. Regenerable by design
#    and NOT the live runtime — Breve keeps that under the memex's
#    .rotli/breve/ — so removing it is a no-op for anything real. Announced,
#    never silent, because it can be hundreds of megabytes.
find "$ROOT/breve-runtime" -type d -name node_modules -prune -print 2>/dev/null \
  | while read -r stray; do
      [ -n "$stray" ] || continue
      echo "  predmg-clean: removing bundled-resource node_modules → ${stray#"$ROOT"/}"
      rm -rf "$stray"
    done || true   # nothing matched ⇒ tolerate under pipefail

exit 0
