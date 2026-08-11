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
    if ask "Also delete Monti's app data (bundled engine, logs, synced-folder list)?"; then
      rm -rf "$APPDATA"
      say "App data deleted."
    else
      say "App data kept at $APPDATA"
    fi
  fi

  # The cached copies of opened files. This is the big one — a mounted drive
  # keeps what you opened, so it can be tens of gigabytes, and it lives in
  # rclone's cache directory rather than Monti's.
  VFS_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/rclone/vfs"
  if [ -d "$VFS_CACHE" ]; then
    size=$(du -sh "$VFS_CACHE" 2>/dev/null | cut -f1)
    if ask "Delete ${size:-the} cached file copies in $VFS_CACHE? (they are copies; the originals are in your cloud)"; then
      rm -rf "$VFS_CACHE"
      say "Cached copies deleted."
    else
      say "Cached copies kept at $VFS_CACHE"
    fi
  fi

  # What bisync remembers about each synced pair. Small, but it is Monti's
  # litter and nothing else reads it.
  BISYNC="${XDG_CACHE_HOME:-$HOME/.cache}/rclone/bisync"
  [ -d "$BISYNC" ] && rm -rf "$BISYNC" && say "Sync state cleared."

  # Mount folders, but only the empty ones: a folder with files in it is
  # either not ours or holds something that never reached the cloud.
  if [ -d "$HOME/CloudDrives" ]; then
    find "$HOME/CloudDrives" -mindepth 1 -maxdepth 1 -type d -empty -exec rmdir {} + 2>/dev/null || true
    rmdir "$HOME/CloudDrives" 2>/dev/null && say "Removed the empty ~/CloudDrives."
    [ -d "$HOME/CloudDrives" ] && say "~/CloudDrives kept — it still has files in it."
  fi

  say "Monti removed. Your rclone config (~/.config/rclone) and everything in your clouds were not touched."
  exit 0
fi

[ "$(uname -s)" = "Linux" ] || die "Monti is Linux-only."

# Releases carry one AppImage per architecture; pick this machine's.
case "$(uname -m)" in
  x86_64)          asset_arch='(x86_64|amd64)' ;;
  aarch64 | arm64) asset_arch='(aarch64|arm64)' ;;
  *) die "no prebuilt package for $(uname -m) — see README 'Building from source'." ;;
esac
have curl || die "curl is required."

# --- the AppImage carries its own GTK and WebKit but takes the C library and
# the graphics stack from the system, as an AppImage should. Checking that
# here turns "error while loading shared libraries" — or, when started from
# the applications menu, a window that never appears — into a sentence that
# says what to do.
newer_or_same() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$2" ]; }

glibc=$(ldd --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)
if [ -n "$glibc" ] && ! newer_or_same "$glibc" 2.35; then
  die "your C library is glibc $glibc and Monti needs 2.35 or newer.
        Supported: Ubuntu 22.04+, Debian 12+, Fedora 36+, openSUSE Tumbleweed,
        Arch and derivatives. On an older system, build from source — see the
        README."
fi

ldc=$(command -v ldconfig || echo /sbin/ldconfig)
if [ -x "$ldc" ]; then
  # Read the cache once. Piping it into grep per library makes ldconfig die
  # of SIGPIPE the moment grep is satisfied, and under `pipefail` that reads
  # as "not found" for whichever libraries happen to match early.
  cache=$("$ldc" -p 2>/dev/null || true)
  # Everything the bundle's ELF headers ask for and does not carry itself,
  # minus the ones no system can be missing (libc, libm, the loader).
  missing=""
  for lib in libGL.so.1 libEGL.so.1 libgbm.so.1 libdrm.so.2 libX11.so.6 \
             libxcb.so.1 libX11-xcb.so.1 libwayland-client.so.0 \
             libfontconfig.so.1 libfreetype.so.6 libharfbuzz.so.0 \
             libfribidi.so.0 libexpat.so.1 libgpg-error.so.0 libgmp.so.10 \
             libcom_err.so.2 libstdc++.so.6 libz.so.1; do
    case "$cache" in *"$lib"*) ;; *) missing="$missing $lib" ;; esac
  done
  if [ -n "$missing" ]; then
    say "These system libraries are missing:$missing"
    say "Every desktop ships them; on a minimal install, add your distribution's"
    say "Mesa, X11 and fontconfig packages. Monti will not start without them."
    ask "Install Monti anyway?" || exit 1
  else
    say "System libraries: ok"
  fi
fi

# --- FUSE3: rclone needs fusermount3 to mount drives. (The AppImage itself
# ships a static runtime and does not need libfuse2.)
if have fusermount3; then
  say "FUSE: ok"
else
  say "FUSE3 is missing — Monti needs it to mount drives."
  if ! ask "Install fuse3 with your package manager (uses sudo)?"; then
    die "FUSE3 is required. Install the fuse3 package yourself, then re-run."
  fi
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
  | grep -o '"browser_download_url": *"[^"]*\.AppImage"' | cut -d'"' -f4 \
  | grep -E "$asset_arch" | head -1) || true

if [ -z "$url" ]; then
  # The API is rate-limited (60 requests/hour per IP); fall back to plain
  # release pages, which are not.
  tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest" | sed 's|.*/||')
  [ -n "$tag" ] || die "Could not reach GitHub releases — check your connection and try again."
  asset=$(curl -fsSL "https://github.com/$REPO/releases/expanded_assets/$tag" \
    | grep -o 'href="[^"]*\.AppImage"' | cut -d'"' -f2 | grep -E "$asset_arch" | head -1)
  [ -n "$asset" ] || die "No AppImage for $(uname -m) in release $tag."
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
