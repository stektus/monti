# ☁️ Mountie

**Mount Google Drive, Dropbox, OneDrive and more as regular local folders on Linux.**

No terminal, no config files. Install, click *Add cloud*, sign in through your
browser — and your cloud appears as a folder in `~/CloudDrives/`. Open it in
Dolphin, Nautilus, KeePassXC, LibreOffice — anything that works with files.

> Status: **early MVP**. Linux only (by design). Name is provisional.

## Why

There is no official Google Drive client for Linux. The community's workhorse,
[rclone](https://rclone.org), is superb — but it lives in the terminal.
Existing GUIs are either abandoned (rclone-browser), sync-only (Celeste) or
paid (Insync). Mountie aims to be the missing piece: a small, native-feeling,
free GUI that does **mounting** first and does it well.

## How it works

```
┌────────────────────┐   JSON-RPC (localhost)   ┌──────────────┐
│  Mountie (Tauri)   │ ───────────────────────▶ │  rclone rcd  │──▶ FUSE mounts
│  GUI + supervisor  │ ◀─────────────────────── │   (engine)   │──▶ cloud APIs
└────────────────────┘    status / progress     └──────────────┘
```

- Mountie spawns `rclone rcd` (rclone's daemon mode) with a random port and
  random credentials, and drives it over its JSON API.
- If rclone isn't installed, Mountie downloads the official build into its own
  data directory — no root needed.
- OAuth happens in **your** browser via rclone's standard flow; Mountie never
  sees your cloud password.
- Mounts use `--vfs-cache-mode full`, so apps that save files in place
  (KeePassXC, office suites) work correctly.

## Features (v0.1)

- [x] Add a cloud account in two clicks (OAuth in browser)
- [x] Mount / unmount to `~/CloudDrives/<name>`
- [x] Auto-download of the rclone engine if missing
- [x] Open mounted folder in your file manager
- [x] Google Drive, Dropbox, Box, pCloud, Yandex Disk (OneDrive experimental)
- [x] Detects mounts made outside Mountie (systemd, manual `rclone mount`)
  and refuses to double-mount a remote — two VFS caches can corrupt files
- [x] Remounts your drives automatically when the app starts

## Roadmap

- [ ] Autostart on login (tray app)
- [ ] System tray
- [ ] Custom mount points and per-remote VFS options
- [ ] Own OAuth client id wizard (rclone's shared client id is being retired in 2026)
- [ ] Two-way sync (bisync) with a conflict-resolution UI
- [ ] Flathub package
- [ ] More providers (WebDAV, S3, SFTP, …)

## Building from source

Prerequisites: [Rust](https://rustup.rs), Node.js ≥ 20, and Tauri's Linux
system deps (Arch/Manjaro: `webkit2gtk-4.1 base-devel`; Debian/Ubuntu:
`libwebkit2gtk-4.1-dev build-essential libssl-dev`). FUSE3 is required at
runtime (preinstalled on most desktop distros).

```bash
npm install
npm run tauri dev      # run in development
npm run tauri build    # produce .AppImage / .deb / .rpm in src-tauri/target/release/bundle/
```

## Contributing

Issues and PRs are welcome. The codebase is deliberately small:
`src-tauri/src/lib.rs` (engine supervisor, ~350 lines) and `src/main.js`
(UI, ~200 lines). If you can read those two files, you understand the whole app.

## License

[MIT](LICENSE). Mountie is an independent project, not affiliated with rclone
or any cloud provider.
