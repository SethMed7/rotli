#!/bin/sh
# Rotli Helper installer - Mac and Linux.
#
#   curl -fsSL https://rotli.co/helper/install.sh | sh -s -- --open https://rotli.co/app/
#
# Downloads the prebuilt rotli-helper for this computer into ~/.rotli/bin,
# checks its SHA-256 against the release's checksum file, and registers it to
# start when you log in (a LaunchAgent on a Mac, a systemd user service on
# Linux) so the vault Rotli Web opens through it stays connected across
# reboots and closed windows. With --open, it then opens Rotli Web with the
# pairing code in the URL fragment (#pair=...), which the browser never sends
# to any server; the page pairs itself and removes it from the address bar.
# No PATH edits, no sudo. The helper listens on 127.0.0.1 only and touches
# only the vault folder you choose.
#
#   ... | sh -s -- --uninstall   stops it, removes the login item and the binary
#
# ROTLI_HELPER_VERSION=1.2.0 overrides the version; ROTLI_HELPER_DRY_RUN=1
# prints what would be done and stops.
set -eu

OPEN_URL=""
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --open) OPEN_URL="${2:-}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "rotli-helper: unknown option $1" >&2; exit 1 ;;
  esac
done
# the pairing code only ever goes to Rotli's own page: the WHOLE address must
# match (a shell glob like http://localhost:*/app/ would also admit
# http://localhost:@evil.example/app/, whose host is evil.example)
if [ -n "$OPEN_URL" ] && { [ "$(printf '%s' "$OPEN_URL" | wc -l | tr -d ' ')" != "0" ] || ! printf '%s\n' "$OPEN_URL" | grep -Eqx 'https://(dev\.)?rotli\.co/app/|http://(localhost|127\.0\.0\.1):[0-9]{1,5}/app/'; }; then
  echo "rotli-helper: --open only accepts Rotli Web's own address, not $OPEN_URL" >&2
  exit 1
fi

VERSION="${ROTLI_HELPER_VERSION:-1.2.0}"
RELEASES="${ROTLI_HELPER_RELEASES:-https://github.com/SethMed7/rotli-releases/releases/download}"
DEST_DIR="${ROTLI_HELPER_DIR:-$HOME/.rotli/bin}"
DEST="$DEST_DIR/rotli-helper"
LOG="$HOME/.rotli/helper.log"
LABEL="co.rotli.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/rotli-helper.service"

# Stop the login item, whichever this computer uses; quiet when there is none.
stop_login_item() {
  if [ "$(uname -s)" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now rotli-helper.service 2>/dev/null || true
  fi
}

if [ "$UNINSTALL" = "1" ]; then
  stop_login_item
  rm -f "$PLIST" "$UNIT" "$DEST"
  echo "Rotli Helper is stopped and removed. Your vault folder is untouched."
  echo "Its pairing code and vault choice stay in ~/.rotli-helper; delete that folder to forget them too."
  exit 0
fi

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
  echo "would register it to start at login and open ${OPEN_URL:-nothing}"
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

mkdir -p "$DEST_DIR" "$HOME/.rotli"
stop_login_item # an upgrade replaces a running helper
mv "$tmp/$asset" "$DEST"
chmod 755 "$DEST"
echo "Installed to $DEST"

# Start at login, and now.
started=0
if [ "$os_name" = "macos" ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$DEST</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
  launchctl bootstrap "gui/$(id -u)" "$PLIST" && started=1
  [ "$started" = "1" ] && echo "Rotli Helper starts when you log in (LaunchAgent $LABEL)."
elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$UNIT_DIR"
  cat >"$UNIT" <<UNIT
[Unit]
Description=Rotli Helper - serves your Rotli vault to Rotli Web on 127.0.0.1

[Service]
ExecStart=$DEST
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
  # the folder picker needs the desktop session's display
  systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY 2>/dev/null || true
  systemctl --user daemon-reload
  systemctl --user enable --now rotli-helper.service && started=1
  [ "$started" = "1" ] && echo "Rotli Helper starts when you log in (systemd user service rotli-helper)."
fi
if [ "$started" != "1" ]; then
  echo "No login item could be registered here; starting it for this session only."
  nohup "$DEST" >>"$LOG" 2>&1 &
fi

# Wait for it to answer, then hand the page its pairing code.
tries=0
until curl -fsS "http://127.0.0.1:43111/health" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 50 ]; then
    echo "rotli-helper: it didn't start - see $LOG" >&2
    exit 1
  fi
  sleep 0.2
done
code="$("$DEST" --print-code | sed -n 's/^Pairing code: //p')"
echo
echo "Pairing code: $code"
if [ -n "$OPEN_URL" ]; then
  echo "Opening Rotli Web to pair..."
  if [ "$os_name" = "macos" ]; then
    open "${OPEN_URL}#pair=${code}" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${OPEN_URL}#pair=${code}" >/dev/null 2>&1 || true
  fi
fi
echo "Done. Rotli Web pairs with it automatically; if it asks, paste the code above."
