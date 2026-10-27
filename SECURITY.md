# Security policy

## Reporting a vulnerability

Report privately through GitHub's
[security advisories](https://github.com/stektus/monti/security/advisories/new)
rather than a public issue — that keeps the details out of sight until there is
a fix. Expect a first reply within a week.

Useful in a report: what an attacker would need (local account, a malicious
cloud response, a crafted config file), what they gain, and the version you
tested.

## What Monti protects

- **Cloud credentials never reach the interface.** The webview receives a
  sanitized list of remotes — names, types and the public half of an API key.
  Client secrets and tokens stay in the Rust side and in rclone's config.
- **Secrets never appear in `argv`.** Everything is passed through rclone's API
  or environment, because `/proc/*/cmdline` is readable by every local process.
- **The API proxy is a whitelist.** The interface may call three read-only
  paths; anything with side effects goes through a dedicated command.
- **The engine's credentials are checked before use.** Monti only talks to a
  daemon it can prove is the one it left behind — matching pid, process start
  time, and actual ownership of the listening socket. If any check fails, no
  credentials are sent and no process is killed.
- **The engine state file is `0600` from creation** and written atomically; it
  holds the daemon's API password.
- **Downloads are verified.** The rclone binary Monti fetches is checked against
  the official `SHA256SUMS` before it is installed, and the install script does
  the same for Monti's own release.
- **Release packages say where they came from.** Each one carries GitHub build
  provenance: a signed statement naming the repository, the workflow and the
  commit that produced it. A checksum only proves the download arrived intact —
  this proves it was not built somewhere else. Check it with
  `gh attestation verify <package> --repo stektus/monti`. This starts with
  v0.9.2 — every release published before it was built by the same workflow
  but carries checksums only, so there is nothing to verify there yet.
- **The dependency tree is checked on a schedule.** `cargo audit` runs on every
  push and once a week against the current RustSec database, so an advisory
  published against a crate underneath Monti surfaces without anyone
  remembering to look.
- **Opening things is constrained.** Folders open only as directories, links
  only over `https` — so neither path can be turned into "execute this".
- **Setting the config password does not put it on a command line either.**
  rclone asks for a new password by running the command named in
  `--password-command`; Monti answers that call with its own binary, which
  prints what it was handed in its environment and exits before any window
  exists. The password reaches rclone through that environment — readable by
  this user and no one else — and never through `argv`, which every process on
  the machine can read. Taking the password off restarts the engine on
  purpose: a daemon still holding it writes it back into the file the next
  time anything saves the config.
- **An encrypted drive's password goes nowhere it should not.** It travels to
  the engine over the local API, never on a command line and never into a log,
  and it is stored by rclone the way rclone stores passwords: obscured. See
  below for what that does *not* mean.

## What Monti does not protect against

- **A compromised local account.** Monti's data, rclone's config and your
  mounted files are all readable by your own user. Anyone who is already you can
  read them.
- **An encrypted rclone config, once you have unlocked it.** Monti asks for
  that password when something needs it and holds it in memory for as long as
  the engine runs — never on disk. While it is held, anything running as you
  can reach the drives through Monti; locking the config again means quitting
  Monti and its engine.
- **Someone reading rclone's config file.** An encrypted drive's password is
  stored there *obscured*, which is reversible by design — rclone has to be
  able to use it unattended. Encryption protects the copy in the cloud; it
  does not protect the machine holding the key. Monti says this in the dialog
  that creates such a drive rather than letting it be assumed.
- **The cloud provider itself,** or anything that happens after your files leave
  this machine.

## Known advisories in the dependency tree

`cargo audit` runs on every push and once a week. It reports five warnings,
none of them a vulnerability and none fixable here.

- **`glib` 0.18.5** carries
  [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429), an
  unsoundness in the `Iterator` implementations for `VariantStrIter`. It is
  fixed in glib 0.20, which requires gtk-rs 0.20, which Tauri 2 does not use.
  Monti's own code never names glib.
- **`proc-macro-error`** is unmaintained and arrives through `glib-macros`.
- **`zvariant`, `zvariant_derive` and `zbus_names`** are unmaintained. They
  arrive underneath `zbus`, which comes from `notify-rust` — the desktop
  notifications — and from `tauri-plugin-single-instance`.

Every one of them is reached through a dependency, not through a choice made
here, and Monti is on the newest Tauri there is. This is why the audit job
reports warnings without failing: a build that is red every day for something
nobody can act on stops being read. Actual vulnerabilities do fail it, and
have; the changelog says which releases answered them.

The GTK3 bindings — `gtk`, `gdk`, `atk` and their companions — used to be
listed here too. RustSec withdrew those advisories on 2026-08-14. The
bindings are still what Tauri 2 is built on; they are simply no longer
flagged.

Last checked against Tauri 2.12.5 on 2026-10-27.

## Scope

Monti drives [rclone](https://rclone.org); flaws inside rclone belong in
[rclone's tracker](https://github.com/rclone/rclone/security). Flaws in how
Monti spawns, authenticates to, or exposes rclone belong here.
