# Packaging

`.AppImage`, `.deb` and `.rpm` are built by the
[release workflow](../.github/workflows/release.yml) on every `v*` tag, launched
on Debian 12, Ubuntu 24.04, Fedora 42 and Arch, and attached to the GitHub
release. Nothing here is needed to install Monti — see the
[README](../README.md) for that.

## `aur/PKGBUILD` — the Arch package

Repackages the release `.deb`, so it needs no build machine and follows a
release within minutes. `makepkg` refuses to build if the download does not
match the checksums in it.

```bash
cd packaging/aur && makepkg -si
```

Bumping it to a new release:

```bash
sed -i "s/^pkgver=.*/pkgver=<new version>/" PKGBUILD
updpkgsums                        # checksums from the published release
makepkg --printsrcinfo > .SRCINFO
makepkg -si                       # build it once before committing
```

`updpkgsums` comes from `pacman-contrib`. It is not on the AUR: registration
for new maintainer accounts is closed there.

## Flatpak — closed, not open

Tried and rejected, twice; the notes are here so it is not tried a third time.

- A sandbox has its own mount namespace: a mount made inside it is invisible
  to the file manager outside. Measured — the mount is in the sandbox's
  `/proc/mounts` and absent from the host's.
- It does not even get that far. `fusermount3` is setuid root and the
  sandbox's user namespace strips that: `mount failed: Operation not
  permitted`.
- The only way out is `flatpak-spawn --host`, which needs
  `--talk-name=org.freedesktop.Flatpak` — the run of the host. Flathub asks
  for minimal static permissions, so it would be both rejected and dishonest.

Revisit only if FUSE mounts become delegable through a portal.
