# Contributing to Monti

Thanks for looking. Monti is a small project with a narrow goal: **mounting
clouds should need no terminal.** That goal decides most questions here.

## Ways to help that need no code

- **Report what broke.** Which distro and desktop, which cloud provider, what
  you did, what happened. Logs live in
  `~/.local/share/io.github.stektus.monti/` — `monti.log` (what Monti did) and
  `engine.log` (what rclone said). They contain no passwords or tokens, but do
  skim them before pasting.
- **Tell us a flow felt confusing.** UX reports are as valuable as crash
  reports. "I could not tell whether it was still uploading" is a real bug.
- **Try a provider we cannot test.** Box, pCloud, Yandex Disk and OneDrive get
  much less real-world use than Google Drive.

## The codebase

Three files hold nearly everything:

| File | What lives there |
|---|---|
| `src-tauri/src/engine.rs` | the rclone daemon: spawning, identity checks, adoption, mounts |
| `src-tauri/src/lib.rs` | commands the UI can call, tray, app lifecycle |
| `src/main.js` | the entire interface |

If a change makes those files harder to read end to end, it probably needs a
different shape.

## Ground rules

**Verify before you claim.** Every change should be exercised, not just
compiled. The project has been bitten by fixes that looked right and did
nothing — the bundled `xdg-open` case in `spawn_opener` is a good example.

**Never put secrets on a command line.** Tokens, passwords and API keys go
through rclone's API or environment, never `argv` — anyone on the machine can
read `/proc/*/cmdline`.

**The browser side is untrusted.** It gets a sanitized view: no config dump, no
client secrets, and a whitelist of read-only API paths. Keep it that way.

**Destructive actions explain themselves.** Anything that deletes says exactly
what will be deleted, before it happens, in the app's own dialog.

**Cache mode stays `full`.** Apps like KeePassXC and LibreOffice corrupt files
saved in place under any lighter mode.

## Checks before opening a pull request

```bash
cd src-tauri
cargo fmt -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test                 # some tests spawn a real rclone daemon
cd .. && node --check src/main.js
```

CI runs the same. Tests that spawn rclone deliberately clear `DISPLAY` so no
browser window opens during a test run.

For UI changes, run the app and look at it — `npm run tauri dev`. On a headless
machine, a virtual display works:

```bash
kwin_wayland --virtual --xwayland --socket=wayland-test --width 1200 --height 860 &
DISPLAY=:2 GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run tauri dev
```

## Commits and pull requests

- One idea per commit; a subject line that says what changed, and a body that
  says **why**.
- Explain in the pull request how you verified the change. "Tested by" beats
  "should work".
- Documentation that describes behaviour is part of the change: if the
  behaviour moves, `README.md` moves with it in the same commit.

## Reporting a security issue

Please do not open a public issue for anything involving credentials, tokens or
local privilege. See [SECURITY.md](SECURITY.md).
