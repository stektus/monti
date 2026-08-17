# Contributing to Monti

Thanks for looking. Monti is a small project with a narrow goal: **mounting
clouds should need no terminal.** That goal decides most questions here.

## Ways to help that need no code

- **Report what broke.** Which distro and desktop, which cloud provider, what
  you did, what happened. Logs live in
  `~/.local/share/io.github.stektus.monti/` — `monti.log` (what Monti did) and
  `engine.log` (what rclone said). They contain no passwords or tokens, but do
  skim them before pasting.
- **Tell me a flow felt confusing.** UX reports are as valuable as crash
  reports. "I could not tell whether it was still uploading" is a real bug.
- **Try a provider I cannot test.** Box, pCloud, Yandex Disk and OneDrive get
  much less real-world use than Google Drive.

## The codebase

Four files hold nearly everything:

| File | What lives there |
|---|---|
| `src-tauri/src/engine.rs` | the rclone daemon: spawning, identity checks, adoption, mounts |
| `src-tauri/src/lib.rs` | commands the UI can call, tray, app lifecycle |
| `src-tauri/src/sync.rs` | synced pairs: bisync runs, conflicts, the pair list on disk |
| `src/main.js` | the entire interface |
| `src/i18n.js` | translation: the dictionary lookup, plurals and number formats |

If a change makes those files harder to read end to end, it probably needs a
different shape.

## Adding a translation

Copy `src/locales/uk.js` to `src/locales/<code>.js`, translate the right-hand
side, and add the language to `LANGUAGES` in `src/i18n.js`. Nothing else is
needed — no build step, no code. `node scripts/check-translations.mjs` tells
you what is still missing, and CI runs it too.

Three things worth knowing before you start:

- **The key is the English sentence.** Leave a key out and that phrase shows in
  English, which is a working state, not a broken one. Translate what you are
  sure of and send it.
- **`{name}`, `{size}` and friends are filled in at runtime.** Keep every
  placeholder that appears in the key; move it wherever your language wants it.
- **Counted phrases take an object instead of a string** — `{ one, few, many,
  other }` — and the form is chosen by `Intl.PluralRules` for your language.
  English needs two forms, Ukrainian and Russian need four.

Provider names, protocols and sample paths (`Google Drive`, `WebDAV`,
`~/.ssh/id_ed25519`) are deliberately left in English: people look for them
exactly as their provider writes them. Messages that come from the engine are
rclone's own words and are shown as they arrive.

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
cd ..
node --check src/main.js
node scripts/check-translations.mjs
```

CI runs the same. Tests that spawn rclone deliberately clear `DISPLAY` so no
browser window opens during a test run.

Three of them go further: `rclone serve` stands up a WebDAV, S3 and SFTP
server on localhost, and the test connects to it the way the Add-cloud dialog
does, mounts it, writes a file through the mount and looks for that file in
the server's own directory. Real protocols, no account, no network. Anywhere
FUSE is missing the mount half says so and stops — the run still passes, but
a skip is never silent.

`npm run tauri dev` works without the appindicator library (the tray is simply
off), but `npm run tauri build` needs it to bundle.

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
