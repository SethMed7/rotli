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

exit 0
