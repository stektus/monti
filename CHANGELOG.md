# Changelog

Notable changes per release. Dates are the release date.

## v0.5.0 — 2026-08-10

**Every drive shows how full the cloud is.** A bar and a line — "127 GB of
916 GB used in the cloud" — read straight from the provider, so you learn
you are out of space in Monti rather than from a failed upload.

**Monti warns before the disk fills up.** Mounted drives cache what you open;
when free space on this computer drops below 2 GB, a banner says so and points
at the cache limits.

**Speed limit.** Settings → Transfers caps how fast Monti uploads and
downloads, so a big transfer does not take the whole connection. The limit is
applied immediately and put back after every engine restart — rclone keeps it
only in memory, so it would otherwise vanish silently.

**Recent transfers.** The same screen lists what the engine has moved since it
started, with sizes, and marks failures.

**Desktop notifications for the two things you cannot see from another
window**: the engine stopping and the disk running out. Switch them off in
Settings. A machine with no notification daemon at all — a bare window manager
without dunst or mako — is not a problem: the message is always in the window
too, and the reason is written to the log.

**Monti notices when a drive disappears.** Something unmounts your folder
outside Monti — `fusermount -u`, a mount that dies — and the engine still
reports it as mounted, so the drive looked fine while the folder was empty.
Monti now asks the kernel, says which drive went, and offers to mount it back.

**Auto-mounted drives survive a slow network.** Starting at login used to mean
racing NetworkManager: the cloud was unreachable for a few seconds, the mount
failed, and that was that. Monti now retries for about four minutes and says
what it is doing.

**`--version` and `--help`.** They print a line and exit instead of opening a
window, which is what a bug report needs.

**The README explains the manual install** for anyone who would rather not
pipe a script into bash — download, verify the checksum, run.

## v0.4.6 — 2026-08-10

**Every release is now launched on other distributions before it ships.** The
blank window in v0.4.3 and v0.4.4 was found by a user, twice, because nothing
in the build ever started the app anywhere except the machine that compiled
it. Releases now run the finished AppImage on Debian 12, Ubuntu 24.04,
Fedora 42 and Arch, take a screenshot in each, and refuse to publish if the
window is blank — a drawn interface has hundreds of distinct colours, an empty
one has two, so the check needs no eyes.

**No host library can be bundled by accident again.** Instead of removing the
one library that caused the last failure, the build now strips every library
that must come from the host — the vendored AppImage community list — and
fails if any survives into the image.

**The installer checks before it installs.** It compares your glibc against
the 2.35 the packages need and looks for the system libraries the AppImage
expects, so an unsupported system produces a sentence explaining that instead
of `error while loading shared libraries` — or, from a menu launcher, silence.

Verified on Debian 11 (correctly refused), Debian 12, Ubuntu 24.04, Fedora 42
and Arch, running the published build in a container of each distribution.

## v0.4.5 — 2026-08-09

**The real fix for the blank AppImage window.** v0.4.4 addressed a different
cause and did not help the person who reported it, so here is what was actually
happening: the AppImage shipped its own `libwayland-client` from the build
machine (Ubuntu 22.04, wayland 1.20) and put it ahead of the system's. Mesa's
EGL driver imports three symbols added in wayland 1.23 —
`wl_display_create_queue_with_name`, `wl_display_dispatch_queue_timeout`,
`wl_fixes_interface` — so on any host with a current Mesa, `eglInitialize`
failed, WebKit aborted with `EGL_BAD_PARAMETER`, and the window came up white.
Nothing the user could set worked around it, because no WebKit option can
supply a missing symbol.

The library is no longer bundled — every desktop that can run a GTK app already
has it — and the release build fails if it ever comes back.

**Monti now logs from its first line**, with version, session type and display
server. The blank-window reports had empty log folders, because the log only
started once something touched a drive.

Root-caused from a Manjaro user's report; reproduced locally by forcing the
same EGL path, and the repacked build verified in the environment that failed.

## v0.4.4 — 2026-08-09

**Fixes a blank window on many Linux setups.** WebKitGTK renders through DMABUF
by default, and where that path cannot create an EGL display — NVIDIA's
proprietary driver, hybrid graphics, virtual machines, some Mesa builds — it
does not fall back: it prints `Could not create default EGL display:
EGL_BAD_PARAMETER` and the window comes up white, or the process aborts. Monti
now selects software compositing before the webview starts, which costs nothing
worth measuring for a page of static cards. Set
`WEBKIT_DISABLE_DMABUF_RENDERER=0` to ask for the accelerated path back.

Reported by a Manjaro user on a fresh install.

Also: a troubleshooting section in the README covering blank windows, a missing
tray icon, and drives mounted outside Monti.

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
