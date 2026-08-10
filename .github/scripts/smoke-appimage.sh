#!/usr/bin/env bash
# Run the AppImage on other distributions and fail if its window does not draw.
#
# Two blank-window releases went out before this existed. Both had the same
# shape: a library bundled from the build machine shadowed the host's copy,
# the renderer process died, and the app kept running with an empty window.
# "It starts" therefore proves nothing — the check that matters is whether
# pixels appear, so each run ends with a screenshot and a colour count. A
# drawn interface has hundreds of distinct colours; a blank window has one or
# two.
set -euo pipefail

APPIMAGE=$(readlink -f "${1:?usage: smoke-appimage.sh <file.AppImage>}")
WORK=$(mktemp -d)
cp "$APPIMAGE" "$WORK/monti.AppImage"
chmod +x "$WORK/monti.AppImage"
trap 'rm -rf "$WORK"' EXIT

# What the bundle deliberately leaves to the host — the graphics stack, fonts
# and a handful of small libraries its own copies of GTK and WebKit link
# against — plus an X server to draw into and ImageMagick to look at the
# result. A container is barer than any desktop, so this list is the price of
# testing somewhere the app was not built.
HOST_DEB="libgl1 libegl1 libgbm1 libdrm2 libfontconfig1 libfreetype6 \
libwayland-client0 libx11-6 libx11-xcb1 libxcb1 libharfbuzz0b libfribidi0 \
libexpat1 libgpg-error0 libgmp10 libcom-err2 zlib1g"
TOOLS_DEB="fonts-dejavu-core xvfb imagemagick procps"
HOST_RPM="mesa-libGL mesa-libEGL mesa-dri-drivers fontconfig freetype libX11 \
libxcb libwayland-client harfbuzz fribidi expat libgpg-error gmp libcom_err \
dejavu-sans-fonts"
HOST_ARCH="mesa libglvnd wayland fontconfig freetype2 libx11 libxcb harfbuzz \
fribidi expat libgpg-error gmp krb5 ttf-dejavu"

run_one() {
  local name=$1 image=$2 install=$3
  echo "::group::smoke: $name"
  if docker run --rm -v "$WORK:/w:ro" "$image" bash -euc "
    $install
    export DISPLAY=:99
    Xvfb :99 -screen 0 1200x860x24 >/dev/null 2>&1 &
    sleep 3
    cd /tmp
    /w/monti.AppImage --appimage-extract-and-run > /tmp/app.log 2>&1 &
    sleep 25

    if grep -qiE 'EGL_BAD|Aborting\.\.\.|panicked|error while loading' /tmp/app.log; then
      echo 'fatal error on startup:'; cat /tmp/app.log; exit 1
    fi
    pgrep -f WebKitWebProcess >/dev/null || {
      echo 'the render process is not running:'; cat /tmp/app.log; exit 1; }

    if command -v magick >/dev/null; then IM='magick'; else IM=''; fi
    \$IM import -window root -silent /tmp/shot.png 2>/dev/null || \
      \$IM import -window root /tmp/shot.png
    colours=\$(\$IM identify -format '%k' /tmp/shot.png)
    echo \"distinct colours on screen: \$colours\"
    [ \"\$colours\" -ge 50 ] || {
      echo 'the window is blank — nothing was drawn'; cat /tmp/app.log; exit 1; }
  "; then
    echo "  $name: ok"
  else
    echo "::error::AppImage does not work on $name"
    echo "::endgroup::"
    return 1
  fi
  echo "::endgroup::"
}

fail=0
run_one "Debian 12"    debian:12         "apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y libgtk-3-0 $HOST_DEB $TOOLS_DEB >/dev/null" || fail=1
run_one "Ubuntu 24.04" ubuntu:24.04      "apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y libgtk-3-0t64 $HOST_DEB $TOOLS_DEB >/dev/null" || fail=1
run_one "Fedora 42"    fedora:42         "dnf -y -q install gtk3 $HOST_RPM xorg-x11-server-Xvfb ImageMagick procps-ng >/dev/null" || fail=1
run_one "Arch"         archlinux:latest  "pacman -Sy --noconfirm --needed --quiet gtk3 $HOST_ARCH xorg-server-xvfb imagemagick procps-ng >/dev/null" || fail=1

if [ "$fail" != 0 ]; then
  echo "smoke test failed — not publishing this build"
  exit 1
fi
echo "the AppImage draws its window on every distribution tested"
