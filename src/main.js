const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import {
  t,
  applyDom,
  setLang,
  getLang,
  onLangChange,
  LANGUAGES,
  fmtBytes,
  fmtSpeed,
} from "./i18n.js";

const PROVIDER_LABELS = {
  drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  box: "Box",
  pcloud: "pCloud",
  yandex: "Yandex Disk",
  mega: "MEGA",
  protondrive: "Proton Drive",
  koofr: "Koofr",
  storj: "Storj",
  jottacloud: "Jottacloud",
  webdav: "WebDAV",
  s3: "S3",
  b2: "Backblaze B2",
  sftp: "SFTP",
  crypt: "encrypted",
};

// Providers that authorize through the browser; the rest are configured
// entirely from form fields.
const OAUTH_PROVIDERS = new Set(["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"]);

// Which box of the Add-cloud form holds which rclone option. Used to fill
// the form back in when the sign-in of an existing drive is being changed —
// only the halves that are not secrets ever arrive to be filled.
const FIELD_INPUT = {
  webdav: { url: "webdav-url", vendor: "webdav-vendor", user: "webdav-user" },
  s3: {
    provider: "s3-provider",
    access_key_id: "s3-access",
    endpoint: "s3-endpoint",
    region: "s3-region",
  },
  b2: { account: "b2-account" },
  mega: { user: "mega-user" },
  protondrive: { username: "proton-user" },
  koofr: { provider: "koofr-provider", endpoint: "koofr-endpoint", user: "koofr-user" },
  storj: { provider: "storj-provider", satellite_address: "storj-satellite" },
  jottacloud: {},
  sftp: { host: "sftp-host", port: "sftp-port", user: "sftp-user", key_file: "sftp-key" },
};

// The one box per provider that holds the secret. Left empty it means
// "keep what is saved", and the placeholder says so.
const SECRET_INPUT = {
  webdav: ["webdav-pass"],
  s3: ["s3-secret"],
  b2: ["b2-key"],
  mega: ["mega-pass"],
  protondrive: ["proton-pass"],
  koofr: ["koofr-pass"],
  sftp: ["sftp-pass"],
  // Storj holds more than one: an access grant, or a key and a passphrase.
  storj: ["storj-grant", "storj-key", "storj-passphrase"],
  jottacloud: ["jotta-token"],
};

const $ = (id) => document.getElementById(id);

// ---------- per-drive preferences (mount point, automount) ----------

const PREFS_KEY = "monti.remotes";
const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
};
const savePrefs = (p) => localStorage.setItem(PREFS_KEY, JSON.stringify(p));
const prefFor = (name) => loadPrefs()[name] || {};
const setPref = (name, patch) => {
  const all = loadPrefs();
  all[name] = { ...(all[name] || {}), ...patch };
  savePrefs(all);
};

// ---------- small helpers ----------

// Whether the engine is up, as last seen. The tray shows it too, and the
// tray is often the only part of Monti on screen.
let engineRunning = false;
// Kept so the pill can be redrawn in another language without waiting for
// the next health tick to say the same thing again.
let lastEngine = null;

function setEngine(stateClass, label) {
  lastEngine = [stateClass, label];
  $("engine-dot").className = `dot ${stateClass}`;
  $("engine-label").textContent = t(label);
  engineRunning = stateClass === "ok";
}

// Render the message inside the open modal dialog (the page-level banner
// sits under the ::backdrop and would be invisible); clearing clears all.
function showError(msg) {
  const slots = ["global-error", "add-error", "remote-error", "pair-error", "sync-error"];
  if (!msg) {
    for (const id of slots) {
      const el = $(id);
      el.textContent = "";
      el.classList.add("hidden");
    }
    return;
  }
  let target = "global-error";
  if ($("add-dialog").open) target = "add-error";
  else if ($("remote-dialog").open) target = "remote-error";
  else if ($("pair-dialog").open) target = "pair-error";
  else if (!$("view-sync").classList.contains("hidden")) target = "sync-error";
  const el = $(target);
  el.textContent = msg;
  el.classList.remove("hidden");
  if (target !== "global-error") el.scrollIntoView({ block: "nearest" });
}

async function rc(path, body = {}) {
  return invoke("rc", { path, body });
}

// ---------- confirmation dialog ----------

// Ask the question inside the app instead of through the browser's
// confirm(), which the system draws with a "JavaScript - tauri://localhost"
// title. Resolves to { ok, extra } — `extra` is the optional checkbox.
function ask({ title, text, points = [], warn = "", okLabel = "OK", danger = false, extra = null }) {
  const dlg = $("confirm-dialog");
  $("confirm-title").textContent = title;
  $("confirm-text").textContent = text;

  const list = $("confirm-points");
  list.innerHTML = "";
  for (const p of points) {
    const li = document.createElement("li");
    li.textContent = p;
    list.append(li);
  }
  list.classList.toggle("hidden", points.length === 0);

  $("confirm-warn").textContent = warn;
  $("confirm-warn").classList.toggle("hidden", !warn);

  const box = $("confirm-extra");
  box.checked = extra ? !!extra.checked : false;
  $("confirm-extra-label").textContent = extra ? extra.label : "";
  $("confirm-extra-row").classList.toggle("hidden", !extra);

  const okBtn = $("confirm-ok");
  okBtn.textContent = okLabel;
  okBtn.className = `btn ${danger ? "danger" : "primary"}`;

  return new Promise((resolve) => {
    let answered = false;
    const finish = (ok) => {
      if (answered) return;
      answered = true;
      dlg.removeEventListener("close", onClose);
      $("confirm-cancel").removeEventListener("click", onCancel);
      $("confirm-form").removeEventListener("submit", onSubmit);
      resolve({ ok, extra: ok && extra ? box.checked : false });
    };
    // Esc and the window manager's close both fire "close" without submit.
    // The event is delivered as a queued task, so a close belonging to the
    // previous question can land here after the next one is already on
    // screen — answering it for the user. If the dialog is open again by
    // the time we hear about it, the event is not ours.
    const onClose = () => {
      if (!dlg.open) finish(false);
    };
    const onCancel = () => {
      dlg.close();
      finish(false);
    };
    const onSubmit = () => finish(true);

    dlg.addEventListener("close", onClose);
    $("confirm-cancel").addEventListener("click", onCancel);
    $("confirm-form").addEventListener("submit", onSubmit);
    dlg.showModal();
    // Destructive answers should never be one stray Enter away.
    $("confirm-cancel").focus();
  });
}

// Clicking the dimmed area outside a dialog closes it, as it does in every
// other desktop app. Esc already worked, and both cloud dialogs hang their
// cleanup (stopping a running browser authorization) on the "cancel" event
// Esc fires — so send that first instead of closing behind their backs.
// mousedown, not click: a selection that starts inside the dialog and ends
// outside it must not count as clicking away.
function closeOnBackdropClick(dlg) {
  dlg.addEventListener("mousedown", (e) => {
    if (e.target !== dlg) return; // landed on something inside
    const box = dlg.getBoundingClientRect();
    const insidePadding =
      e.clientX >= box.left &&
      e.clientX <= box.right &&
      e.clientY >= box.top &&
      e.clientY <= box.bottom;
    if (insidePadding) return;
    dlg.dispatchEvent(new Event("cancel"));
    dlg.close();
  });
}

function makeBtn(label, extra, onClick, title = "") {
  const b = document.createElement("button");
  b.className = `btn ${extra}`;
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", async () => {
    b.disabled = true;
    showError("");
    try {
      await onClick();
    } catch (e) {
      showError(String(e));
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

// A path is truncated from the left — the tail says which folder this is —
// which the stylesheet does with `direction: rtl`. That alone reorders the
// neutral characters at the ends, so "/tmp/x" comes out as "tmp/x/". The
// text goes into an inline box of its own that is explicitly left-to-right:
// the ellipsis stays at the front and the slashes stay where they were
// written. Copying the line still yields the plain path — no invisible
// control characters are added.
function setPath(el, text, title = text) {
  el.textContent = "";
  const inner = document.createElement("span");
  inner.textContent = text;
  el.append(inner);
  el.title = title;
}

// ---------- browser-authorization state (shared by both dialogs) ----------

let authInProgress = false;
let userCancelled = false;

async function abortAuth() {
  if (!authInProgress) return;
  userCancelled = true;
  await invoke("cancel_create_remote").catch(() => {});
}

// Translate raw rclone/OAuth errors into something a person can act on.
function friendlyAuthError(err) {
  const s = String(err);
  if (s.includes("access_denied"))
    return t(
      "Google refused the sign-in (403 access_denied): the Google account " +
        "you signed in with is not on your app's test-user list.\n\n" +
        "Fix: open console.cloud.google.com/auth/audience → Test users → " +
        "Add users → add your own e-mail → Save, then try again."
    );
  if (s.includes("invalid_client"))
    return t(
      "Google rejected the API key (invalid_client): the Client ID or " +
        "Client secret has a typo. Copy both values again from " +
        "console.cloud.google.com/apis/credentials."
    );
  if (s.includes("address already in use"))
    return t(
      "Another authorization is still waiting in some browser tab " +
        "(port 53682 is busy). Close old rclone/Google tabs, wait a few " +
        "seconds and try again."
    );
  return s;
}

// Run an action that ends in a browser OAuth wait, toggling a status line.
async function withAuth(statusEl, action) {
  authInProgress = true;
  userCancelled = false;
  statusEl.classList.remove("hidden");
  try {
    await action();
    return true;
  } catch (err) {
    if (!userCancelled) showError(friendlyAuthError(err));
    return false;
  } finally {
    authInProgress = false;
    statusEl.classList.add("hidden");
  }
}

// ---------- VFS mount options ----------

// Build the vfsOpt object for a drive from saved prefs; the backend forces
// CacheMode=full on top of whatever we send.
function vfsOptFor(name) {
  const v = prefFor(name).vfs || {};
  const opt = {};
  if (v.readOnly) opt.ReadOnly = true;
  if (v.maxSize) opt.CacheMaxSize = v.maxSize;
  if (v.maxAge) opt.CacheMaxAge = v.maxAge;
  return Object.keys(opt).length ? opt : null;
}

// ---------- choosing which folders a drive or a pair carries ----------

// Folders left out, as paths under the drive root ("Photos/2019"). The
// backend turns them into rclone filter rules; the picker below ticks them.
const excludesFor = (name) => prefFor(name).excludes || [];

const joinPath = (base, name) => (base ? `${base}/${name}` : name);
const relativeTo = (base, full) =>
  base && full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full;
const lastSegment = (path) => path.split("/").filter(Boolean).pop() || path;

// One line for the dialogs: what the current choice amounts to.
function foldersSummary(excluded) {
  const n = (excluded || []).length;
  if (!n) return t("All folders");
  return n === 1
    ? t("1 folder left out: {folder}", { folder: excluded[0] })
    : t("{n} folders left out", { n });
}

// State of the open picker. One at a time — it is a modal dialog.
let picker = null;

const excludedExactly = (rel) => picker.excluded.has(rel);
const excludedByParent = (rel) =>
  [...picker.excluded].some((e) => rel.startsWith(`${e}/`));

// Re-read every row from the set, including rows added by a lazy expand.
// A folder inside one that is already left out cannot be chosen separately:
// its checkbox says what will happen and takes no orders.
function refreshPickerRows() {
  // Listing a cloud folder takes seconds, and the dialog can be closed
  // inside those seconds — then there is nothing left to refresh.
  if (!picker) return;
  for (const row of picker.rows) {
    const byParent = excludedByParent(row.rel);
    row.box.checked = !byParent && !excludedExactly(row.rel);
    row.box.disabled = byParent;
    row.wrap.classList.toggle("off", byParent || excludedExactly(row.rel));
  }
  $("folders-count").textContent = foldersSummary([...picker.excluded].sort());
}

async function loadChildren(container, fullPath, depth) {
  const remote = picker.remote;
  const dirs = await unlocked(() => invoke("list_cloud_dirs", { name: remote, path: fullPath }));
  if (!picker) return 0; // closed while the cloud was answering
  for (const full of dirs) container.append(folderRow(full, depth));
  refreshPickerRows();
  return dirs.length;
}

function folderRow(full, depth) {
  const rel = relativeTo(picker.base, full);
  const wrap = document.createElement("div");
  wrap.className = "tree-item";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingInlineStart = `${depth * 20}px`;

  const kids = document.createElement("div");
  kids.className = "tree-kids hidden";

  // Folders are opened on demand: a cloud with thousands of them must not
  // be listed in full to answer "which ones do I want".
  let loaded = false;
  const toggle = makeBtn("▸", "tree-toggle", async () => {
    if (!loaded) {
      toggle.textContent = "⋯";
      try {
        await loadChildren(kids, full, depth + 1);
        loaded = true;
      } catch (e) {
        showPickerError(e);
        toggle.textContent = "▸";
        return;
      }
    }
    const hidden = kids.classList.toggle("hidden");
    toggle.textContent = hidden ? "▸" : "▾";
  });
  toggle.type = "button";

  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.addEventListener("change", () => {
    if (box.checked) {
      picker.excluded.delete(rel);
    } else {
      picker.excluded.add(rel);
      // Anything below it is covered by the parent's rule; keeping the
      // children in the list would only make the rules harder to read.
      for (const e of [...picker.excluded]) {
        if (e.startsWith(`${rel}/`)) picker.excluded.delete(e);
      }
    }
    refreshPickerRows();
  });
  const text = document.createElement("span");
  text.textContent = lastSegment(full);
  label.append(box, text);

  row.append(toggle, label);
  wrap.append(row, kids);
  picker.rows.push({ rel, box, wrap });
  return wrap;
}

function showPickerError(e) {
  if (!picker) return; // the dialog is gone; nowhere to say it
  const el = $("folders-error");
  el.textContent = String(e);
  el.classList.remove("hidden");
}

// Open the picker. Resolves to the new list of excluded folders, or null
// when the person changed their mind.
function chooseFolders({ remote, base, excluded, title, hint }) {
  return new Promise((resolve) => {
    picker = {
      remote,
      base: base || "",
      excluded: new Set(excluded || []),
      rows: [],
      resolve,
    };
    $("folders-title").textContent = title;
    $("folders-hint").textContent = hint;
    $("folders-error").classList.add("hidden");
    $("folders-count").textContent = "";
    const tree = $("folders-tree");
    tree.innerHTML = "";
    tree.classList.add("loading");
    tree.textContent = t("Reading the cloud…");
    $("folders-dialog").showModal();
    loadChildren(tree, picker.base, 0)
      .then((n) => {
        tree.classList.remove("loading");
        tree.firstChild?.remove(); // the "reading" line
        if (!n) tree.textContent = t("This folder has no subfolders.");
      })
      .catch((e) => {
        tree.classList.remove("loading");
        tree.textContent = "";
        showPickerError(e);
      });
  });
}

// Where a drive's folder lives, for telling the person what will be removed.
// Mirrors the backend: a custom mount point wins, otherwise ~/CloudDrives/<name>.
function mountFolderOf(name, mountPoint) {
  const custom = (mountPoint || "").trim();
  if (custom) return custom;
  return `~/CloudDrives/${name}`;
}

// The unit is mandatory: rclone reads a bare "500" as 500 KiB, which is
// never what someone typing a cache size means.
const SIZE_RE = /^\d+(\.\d+)?\s*(b|k|ki|m|mi|g|gi|t|ti|p|pi)$/i;
const AGE_RE = /^(\d+(\.\d+)?(ms|s|m|h|d|w|y))+$/i;

// ---------- desktop notifications ----------

// Only for things someone must act on and would otherwise learn about far
// too late: the engine dying under a mounted drive, the disk running out.
// Everything announced here is also visible in the window — the
// notification exists for when the window is not.
const NOTIFY_KEY = "monti.notify";
const notifyEnabled = () => localStorage.getItem(NOTIFY_KEY) !== "off";

function notify(title, body) {
  if (!notifyEnabled()) return;
  invoke("notify_user", { title, body }).catch(() => {});
}

// ---------- appearance ----------

// Light or dark is the desktop's call by default — the stylesheet follows
// prefers-color-scheme — but a person who runs a light desktop and a dark
// file manager (or the other way round) can say so here, and that choice
// wins in both directions.
const THEME_KEY = "monti.theme";
const savedTheme = () => localStorage.getItem(THEME_KEY) || "auto";

function applyTheme(choice = savedTheme()) {
  if (choice === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
}

// ---------- speed limit ----------

// rclone holds the limit in the running daemon, not in its config, so it
// is gone after every engine restart — including the automatic one after a
// crash. Monti keeps the choice and puts it back.
const BW_KEY = "monti.bwlimit";
const savedBwLimit = () => localStorage.getItem(BW_KEY) || "off";

async function applyBwLimit() {
  const rate = savedBwLimit();
  if (rate === "off") return; // the engine starts unlimited anyway
  await invoke("bandwidth_limit", { rate }).catch(() => {});
}

// ---------- engine health ----------

let healthTimer = null;
let engineDown = false;
let healthTicks = 0;

// A drive can go away while the engine stays perfectly healthy: someone runs
// `fusermount -u`, a mount dies. Nothing announces it — the window keeps
// showing the drive as mounted while the folder is empty. The backend reports
// each such drive once, so anything that comes back here is news.
async function checkLostMounts() {
  // Drives a locked config could not mount are not "lost outside Monti" —
  // they are queued behind the password, and the alarm would ring forever.
  if (configLocked) return;
  let lost;
  try {
    lost = await invoke("lost_mounts");
  } catch {
    return; // engine busy or restarting — the next pass will tell
  }
  if (!lost.length) return;
  const which = lost.join(", ");
  showError(
    t(
      "{which} is no longer mounted — something unmounted it outside Monti. " +
        "Press Mount on the drive to bring the folder back.",
      { which }
    )
  );
  notify(
    t("Monti: a drive disconnected"),
    t("{which} is no longer mounted. Open Monti and press Mount.", { which })
  );
  await refreshRemotes({ quiet: true }).catch(() => {});
}

async function healthTick() {
  if (document.hidden) return;
  let alive;
  try {
    alive = await invoke("engine_health");
  } catch {
    return; // IPC hiccup — decide on the next tick
  }
  // Mounts change far more slowly than the engine dies, and the check costs
  // an engine round trip, so it rides every fourth tick.
  if (alive && !engineDown && ++healthTicks % 4 === 0) {
    await checkLostMounts();
  }
  if (!alive && !engineDown) {
    engineDown = true;
    setEngine("err", "engine stopped");
    $("engine-restart").classList.remove("hidden");
    showError(
      t(
        "The rclone engine stopped unexpectedly — your drives are disconnected. " +
          "Press “Restart engine” to bring them back."
      )
    );
    notify(
      t("Monti: your drives are disconnected"),
      t("The rclone engine stopped. Open Monti and press “Restart engine”.")
    );
  } else if (alive && engineDown) {
    engineDown = false;
    $("engine-restart").classList.add("hidden");
    setEngine("ok", "engine running");
    showError("");
    await refreshRemotes().catch(() => {});
  }
}

// ---------- activity indicator ----------

let ownMounts = new Map(); // remote name -> mount point, kept fresh by refreshRemotes
let activityTimer = null;

// rclone size strings ("20480M") are for rclone, not for people.
const fmtLimit = (s) =>
  String(s).replace(/^(\d+)M$/, (_, m) =>
    m >= 1024 ? `${Math.round(m / 1024)} ${t("GB")}` : `${m} ${t("MB")}`
  );

// Cloud quota per remote. Asking the provider costs a network round trip,
// and the list is redrawn after every action, so answers are kept for a
// few minutes — space in a cloud does not change by the second.
const quotaCache = new Map();
const QUOTA_TTL = 5 * 60 * 1000;

async function showQuota(el, name) {
  const hit = quotaCache.get(name);
  let info = hit && Date.now() - hit.at < QUOTA_TTL ? hit.info : null;
  if (!info) {
    try {
      info = await invoke("remote_about", { name });
    } catch {
      // Plenty of backends cannot answer this (S3 among them). That is a
      // fact about the provider, not a failure worth showing.
      quotaCache.set(name, { at: Date.now(), info: {} });
      return;
    }
    quotaCache.set(name, { at: Date.now(), info });
  }

  const { total, used } = info;
  if (used == null && total == null) return;

  const bar = el.querySelector(".quota-bar");
  const fill = bar.querySelector("span");
  const text = el.querySelector(".quota-text");

  if (total && used != null) {
    const pct = Math.min(100, Math.round((used / total) * 100));
    fill.style.width = `${pct}%`;
    bar.classList.toggle("full", pct >= 90);
    text.textContent = t("{used} of {total} used in the cloud", {
      used: fmtBytes(used),
      total: fmtBytes(total),
    });
  } else {
    bar.classList.add("hidden");
    text.textContent = t("{used} used in the cloud", {
      used: fmtBytes(used ?? total),
    });
  }
  el.classList.remove("hidden");
}

async function pollActivity() {
  if (document.hidden) return;
  const pill = $("activity-pill");
  try {
    const stats = await rc("core/stats");
    const transfers = stats.transferring || [];
    if (transfers.length) {
      const speed = transfers.reduce((sum, x) => sum + (x.speed || 0), 0);
      $("activity-label").textContent = t("{n} files · {speed}", {
        n: transfers.length,
        speed: fmtSpeed(speed),
      });
      pill.classList.remove("hidden");
    } else {
      pill.classList.add("hidden");
    }

    // Per-drive "syncing" chip: the VFS cache knows about pending uploads
    // even when no bytes are moving yet (queued writeback).
    await Promise.all(
      [...ownMounts.keys()].map(async (name) => {
        const chip = document.querySelector(
          `.remote-card[data-name="${CSS.escape(name)}"] .chip.sync`
        );
        if (!chip) return;
        const vfs = await rc("vfs/stats", { fs: `${name}:` }).catch(() => null);
        const dc = (vfs && vfs.diskCache) || {};
        const busy =
          (dc.uploadsInProgress || 0) + (dc.uploadsQueued || 0) > 0;
        chip.classList.toggle("hidden", !busy);
      })
    );
  } catch {
    pill.classList.add("hidden"); // engine restarting — go quiet, retry next tick
  }
}

// ---------- a password-protected rclone config ----------

// rclone reads its config the first time something needs a remote, not when
// the daemon starts — so a locked config is not a startup failure, it is the
// answer to the drive list. Rust turns both refusals into these markers so
// the words can live here with the rest of the interface.
const CONFIG_LOCKED = "monti:config-locked";
const CONFIG_LOCKED_BAD = "monti:config-locked-bad-password";

// While the config sat locked, the quiet paths gave up without a word —
// auto-mounts, syncs set to run at start. This remembers that something was
// skipped, so the first successful look at the config can run it.
let lockSkipped = false;

// Whether the config is known to be locked right now. Background watchers
// consult this: while it is true, "drive is not mounted" is not news worth
// an alarm — everything is waiting for the same password.
let configLocked = false;

// The net under every click handler that awaits without catching: without
// it a rejected promise dies in silence and the button just does nothing.
window.addEventListener("unhandledrejection", (ev) => {
  ev.preventDefault();
  const msg = String(ev.reason ?? "");
  showError(msg.startsWith(CONFIG_LOCKED) ? t("The rclone config is locked.") : msg);
});

// Run something that needs the config, and if the config turns out to be
// locked, ask and run it again. Every call that names a remote can come back
// this way — adding a cloud checks the name is free, the sync tab reads the
// drive list — so the asking belongs here rather than at each of them.
async function unlocked(run) {
  try {
    return await run();
  } catch (e) {
    if (!String(e).startsWith(CONFIG_LOCKED)) throw e;
    // Thrown as a string, not an Error: everything a Tauri command rejects
    // with is a string, and the callers print it with String(err) — an Error
    // would arrive at the dialog wearing an "Error: " prefix.
    if (!(await askConfigPassword(String(e) === CONFIG_LOCKED_BAD))) {
      throw t("The rclone config is still locked.");
    }
    // The drives page may be sitting on the locked panel from an earlier
    // refusal. It is right again now, whatever happens to the call below —
    // and if this is left to the caller, a call that fails for its own
    // reasons leaves a lock on screen over an unlocked config.
    lockSkipped = true;
    refreshRemotes().catch(() => {});
    return run();
  }
}

// Ask, hand it to the engine, and say whether we got in. Stays open on a
// wrong password: the person is holding the right one somewhere and being
// thrown back to an empty window helps nobody.
function askConfigPassword(wrongAlready) {
  const dlg = $("unlock-dialog");
  const field = $("unlock-pass");
  const err = $("unlock-error");
  field.value = "";
  err.textContent = wrongAlready ? t("The saved password no longer opens this config.") : "";
  err.classList.toggle("hidden", !wrongAlready);

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      field.value = "";
      dlg.removeEventListener("close", onClose);
      $("unlock-cancel").removeEventListener("click", onCancel);
      $("unlock-form").removeEventListener("submit", onSubmit);
      resolve(ok);
    };
    const onClose = () => {
      if (!dlg.open) finish(false);
    };
    const onCancel = () => {
      dlg.close();
      finish(false);
    };
    const onSubmit = async (e) => {
      e.preventDefault();
      const password = field.value;
      if (!password) {
        field.focus();
        return;
      }
      const ok = $("unlock-ok");
      ok.disabled = true;
      try {
        await invoke("unlock_config", { password });
        // The unlock restarts the daemon, and a fresh daemon is an
        // unlimited one: every other restart in the app puts the speed
        // limit back, and this one used to drop it for the session.
        await applyBwLimit().catch(() => {});
        dlg.close();
        finish(true);
      } catch (e) {
        // The backend answers with its marker so the words can live in the
        // dictionaries with the rest of the interface.
        err.textContent = String(e).startsWith(CONFIG_LOCKED)
          ? t(
              "That is not the password for this config file. It is the one " +
                "rclone asks for when you run it in a terminal — not a " +
                "password for any of the drives inside."
            )
          : String(e);
        err.classList.remove("hidden");
        field.select();
      } finally {
        ok.disabled = false;
      }
    };
    dlg.addEventListener("close", onClose);
    $("unlock-cancel").addEventListener("click", onCancel);
    $("unlock-form").addEventListener("submit", onSubmit);
    dlg.showModal();
    field.focus();
  });
}

// ---------- drives ----------

async function fetchState() {
  const [remotes, mounts, sysMounts, recorded] = await Promise.all([
    invoke("list_remotes"),
    rc("mount/listmounts"),
    invoke("list_system_mounts"),
    invoke("own_mounts"),
  ]);
  // What is mounted right now comes from the engine; what each mount is
  // called comes from Monti's own record of making it. rclone answers with
  // the canonical fs — "gdrive:" for a cloud, "gdrive:." for a local remote,
  // a bare path for an alias — and the last one has no drive name in it at
  // all, which is how a mounted drive ended up labelled "not mounted".
  const nameOfPoint = new Map(Object.entries(recorded).map(([n, p]) => [p, n]));
  const own = new Map(
    (mounts.mountPoints || []).map((m) => [
      nameOfPoint.get(m.MountPoint) || m.Fs.split(":")[0],
      m.MountPoint,
    ])
  );
  const ownPoints = new Set(own.values());
  const external = new Map();
  for (const m of sysMounts) {
    if (!ownPoints.has(m.mountPoint) && !external.has(m.remote)) {
      external.set(m.remote, m.mountPoint);
    }
  }
  return { remotes, own, external };
}

// The tray's words. They are counted and translated here rather than in
// Rust: "5 drives" has three different endings in Ukrainian, and the rules
// for that are in the browser's Intl. Rust only fills in {name}, because
// Rust is what decides which drives fit in the menu.
function trayLabels(running, drives) {
  const total = drives.length;
  const mounted = drives.filter((d) => d.mounted).length;
  return {
    open: t("Open Monti"),
    quit: t("Quit"),
    status: !running
      ? t("Engine stopped")
      : total > 1
        ? t("Engine running · {mounted} of {total} mounted", { mounted, total })
        : t("Engine running"),
    mount: t("Mount “{name}”"),
    unmount: t("Unmount “{name}”"),
    allDrives: t("All {n} drives in Monti…", { n: total }),
    unmountAll: t("Unmount all {n} drives", { n: mounted }),
    tooltip: !running
      ? t("Monti — engine stopped")
      : mounted === 0
        ? t("Monti — no drives mounted")
        : t("Monti — {n} drives mounted", { n: mounted }),
  };
}

async function refreshRemotes(opts = {}) {
  let snapshot;
  try {
    snapshot = await fetchState();
  } catch (e) {
    if (!String(e).startsWith(CONFIG_LOCKED)) throw e;
    configLocked = true;
    // Turned down. Not an error message — a state with a way out of it: an
    // empty "no clouds connected yet" would be a lie about a config full of
    // them, and a red banner leaves nothing to press. A quiet caller — a
    // timer, a tab switch — shows the state but never summons the dialog:
    // that right belongs to the person's own actions.
    if (opts.quiet || !(await askConfigPassword(String(e) === CONFIG_LOCKED_BAD))) {
      lockSkipped = true;
      $("remotes-list").innerHTML = "";
      $("empty-hint").classList.add("hidden");
      $("locked-hint").classList.remove("hidden");
      return;
    }
    snapshot = await fetchState();
  }
  configLocked = false;
  $("locked-hint").classList.add("hidden");
  if (lockSkipped) {
    // The unlock is the moment the skipped work was waiting for.
    lockSkipped = false;
    autoRemount()
      .then((n) => (n ? refreshRemotes() : null))
      .catch(() => {});
    syncOnStart().catch(() => {});
  }
  const { remotes, own, external } = snapshot;
  ownMounts = own;
  // The tray is drawn from the same state, so it never disagrees with the
  // window about what is mounted.
  const trayDrives = remotes.map((r) => ({
    name: r.name,
    mounted: own.has(r.name) || external.has(r.name),
  }));
  invoke("update_tray", {
    engineRunning: engineRunning,
    drives: trayDrives,
    labels: trayLabels(engineRunning, trayDrives),
  }).catch(() => {});
  const list = $("remotes-list");
  list.innerHTML = "";
  $("empty-hint").classList.toggle("hidden", remotes.length > 0);

  invoke("disk_free")
    .then((free) => lowDiskWarning($("disk-warning"), free))
    .catch(() => {});

  for (const { name, type, hasOwnKey: ownKey, mountedReadOnly, wraps } of remotes) {
    const ownPoint = own.get(name);
    const extPoint = external.get(name);
    // For a live Monti mount show the real state; otherwise what the next
    // mount will do (the pref).
    const readOnly = ownPoint != null && mountedReadOnly != null
      ? mountedReadOnly
      : !!prefFor(name).vfs?.readOnly;

    const card = document.createElement("div");
    card.className = "card remote-card";
    card.dataset.name = name;
    card.innerHTML = `
      <div class="remote-head">
        <span class="remote-name"></span>
        <span class="spacer"></span>
        ${
          ownPoint
            ? `<span class="chip state on">${t("mounted")}</span>` +
              `<span class="chip state sync hidden" title="${t("Uploading changes to the cloud")}">⇅ ${t("syncing")}</span>`
            : extPoint
              ? `<span class="chip state ext" title="${t("Mounted outside Monti (e.g. a systemd service).")}">${t("mounted · system")}</span>`
              : `<span class="chip state">${t("not mounted")}</span>`
        }
      </div>
      <div class="remote-tags">
        <span class="chip provider"></span>
        ${
          wraps
            ? `<span class="chip wraps" title="${t("The encrypted copy is stored here")}"></span>`
            : ""
        }
        ${ownKey ? `<span class="chip key" title="${t("Connected through your own API key")}">${t("own key")}</span>` : ""}
        ${readOnly ? `<span class="chip" title="${t("Read-only: files cannot be changed")}">${t("read-only")}</span>` : ""}
      </div>
      <div class="remote-path muted mono"></div>
      <div class="remote-quota hidden">
        <div class="quota-bar"><span></span></div>
        <div class="quota-text muted"></div>
      </div>
      <div class="remote-cache muted hidden"></div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = t(PROVIDER_LABELS[type] || type);
    if (wraps) card.querySelector(".wraps").textContent = t("in {name}", { name: wraps });
    // The line is truncated to keep every card the same shape; the full
    // path is one hover away.
    setPath(
      card.querySelector(".remote-path"),
      ownPoint || extPoint || prefFor(name).mountPoint || `~/CloudDrives/${name}`,
    );
    card.querySelector(".remote-name").title = name;

    // Measuring walks the cache directory, so do it after the card is on
    // screen rather than holding up the whole list.
    const cacheEl = card.querySelector(".remote-cache");
    invoke("vfs_cache_size", { name })
      .then((used) => {
        if (!used) return;
        cacheEl.textContent = t("{size} cached on this computer", {
          size: fmtBytes(used),
        });
        cacheEl.classList.remove("hidden");
      })
      .catch(() => {});

    showQuota(card.querySelector(".remote-quota"), name);

    const actions = card.querySelector(".remote-actions");

    if (ownPoint) {
      actions.append(
        makeBtn(t("Open folder"), "primary", () => invoke("open_folder", { path: ownPoint })),
        makeBtn(t("Unmount"), "", async () => {
          try {
            await invoke("unmount_remote", { mountPoint: ownPoint });
          } catch (e) {
            const m = String(e).match(/UPLOADS_PENDING:(\d+)/);
            if (!m) throw e;
            const { ok } = await ask({
              title: t("Uploads are still running"),
              text: t('{n} file(s) from "{name}" have not reached the cloud yet.', {
                n: m[1],
                name,
              }),
              points: [
                t("Unmounting pauses the upload; it resumes the next time you mount the drive."),
                t("Until then those changes exist only on this computer."),
              ],
              warn: t("Shutting the computer down before the next mount can lose them."),
              okLabel: t("Unmount anyway"),
              danger: true,
            });
            if (!ok) return;
            await invoke("unmount_remote", { mountPoint: ownPoint, force: true });
          }
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), t("Drive settings"))
      );
      addShareButton(actions, name);
    } else if (extPoint) {
      actions.append(
        makeBtn(t("Open folder"), "primary", () => invoke("open_folder", { path: extPoint })),
        makeBtn(t("Unmount"), "", async () => {
          const { ok } = await ask({
            title: t('Unmount "{name}"?', { name }),
            text: t(
              "This drive was mounted outside Monti — by a systemd service or " +
                "a manual rclone mount."
            ),
            points: [
              t("Close any app still using files there first."),
              t("A service that manages this mount may bring it back, or may need to be disabled separately."),
            ],
            warn: t("Unsaved changes in files that are still open would be lost."),
            okLabel: t("Unmount"),
            danger: true,
          });
          if (!ok) return;
          await invoke("unmount_external", { mountPoint: extPoint });
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), t("Drive settings"))
      );
    } else {
      actions.append(
        makeBtn(t("Mount"), "primary", async () => {
          const mp = prefFor(name).mountPoint || null;
          await unlocked(() =>
            invoke("mount_remote", {
              name,
              mountPoint: mp,
              vfs: vfsOptFor(name),
              excludes: excludesFor(name),
            })
          );
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), t("Drive settings")),
        makeBtn(t("Remove"), "danger", async () => {
          // Everything is decided in one dialog, before anything happens:
          // asking about the cache afterwards meant asking a question the
          // person could no longer answer with the drive in front of them.
          const mountPoint = prefFor(name).mountPoint || null;
          const cached = await invoke("vfs_cache_size", { name }).catch(() => 0);
          const points = [
            t("Files in the cloud are not touched."),
            t("The saved sign-in for this drive is removed from the rclone config on this machine."),
          ];
          if (mountFolderOf(name, mountPoint)) {
            points.push(
              t("The empty mount folder {folder} is removed.", {
                folder: mountFolderOf(name, mountPoint),
              })
            );
          }
          const { ok, extra } = await ask({
            title: t('Disconnect "{name}" from this computer?', { name }),
            text: t("The drive disappears from Monti. You can add it back later by signing in again."),
            points,
            okLabel: t("Disconnect"),
            danger: true,
            extra: cached
              ? {
                  label: t("Also delete {size} of cached file copies", {
                    size: fmtBytes(cached),
                  }),
                  checked: true,
                }
              : null,
          });
          if (!ok) return;
          await unlocked(() => invoke("delete_remote", { name, mountPoint }));
          // Only forget the prefs once the remote is really gone — a failed
          // delete (e.g. still mounted) keeps the drive fully configured.
          const all = loadPrefs();
          delete all[name];
          savePrefs(all);
          if (extra) {
            await invoke("clear_vfs_cache", { name }).catch((e) => showError(String(e)));
          }
          await refreshRemotes();
        })
      );
    }
    list.append(card);
  }
}

// Mount everything marked "mount automatically".
async function autoRemount() {
  const prefs = loadPrefs();
  const wanted = Object.keys(prefs).filter((n) => prefs[n].automount);
  if (!wanted.length) return 0;
  let state;
  try {
    state = await fetchState();
  } catch (e) {
    // A locked config is not a mount failure; the unlock runs this again.
    if (!String(e).startsWith(CONFIG_LOCKED)) throw e;
    lockSkipped = true;
    return 0;
  }
  const { remotes, own, external } = state;
  const existing = new Set(remotes.map((r) => r.name));
  let mounted = 0;
  for (const name of wanted) {
    if (!existing.has(name) || own.has(name) || external.has(name)) continue;
    try {
      await invoke("mount_remote", {
        name,
        mountPoint: prefs[name].mountPoint || null,
        vfs: vfsOptFor(name),
        excludes: excludesFor(name),
      });
      mounted += 1;
    } catch (e) {
      retryAutoMount(name, 0, e);
    }
  }
  return mounted;
}

// "Share a file" belongs only on drives whose provider makes links —
// Drive, Dropbox, OneDrive, pCloud. The answer comes from the engine, so
// the button appears a moment after the card; that beats a button that
// half the drives answer with an error.
function addShareButton(actions, name) {
  invoke("supports_links", { name })
    .then((can) => {
      if (!can) return;
      actions.append(
        makeBtn(t("Share a file"), "", () => shareFile(name), t("Get a link to a file in this drive"))
      );
    })
    .catch(() => {});
}

async function shareFile(name) {
  let url;
  try {
    url = await unlocked(() => invoke("share_link", { name }));
  } catch (e) {
    showError(String(e));
    return;
  }
  if (!url) return; // the chooser was dismissed
  $("link-url").value = url;
  $("link-copy").textContent = t("Copy");
  $("link-dialog").showModal();
}

// Autostart puts Monti on screen before the network is necessarily up, and a
// cloud that cannot be reached yet fails to mount for a minute or two at
// most. Giving up on the first try would leave people with an empty folder
// and no idea why, so keep trying quietly for about four minutes.
const AUTOMOUNT_RETRIES = [10, 30, 60, 120]; // seconds between attempts

function retryAutoMount(name, attempt, lastError) {
  // A locked config is not the network coming up — retrying cannot fix it,
  // and the unlock runs auto-mounts again anyway.
  if (String(lastError).startsWith(CONFIG_LOCKED)) {
    lockSkipped = true;
    return;
  }
  if (attempt >= AUTOMOUNT_RETRIES.length) {
    showError(t("Auto-mount of “{name}” failed: {error}", { name, error: lastError }));
    return;
  }
  const wait = AUTOMOUNT_RETRIES[attempt];
  showError(
    t(
      "“{name}” is not mounted yet — trying again in {wait}s. " +
        "Right after login this usually means the network is still coming up.",
      { name, wait }
    )
  );
  setTimeout(async () => {
    try {
      const { own, external } = await fetchState();
      if (own.has(name) || external.has(name)) {
        showError(""); // mounted meanwhile, by hand or by the engine
        await refreshRemotes();
        return;
      }
      await invoke("mount_remote", {
        name,
        mountPoint: prefFor(name).mountPoint || null,
        vfs: vfsOptFor(name),
        excludes: excludesFor(name),
      });
      showError("");
      await refreshRemotes();
    } catch (e) {
      retryAutoMount(name, attempt + 1, e);
    }
  }, wait * 1000);
}

// ---------- synced folders ----------

// A synced folder is the other half of what Monti does: a mounted drive is
// the whole cloud with nothing on disk, a synced folder is a real local copy
// that works with no network. rclone calls it bisync; the hard parts it
// leaves to us are the first run and what to do with a conflict.

const SCHEDULE_LABELS = {
  manual: "manual",
  start: "when Monti starts",
  "15m": "every 15 minutes",
  "1h": "every hour",
};

let syncJobs = new Map(); // pair name -> { jobid, resync }

async function refreshPairs() {
  const pairs = await invoke("sync_pairs");
  const list = $("sync-list");
  list.innerHTML = "";
  $("sync-empty").classList.toggle("hidden", pairs.length > 0);

  for (const p of pairs) {
    const card = document.createElement("div");
    card.className = "card remote-card";
    card.dataset.name = p.name;
    const running = syncJobs.has(p.name);
    card.innerHTML = `
      <div class="remote-head">
        <span class="remote-name"></span>
        <span class="spacer"></span>
        <span class="chip state${running ? " sync" : p.initialized ? " on" : ""}"></span>
      </div>
      <div class="remote-tags">
        <span class="chip">${t(SCHEDULE_LABELS[p.schedule] || p.schedule)}</span>
      </div>
      <div class="remote-path muted mono"></div>
      <div class="sync-progress muted"></div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = p.name;
    card.querySelector(".chip.state").textContent = running
      ? t("syncing")
      : p.initialized
        ? t("ready")
        : t("not synced yet");
    setPath(card.querySelector(".remote-path"), `${p.local}  ⇄  ${p.remote}`);

    const line = card.querySelector(".sync-progress");
    if (p.lastRun) {
      line.textContent =
        p.lastResult === "ok"
          ? t("last sync {when} UTC", { when: p.lastRun })
          : t("last sync failed: {error}", { error: p.lastResult });
      line.classList.toggle("failed-text", p.lastResult !== "ok");
    } else {
      line.textContent = t("never synced");
    }

    const actions = card.querySelector(".remote-actions");
    if (running) {
      actions.append(
        makeBtn(t("Stop"), "", async () => {
          const job = syncJobs.get(p.name);
          if (job) await invoke("sync_stop", { jobid: job.jobid }).catch(() => {});
        })
      );
    } else {
      actions.append(
        makeBtn(t("Sync now"), "primary", () => startSync(p)),
        makeBtn("⚙", "icon", () => openPairDialog(p), t("Settings for this pair")),
        makeBtn(t("Remove"), "danger", () => removePair(p))
      );
    }
    list.append(card);
    showConflicts(card, p.name);
  }
}

// The one run that can overwrite files, so it asks first — every later run
// keeps both versions instead.
function askFirstSync(pair) {
  return new Promise((resolve) => {
    const dlg = $("firstsync-dialog");
    $("firstsync-text").textContent = t(
      '"{name}" has not been synced yet. Monti will compare {local} and ' +
        "{remote} and make them match.",
      { name: pair.name, local: pair.local, remote: pair.remote }
    );
    const done = (mode) => {
      dlg.removeEventListener("close", onClose);
      resolve(mode);
    };
    const onClose = () => done(null);
    const onSubmit = () => {
      dlg.removeEventListener("close", onClose);
      $("firstsync-form").removeEventListener("submit", onSubmit);
      resolve($("firstsync-mode").value);
    };
    dlg.addEventListener("close", onClose, { once: true });
    $("firstsync-form").addEventListener("submit", onSubmit, { once: true });
    $("firstsync-cancel").onclick = () => dlg.close();
    // What this will cost in disk space, measured with the pair's own
    // folder choices. It arrives while the dialog is already open: walking
    // a cloud folder takes seconds, and the question is answerable without
    // it — a sync that runs out of disk halfway is the thing to avoid.
    const space = $("firstsync-space");
    space.textContent = t("Measuring the cloud folder…");
    space.classList.remove("warn-text");
    invoke("sync_estimate", { name: pair.name })
      .then(({ cloudBytes, cloudFiles, freeBytes }) => {
        if (cloudBytes == null) {
          space.textContent = "";
          return;
        }
        const files = t("{n} files", { n: cloudFiles });
        space.textContent =
          freeBytes == null
            ? t("The cloud side holds {size} in {files}.", {
                size: fmtBytes(cloudBytes),
                files,
              })
            : t(
                "The cloud side holds {size} in {files}; this computer has {free} free.",
                { size: fmtBytes(cloudBytes), files, free: fmtBytes(freeBytes) }
              );
        if (freeBytes != null && cloudBytes > freeBytes) {
          space.textContent +=
            " " + t("It will not all fit — leave some folders out first.");
          space.classList.add("warn-text");
        }
      })
      .catch(() => {
        space.textContent = "";
      });
    dlg.showModal();
  });
}

async function startSync(pair, force = false, interactive = true) {
  showError("");
  let resyncMode = null;
  if (!pair.initialized) {
    resyncMode = await askFirstSync(pair);
    if (!resyncMode) return; // cancelled
  }
  let jobid;
  try {
    const run = () =>
      invoke("sync_run", {
        name: pair.name,
        resync: !pair.initialized,
        resyncMode,
        dryRun: false,
        force,
      });
    // A hand on the button deserves the password dialog; a schedule firing
    // in the background does not get to interrupt anyone — it waits for the
    // unlock and is re-run by it.
    jobid = await (interactive ? unlocked(run) : run());
  } catch (e) {
    if (String(e).startsWith(CONFIG_LOCKED)) {
      lockSkipped = true;
      return;
    }
    showError(t('Sync of "{name}" could not start: {error}', { name: pair.name, error: e }));
    return;
  }
  syncJobs.set(pair.name, { jobid, resync: !pair.initialized, force, interactive });
  await refreshPairs();
  followSync(pair.name);
}

// Deleting on one side means deleting on the other, and rclone refuses to do
// that until someone says so — through the RC it stops at the very first
// removed file. Say what it is about to delete, in files, and let the answer
// stick for this pair.
async function confirmDeletes(pair, n, total) {
  const { ok, extra } = await ask({
    title: t("Files were deleted"),
    text:
      n && total
        ? t(
            '{n} of {total} file(s) are gone from one side of "{name}". ' +
              "Syncing will remove them from the other side too.",
            { n, total, name: pair.name }
          )
        : t(
            'Files are gone from one side of "{name}". Syncing will remove ' +
              "them from the other side too.",
            { name: pair.name }
          ),
    points: [
      t("on this computer: {path}", { path: pair.local }),
      t("in the cloud: {path}", { path: pair.remote }),
      t("if this is not what you expected, cancel and check both folders first"),
    ],
    okLabel: t("Delete them"),
    danger: true,
    extra: { label: t("Stop asking for this pair"), checked: false },
  });
  return { ok, remember: !!extra };
}

// bisync of a real folder takes minutes; follow the job and keep the card
// honest about what is happening.
function followSync(name) {
  // rclone forgets a finished job after about a minute, and the poll then
  // fails for good. Retrying it forever left the pair pinned at "syncing"
  // — no result, no way to start it again — until Monti was restarted.
  let misses = 0;
  const tick = async () => {
    const job = syncJobs.get(name);
    if (!job) return;
    let p;
    try {
      p = await invoke("sync_progress", { jobid: job.jobid, name });
      misses = 0;
    } catch (e) {
      if (++misses < 10) {
        setTimeout(tick, 3000);
        return;
      }
      // Half a minute of silence: let the pair go rather than pretend.
      syncJobs.delete(name);
      await invoke("sync_finished", {
        name,
        ok: false,
        wasResync: job.resync,
        detail: t("lost track of this run — start it again to be sure"),
        rememberDeletes: false,
      }).catch(() => {});
      await refreshPairs().catch(() => {});
      showError(t('Sync of "{name}" failed: {error}', { name, error: String(e) }));
      return;
    }
    if (!p.finished) {
      const card = $("sync-list").querySelector(`[data-name="${CSS.escape(name)}"]`);
      const line = card && card.querySelector(".sync-progress");
      if (line) {
        line.textContent = p.transfers
          ? t("syncing — {n} file(s), {size}", {
              n: p.transfers,
              size: fmtBytes(p.bytes),
            })
          : t("syncing — checking {n} file(s)", { n: p.checks });
      }
      setTimeout(tick, 2000);
      return;
    }
    syncJobs.delete(name);

    // A job the locked config never let start is not a failed sync — the
    // run has simply not happened yet. The unlock re-runs it; a banner and
    // a desktop notification would dress the waiting up as an error.
    if (String(p.error || "").startsWith(CONFIG_LOCKED)) {
      configLocked = true;
      await refreshPairs().catch(() => {});
      // A hand-started sync deserves the dialog: rclone accepts an async
      // bisync and returns a job id even when the config is locked, so the
      // refusal arrives here rather than at the call unlocked() wraps.
      const pair = (await invoke("sync_pairs").catch(() => [])).find((x) => x.name === name);
      if (job.interactive && pair) {
        if (await askConfigPassword(String(p.error) === CONFIG_LOCKED_BAD)) {
          refreshRemotes().catch(() => {});
          await startSync(pair, job.force, true);
          return;
        }
      }
      lockSkipped = true;
      return;
    }

    // The one failure that is a question rather than a fault.
    const deletes = /^TOO_MANY_DELETES:(\d+):(\d+)$/.exec(p.error || "");
    if (!p.success && deletes && !job.force) {
      const pair = (await invoke("sync_pairs")).find((x) => x.name === name);
      await refreshPairs().catch(() => {});
      if (!pair) return;
      const { ok, remember } = await confirmDeletes(pair, +deletes[1], +deletes[2]);
      if (remember) {
        await invoke("sync_finished", {
          name,
          ok: false,
          wasResync: false,
          detail: "waiting for you",
          rememberDeletes: true,
        }).catch(() => {});
      }
      if (ok) await startSync(pair, true);
      return;
    }

    await invoke("sync_finished", {
      name,
      ok: p.success,
      wasResync: job.resync,
      detail: p.error || "",
      rememberDeletes: false,
    }).catch(() => {});
    if (!p.success) {
      showError(t('Sync of "{name}" failed: {error}', { name, error: p.error }));
      notify(
        t("Monti: sync failed"),
        t('"{name}" did not finish: {error}', { name, error: p.error })
      );
    }
    await refreshPairs().catch(() => {});
  };
  setTimeout(tick, 1500);
}

async function showConflicts(card, name) {
  let list;
  try {
    list = await invoke("sync_conflicts", { name });
  } catch {
    return;
  }
  if (!list.length) return;
  const box = document.createElement("div");
  box.className = "conflict-box";
  const head = document.createElement("div");
  head.className = "conflict-head";
  head.textContent = t("{n} file(s) changed on both sides", { n: list.length });
  box.append(head);
  for (const c of list.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "conflict-row";
    const name_ = document.createElement("span");
    name_.className = "transfer-name mono";
    setPath(name_, c.loser.split("/").pop(), c.loser);
    row.append(name_);
    const settle = (keep, label, title) =>
      makeBtn(
        label,
        "small",
        async () => {
          await invoke("sync_resolve", { loser: c.loser, keep }).catch((e) =>
            showError(String(e))
          );
          await refreshPairs();
        },
        title
      );
    // When both sides changed in the same second rclone renames both copies
    // and no current version is left — the backend says so with an empty
    // winner. Offering "keep current" there would delete the only copy of
    // the file, which is the opposite of what settling a conflict is for.
    if (c.winner) {
      row.append(settle("winner", t("keep current"), t("Delete this older copy")));
    } else {
      const gone = document.createElement("span");
      gone.className = "muted";
      gone.textContent = t("no current version — both sides were renamed");
      row.append(gone);
    }
    row.append(
      settle("loser", t("keep this"), t("Put this copy back under the original name")),
      settle("both", t("keep both"), t("Rename it to “(copy)” and stop calling it a conflict"))
    );
    box.append(row);
  }
  card.append(box);
}

let editingPair = null;
// Folders left out of the pair being edited, in the picker's hands.
let pairExcludes = [];

async function openPairDialog(pair = null) {
  editingPair = pair;
  showError("");
  const remotes = await unlocked(() => invoke("list_remotes")).catch(() => []);
  const sel = $("pair-remote");
  sel.innerHTML = "";
  for (const r of remotes) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    sel.append(opt);
  }
  $("pair-title").textContent = pair
    ? t("{name} — sync settings", { name: pair.name })
    : t("New sync");
  $("pair-name").value = pair ? pair.name : "";
  $("pair-name").disabled = !!pair; // the name keys the pair's history
  $("pair-local").value = pair ? pair.local : "";
  if (pair) {
    const [remote, ...rest] = pair.remote.split(":");
    sel.value = remote;
    $("pair-path").value = rest.join(":");
  } else {
    $("pair-path").value = "";
  }
  $("pair-schedule").value = pair ? pair.schedule : "manual";
  $("pair-conflict").value = pair ? pair.conflictResolve : "newer";
  // "Stop asking for this pair" used to be a one-way door: ticked once in a
  // confirmation, never visible again, and every later run — including the
  // unattended scheduled ones — carried force:true past bisync's own
  // safety abort. Here it is, where the pair is edited, and it can go back.
  $("pair-ask-deletes").checked = !(pair && pair.deleteWithoutAsking);
  pairExcludes = pair ? pair.excludes || [] : [];
  $("pair-folders-status").textContent = foldersSummary(pairExcludes);
  $("pair-dialog").showModal();
}

async function savePairFromDialog() {
  const name = $("pair-name").value.trim();
  const local = $("pair-local").value.trim(); // "~/..." is expanded by the backend
  const remote = `${$("pair-remote").value}:${$("pair-path").value.trim().replace(/^\/+/, "")}`;
  if (!$("pair-remote").value) {
    showError(t("Connect a cloud first — there is nothing to sync with."));
    return;
  }
  // Changing which folders a working pair carries sends it through the
  // first run again. That is not a formality: bisync compares this run
  // against its own listing from last time, so folders that vanish behind
  // a new filter read as "deleted here" — and answering Monti's delete
  // question would then remove them from the cloud. The first run rebuilds
  // the listing instead, and it never deletes anything.
  const filterChanged =
    editingPair && JSON.stringify(editingPair.excludes || []) !== JSON.stringify(pairExcludes);
  if (filterChanged && editingPair.initialized) {
    const { ok } = await ask({
      title: t('"{name}" will sync from scratch once', { name }),
      text: t("You changed which folders this pair carries."),
      points: [
        t("The next sync compares both sides fully and merges them, keeping the newer copy of anything that differs."),
        t("Nothing is deleted by that run, and folders you left out are simply not touched again."),
      ],
      okLabel: t("Save"),
    });
    if (!ok) return;
  }
  try {
    await invoke("sync_pair_save", {
      pair: {
        name,
        local,
        remote,
        schedule: $("pair-schedule").value,
        conflictResolve: $("pair-conflict").value,
        deleteWithoutAsking: !$("pair-ask-deletes").checked,
        initialized: editingPair ? editingPair.initialized : false,
        excludes: pairExcludes,
      },
    });
  } catch (e) {
    showError(String(e));
    return;
  }
  $("pair-dialog").close();
  await refreshPairs();
}

async function removePair(pair) {
  const { ok } = await ask({
    title: t('Stop syncing "{name}"?', { name: pair.name }),
    text: t("Monti forgets this pair. Nothing is deleted:"),
    points: [
      t("{path} stays exactly as it is", { path: pair.local }),
      t("{path} stays exactly as it is", { path: pair.remote }),
      t("the two simply stop being kept the same"),
    ],
    okLabel: t("Stop syncing"),
    danger: true,
  });
  if (!ok) return;
  await invoke("sync_pair_remove", { name: pair.name }).catch((e) => showError(String(e)));
  await refreshPairs();
}

// Pairs set to "when Monti starts". A pair that has never been synced is
// left alone: the first run needs an answer nobody is there to give.
async function syncOnStart() {
  const pairs = await invoke("sync_pairs").catch(() => []);
  for (const p of pairs) {
    if (p.schedule === "start" && p.initialized) await startSync(p, false, false).catch(() => {});
  }
}

// Pairs set to run on a schedule, driven from here because rclone has no
// scheduler of its own. Nothing runs while Monti is closed, and the Sync
// screen says so rather than implying a background service.
function startSyncSchedules() {
  const due = new Map(); // name -> next run, ms
  const period = { "15m": 15 * 60 * 1000, "1h": 60 * 60 * 1000 };
  setInterval(async () => {
    if (engineDown) return;
    let pairs;
    try {
      pairs = await invoke("sync_pairs");
    } catch {
      return;
    }
    const now = Date.now();
    for (const p of pairs) {
      const every = period[p.schedule];
      if (!every || !p.initialized || syncJobs.has(p.name)) continue;
      const next = due.get(p.name) ?? now + every;
      due.set(p.name, next);
      if (now >= next) {
        due.set(p.name, now + every);
        startSync(p, false, false).catch(() => {});
      }
    }
  }, 60000);
}

// ---------- drive settings dialog ----------

let dialogRemote = null;
// Public half of the key as stored in config when the dialog opened; the
// secret itself never reaches the webview (list_remotes is sanitized).
let dialogKey = { id: "" };
// Folders left out, edited by the picker and written on Save.
let dialogExcludes = [];

async function openRemoteDialog(name) {
  dialogRemote = name;
  showError("");
  const pref = prefFor(name);
  dialogExcludes = excludesFor(name);
  $("remote-folders-status").textContent = foldersSummary(dialogExcludes);
  $("remote-title").textContent = t("{name} — settings", { name });
  $("remote-mountpoint").value = pref.mountPoint || "";
  $("remote-automount").checked = !!pref.automount;
  const vfs = pref.vfs || {};
  $("remote-readonly").checked = !!vfs.readOnly;
  $("remote-cache-size").value = vfs.maxSize || "";
  $("remote-cache-age").value = vfs.maxAge || "";

  const remotes = await invoke("list_remotes");
  const info = remotes.find((r) => r.name === name) || {};

  // An API key and a browser sign-in belong to the providers that have one.
  // A Backblaze or WebDAV drive is reached with the credentials already in
  // the config, so the section and the Re-authorize button would offer
  // something that cannot happen.
  const oauth = OAUTH_PROVIDERS.has(info.type);
  $("remote-key-section").classList.toggle("hidden", !oauth);
  $("remote-reconnect").classList.toggle("hidden", !oauth);

  // A drive reached with a password needs the other thing: a way to change
  // that password when it stops working. Without it the only way back in is
  // deleting the drive, which also throws away its mount folder, its hidden
  // folders and everything it had cached. An encrypted drive is left out —
  // there the password is the key, and a new one unlocks nothing.
  const formBased = !oauth && !!FIELD_INPUT[info.type];
  $("remote-signin-row").classList.toggle("hidden", !formBased);
  if (formBased) {
    $("remote-signin-status").textContent = t("Saved on this computer.");
    invoke("remote_credentials", { name })
      .then(({ fields }) => {
        const who = fields.user || fields.username || fields.account || fields.access_key_id;
        if (who) $("remote-signin-status").textContent = t("Signed in as {who}", { who });
      })
      .catch(() => {});
  }

  dialogKey = { id: info.clientId || "", oauth };
  $("remote-client-id").value = dialogKey.id;
  $("remote-client-secret").value = "";
  $("remote-client-secret").placeholder = info.hasOwnKey
    ? t("unchanged — enter a new one to replace")
    : "";
  $("remote-key-status").textContent = dialogKey.id
    ? t("Using your own API key.")
    : t(
        "Using rclone's shared key — it is being retired during 2026, " +
          "switching to your own key is recommended."
      );

  // Say what the empty limit field actually means, instead of "unlimited".
  invoke("cache_info")
    .then((c) => {
      $("remote-cache-size").placeholder = t("{limit} · e.g. 10G", {
        limit: fmtLimit(c.defaultLimit),
      });
    })
    .catch(() => {});
  refreshDialogCache(name);

  $("remote-dialog").showModal();
}

// Storage section in Settings. A cache that outgrows the disk is the
// oldest and loudest complaint about rclone mounts, so say plainly how
// much is used, how much is left, and warn before the disk is gone.
async function refreshCacheInfo() {
  let info;
  try {
    info = await invoke("cache_info");
  } catch {
    return;
  }
  $("cache-used").textContent = fmtBytes(info.used);
  $("cache-free").textContent = fmtBytes(info.free);
  $("cache-default").textContent = fmtLimit(info.defaultLimit);

  lowDiskWarning($("cache-warning"), info.free);
}

// One sentence, two places: Settings, where someone went looking, and the
// drives screen, where they did not. A disk filling up is worth saying
// twice — by the time mounts start failing it is already too late.
const LOW_DISK = 2 * 1024 * 1024 * 1024;
let lowDiskTold = false;

function lowDiskWarning(el, free) {
  if (free > 0 && free < LOW_DISK) {
    el.textContent = t(
      "Only {left} left on this disk. Clear a drive's cache in its " +
        "settings, or lower its cache size limit.",
      { left: fmtBytes(free) }
    );
    el.classList.remove("hidden");
    // Once per crossing, not once per redraw: this check runs on every
    // refresh, and a notification per refresh would be its own problem.
    if (!lowDiskTold) {
      lowDiskTold = true;
      notify(
        t("Monti: this disk is nearly full"),
        t("Only {left} left. Clear a drive's cache or lower its limit.", {
          left: fmtBytes(free),
        })
      );
    }
  } else {
    el.classList.add("hidden");
    lowDiskTold = false;
  }
}

// Cache size for the open settings dialog, plus the state of its button.
async function refreshDialogCache(name) {
  const label = $("remote-cache-used");
  const btn = $("remote-cache-clear");
  label.textContent = t("counting…");
  btn.disabled = true;
  const used = await invoke("vfs_cache_size", { name }).catch(() => 0);
  const mounted = ownMounts.has(name);
  label.textContent = used ? fmtBytes(used) : t("nothing cached");
  btn.disabled = !used || mounted;
  btn.title = mounted
    ? t("Unmount the drive first — rclone is using these files right now")
    : t("Delete the downloaded copies kept on this computer");
}

// ---------- views ----------

function switchView(view) {
  // A message about what went wrong on one tab is not about the tab being
  // opened; leaving it up made a single failure look like the whole app was
  // broken, on every page, until something else happened to clear it.
  showError("");
  $("view-drives").classList.toggle("hidden", view !== "drives");
  $("view-sync").classList.toggle("hidden", view !== "sync");
  $("view-settings").classList.toggle("hidden", view !== "settings");
  document
    .querySelectorAll(".seg-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  // Numbers behind this tab go stale the moment it is hidden; refresh them
  // when it is actually being looked at rather than on a timer.
  if (view === "settings") {
    refreshCacheInfo().catch(() => {});
    refreshTransfers().catch(() => {});
  }
  if (view === "sync") refreshPairs().catch(() => {});
  // The drive list was the one tab drawn once and left alone, so anything
  // that changed while it was hidden — a drive added from a dialog, a config
  // unlocked, a mount that went away — was still on screen as it used to be.
  if (view === "drives") refreshRemotes({ quiet: true }).catch(() => {});
}

// What the engine has finished moving since it started. Answers "is it
// doing anything at all?", which is what most "it's broken" reports turn
// out to be about.
async function refreshTransfers() {
  const box = $("transfer-list");
  let list;
  try {
    list = (await invoke("transfer_history")).transferred || [];
  } catch {
    box.textContent = t("The engine isn't running.");
    return;
  }
  if (!list.length) {
    box.textContent = t("Nothing transferred since the engine started.");
    return;
  }
  box.innerHTML = "";
  for (const item of list.slice(-12).reverse()) {
    const row = document.createElement("div");
    row.className = "transfer-row";
    const name = document.createElement("span");
    name.className = "transfer-name mono";
    setPath(name, item.name || t("(unnamed)"), item.name || "");
    const meta = document.createElement("span");
    meta.className = item.error ? "transfer-meta failed" : "transfer-meta";
    meta.textContent = item.error
      ? t("failed")
      : fmtBytes(item.bytes || item.size || 0) +
        (item.checked ? " · " + t("checked") : "");
    row.append(name, meta);
    box.append(row);
  }
}

async function initSettings() {
  const info = await invoke("app_info");
  $("about-version").textContent = `v${info.appVersion}`;
  $("about-rclone").textContent = info.rcloneVersion || t("not installed");
  setPath($("about-rclone-path"), info.rclonePath || "—");
  setPath($("about-config"), info.configPath || "—");
  $("open-config-btn").addEventListener("click", () => {
    if (info.configPath) {
      const dir = info.configPath.slice(0, info.configPath.lastIndexOf("/"));
      invoke("open_folder", { path: dir }).catch((e) => showError(String(e)));
    }
  });

  await refreshCacheInfo();

  // Re-download the engine into the app folder (recovers from a corrupted
  // or interrupted download; the running daemon keeps its old binary until
  // the next engine restart).
  $("reinstall-btn").addEventListener("click", async () => {
    const btn = $("reinstall-btn");
    const status = $("reinstall-status");
    btn.disabled = true;
    showError("");
    status.textContent = t("Downloading rclone… (10–40 MB)");
    status.dataset.downloading = "1";
    status.classList.remove("hidden");
    try {
      const path = await invoke("install_rclone");
      delete status.dataset.downloading;
      status.textContent = t(
        "Done — installed to {path}. Takes effect on the next engine restart.",
        { path }
      );
      const fresh = await invoke("app_info");
      $("about-rclone").textContent = fresh.rcloneVersion || t("not installed");
      setPath($("about-rclone-path"), fresh.rclonePath || "—");
    } catch (e) {
      delete status.dataset.downloading;
      status.classList.add("hidden");
      showError(String(e));
    } finally {
      btn.disabled = false;
    }
  });

  // Autostart on login
  $("opt-autostart").checked = await invoke("get_autostart");
  $("opt-autostart").addEventListener("change", async (e) => {
    try {
      await invoke("set_autostart", { enabled: e.target.checked });
    } catch (err) {
      showError(String(err));
      e.target.checked = !e.target.checked;
    }
  });

  // Keep drives mounted after quit (default: on)
  const keepPref = localStorage.getItem("monti.keepMounts");
  const keepOn = keepPref === null ? true : keepPref === "1";
  $("opt-keep-mounts").checked = keepOn;
  await invoke("set_keep_mounts", { enabled: keepOn });
  $("opt-keep-mounts").addEventListener("change", async (e) => {
    localStorage.setItem("monti.keepMounts", e.target.checked ? "1" : "0");
    await invoke("set_keep_mounts", { enabled: e.target.checked });
  });

  // Close to tray
  const trayPref = localStorage.getItem("monti.closeToTray");
  const trayOn = trayPref === null ? true : trayPref === "1";
  $("opt-tray").checked = trayOn && info.trayAvailable;
  $("opt-tray").disabled = !info.trayAvailable;
  if (!info.trayAvailable) {
    $("tray-hint").textContent = t(
      "Tray isn't available on this desktop — closing the window quits Monti. " +
        "(On Arch/Manjaro: install libayatana-appindicator.)"
    );
  }
  await invoke("set_close_to_tray", {
    enabled: trayOn && info.trayAvailable,
  });
  $("opt-tray").addEventListener("change", async (e) => {
    localStorage.setItem("monti.closeToTray", e.target.checked ? "1" : "0");
    await invoke("set_close_to_tray", { enabled: e.target.checked });
  });

  // Desktop notifications
  $("opt-notify").checked = notifyEnabled();
  $("opt-notify").addEventListener("change", (e) => {
    localStorage.setItem(NOTIFY_KEY, e.target.checked ? "on" : "off");
  });

  // Language. Switching redraws the page instead of restarting the app, so
  // whatever is on screen — a mounted drive, a running transfer — stays.
  const langSel = $("opt-lang");
  for (const { code, label } of LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    langSel.append(opt);
  }
  langSel.value = getLang();
  langSel.addEventListener("change", (e) => setLang(e.target.value));

  // Appearance
  const theme = $("opt-theme");
  theme.value = savedTheme();
  theme.addEventListener("change", (e) => {
    localStorage.setItem(THEME_KEY, e.target.value);
    applyTheme(e.target.value);
  });

  // Speed limit. The engine forgets it on every restart, so the choice is
  // ours to remember and re-apply — see applyBwLimit() at boot.
  const sel = $("opt-bwlimit");
  sel.value = savedBwLimit();
  sel.addEventListener("change", async (e) => {
    const rate = e.target.value;
    localStorage.setItem(BW_KEY, rate);
    try {
      await invoke("bandwidth_limit", { rate });
    } catch (err) {
      showError(String(err));
    }
  });
}

// ---------- boot ----------

async function boot() {
  showError("");
  const status = await invoke("engine_status");

  if (!status.rcloneFound) {
    setEngine("err", "engine not installed");
    $("install-card").classList.remove("hidden");
    $("remotes-section").classList.add("hidden");
    return;
  }
  $("install-card").classList.add("hidden");

  try {
    setEngine("warn", "starting…");
    await invoke("start_engine");
    setEngine("ok", status.version || "engine running");
    $("remotes-section").classList.remove("hidden");
    await applyBwLimit();
    // The drive list first: with a locked config this is where the password
    // dialog appears, once, before anything else needs the answer.
    await refreshRemotes();
    if (await autoRemount()) await refreshRemotes();
    await syncOnStart();
    startSyncSchedules();
    if (!activityTimer) activityTimer = setInterval(pollActivity, 2000);
    if (!healthTimer) healthTimer = setInterval(healthTick, 5000);
  } catch (e) {
    setEngine("err", "engine failed");
    showError(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  applyTheme(); // before anything is painted, so there is no flash
  applyDom(); // and the same for the language, for the same reason

  // Everything drawn from JavaScript has to be drawn again in the new
  // language; the static markup is handled inside setLang().
  onLangChange(() => {
    if (lastEngine) setEngine(...lastEngine);
    refreshRemotes().catch(() => {});
    refreshPairs().catch(() => {});
    refreshCacheInfo().catch(() => {});
    refreshTransfers().catch(() => {});
  });

  for (const id of [
    "add-dialog",
    "confirm-dialog",
    "remote-dialog",
    "pair-dialog",
    "folders-dialog",
    "link-dialog",
    "firstsync-dialog",
  ]) {
    closeOnBackdropClick($(id));
  }






  boot();
  initSettings().catch((e) => showError(String(e)));

  // The tray's per-drive actions. They happen with the window hidden, so
  // anything that goes wrong is said in a notification — an error banner in
  // a window nobody is looking at is not saying it.
  listen("tray-action", async (e) => {
    const { action, name } = e.payload;
    try {
      if (action === "unmountall") {
        // One click before undocking or suspending. A drive still writing
        // refuses, says which one, and the rest still come down — the point
        // is to leave nothing half-uploaded, not to force everything off.
        const busy = [];
        const failed = [];
        for (const [drive, point] of [...ownMounts]) {
          // Whatever one drive says, the rest still come down. Rethrowing
          // here abandoned every drive after the first difficult one, and
          // the outer handler had no drive name to report — the person got
          // a desktop notification reading "undefined".
          await invoke("unmount_remote", { mountPoint: point }).catch((err) => {
            if (String(err).includes("UPLOADS_PENDING")) busy.push(drive);
            else failed.push(`${drive}: ${err}`);
          });
        }
        if (busy.length) {
          notify(
            t("{n} drive(s) are still uploading", { n: busy.length }),
            t("{drives} — open Monti to unmount anyway.", {
              drives: busy.join(", "),
            })
          );
        }
        if (failed.length) {
          notify(t("Could not unmount everything"), failed.join("\n"));
          showError(failed.join("; "));
        }
        await refreshRemotes();
        return;
      }
      if (action === "mount") {
        await invoke("mount_remote", {
          name,
          mountPoint: prefFor(name).mountPoint || null,
          vfs: vfsOptFor(name),
          excludes: excludesFor(name),
        });
      } else {
        const point = ownMounts.get(name);
        if (!point) return;
        await invoke("unmount_remote", { mountPoint: point });
      }
      await refreshRemotes();
    } catch (err) {
      const pending = String(err).match(/UPLOADS_PENDING:(\d+)/);
      if (pending) {
        notify(
          t("“{name}” is still uploading", { name }),
          t(
            "{n} file(s) have not reached the cloud yet. Open Monti to " +
              "unmount anyway.",
            { n: pending[1] }
          )
        );
      } else if (String(err).startsWith(CONFIG_LOCKED)) {
        notify(t("The rclone config is locked."), t("Open Monti and enter the password first."));
      } else {
        notify(
          action === "mount"
            ? t("Could not mount “{name}”", { name })
            : t("Could not unmount “{name}”", { name }),
          String(err)
        );
        showError(String(err));
      }
    }
  });

  // Live progress for the engine download (first install and reinstall).
  listen("engine-download", (e) => {
    const { downloaded, total } = e.payload;
    const text = total
      ? t("Downloading rclone… {percent}% of {size}", {
          percent: Math.round((downloaded / total) * 100),
          size: fmtBytes(total),
        })
      : t("Downloading rclone… {size}", { size: fmtBytes(downloaded) });
    // Which line to write into is a flag on the element, not the text it
    // happens to hold: the text is translated, "Downloading" is not a
    // prefix any more.
    for (const id of ["install-status", "reinstall-status"]) {
      const el = $(id);
      if (el && !el.classList.contains("hidden") && el.dataset.downloading) {
        el.textContent = text;
      }
    }
  });

  document.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  // --- engine recovery ---
  $("engine-restart").addEventListener("click", async () => {
    const btn = $("engine-restart");
    btn.disabled = true;
    setEngine("warn", "restarting…");
    try {
      await invoke("restart_engine");
      engineDown = false;
      btn.classList.add("hidden");
      setEngine("ok", "engine running");
      showError("");
      // A fresh daemon is an unlimited daemon; put the limit back before
      // the restored mounts start moving data.
      await applyBwLimit();
      await refreshRemotes();
    } catch (e) {
      setEngine("err", "engine stopped");
      showError(String(e));
    } finally {
      btn.disabled = false;
    }
  });

  // External links must open in the system browser, not inside the app.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='http']");
    if (!a) return;
    e.preventDefault();
    invoke("open_link", { url: a.href }).catch((err) => showError(String(err)));
  });

  // --- install engine ---
  $("install-btn").addEventListener("click", async () => {
    const btn = $("install-btn");
    btn.disabled = true;
    $("install-status").textContent = t("Downloading rclone… (10–40 MB)");
    $("install-status").dataset.downloading = "1";
    try {
      await invoke("install_rclone");
      delete $("install-status").dataset.downloading;
      $("install-status").textContent = t("Done!");
      await boot();
    } catch (e) {
      delete $("install-status").dataset.downloading;
      $("install-status").textContent = "";
      showError(String(e));
    } finally {
      btn.disabled = false;
    }
  });

  // --- a link to a file ---
  $("link-copy").addEventListener("click", () => {
    const field = $("link-url");
    field.select();
    // execCommand is old, but the async clipboard API needs a secure origin
    // and the webview's tauri:// origin is not one of those.
    const done = document.execCommand("copy");
    $("link-copy").textContent = done ? t("Copied") : t("Press Ctrl+C");
  });

  // --- browsing for a folder on this computer ---
  for (const [button, field] of [
    ["remote-browse", "remote-mountpoint"],
    ["pair-browse", "pair-local"],
  ]) {
    $(button).addEventListener("click", async () => {
      try {
        const picked = await invoke("pick_folder", { start: $(field).value.trim() || null });
        if (picked) $(field).value = picked;
      } catch (e) {
        showError(String(e));
      }
    });
  }

  // --- choosing folders ---
  $("folders-cancel").addEventListener("click", () => $("folders-dialog").close());
  $("folders-all").addEventListener("click", () => {
    picker.excluded.clear();
    refreshPickerRows();
  });
  // Closing by Escape or by clicking beside the dialog means "never mind",
  // so the promise has to settle either way — a picker nobody answered must
  // not leave the settings dialog waiting forever.
  $("folders-dialog").addEventListener("close", () => {
    if (picker?.resolve) picker.resolve(null);
    picker = null;
  });
  $("folders-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const chosen = [...picker.excluded].sort();
    picker.resolve(chosen);
    picker.resolve = null;
    $("folders-dialog").close();
  });

  $("remote-folders-choose").addEventListener("click", async () => {
    const chosen = await chooseFolders({
      remote: dialogRemote,
      base: "",
      excluded: dialogExcludes,
      title: t('Folders of "{name}"', { name: dialogRemote }),
      hint: t(
        "Unticked folders are left out of the mounted drive: they stay in " +
          "the cloud, they just do not appear on this computer."
      ),
    });
    if (!chosen) return;
    dialogExcludes = chosen;
    $("remote-folders-status").textContent = foldersSummary(chosen);
  });

  $("pair-folders-choose").addEventListener("click", async () => {
    const remote = $("pair-remote").value;
    if (!remote) {
      showError(t("Pick the cloud first — its folders are what you choose from."));
      return;
    }
    const base = $("pair-path").value.trim().replace(/^\/+|\/+$/g, "");
    const chosen = await chooseFolders({
      remote,
      base,
      excluded: pairExcludes,
      title: t("Folders to sync"),
      hint: t(
        "Unticked folders are not synced: they stay as they are on both " +
          "sides, and Monti stops comparing them."
      ),
    });
    if (!chosen) return;
    pairExcludes = chosen;
    $("pair-folders-status").textContent = foldersSummary(chosen);
  });

  // --- synced folders ---
  $("add-pair-btn").addEventListener("click", () => openPairDialog().catch((e) => showError(String(e))));
  $("pair-cancel").addEventListener("click", () => $("pair-dialog").close());
  $("pair-form").addEventListener("submit", (e) => {
    e.preventDefault(); // saving can fail, and the dialog must stay open then
    savePairFromDialog().catch((err) => showError(String(err)));
  });

  // --- add cloud dialog ---
  //
  // The same dialog changes the sign-in of a drive that already exists: the
  // fields are the same fields. A second copy of them would be a second
  // place to keep WebDAV vendors, S3 endpoints and Proton's one-time code
  // right, and one of the two would drift.
  let signInFor = null;

  const addDialogMode = (name, type) => {
    signInFor = name;
    $("add-title").textContent = name ? t("{name} — sign in again", { name }) : t("Add a cloud");
    // The drive is already chosen. Offering to rename it, or to turn it into
    // a different provider, would be offering to make a different drive.
    $("add-name-row").classList.toggle("hidden", !!name);
    $("add-provider-row").classList.toggle("hidden", !!name);
    // The button stays "Connect" in both modes, because that is what it
    // does — and because Proton's code field says to press Connect while
    // the code is still alive.
    if (name) {
      // The box is hidden, not gone: an empty required field the person
      // cannot see would block the form with nothing to show for it.
      $("add-name").value = name;
      $("add-provider").value = type;
    }
  };

  // The way back from the locked state. The dialog itself refreshes the
  // page when it succeeds, so there is nothing to do here on failure — the
  // panel is still on screen with the same button.
  $("locked-unlock").addEventListener("click", async () => {
    if (await askConfigPassword(false)) await refreshRemotes().catch(() => {});
  });

  $("add-btn").addEventListener("click", () => {
    $("add-form").reset();
    showError("");
    $("add-status").classList.add("hidden");
    $("add-advanced").open = false;
    for (const ids of Object.values(SECRET_INPUT))
      for (const id of ids) $(id).placeholder = "";
    addDialogMode(null, null);
    updateAddForm();
    $("add-dialog").showModal();
  });

  // Same form, filled in with what is already known about the drive —
  // everything except the secret, which is what is being replaced.
  const openSignInDialog = async (name) => {
    let info;
    try {
      info = await invoke("remote_credentials", { name });
    } catch (err) {
      showError(String(err));
      return;
    }
    $("add-form").reset();
    showError("");
    $("add-status").classList.add("hidden");
    $("add-advanced").open = false;
    addDialogMode(name, info.type);
    updateAddForm();
    for (const [key, value] of Object.entries(info.fields || {})) {
      const el = $(FIELD_INPUT[info.type]?.[key] || "");
      if (el) el.value = value;
    }
    // Short on purpose: some of these boxes are half a row wide, and a
    // placeholder that gets cut off mid-word says less than one word does.
    for (const id of SECRET_INPUT[info.type] || []) $(id).placeholder = t("unchanged");
    $("add-dialog").showModal();
  };
  $("add-cancel").addEventListener("click", async () => {
    await abortAuth();
    $("add-dialog").close();
  });
  $("add-dialog").addEventListener("cancel", () => abortAuth());

  // Show the fields that match the chosen provider: OAuth clouds get the
  // API-key section and browser hint, servers get their own form.
  const updateAddForm = () => {
    const p = $("add-provider").value;
    const oauth = OAUTH_PROVIDERS.has(p);
    $("add-advanced").classList.toggle("hidden", !oauth);
    $("add-oauth-hint").classList.toggle("hidden", !oauth);
    // The step-by-step key guide is written for Google Drive.
    $("key-help-drive").classList.toggle("hidden", p !== "drive");
    document
      .querySelectorAll(".params")
      .forEach((d) => d.classList.toggle("hidden", d.id !== `params-${p}`));
    if (p === "storj") updateStorjForm();
    $("add-status").textContent = oauth
      ? t("⏳ Waiting for you to authorize in the browser… Press Cancel to abort.")
      : t("⏳ Connecting…");
    // An encrypted drive is stored inside a drive that already exists, so
    // the list of those has to be current every time the form is shown.
    if (p === "crypt") {
      invoke("list_remotes")
        .then((remotes) => {
          const sel = $("crypt-remote");
          sel.innerHTML = "";
          for (const r of remotes.filter((r) => r.type !== "crypt")) {
            const opt = document.createElement("option");
            opt.value = r.name;
            opt.textContent = r.name;
            sel.append(opt);
          }
        })
        .catch(() => {});
    }
  };
  $("add-provider").addEventListener("change", updateAddForm);

  // Storj takes either an access grant or the three values it is made from.
  // Showing both at once asks for one of them to be filled in by mistake.
  const updateStorjForm = () => {
    const grant = $("storj-provider").value === "existing";
    $("storj-grant-rows").classList.toggle("hidden", !grant);
    $("storj-key-rows").classList.toggle("hidden", grant);
  };
  $("storj-provider").addEventListener("change", updateStorjForm);

  // Non-OAuth providers: collect their form fields and check the required
  // ones (native `required` can't be used — the fields are often hidden).
  // When an existing drive is being signed in again, a blank secret means
  // "keep the saved one", so it is not demanded.
  const collectParams = (p, editing = false) => {
    const v = (id) => $(id).value.trim();
    if (p === "webdav") {
      if (!v("webdav-url")) return t("Server URL is required.");
      return {
        url: v("webdav-url"),
        vendor: $("webdav-vendor").value,
        user: v("webdav-user"),
        pass: $("webdav-pass").value,
      };
    }
    if (p === "s3") {
      if (!editing && (!v("s3-access") || !$("s3-secret").value))
        return t("Access key ID and Secret access key are required.");
      if ($("s3-provider").value !== "AWS" && !v("s3-endpoint"))
        return t("Endpoint is required for non-Amazon S3 services.");
      return {
        provider: $("s3-provider").value,
        access_key_id: v("s3-access"),
        secret_access_key: $("s3-secret").value,
        endpoint: v("s3-endpoint"),
        region: v("s3-region"),
      };
    }
    if (p === "protondrive") {
      if (!editing && (!v("proton-user") || !$("proton-pass").value))
        return t("E-mail and password are required.");
      const params = { username: v("proton-user"), password: $("proton-pass").value };
      // Sent only when there is one: an empty code is not the same as no
      // second factor, and rclone treats it as a failed one.
      const code = v("proton-2fa");
      if (code) params["2fa"] = code;
      return params;
    }
    if (p === "jottacloud") {
      // Not a password: a token the account's security page prints once,
      // which rclone trades for a session of its own.
      if (!v("jotta-token")) return t("A personal login token is required.");
      return { login_token: v("jotta-token") };
    }
    if (p === "storj") {
      // An access grant already carries the passphrase; the other route
      // spells the same thing out in three fields.
      if ($("storj-provider").value === "existing") {
        if (!editing && !$("storj-grant").value) return t("An access grant is required.");
        return { provider: "existing", access_grant: $("storj-grant").value };
      }
      if (!editing && (!$("storj-key").value || !$("storj-passphrase").value))
        return t("An API key and an encryption passphrase are required.");
      return {
        provider: "new",
        satellite_address: v("storj-satellite") || "us1.storj.io",
        api_key: $("storj-key").value,
        passphrase: $("storj-passphrase").value,
      };
    }
    if (p === "koofr") {
      const service = $("koofr-provider").value;
      if (!editing && (!v("koofr-user") || !$("koofr-pass").value))
        return t("E-mail and app password are required.");
      if (service === "other" && !v("koofr-endpoint"))
        return t("An API endpoint is required for other Koofr-compatible services.");
      return {
        provider: service,
        endpoint: v("koofr-endpoint"),
        user: v("koofr-user"),
        password: $("koofr-pass").value,
      };
    }
    if (p === "mega") {
      if (!editing && (!v("mega-user") || !$("mega-pass").value))
        return t("E-mail and password are required.");
      return { user: v("mega-user"), pass: $("mega-pass").value };
    }
    if (p === "b2") {
      // rclone calls them account and key; Backblaze calls them keyID and
      // applicationKey on the page they are copied from.
      if (!editing && (!v("b2-account") || !$("b2-key").value))
        return t("Key ID and Application key are required.");
      return { account: v("b2-account"), key: $("b2-key").value };
    }
    if (p === "sftp") {
      if (!v("sftp-host") || !v("sftp-user"))
        return "Host and Username are required.";
      return {
        host: v("sftp-host"),
        port: v("sftp-port"),
        user: v("sftp-user"),
        pass: $("sftp-pass").value,
        key_file: v("sftp-key"),
      };
    }
    if (p === "crypt") {
      const base = $("crypt-remote").value;
      if (!base) return t("Add a drive first — an encrypted drive lives inside one.");
      // Both fields are compared as typed, spaces included: the password is
      // sent unchanged, and a mistyped one is only discovered much later,
      // when the files no longer open.
      const pass = $("crypt-pass").value;
      if (!pass) return t("A password is required — that is the whole point.");
      if (pass !== $("crypt-pass2").value) return t("The two passwords are not the same.");
      if (!$("crypt-understood").checked)
        return t("Please confirm the password is written down: it cannot be recovered.");
      const folder = v("crypt-path").replace(/^\/+|\/+$/g, "") || "Encrypted";
      return { remote: `${base}:${folder}`, password: pass };
    }
    return null;
  };

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("add-name").value.trim();
    const provider = $("add-provider").value;
    const params = collectParams(provider, !!signInFor);
    if (typeof params === "string") {
      showError(params);
      return;
    }
    $("add-submit").disabled = true;
    showError("");
    // Adding a drive reads the config first, to see the name is free — so
    // this is the other door a locked config is met at, and it asks here
    // rather than failing with rclone's own words.
    const ok = await withAuth($("add-status"), () =>
      unlocked(() =>
        signInFor
          ? invoke("update_remote_credentials", { name: signInFor, params })
          : invoke("create_remote", {
              name,
              provider,
              clientId: $("add-client-id").value.trim() || null,
              clientSecret: $("add-client-secret").value.trim() || null,
              params,
            })
      )
    );
    $("add-submit").disabled = false;
    if (ok) {
      // Sensible default: new drives mount automatically from now on.
      if (!signInFor) setPref(name, { automount: true });
      $("add-dialog").close();
      $("remote-dialog").close();
      await refreshRemotes();
    } else if (provider === "protondrive" && $("proton-2fa").value.trim()) {
      // A code dies the moment it is tried, right or wrong. Clear that one
      // field and put the cursor in it: everything else the person typed
      // stays, so a second attempt is six digits of work.
      $("proton-2fa").value = "";
      $("proton-2fa").focus();
    }
  });

  // --- drive settings dialog ---
  $("remote-cancel").addEventListener("click", async () => {
    await abortAuth();
    $("remote-dialog").close();
  });
  $("remote-dialog").addEventListener("cancel", () => abortAuth());

  $("remote-cache-clear").addEventListener("click", async () => {
    if (!dialogRemote) return;
    const name = dialogRemote;
    const used = await invoke("vfs_cache_size", { name }).catch(() => 0);
    const { ok } = await ask({
      title: t("Clear the local cache?"),
      text: t(
        '{size} of downloaded copies of "{name}" will be deleted from this computer.',
        { size: fmtBytes(used), name }
      ),
      points: [
        t("Files in the cloud are not touched."),
        t("They download again the next time you open them."),
      ],
      okLabel: t("Clear cache"),
      danger: true,
    });
    if (!ok) return;
    try {
      await invoke("clear_vfs_cache", { name });
    } catch (e) {
      showError(String(e));
    }
    await refreshDialogCache(name);
  });

  $("remote-signin").addEventListener("click", () => {
    if (dialogRemote) openSignInDialog(dialogRemote);
  });

  $("remote-reconnect").addEventListener("click", async () => {
    if (!dialogRemote) return;
    $("remote-save").disabled = true;
    $("remote-reconnect").disabled = true;
    const ok = await withAuth($("remote-status"), () =>
      invoke("reconnect_remote", { name: dialogRemote })
    );
    $("remote-save").disabled = false;
    $("remote-reconnect").disabled = false;
    if (ok) {
      $("remote-dialog").close();
      await refreshRemotes();
    }
  });

  $("remote-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dialogRemote) return;
    const maxSize = $("remote-cache-size").value.trim();
    const maxAge = $("remote-cache-age").value.trim();
    if (maxSize && !SIZE_RE.test(maxSize)) {
      showError(t('"{value}" is not a size — try something like 500M or 10G.', { value: maxSize }));
      return;
    }
    if (maxAge && !AGE_RE.test(maxAge)) {
      showError(
        t('"{value}" is not a duration — try something like 30m, 24h or 7d.', {
          value: maxAge,
        })
      );
      return;
    }
    const name = dialogRemote;
    const foldersChanged =
      JSON.stringify(excludesFor(name)) !== JSON.stringify(dialogExcludes);
    setPref(name, {
      mountPoint: $("remote-mountpoint").value.trim() || null,
      automount: $("remote-automount").checked,
      excludes: dialogExcludes,
      vfs: {
        readOnly: $("remote-readonly").checked,
        maxSize: maxSize || null,
        maxAge: maxAge || null,
      },
    });

    const newId = $("remote-client-id").value.trim();
    const newSecret = $("remote-client-secret").value.trim();
    // An empty secret field means "keep the stored secret" — the stored
    // value is never shown here. A key update happens when the ID changes
    // or a new secret was typed.
    // Only where a key means anything: the fields are hidden for the rest,
    // and a hidden field must never decide to re-run an authorization.
    const keyChanged =
      dialogKey.oauth && (newId !== dialogKey.id || newSecret !== "");

    if (keyChanged) {
      if (newId && newId !== dialogKey.id && !newSecret) {
        showError(t("Enter the Client secret that pairs with the new Client ID."));
        return;
      }
      if (!newId && newSecret) {
        showError(t("Enter the Client ID that pairs with this Client secret."));
        return;
      }
      // Changing the key re-runs the browser authorization in one go.
      $("remote-save").disabled = true;
      const ok = await withAuth($("remote-status"), () =>
        invoke("update_remote_key", {
          name: dialogRemote,
          clientId: newId,
          clientSecret: newSecret,
        })
      );
      $("remote-save").disabled = false;
      if (!ok) return; // keep the dialog open so nothing is silently lost
    }
    $("remote-dialog").close();
    await refreshRemotes();
    // A mounted drive keeps showing the old set of folders: rclone builds
    // the filter when the mount is made. Say so, and offer the remount
    // rather than leaving a setting that appears to have done nothing.
    if (foldersChanged && ownMounts.has(name)) {
      const point = ownMounts.get(name);
      const { ok } = await ask({
        title: t('Remount "{name}" now?', { name }),
        text: t("The folders you chose apply from the next mount on."),
        points: [
          t("Monti unmounts the drive and mounts it again — a few seconds."),
          t("Files open from that folder right now would lose their connection."),
        ],
        okLabel: t("Remount"),
      });
      if (!ok) return;
      try {
        await invoke("unmount_remote", { mountPoint: point });
        await invoke("mount_remote", {
          name,
          mountPoint: prefFor(name).mountPoint || null,
          vfs: vfsOptFor(name),
          excludes: excludesFor(name),
        });
      } catch (e) {
        showError(String(e));
      }
      await refreshRemotes();
    }
  });
});
