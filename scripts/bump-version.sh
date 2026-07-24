#!/usr/bin/env bash
# bump-version.sh <semver> — set the version in lockstep across the app/package
# manifests and the Rust lockfile. Optionally scaffolds a CHANGELOG heading.
#
#   ./scripts/bump-version.sh 0.2.0
#
# The updater compares the running app's version (Cargo/tauri.conf) against the
# version in latest.json, so these three drifting apart is the classic "the
# update never offers / offers forever" bug. Keep them identical.
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "usage: bump-version.sh <semver>   e.g. bump-version.sh 0.2.0" >&2
  exit 1
fi
# basic semver shape (X.Y.Z, optional -prerelease) — fail loud on a typo
if ! printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "error: '$VERSION' is not a semver (expected X.Y.Z)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- tauri.conf.json: "version": "X" (JSON, read-modify-write via bun) ---
VERSION="$VERSION" bun -e '
  const p = process.argv[1];
  const v = process.env.VERSION;
  const j = JSON.parse(await Bun.file(p).text());
  j.version = v;
  await Bun.write(p, JSON.stringify(j, null, 2) + "\n");
' "$ROOT/src-tauri/tauri.conf.json"

# --- package.json: "version": "X" ---
VERSION="$VERSION" bun -e '
  const p = process.argv[1];
  const v = process.env.VERSION;
  const j = JSON.parse(await Bun.file(p).text());
  j.version = v;
  await Bun.write(p, JSON.stringify(j, null, 2) + "\n");
' "$ROOT/package.json"

# --- Cargo.toml: the FIRST `version = "..."` under [package] ---
VERSION="$VERSION" bun -e '
  const p = process.argv[1];
  const v = process.env.VERSION;
  let text = await Bun.file(p).text();
  // only the [package] table version, not [dependencies] pins
  const pkgStart = text.indexOf("[package]");
  if (pkgStart < 0) { console.error("Cargo.toml: no [package] table"); process.exit(1); }
  const nextTable = text.indexOf("\n[", pkgStart + 1);
  const end = nextTable < 0 ? text.length : nextTable;
  const head = text.slice(0, pkgStart);
  const body = text.slice(pkgStart, end);
  const tail = text.slice(end);
  const replaced = body.replace(/^version\s*=\s*".*"/m, `version = "${v}"`);
  if (replaced === body) { console.error("Cargo.toml: no version line in [package]"); process.exit(1); }
  await Bun.write(p, head + replaced + tail);
' "$ROOT/src-tauri/Cargo.toml"

# --- Cargo.lock: the `rotli` package entry generated from Cargo.toml ---
VERSION="$VERSION" bun -e '
  const p = process.argv[1];
  const v = process.env.VERSION;
  let text = await Bun.file(p).text();
  const pattern = /(\[\[package\]\]\nname = "rotli"\nversion = ")[^"]+(")/;
  if (!pattern.test(text)) { console.error("Cargo.lock: no rotli package entry"); process.exit(1); }
  text = text.replace(pattern, `$1${v}$2`);
  await Bun.write(p, text);
' "$ROOT/src-tauri/Cargo.lock"

# --- CHANGELOG: scaffold a dated heading under [Unreleased] (best-effort) ---
CHANGELOG="$ROOT/CHANGELOG.md"
if [ -f "$CHANGELOG" ] && ! grep -qE "^## \[$VERSION\]" "$CHANGELOG"; then
  TODAY="$(date +%Y-%m-%d)"
  VERSION="$VERSION" TODAY="$TODAY" bun -e '
    const p = process.argv[1];
    const v = process.env.VERSION, today = process.env.TODAY;
    let text = await Bun.file(p).text();
    const heading = `## [${v}] - ${today}\n`;
    if (text.includes("## [Unreleased]")) {
      text = text.replace("## [Unreleased]", `## [Unreleased]\n\n${heading}`);
    } else {
      text = `${heading}\n${text}`;
    }
    await Bun.write(p, text);
  ' "$CHANGELOG" || true
fi

echo "bumped to $VERSION (tauri.conf.json · Cargo.toml · Cargo.lock · package.json)"
