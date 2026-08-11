# Packaging

The `.AppImage`, `.deb` and `.rpm` are built by the
[release workflow](../.github/workflows/release.yml) on every `v*` tag, run on
Debian 12, Ubuntu 24.04, Fedora 42 and Arch before publishing, and attached to
the GitHub release. Everything here is about the channels that need a human.

## AUR — `monti-bin`

Repackages the release `.deb`, so it follows a release within minutes and
needs no build machine. Tested locally with `makepkg` on Arch.

One-time setup: an [AUR](https://aur.archlinux.org) account with an SSH key,
then `git clone ssh://aur@aur.archlinux.org/monti-bin.git`.

After each release:

```bash
cd monti-bin                     # the AUR clone
cp ../monti/packaging/aur/PKGBUILD .
sed -i "s/^pkgver=.*/pkgver=<new version>/" PKGBUILD
updpkgsums                       # real checksums from the release
makepkg --printsrcinfo > .SRCINFO
makepkg -si                      # build and install it once, to be sure
git commit -am "monti-bin <new version>" && git push
```

`updpkgsums` and `makepkg --printsrcinfo` come from `pacman-contrib` and
`pacman`; the AUR rejects a push whose `.SRCINFO` does not match the PKGBUILD.

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

So: AppImage, `.deb`, `.rpm` and the AUR. If FUSE mounts ever become
delegable to the host through a portal, this is worth revisiting.
