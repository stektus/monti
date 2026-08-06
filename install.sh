#!/usr/bin/env bash
# Monti installer — one command, no manual steps:
#
#   curl -fsSL https://raw.githubusercontent.com/stektus/monti/main/install.sh | bash
#
# or from a clone:  ./install.sh
# Uninstall:        ./install.sh --uninstall
#
# What it does: checks FUSE (installs via your package manager if missing),
# downloads the latest release AppImage into ~/Applications and adds a
# launcher with an icon to your app menu. No root files are touched —
# uninstalling is deleting three paths (or running --uninstall).

set -euo pipefail

REPO="stektus/monti"
APP_DIR="$HOME/Applications"
BIN="$APP_DIR/Monti.AppImage"
DESKTOP="$HOME/.local/share/applications/monti.desktop"
ICON_DIR="$HOME/.local/share/icons/hicolor"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Ask a yes/no question; works when the script is piped (curl | bash) by
# reading from the terminal directly. Defaults to "no" without a terminal.
ask() {
  local reply=n
  if [ -t 0 ]; then
    read -r -p "$1 [y/N] " reply || reply=n
  elif [ -e /dev/tty ]; then
    read -r -p "$1 [y/N] " reply < /dev/tty || reply=n
  fi
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

if [ "${1:-}" = "--uninstall" ]; then
  APPDATA="$HOME/.local/share/io.github.stektus.monti"
  AUTOSTART="$HOME/.config/autostart/monti.desktop"

  # The engine may still be running detached, keeping drives mounted.
  enginepid=""
  if [ -f "$APPDATA/engine.json" ] && have python3; then
    enginepid=$(python3 -c "import json;print(json.load(open('$APPDATA/engine.json')).get('pid',''))" 2>/dev/null || true)
  fi
  if [ -n "$enginepid" ] && kill -0 "$enginepid" 2>/dev/null \
     && grep -qs rclone "/proc/$enginepid/comm" 2>/dev/null; then
    if ask "Monti's background engine is running (drives may be mounted). Stop it and unmount?"; then
      kill "$enginepid" 2>/dev/null || true
      say "Engine stopped."
    else
      say "Engine left running — drives stay mounted."
    fi
  fi

  rm -f "$BIN" "$DESKTOP" "$AUTOSTART" \
    "$ICON_DIR/32x32/apps/monti.png" "$ICON_DIR/128x128/apps/monti.png"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

  if [ -d "$APPDATA" ]; then
    if ask "Also delete Monti's app data (bundled engine, logs, window state)?"; then
      rm -rf "$APPDATA"
      say "App data deleted."
    else
      say "App data kept at $APPDATA"
    fi
  fi
  say "Monti removed. Your rclone config (~/.config/rclone) and cloud files were not touched."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "Monti is Linux-only."
[ "$(uname -m)" = "x86_64" ] || die "Prebuilt packages are x86_64 only for now — see README 'Building from source'."
have curl || die "curl is required."

# --- FUSE3: rclone needs fusermount3 to mount drives. (The AppImage itself
# ships a static runtime and does not need libfuse2.)
if have fusermount3; then
  say "FUSE: ok"
else
  say "FUSE3 is missing — installing (your password may be asked)…"
  if have pacman; then
    sudo pacman -S --needed --noconfirm fuse3
  elif have apt-get; then
    sudo apt-get update -qq && sudo apt-get install -y fuse3
  elif have dnf; then
    sudo dnf install -y fuse3
  elif have zypper; then
    sudo zypper install -y fuse3
  else
    die "Could not detect your package manager. Install fuse3, then re-run."
  fi
fi

# --- download the latest release AppImage
say "Fetching the latest release…"
url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | cut -d'"' -f4 | head -1) || true

if [ -z "$url" ]; then
  # The API is rate-limited (60 requests/hour per IP); fall back to plain
  # release pages, which are not.
  tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest" | sed 's|.*/||')
  [ -n "$tag" ] || die "Could not reach GitHub releases — check your connection and try again."
  asset=$(curl -fsSL "https://github.com/$REPO/releases/expanded_assets/$tag" \
    | grep -o 'href="[^"]*\.AppImage"' | cut -d'"' -f2 | head -1)
  [ -n "$asset" ] || die "No AppImage found in release $tag."
  url="https://github.com$asset"
fi

mkdir -p "$APP_DIR"
say "Downloading $(basename "$url")…"
curl -fL --progress-bar -o "$BIN.part" "$url"

# --- verify against the checksums published with the release
sums_url="$(dirname "$url")/SHA256SUMS"
if sums=$(curl -fsSL "$sums_url" 2>/dev/null); then
  expected=$(printf '%s\n' "$sums" | grep " $(basename "$url")\$" | cut -d' ' -f1) || true
  if [ -z "$expected" ]; then
    say "AppImage not listed in SHA256SUMS — skipping verification."
  elif [ "$(sha256sum "$BIN.part" | cut -d' ' -f1)" != "$expected" ]; then
    rm -f "$BIN.part"
    die "Checksum mismatch — the download is corrupted or tampered with. Try again."
  else
    say "Checksum: ok"
  fi
else
  say "Checksum file not published for this release — skipping verification."
fi

mv "$BIN.part" "$BIN"
chmod +x "$BIN"

# --- menu entry + icons
say "Adding Monti to your application menu…"
mkdir -p "$ICON_DIR/32x32/apps" "$ICON_DIR/128x128/apps" "$(dirname "$DESKTOP")"
curl -fsSL -o "$ICON_DIR/32x32/apps/monti.png" \
  "https://raw.githubusercontent.com/$REPO/main/src-tauri/icons/32x32.png"
curl -fsSL -o "$ICON_DIR/128x128/apps/monti.png" \
  "https://raw.githubusercontent.com/$REPO/main/src-tauri/icons/128x128.png"

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Monti
Comment=Mount your clouds
Exec="$BIN"
Icon=monti
Terminal=false
Categories=Utility;
StartupWMClass=monti
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

say "Done! Find “Monti” in your application menu, or run: $BIN"
