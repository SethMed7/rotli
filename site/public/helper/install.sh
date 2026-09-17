#!/bin/sh
# Rotli Helper installer - Mac and Linux.
#
#   curl -fsSL https://rotli.co/helper/install.sh | sh
#
# Downloads the prebuilt rotli-helper for this computer into ~/.rotli/bin,
# checks its SHA-256 against the release's checksum file, and starts it, which
# prints the pairing code Rotli Web asks for. Nothing else is touched: no
# PATH edits, no sudo, no launch agents. Run ~/.rotli/bin/rotli-helper later
# to start it again; delete ~/.rotli/bin/rotli-helper to uninstall.
#
# ROTLI_HELPER_VERSION=1.1.0 overrides the version; ROTLI_HELPER_DRY_RUN=1
# prints what would be downloaded and stops.
set -eu

VERSION="${ROTLI_HELPER_VERSION:-1.1.0}"
RELEASES="${ROTLI_HELPER_RELEASES:-https://github.com/SethMed7/rotli-releases/releases/download}"
DEST_DIR="${ROTLI_HELPER_DIR:-$HOME/.rotli/bin}"
DEST="$DEST_DIR/rotli-helper"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os_name="macos" ;;
  Linux) os_name="linux" ;;
  *) echo "rotli-helper: $os is not supported by this installer (Mac and Linux only; Windows uses install.ps1)." >&2; exit 1 ;;
esac
case "$arch" in
  arm64|aarch64) arch_name="arm64" ;;
  x86_64|amd64) arch_name="x64" ;;
  *) echo "rotli-helper: no build for the $arch processor yet." >&2; exit 1 ;;
esac

asset="rotli-helper-${os_name}-${arch_name}"
url="$RELEASES/helper-v$VERSION/$asset"
sums_url="$RELEASES/helper-v$VERSION/SHA256SUMS"

if [ "${ROTLI_HELPER_DRY_RUN:-}" = "1" ]; then
  echo "would download $url"
  echo "would verify against $sums_url"
  echo "would install to $DEST"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "rotli-helper: curl is needed to download the helper." >&2
  exit 1
fi

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t rotli-helper)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading Rotli Helper $VERSION for ${os_name}/${arch_name}..."
if ! curl -fsSL "$url" -o "$tmp/$asset"; then
  echo "rotli-helper: no download at $url - this version may not be published for your computer yet." >&2
  exit 1
fi

# Verify against the release's checksum file. When the release ships one,
# verification is required: a missing line for this asset, or no way to
# compute a hash on this machine, refuses the install rather than shipping an
# unchecked binary. Only a release without SHA256SUMS installs unverified,
# and says so.
if curl -fsSL "$sums_url" -o "$tmp/SHA256SUMS" 2>/dev/null; then
  expected="$(awk -v a="$asset" '$2 == a { print $1; exit }' "$tmp/SHA256SUMS")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  else
    echo "rotli-helper: this machine has neither sha256sum nor shasum, so the download cannot be verified - not installing." >&2
    exit 1
  fi
  if [ -z "$expected" ]; then
    echo "rotli-helper: the release's checksum file has no entry for $asset - not installing." >&2
    exit 1
  fi
  if [ "$expected" != "$actual" ]; then
    echo "rotli-helper: the download did not match the published checksum - not installing." >&2
    exit 1
  fi
  echo "Checksum verified."
else
  echo "This release publishes no checksum file; installing unverified."
fi

mkdir -p "$DEST_DIR"
mv "$tmp/$asset" "$DEST"
chmod 755 "$DEST"
echo "Installed to $DEST"
echo "Starting it now - keep this window open while you chat (Ctrl+C stops it)."
echo
exec "$DEST"
