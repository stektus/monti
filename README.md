# ⛰️ Monti

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)](#)
[![Powered by rclone](https://img.shields.io/badge/powered%20by-rclone-3f79ad)](https://rclone.org)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

**Mount your clouds.** Google Drive, Dropbox, OneDrive and more as regular
local folders on Linux.

No terminal, no config files. Install, click *Add cloud*, sign in through your
browser — and your cloud appears as a folder in `~/CloudDrives/`. Open it in
Dolphin, Nautilus, KeePassXC, LibreOffice — anything that works with files.

*Monti* — from **mount**, and Italian for *mountains*: the place where clouds
come down to earth.

> Status: **early beta**. Linux only, by design.

![Monti — your clouds as drive cards](docs/screenshot-main.png)

## Why

There is no official Google Drive client for Linux. The community's workhorse,
[rclone](https://rclone.org), is superb — but it lives in the terminal.
Existing GUIs are either abandoned (rclone-browser), sync-only (Celeste) or
paid (Insync). Monti aims to be the missing piece: a small, native-feeling,
free GUI that does **mounting** first and does it well.

## How it works

```
┌────────────────────┐   JSON-RPC (localhost)   ┌──────────────┐
│   Monti (Tauri)    │ ───────────────────────▶ │  rclone rcd  │──▶ FUSE mounts
│  GUI + supervisor  │ ◀─────────────────────── │   (engine)   │──▶ cloud APIs
└────────────────────┘    status / progress     └──────────────┘
```

- Monti spawns `rclone rcd` (rclone's daemon mode) with a random port and
  random credentials, and drives it over its JSON API.
- If rclone isn't installed, Monti downloads the official build into its own
  data directory — no root needed.
- OAuth happens in **your** browser via rclone's standard flow; Monti never
  sees your cloud password.
- Mounts use `--vfs-cache-mode full`, so apps that save files in place
  (KeePassXC, office suites) work correctly.
- The engine is a separate background process. With *Keep drives mounted
  after quitting* on (the default), closing Monti leaves your folders
  working; on the next start Monti verifies the daemon's identity
  (pid + start time + port ownership) and reconnects to it. With the
  option off, quitting stops the engine — after draining pending uploads.
- A health probe watches the engine; if it dies, Monti shows a warning
  and restores all mounts with their exact options on one click.

## Features

- Add a cloud account in two clicks (OAuth in browser, cancellable, with timeout)
- Mount / unmount; custom mount folder per drive
- Automatic mounting of chosen drives on start
- Start on login (XDG autostart) — drives ready right after you sign in
- Close to tray: the window closes, drives stay mounted
- Keep drives mounted after quitting — the engine stays in the
  background and Monti picks it up again on next start
- Detects mounts made outside Monti (systemd, manual `rclone mount`),
  shows them, can unmount them, and refuses to double-mount a remote —
  two VFS caches over one remote can corrupt files
- Auto-download of the rclone engine if missing (no root)
- Transfer activity indicator; per-drive read-only mode and cache limits
- Google Drive, Dropbox, Box, pCloud, Yandex Disk (OneDrive experimental)
- Self-hosted friendly: WebDAV / Nextcloud, S3-compatible storage, SFTP

## Roadmap

- [x] Own OAuth client id wizard (rclone's shared client id is being retired in 2026)
- [x] Per-drive VFS/cache options in the UI (read-only, cache limits)
- [x] Transfer/cache activity indicator
- [x] WebDAV, S3-compatible and SFTP support
- [x] One-command install script for any distro
- [ ] AUR package
- [ ] Flathub package
- [ ] Two-way sync (bisync) with a conflict-resolution UI
- [ ] Translations (Ukrainian, Russian, …)
- [ ] More providers (Proton Drive, Mega, …)

## Install

One command, any distro:

```bash
curl -fsSL https://raw.githubusercontent.com/stektus/monti/main/install.sh | bash
```

It checks FUSE (installs it via your package manager if missing), downloads
the latest release and adds Monti to your application menu. Everything goes
to your home directory — no root files touched. The same script from a
clone: `./install.sh`. Uninstall: `./install.sh --uninstall` (or add
`-s -- --uninstall` to the curl command above).

Prefer packages? Grab them from the
[latest release](https://github.com/stektus/monti/releases/latest):

- **`.AppImage`** — any distro: `chmod +x Monti_*.AppImage && ./Monti_*.AppImage`
- **`.deb`** — Debian / Ubuntu / Mint: `sudo apt install ./Monti_*.deb`
- **`.rpm`** — Fedora: `sudo dnf install ./Monti_*.rpm`, openSUSE: `sudo zypper install ./Monti_*.rpm`

A `SHA256SUMS` file is published with each release; the install script
verifies the download against it automatically.

FUSE3 is required at runtime (preinstalled on most desktop distros).
Arch/Manjaro users: the AppImage works fine; an AUR package is planned.
Prebuilt packages are x86_64 only for now — on arm64, build from source.

## Building from source

Prerequisites: [Rust](https://rustup.rs), Node.js ≥ 20, and Tauri's Linux
system deps:

- Arch/Manjaro: `sudo pacman -S --needed base-devel webkit2gtk-4.1 libayatana-appindicator`
- Debian/Ubuntu: `sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf`

`npm run tauri dev` works without the appindicator library (the tray is
simply off), but `npm run tauri build` needs it to bundle. FUSE3 is
required at runtime (preinstalled on most desktop distros).

```bash
git clone https://github.com/stektus/monti.git
cd monti
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce .AppImage / .deb / .rpm in src-tauri/target/release/bundle/
```

## Contributing

Issues and PRs are welcome. The codebase is deliberately small:
`src-tauri/src/engine.rs` (daemon lifecycle), `src-tauri/src/lib.rs`
(commands and tray) and `src/main.js` (UI). If you can read those three
files, you understand the whole app.

## License

[MIT](LICENSE). Monti is an independent project, not affiliated with rclone
or any cloud provider.
