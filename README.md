# ⛰️ Monti

**Mount your clouds.** Google Drive, Dropbox, OneDrive and more as regular
local folders on Linux.

No terminal, no config files. Install, click *Add cloud*, sign in through your
browser — and your cloud appears as a folder in `~/CloudDrives/`. Open it in
Dolphin, Nautilus, KeePassXC, LibreOffice — anything that works with files.

*Monti* — from **mount**, and Italian for *mountains*: the place where clouds
come down to earth.

> Status: **early beta**. Linux only, by design.

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
- Every rclone process is tied to Monti's lifetime (PDEATHSIG) — no orphan
  daemons, no stale mounts.

## Features

- Add a cloud account in two clicks (OAuth in browser, cancellable, with timeout)
- Mount / unmount; custom mount folder per drive
- Automatic mounting of chosen drives on start
- Start on login (XDG autostart) — drives ready right after you sign in
- Close to tray: the window closes, drives stay mounted
- Detects mounts made outside Monti (systemd, manual `rclone mount`),
  shows them, can unmount them, and refuses to double-mount a remote —
  two VFS caches over one remote can corrupt files
- Auto-download of the rclone engine if missing (no root)
- Transfer activity indicator; per-drive read-only mode and cache limits
- Google Drive, Dropbox, Box, pCloud, Yandex Disk (OneDrive experimental)
- Self-hosted friendly: WebDAV / Nextcloud, S3-compatible storage, SFTP

## Roadmap

- [x] Own OAuth client id wizard (rclone's shared client id is being retired in 2026)
- [x] Per-drive VFS/cache options in the UI
- [x] Transfer/cache activity indicator
- [x] WebDAV, S3-compatible and SFTP support
- [ ] Two-way sync (bisync) with a conflict-resolution UI
- [ ] Flathub package
- [ ] More providers (protondrive, …)

## Building from source

Prerequisites: [Rust](https://rustup.rs), Node.js ≥ 20, and Tauri's Linux
system deps (Arch/Manjaro: `webkit2gtk-4.1 base-devel`; Debian/Ubuntu:
`libwebkit2gtk-4.1-dev build-essential libssl-dev`). FUSE3 is required at
runtime (preinstalled on most desktop distros).

```bash
git clone https://github.com/stektus/monti.git
cd monti
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce .AppImage / .deb / .rpm in src-tauri/target/release/bundle/
```

## Contributing

Issues and PRs are welcome. The codebase is deliberately small:
`src-tauri/src/lib.rs` (engine supervisor) and `src/main.js` (UI). If you can
read those two files, you understand the whole app.

## License

[MIT](LICENSE). Monti is an independent project, not affiliated with rclone
or any cloud provider.
