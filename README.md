# ⛰️ Monti

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)](#)
[![Powered by rclone](https://img.shields.io/badge/powered%20by-rclone-3f79ad)](https://rclone.org)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)

**Mount your clouds.** Your Google Drive, Dropbox or OneDrive becomes a normal
folder on your Linux desktop — open it in your file manager, edit files, save
them. No terminal, no config files, no sync folder eating your disk.

![Monti — your clouds as drive cards](docs/screenshot-main.png)

*Monti* — from **mount**, and Italian for *mountains*: the place where clouds
come down to earth.

> Status: **early beta.** Linux only, by design. It works, and it is honest
> about what it does — but expect rough edges and please report them.

## The problem

Google has never shipped a Drive client for Linux, and the alternatives all ask
for something:

| | |
|---|---|
| **Sync clients** (Insync, overGrive) | download a second copy of everything onto your disk, and cost money |
| **The web interface** | no normal "open, edit, save" — you download, edit, re-upload |
| **rclone** | excellent and free, but it lives in the terminal: config wizards, mount flags, systemd units |

[rclone](https://rclone.org) already solves the hard part. What was missing is
a way to use it without becoming an rclone expert. That is Monti.

## What Monti does

- **Your cloud is a folder.** It appears in `~/CloudDrives/`, and every app —
  Dolphin, Nautilus, LibreOffice, KeePassXC — treats it like any other folder.
- **Nothing is downloaded until you open it.** No full copy of your cloud on
  disk; files arrive when you actually open them.
- **Sign in through your browser**, the way you expect. Monti never sees your
  password.
- **Your drives survive quitting the app.** Close Monti and your folders keep
  working; it reconnects to its background engine on the next start.
- **It tells you the truth.** How much disk the cache is using, what a button
  is about to delete, and when something is still uploading.

## Screenshots

| | |
|---|---|
| ![Add a cloud](docs/screenshot-add-cloud.png) | **Adding a cloud** — pick a provider, give it a name, sign in. The API-key wizard is there when you want it, folded away when you don't. |
| ![Drive settings](docs/screenshot-drive-settings.png) | **Per-drive settings** — where it mounts, whether it mounts on start, read-only mode, cache limit, and how much this drive has cached right now. |
| ![Storage](docs/screenshot-storage.png) | **Storage** — what the cache costs you and how much room is left, because a cache that quietly fills the disk is the classic way rclone mounts go wrong. |
| ![Disconnecting a drive](docs/screenshot-disconnect.png) | **Removing a drive** — the dialog lists exactly what happens, including the folder it deletes, and lets you clear the cache in the same click. |

## Pain points this closes

Monti was built around the things that actually go wrong with rclone mounts:

- **The cache eating your disk.** Mounts need a full disk cache to let apps save
  files in place. Left unbounded, it grows until the disk is gone — the single
  most common rclone-mount complaint. Monti gives every drive a sane limit by
  default, shows the size on the card, and lets you clear it in one click.
- **Files that save "successfully" but never arrive.** Unmounting while uploads
  are queued is silent data loss. Monti checks before unmounting and before
  quitting, and says so plainly.
- **Drives disappearing when you close the window.** The engine runs
  independently, and Monti re-adopts it — after verifying it really is the
  process it left behind, not something else on the same port.
- **A dead engine looking like a broken cloud.** A health check spots it within
  seconds and restores every mount, with its exact options, on one click.
- **Two mounts of one remote corrupting files.** Monti refuses to double-mount,
  and shows mounts made outside itself instead of ignoring them.
- **rclone's shared API key being retired during 2026.** Monti walks you through
  creating your own key, including the test-user step that trips up most people.

## Install

One command, any distro:

```bash
curl -fsSL https://raw.githubusercontent.com/stektus/monti/main/install.sh | bash
```

It checks FUSE (offers to install it), downloads the latest release, verifies it
against the published checksums and adds Monti to your application menu.
Everything lands in your home directory — no root files touched.
Uninstall with `./install.sh --uninstall`.

Prefer packages? Grab them from the
[latest release](https://github.com/stektus/monti/releases/latest):

| Package | For | On disk |
|---|---|---|
| `.AppImage` | any distro — `chmod +x` and run | ~80 MB |
| `.deb` | Debian, Ubuntu, Mint | ~18 MB |
| `.rpm` | Fedora, openSUSE | ~18 MB |

The AppImage carries its own copy of the desktop libraries, which is why it is
larger; the packages use the ones your system already has.

FUSE3 is required at runtime (preinstalled on most desktop distros). Prebuilt
packages are x86_64 only for now — on arm64, build from source. If rclone is not
installed, Monti downloads the official build into its own folder; no root
needed.

## How it works

```
┌────────────────────┐   JSON-RPC (localhost)   ┌──────────────┐
│   Monti (Tauri)    │ ───────────────────────▶ │  rclone rcd  │──▶ FUSE mounts
│  GUI + supervisor  │ ◀─────────────────────── │   (engine)   │──▶ cloud APIs
└────────────────────┘    status / progress     └──────────────┘
```

- Monti spawns `rclone rcd` (rclone's daemon mode) on a random port with random
  credentials and drives it over its JSON API. The credentials never reach the
  browser side of the app, and never appear in the process list.
- Mounts always run with `--vfs-cache-mode full`, because apps that save files
  in place (KeePassXC, office suites) corrupt them otherwise.
- The engine is a separate background process. With *Keep drives mounted after
  quitting* on (the default), closing Monti leaves your folders working; on the
  next start Monti verifies the daemon's identity — pid, start time and actual
  ownership of the port — before reconnecting or sending anything to it.
- OAuth happens in your browser through rclone's own flow, driven over the API
  so no engine restart is needed and no drive gets dropped mid-setup.

## Supported clouds

Google Drive, Dropbox, Box, pCloud, Yandex Disk, OneDrive (experimental), and
self-hosted storage: WebDAV / Nextcloud, S3-compatible, SFTP.

## Roadmap

- [x] Own OAuth client-id wizard (rclone's shared key is being retired in 2026)
- [x] Per-drive cache limits, read-only mode, cache cleanup
- [x] Transfer activity indicator and engine health recovery
- [x] WebDAV, S3-compatible and SFTP support
- [x] One-command install script with checksum verification
- [ ] Cloud storage quota on each drive card
- [ ] Bandwidth limit and desktop notifications
- [ ] AUR and Flathub packages
- [ ] Two-way sync (bisync) with a conflict-resolution UI
- [ ] Translations (Ukrainian, Russian, …)
- [ ] More providers (Proton Drive, Mega, …)

## Building from source

Prerequisites: [Rust](https://rustup.rs), Node.js ≥ 20, and Tauri's Linux system
dependencies:

- Arch/Manjaro: `sudo pacman -S --needed base-devel webkit2gtk-4.1 libayatana-appindicator`
- Debian/Ubuntu: `sudo apt install build-essential libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf`

```bash
git clone https://github.com/stektus/monti.git
cd monti
npm install
npm run tauri dev      # run in development
npm run tauri build    # .AppImage / .deb / .rpm in src-tauri/target/release/bundle/
```

`npm run tauri dev` works without the appindicator library (the tray is simply
off), but `npm run tauri build` needs it to bundle.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
The codebase is deliberately small: `src-tauri/src/engine.rs` (daemon
lifecycle), `src-tauri/src/lib.rs` (commands and tray) and `src/main.js` (UI).
If you can read those three files, you understand the whole app.

## License

[MIT](LICENSE). Monti is an independent project, not affiliated with rclone or
any cloud provider.
