# Packaging

The `.AppImage`, `.deb` and `.rpm` are built by the
[release workflow](../.github/workflows/release.yml) on every `v*` tag, run on
Debian 12, Ubuntu 24.04, Fedora 42 and Arch before publishing, and attached to
the GitHub release. Everything here is about the channels that need a human.

## Arch — `packaging/aur/PKGBUILD`

Repackages the release `.deb`, so it follows a release within minutes and
needs no build machine. The checksums in it are the ones from the current
release, and `makepkg` refuses to build if the download does not match them.

Anyone on Arch can install that package straight from a clone:

```bash
git clone https://github.com/stektus/monti
cd monti/packaging/aur && makepkg -si
```

**The AUR itself is not an option at the moment.** After the mid-2026 flood of
malicious packages, aur.archlinux.org closed new account registration, and the
aurweb v6.5.0 announcement (11 August 2026) still says "Registration remains
closed for now" with no date attached. `monti-bin` is therefore not on the AUR
yet — the command above is the Arch path until an account can be created.

When registration reopens: create the account, add an SSH key,
`git clone ssh://aur@aur.archlinux.org/monti-bin.git`, and after each release

```bash
cd monti-bin                     # the AUR clone
cp ../monti/packaging/aur/{PKGBUILD,.SRCINFO} .
git commit -am "monti-bin <new version>" && git push
```

The `PKGBUILD` and `.SRCINFO` here are kept release-ready, so that is the whole
job. Regenerating them for a new version:

```bash
sed -i "s/^pkgver=.*/pkgver=<new version>/" PKGBUILD
updpkgsums                       # real checksums from the release
makepkg --printsrcinfo > .SRCINFO
makepkg -si                      # build and install it once, to be sure
```

`updpkgsums` comes from `pacman-contrib`; the AUR rejects a push whose
`.SRCINFO` does not match the `PKGBUILD`.

## Flatpak — not supported, and here is why

A Flatpak Monti cannot do the one thing Monti exists for: put a cloud folder
where your file manager can open it.

- A sandboxed app has its own mount namespace. A mount made inside it is
  invisible to everything outside — measured: a bind mount created in the
  sandbox is listed in the sandbox's `/proc/mounts` and absent from the
  host's, and the folder that has files inside the sandbox is empty outside.
- Mounting does not even get that far: rclone mounts through `fusermount3`,
  which is setuid root, and a sandbox's user namespace strips that —
  `fusermount3: mount failed: Operation not permitted`.

The only way around it is to run the engine outside the sandbox through
`flatpak-spawn --host`, which needs `--talk-name=org.freedesktop.Flatpak` —
the permission that hands an app the run of the host. Flathub asks that
"static permissions must be kept to an absolute minimum" and does not accept
apps that bypass security mechanisms, and a "sandboxed" app with a hole that
size would be a lie told to whoever installs it.

So: AppImage, `.deb`, `.rpm` and the PKGBUILD. If FUSE mounts ever become
delegable to the host through a portal, this is worth revisiting.
