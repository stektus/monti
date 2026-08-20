# Changelog

Notable changes per release. Dates are the release date.

## Unreleased

**A password-protected rclone config now works.** Until now Monti met one by
telling you to open a terminal and take the password off — asking you to
weaken your setup so the app could run, which is the wrong way round. It asks
for the password instead, in a dialog, and hands it to the engine through the
environment. It is kept in memory and never written to disk: someone who
encrypted their config did it so that reading a file would not give up their
remotes, and storing the key beside it would undo exactly that. The engine
holds it while it runs, so the question comes back only after a restart.

A wrong password is answered where you typed it, in your language, and says
which password is meant — the one rclone asks for in a terminal, not one
belonging to a drive inside.

The question is asked once, at the moment something actually needs the
config, and declining it is a state you can leave, not a wall: the drives
page shows a lock with a button, every direct action — mounting, adding a
cloud, starting a sync — brings the dialog back on its own, and the
background keeps quiet. Auto-mounts, drives recorded from the last run and
syncs scheduled for start wait without banners or notifications, and the
moment the password is entered they all run themselves: drives mount,
skipped syncs start, nothing has to be clicked twice. If the password
changes outside Monti, the dialog says the saved one no longer opens the
config and asks for the new one; taking the encryption off is noticed
silently.

## v0.9.1 — 2026-08-17

Everything below was meant to be v0.9.0. That tag exists and its build never
finished: GitHub answered 429 to the AppImage tooling the bundler downloads
mid-build, on both architectures and both attempts. The tooling is now fetched
before the build, patiently, and kept between runs — nothing about the app
itself changed between the two versions.

**Backblaze B2 and MEGA.** Both sign in from the dialog rather than the
browser: B2 takes a key ID and an application key, MEGA takes the account's
own e-mail and password. Ten free gigabytes at Backblaze and twenty at MEGA,
which makes either a reasonable place to keep a backup drive.

MEGA has no application passwords, so an account with two-factor
authentication cannot be reached this way — the form says so rather than
letting the sign-in fail with something unhelpful.

**Proton Drive**, with two-factor accounts included. The code goes in the last
field, right above Connect, because it is good for thirty seconds; Proton
trades it for a session once and signs Monti in on its own afterwards.

Signing in happens as the drive is added rather than the first time it is
mounted — a one-time code written into a config file is already dead by the
time somebody presses Mount. If it is refused, the half-made drive is removed
instead of waiting in the list to fail later, and Proton's two answers are
told apart: a stale code asks for a fresh one, a bad password says so.

The refusal is shown in the dialog, which stays open with everything still
typed. A code is spent whether it was accepted or not, so that one field is
emptied and handed back the cursor: a second attempt is six digits of work.

**The providers are tested against servers that answer.** rclone can serve the
protocols Monti connects to, so WebDAV, S3 and SFTP now get a real round trip
in the test suite: a server on localhost, the same call the Add-cloud dialog
makes, a mount, a file written through that mount and found on the other side.
Field names for every provider — the B2 and OAuth ones included — are held
against rclone's own list of options, which is the mistake that otherwise
shows up only when somebody signs in.

**A drive's settings stop offering an API key it cannot use.** The Client ID,
Client secret and Re-authorize button showed on every drive, Backblaze and
WebDAV included, where there is no browser sign-in to re-run and the
credentials already sit in the config.

**Koofr**, and Digi Storage with it — the same backend serves both, and any
other service that speaks the Koofr API. It signs in with an application
password rather than the account one, which is the reason it is worth having:
unlike MEGA, a Koofr account with two-factor authentication can be reached, and
the password can be revoked on its own without touching the account.

**Settings is one column now, at every width.** Two columns fitted more on a
wide screen and cost more than they gave: the eye had to pick a side, the short
cards left a hole under the long ones, and which card sat where changed with the
size of the window. One column is read the way a settings page is read — top to
bottom, one thing at a time — and the column is a little wider than the old one
was. Explanations under each setting stop at about sixty characters, the width
a line can be read back from without losing its place.

**The window's header lines up with what is under it.** The logo sat in the far
corner of a wide monitor while the cards started a hand's width to the right;
the bar still spans the window, but its contents keep to the same column the
cards do.

**Storj**, both ways in: an access grant, which is one long string carrying
everything including the encryption passphrase, or the satellite, API key and
passphrase it is made from. The form shows one or the other, never both, so
there is nothing to fill in by mistake.

The passphrase is taken exactly as typed, spaces included — it is not a
password that a server checks but the key the files are encrypted with, and
trimming one would leave a drive that opens nothing.

The console hands out a satellite address and an API key together and no
passphrase at all, which leaves the third field looking like a mistake. It is
the project's own phrase — the one the console asks for before it will show the
files — and the form now says so, because a different one signs in perfectly
well and then shows an empty drive: the names are encrypted too.

A grant that is not a grant is told apart from one that was refused. Storj
reads the string on this computer before it talks to a satellite, so half a
line, or a copy that got wrapped on the way, fails with "invalid access grant
format" — four abbreviations deep, and previously passed through untouched.
It now says what it means and where to get another one.

**Jottacloud**, which signs in like neither of the others: not a form and not
a browser, but a short dialog rclone runs — which kind of account, then a
personal login token from the account's security page, then which device to
use. Monti answers it from the one field the form asks for, and the token is
spent the way Proton's code is: once, to let this computer in, after which
Jottacloud keeps Monti signed in itself. A token that is refused takes its
half-made drive with it.

A refused login token says which mistake it was. Jottacloud answers a token
it does not like in four different voices — a JSON parse error, a base64 one,
a 401, or an empty reply that surfaces as "unexpected EOF" — and three of them
reached the dialog as they were. All four now say the one thing that helps: the
token is good for a single sign-in and a few minutes, so make a fresh one.

**A drive that was refused while being written is no longer left behind.**
Some backends do real work as the section is written rather than when the drive
is first used: Storj trades the satellite, key and passphrase for an access
grant right there. rclone writes what it was given before finding out it does
not work, so a refused Storj drive appeared in the list underneath the error
saying it had not been added — and was still there after a restart. All three
ways of making a drive — a form, a browser, a dialog — now take the section
back out, and a test reads the source to keep it that way.

**A drive that cannot sign in is no longer added.** Writing a password into a
config file checks nothing — rclone signs in the first time the drive is used —
so a mistyped key produced a drive that looked added and failed minutes later
at Mount, by which point the dialog that knew which field was wrong was gone.
The sign-in now happens while the form is still on screen, for Backblaze,
MEGA, Koofr, Proton Drive, WebDAV and SFTP; if it is refused, the half-made
drive is removed and the dialog says so with everything still typed. S3 is left
out on purpose — keys there are routinely scoped to one bucket, and a root
listing would fail for a key that is perfectly good.

**A refused sign-in names the mistake that provider usually makes.** Koofr
refuses the account password — the one it wants is made in Preferences →
Password; Backblaze shows an application key once and never again; MEGA cannot
be reached at all with two-factor authentication on. Each of those is now said
in the refusal itself, next to the provider's own words, instead of leaving
someone to check the fields that were right all along. And Koofr's answer, four
hundred characters of HTTP headers, is cut to the part that means something —
the whole of it stays in engine.log.

**A refused sign-in is readable, and says the right half.** Adding a drive with
a wrong key was told its saved sign-in had expired and to go and sign in again —
in the dialog it was signing in from. The two wordings exist; the one for a
form still on screen simply never won, because the message had already been
explained on its way out of the engine and arrived here finished. Only Google writes
"Error 401"; Backblaze says `Unknown 401 (401 bad_auth_token)` and Proton says
`Invalid access token`, and neither was recognised, so both arrived raw. The
same 401 also means two different things: in front of a form still on screen it
means one of the boxes is wrong — including a password that came with a stray
space on the end — while at a mount it means a sign-in that used to work has
run out. Each moment now says only its own half.

**A password that stopped working can be replaced.** Drive settings gained a
Sign-in row for every drive reached with credentials — WebDAV, S3, Backblaze,
SFTP, MEGA, Proton Drive — showing who is signed in and a way to change it.
Until now the only route back in was deleting the drive, which also threw away
its mount folder, its hidden folders and everything it had cached.

It is the Add-cloud form again, filled in with what is already known and the
secret left blank; blank means "keep the saved one". The new details are tried
before they are kept, and the old ones go back if the provider refuses them —
a typo cannot turn a working drive into a broken one. A drive that was mounted
is mounted again straight away, because rclone signs in when a drive is
mounted and would otherwise go on using what stopped working.

An encrypted drive is left out on purpose: there the password is the key, not
a sign-in, and a new one would not open what the old one locked.

## v0.8.0 — 2026-08-12

**Monti speaks Ukrainian and Russian.** It follows your desktop's language, or
you pick one in Settings — the whole interface, not the menus only: drive
cards, dialogs, notifications and the tray. Sizes and speeds are formatted the
way your language writes them, so a drive reads 15,5 ГБ, and counted phrases
take the right ending — one file, two files, five files are three different
words in both new languages.

Messages that come straight from the engine stay in English. They are rclone's
own words, and the provider's error is what you search for when something
breaks; the Language setting says so rather than leaving you to notice.

**Adding a language needs no code.** A translation is one file of English
sentence → your sentence, and `scripts/check-translations.mjs` says what is
still missing. CONTRIBUTING.md has the details; CI runs the same check, so a
dictionary that lost a placeholder or a plural form cannot land quietly.

## v0.7.5 — 2026-08-12

**Settings reads like a page again on a wide window.** Maximised, the four
groups were laid out in a grid, and a grid lines its cards up in rows: a short
card next to a tall one left a hole underneath it. They now flow into columns
that pack tight and balance themselves, capped at a reading width and centred
— a switch three feet from the sentence explaining it helped nobody. Below
1160 px it is one column, wide enough to keep every setting on one line.

**About stops wrapping paths into three ragged lines.** The engine and config
paths are cut at the front now, the way the drive cards do it, with the whole
path on hover.

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
