# Changelog

Notable changes per release. Dates are the release date.

## v0.7.4 — 2026-08-12

**The window stops locking up while Monti does its housekeeping.** A command
that Tauri runs synchronously runs on the thread that draws the window, and
sixteen of Monti's did: measuring a drive's cache walks every file in it,
clearing it deletes them, and the window could do nothing at all meanwhile —
buttons included. They now run on a worker thread, where they belong.

Two things people hit that are *not* Monti, written down under
[If something goes wrong](README.md#if-something-goes-wrong) rather than left
to be rediscovered: the title-bar buttons that ignore clicks on Wayland (a
bug one layer down, already fixed upstream in tao 0.36 and waiting for a
Tauri release that carries it), and the file manager freezing for seconds
inside a cloud folder — that is the provider answering "how much space is
free", and on Google Drive through rclone's shared API key it was measured at
17 seconds against 0.3 with an own key.

## v0.7.3 — 2026-08-12

**A drive's folder is no longer a trap when the drive is away.** Save a
document into `~/CloudDrives/gdrive` while Monti is not running and, until
now, nothing objected: the file went to the local disk, never reached the
cloud, and the next mount failed outright — FUSE will not mount over a folder
with anything in it, so one stray file took the drive out of service. The
folder is now left read-only whenever the drive is not mounted, so that save
fails where it can still be acted on. Looking inside it still works, and
Monti opens it up again for the moment of mounting.

**The tray stays a menu, not a second window.** With more than eight drives
it shows the first eight — mounted ones first, since unmounting is what a
click is worth — then *All N drives in Monti…*. The status line counts
(*Engine running · 3 of 50 mounted*), and when several drives are up there is
one **Unmount all** — the thing worth having before undocking or suspending.
A drive still uploading refuses and says so; the rest come down.

**The Arch package installs the tray library.** `libayatana-appindicator` was
an optional dependency, which meant the tray silently did not exist unless the
person knew to install it. The `.deb` and `.rpm` always required it; now the
`PKGBUILD` does too, and the AppImage carries its own copy.

## v0.7.2 — 2026-08-12

**Starting with the session no longer opens a window.** *Start Monti on login*
existed to get your drives up, and instead it put a window in front of whatever
you were about to do. The autostart entry now runs Monti with `--hidden`: the
drives mount, the window stays closed. Opening it afterwards is the tray icon,
or simply starting Monti again — the second launch shows the window of the one
already running, as it always did.

**A second Monti no longer loses the engine's mount list.** Two instances that
overlap for a moment — one starting as another quits — wrote the engine file
through the same temporary name, and whichever renamed second found it gone:
`failed to save engine.json: No such file or directory`, leaving a stale list
of mounts behind. The temporary name now carries the process id.

## v0.7.1 — 2026-08-11

**Paths read the right way round again.** A drive card shows its folder
truncated from the left, so the end — the part that says which folder it is —
always survives. The trick that does the truncating also dragged the leading
`/` to the other end, so `/home/you/CloudDrives/gdrive` came out as
`home/you/CloudDrives/gdrive/`. Same for file names in the transfer list.

## v0.7.0 — 2026-08-11

**Choose which folders a drive carries.** A cloud with 2 TB in it does not
belong on a laptop. Drive settings and sync settings now open a picker of the
cloud's own folders; unticked ones are left out — the mount does not show
them, the sync does not compare them, and the cloud keeps them untouched.

Changing the folders of a pair that already syncs sends it through the first
run again, on purpose: bisync compares each run against its own listing from
last time, so folders that vanish behind a new filter read as deletions —
and answering Monti's delete question would then wipe them from the cloud.
The first run rebuilds the listing instead, and never deletes.

**Encrypted drives.** A new kind of drive that lives inside one you already
have, encrypting file contents *and names* before they leave this computer.
Use it like any other drive: mount it, sync with it, leave folders out of it.
There is no password recovery, which the dialog says before it lets you
create one, and rclone stores that password obscured — reversible — in its
config file, which the dialog also says.

**The tray finally says something.** Whether the engine is running, and one
click to mount or unmount each drive without opening the window.

**Errors in words that mean something.** "googleapi: Error 403: The user's
Drive storage quota has been exceeded., storageQuotaExceeded" now leads with
"the cloud is full", a rate limit says so instead of looking like the same
error, an expired sign-in points at Re-authorize, and an unreachable provider
says that. The provider's own sentence is kept underneath — a bug report
needs it, and a wrong guess must not hide the truth.

**Also:** a **Browse…** button beside the two path fields; **Share a file**
on drives whose provider makes links (absent on those that do not); the first
sync says how much it will download and how much room is left before it
starts; and a drive mounted by Monti no longer shows as "not mounted" when
rclone reports it under a path instead of a name.

## v0.6.0 — 2026-08-11

**Synced folders.** A new Sync screen keeps a folder on this computer and a
folder in the cloud the same, in both directions — the arrangement people
install Dropbox for. It is the other half of what a mounted drive does: a
mount is the whole cloud with nothing on disk and nothing without a network; a
synced folder is a real copy that works on a train and catches up afterwards.

The hard parts are the ones this is careful about:

- **The first sync asks.** It is the only run that can overwrite a file with
  the other side's version, so Monti asks which side wins instead of guessing.
- **A conflict never deletes.** When the same file changed in both places the
  newer one keeps the name and the other is kept beside it, and the pair's card
  offers three plain answers: keep this one, keep that one, keep both.
- **A deletion asks too.** Removing a file locally removes it from the cloud on
  the next sync, so Monti says how many files are about to go and waits — once,
  or for good, per folder.
- **No promises about the background.** Syncing runs while Monti runs. Pairs
  can sync on start, every 15 minutes or every hour, and the screen says
  plainly that a closed Monti syncs nothing.

## v0.5.2 — 2026-08-11

**arm64 builds.** Every release now carries an AppImage, `.deb` and `.rpm` for
ARM machines as well, built on an ARM runner rather than cross-compiled, and
launched on Debian 12, Ubuntu 24.04 and Fedora 42 before publishing. The
install script picks the file matching your machine.

**A package for the AUR.** `packaging/aur/PKGBUILD` builds `monti-bin` from the
release `.deb`; see [packaging/](packaging/) for publishing it.

**Flatpak: ruled out, with the reasons written down.** A mount made inside a
sandbox is invisible to the file manager outside it, which is the one thing
Monti exists to do.

## v0.5.1 — 2026-08-10

**Light or dark, your choice.** Monti already followed the desktop's setting;
Settings → Appearance can now override it in either direction, and the choice
is remembered.

**Drive cards line up.** A drive with an extra badge — "own key", "read-only" —
used to push its path, quota and buttons out of step with the card beside it.
Every card is now built from the same rows, and the buttons sit on one line
across the whole row.

**The window uses the window.** On a large screen the page stopped at laptop
width and left two thirds of the monitor empty; cards now flow into as many
columns as fit. Settings are laid out in columns too, instead of one long
scroll.

**Dialogs behave.** They fit into a short window and scroll inside themselves
instead of having their buttons cut off, and clicking beside a dialog closes
it — with the same cleanup Escape does, so a browser sign-in in progress is
stopped properly.

**Fixes:** the quota bar had no track and transfer rows drew their separator in
the text colour (a stylesheet variable that was never defined), and the
dropdowns in Settings were raw system widgets — white boxes in a dark window.

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
