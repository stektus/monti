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

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN" "$DESKTOP" \
    "$ICON_DIR/32x32/apps/monti.png" "$ICON_DIR/128x128/apps/monti.png"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  say "Monti removed. Your rclone config and cloud data were not touched."
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
url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | cut -d'"' -f4 | head -1)
[ -n "$url" ] || die "No AppImage found in the latest release."

mkdir -p "$APP_DIR"
say "Downloading $(basename "$url")…"
curl -fL --progress-bar -o "$BIN.part" "$url"
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
