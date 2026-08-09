# Changelog

Notable changes per release. Dates are the release date.

## v0.4.3 — 2026-08-09

**Folders and links open again.** Two separate faults, both reported by a user
on KDE Plasma 6:

- *Open config folder* failed everywhere with "Not allowed to open path" — the
  permission scope did not cover hidden directories like `~/.config/rclone`.
- Folders and links did nothing at all in AppImage builds: the bundle ships
  `xdg-open` 1.1.3 and puts its own `bin` first on `PATH`, and that version's
  KDE branch knows session versions 4 and 5 only. On Plasma 6 it matched
  nothing, ran no command and reported success — so failure was silent.

Both now go through Monti's own commands, which run the system `xdg-open` with
the AppImage's entries stripped from `PATH`. Folders open only as directories
and links only over `https`, so neither can be turned into "execute this".

**Cache you can see and control.** A mount's disk cache growing until the disk
is full is the oldest complaint about rclone mounts, and Monti forces full
caching so apps can save files in place. So:

- every drive gets a cache limit by default — a tenth of the free space, kept
  between 1 and 20 GB — instead of rclone's unbounded default;
- each drive card shows how much it has cached;
- drive settings show the size and offer **Clear cache** (refused while the
  drive is mounted, since rclone is using those files);
- Settings gained a **Storage** section: cached total, free space, the default
  limit, and a warning when the disk is nearly gone.

**Dialogs that belong to the app.** Confirmations were drawn by the system with
a "JavaScript - tauri://localhost" title, which reads as an error exactly when
someone is deciding on something irreversible. They are now Monti's own dialogs:
the safe answer holds focus, Esc cancels, and destructive buttons are marked.

Removing a drive asks once instead of twice — the dialog lists what will happen,
including the mount folder it deletes (previously silent), and clearing the
cache is a checkbox in the same dialog rather than a question asked afterwards.

**Also:** removed the `tauri-plugin-opener` dependency; project documentation
for contributors (`CONTRIBUTING.md`, `SECURITY.md`, issue and pull-request
templates); a rewritten README with screenshots.

## v0.4.2 — 2026-08-08

- The daemon-identity check now covers IPv6 sockets and decides ownership from
  the process's own file descriptors, with a test proving a bystander process is
  never mistaken for ours.

## v0.4.1 — 2026-08-07

- Removing a cloud now also removes the empty mount folder it created, and
  `~/CloudDrives` itself once the last drive is gone.
- The release workflow deletes superseded releases and their tags, keeping one
  current release.

## v0.4.0 — 2026-08-07

The stabilization release: the architectural work behind everything above.

- Configuration and OAuth moved to rclone's API state machine — no engine
  restart when adding a cloud, so other drives are never dropped mid-setup, and
  no secrets in the process list.
- The engine survives quitting Monti, and is re-adopted on the next start only
  after matching pid, process start time and ownership of its port.
- Health check with one-click recovery that restores every mount with its exact
  options.
- Uploads are checked before unmounting and before quitting.
- Client secrets no longer reach the interface; the engine state file is `0600`
  from creation.
- The rclone download is verified against the official checksums and installed
  atomically, with progress.
- One-command installer with checksum verification and a complete uninstall.
