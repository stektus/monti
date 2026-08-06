# Packaging

Release binaries (.AppImage / .deb / .rpm) are built by the
[Release workflow](../.github/workflows/release.yml) on every `v*` tag and
attached to the GitHub release automatically.

## AUR (`monti-bin`)

One-time setup: create an [AUR](https://aur.archlinux.org) account, add an
SSH key, then:

```bash
git clone ssh://aur@aur.archlinux.org/monti-bin.git
cp aur/PKGBUILD monti-bin/ && cd monti-bin
updpkgsums               # fills the real sha256 from the release
makepkg --printsrcinfo > .SRCINFO
makepkg -si              # test install locally
git add PKGBUILD .SRCINFO && git commit -m "monti-bin 0.3.0" && git push
```

Per release: bump `pkgver`, re-run `updpkgsums` + `.SRCINFO`, push.

## Flathub

Groundwork lives in `flatpak/` (manifest + AppStream metainfo). Blocker
before submitting: **FUSE mounts from inside the sandbox** — `rclone mount`
needs `/dev/fuse` and the host `fusermount3`; this must be proven to work
under `--device=all` (possibly with a `flatpak-spawn --host` fusermount
wrapper). Until that is tested, Flatpak is not a supported channel —
AppImage, deb, rpm and AUR are.

Submission itself: fork [flathub/flathub](https://github.com/flathub/flathub),
add the manifest, open a PR — their bot builds and reviews it.
