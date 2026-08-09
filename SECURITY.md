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
- **Opening things is constrained.** Folders open only as directories, links
  only over `https` — so neither path can be turned into "execute this".

## What Monti does not protect against

- **A compromised local account.** Monti's data, rclone's config and your
  mounted files are all readable by your own user. Anyone who is already you can
  read them.
- **An encrypted rclone config.** Monti cannot unlock one; it detects the case
  and explains it instead of failing obscurely.
- **The cloud provider itself,** or anything that happens after your files leave
  this machine.

## Scope

Monti drives [rclone](https://rclone.org); flaws inside rclone belong in
[rclone's tracker](https://github.com/rclone/rclone/security). Flaws in how
Monti spawns, authenticates to, or exposes rclone belong here.
