const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const PROVIDER_LABELS = {
  drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  box: "Box",
  pcloud: "pCloud",
  yandex: "Yandex Disk",
  webdav: "WebDAV",
  s3: "S3",
  sftp: "SFTP",
};

// Providers that authorize through the browser; the rest are configured
// entirely from form fields.
const OAUTH_PROVIDERS = new Set(["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"]);

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

function setEngine(stateClass, label) {
  $("engine-dot").className = `dot ${stateClass}`;
  $("engine-label").textContent = label;
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
    return (
      "Google refused the sign-in (403 access_denied): the Google account " +
      "you signed in with is not on your app's test-user list.\n\n" +
      "Fix: open console.cloud.google.com/auth/audience → Test users → " +
      "Add users → add your own e-mail → Save, then try again."
    );
  if (s.includes("invalid_client"))
    return (
      "Google rejected the API key (invalid_client): the Client ID or " +
      "Client secret has a typo. Copy both values again from " +
      "console.cloud.google.com/apis/credentials."
    );
  if (s.includes("address already in use"))
    return (
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
  let lost;
  try {
    lost = await invoke("lost_mounts");
  } catch {
    return; // engine busy or restarting — the next pass will tell
  }
  if (!lost.length) return;
  const which = lost.join(", ");
  showError(
    `${which} is no longer mounted — something unmounted it outside Monti. ` +
      "Press Mount on the drive to bring the folder back."
  );
  notify(
    "Monti: a drive disconnected",
    `${which} is no longer mounted. Open Monti and press Mount.`
  );
  await refreshRemotes().catch(() => {});
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
      "The rclone engine stopped unexpectedly — your drives are disconnected. " +
        "Press “Restart engine” to bring them back."
    );
    notify(
      "Monti: your drives are disconnected",
      "The rclone engine stopped. Open Monti and press “Restart engine”."
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

const fmtBytes = (n) =>
  n >= 1073741824
    ? `${(n / 1073741824).toFixed(1)} GB`
    : n >= 1048576
      ? `${Math.round(n / 1048576)} MB`
      : `${Math.max(1, Math.round(n / 1024))} kB`;

// rclone size strings ("20480M") are for rclone, not for people.
const fmtLimit = (s) =>
  String(s).replace(/^(\d+)M$/, (_, m) =>
    m >= 1024 ? `${Math.round(m / 1024)} GB` : `${m} MB`
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
    text.textContent = `${fmtBytes(used)} of ${fmtBytes(total)} used in the cloud`;
  } else {
    bar.classList.add("hidden");
    text.textContent = `${fmtBytes(used ?? total)} used in the cloud`;
  }
  el.classList.remove("hidden");
}

const fmtSpeed = (bps) =>
  bps >= 1048576
    ? `${(bps / 1048576).toFixed(1)} MB/s`
    : bps >= 1024
      ? `${Math.round(bps / 1024)} kB/s`
      : `${Math.round(bps)} B/s`;

async function pollActivity() {
  if (document.hidden) return;
  const pill = $("activity-pill");
  try {
    const stats = await rc("core/stats");
    const transfers = stats.transferring || [];
    if (transfers.length) {
      const speed = transfers.reduce((s, t) => s + (t.speed || 0), 0);
      $("activity-label").textContent = `${transfers.length} file${
        transfers.length === 1 ? "" : "s"
      } · ${fmtSpeed(speed)}`;
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

// ---------- drives ----------

async function fetchState() {
  const [remotes, mounts, sysMounts] = await Promise.all([
    invoke("list_remotes"),
    rc("mount/listmounts"),
    invoke("list_system_mounts"),
  ]);
  // rclone answers with the canonical fs, which is "gdrive:" for a cloud but
  // "gdrive:." for a local remote — the drive name is what precedes the colon.
  const own = new Map(
    (mounts.mountPoints || []).map((m) => [m.Fs.split(":")[0], m.MountPoint])
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

async function refreshRemotes() {
  const { remotes, own, external } = await fetchState();
  ownMounts = own;
  const list = $("remotes-list");
  list.innerHTML = "";
  $("empty-hint").classList.toggle("hidden", remotes.length > 0);

  invoke("disk_free")
    .then((free) => lowDiskWarning($("disk-warning"), free))
    .catch(() => {});

  for (const { name, type, hasOwnKey: ownKey, mountedReadOnly } of remotes) {
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
            ? '<span class="chip state on">mounted</span>' +
              '<span class="chip state sync hidden" title="Uploading changes to the cloud">⇅ syncing</span>'
            : extPoint
              ? '<span class="chip state ext" title="Mounted outside Monti (e.g. a systemd service).">mounted · system</span>'
              : '<span class="chip state">not mounted</span>'
        }
      </div>
      <div class="remote-tags">
        <span class="chip provider"></span>
        ${ownKey ? '<span class="chip key" title="Connected through your own API key">own key</span>' : ""}
        ${readOnly ? '<span class="chip" title="Read-only: files cannot be changed">read-only</span>' : ""}
      </div>
      <div class="remote-path muted mono"></div>
      <div class="remote-quota hidden">
        <div class="quota-bar"><span></span></div>
        <div class="quota-text muted"></div>
      </div>
      <div class="remote-cache muted hidden"></div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = PROVIDER_LABELS[type] || type;
    const pathEl = card.querySelector(".remote-path");
    pathEl.textContent =
      ownPoint || extPoint || prefFor(name).mountPoint || `~/CloudDrives/${name}`;
    // The line is truncated to keep every card the same shape; the full
    // path is one hover away.
    pathEl.title = pathEl.textContent;
    card.querySelector(".remote-name").title = name;

    // Measuring walks the cache directory, so do it after the card is on
    // screen rather than holding up the whole list.
    const cacheEl = card.querySelector(".remote-cache");
    invoke("vfs_cache_size", { name })
      .then((used) => {
        if (!used) return;
        cacheEl.textContent = `${fmtBytes(used)} cached on this computer`;
        cacheEl.classList.remove("hidden");
      })
      .catch(() => {});

    showQuota(card.querySelector(".remote-quota"), name);

    const actions = card.querySelector(".remote-actions");

    if (ownPoint) {
      actions.append(
        makeBtn("Open folder", "primary", () => invoke("open_folder", { path: ownPoint })),
        makeBtn("Unmount", "", async () => {
          try {
            await invoke("unmount_remote", { mountPoint: ownPoint });
          } catch (e) {
            const m = String(e).match(/UPLOADS_PENDING:(\d+)/);
            if (!m) throw e;
            const { ok } = await ask({
              title: "Uploads are still running",
              text:
                `${m[1]} file(s) from "${name}" have not reached the cloud yet.`,
              points: [
                "Unmounting pauses the upload; it resumes the next time you mount the drive.",
                "Until then those changes exist only on this computer.",
              ],
              warn:
                "Shutting the computer down before the next mount can lose them.",
              okLabel: "Unmount anyway",
              danger: true,
            });
            if (!ok) return;
            await invoke("unmount_remote", { mountPoint: ownPoint, force: true });
          }
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), "Drive settings")
      );
    } else if (extPoint) {
      actions.append(
        makeBtn("Open folder", "primary", () => invoke("open_folder", { path: extPoint })),
        makeBtn("Unmount", "", async () => {
          const { ok } = await ask({
            title: `Unmount "${name}"?`,
            text:
              "This drive was mounted outside Monti — by a systemd service or " +
              "a manual rclone mount.",
            points: [
              "Close any app still using files there first.",
              "A service that manages this mount may bring it back, or may need to be disabled separately.",
            ],
            warn: "Unsaved changes in files that are still open would be lost.",
            okLabel: "Unmount",
            danger: true,
          });
          if (!ok) return;
          await invoke("unmount_external", { mountPoint: extPoint });
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), "Drive settings")
      );
    } else {
      actions.append(
        makeBtn("Mount", "primary", async () => {
          const mp = prefFor(name).mountPoint || null;
          await invoke("mount_remote", { name, mountPoint: mp, vfs: vfsOptFor(name) });
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), "Drive settings"),
        makeBtn("Remove", "danger", async () => {
          // Everything is decided in one dialog, before anything happens:
          // asking about the cache afterwards meant asking a question the
          // person could no longer answer with the drive in front of them.
          const mountPoint = prefFor(name).mountPoint || null;
          const cached = await invoke("vfs_cache_size", { name }).catch(() => 0);
          const points = [
            "Files in the cloud are not touched.",
            "The saved sign-in for this drive is removed from the rclone config on this machine.",
          ];
          if (mountFolderOf(name, mountPoint)) {
            points.push(`The empty mount folder ${mountFolderOf(name, mountPoint)} is removed.`);
          }
          const { ok, extra } = await ask({
            title: `Disconnect "${name}" from this computer?`,
            text: "The drive disappears from Monti. You can add it back later by signing in again.",
            points,
            okLabel: "Disconnect",
            danger: true,
            extra: cached
              ? {
                  label: `Also delete ${fmtBytes(cached)} of cached file copies`,
                  checked: true,
                }
              : null,
          });
          if (!ok) return;
          await invoke("delete_remote", { name, mountPoint });
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
  if (!wanted.length) return;
  const { remotes, own, external } = await fetchState();
  const existing = new Set(remotes.map((r) => r.name));
  for (const name of wanted) {
    if (!existing.has(name) || own.has(name) || external.has(name)) continue;
    try {
      await invoke("mount_remote", {
        name,
        mountPoint: prefs[name].mountPoint || null,
        vfs: vfsOptFor(name),
      });
    } catch (e) {
      retryAutoMount(name, 0, e);
    }
  }
}

// Autostart puts Monti on screen before the network is necessarily up, and a
// cloud that cannot be reached yet fails to mount for a minute or two at
// most. Giving up on the first try would leave people with an empty folder
// and no idea why, so keep trying quietly for about four minutes.
const AUTOMOUNT_RETRIES = [10, 30, 60, 120]; // seconds between attempts

function retryAutoMount(name, attempt, lastError) {
  if (attempt >= AUTOMOUNT_RETRIES.length) {
    showError(`Auto-mount of “${name}” failed: ${lastError}`);
    return;
  }
  const wait = AUTOMOUNT_RETRIES[attempt];
  showError(
    `“${name}” is not mounted yet — trying again in ${wait}s. ` +
      "Right after login this usually means the network is still coming up."
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
        <span class="chip">${SCHEDULE_LABELS[p.schedule] || p.schedule}</span>
      </div>
      <div class="remote-path muted mono"></div>
      <div class="sync-progress muted"></div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = p.name;
    card.querySelector(".chip.state").textContent = running
      ? "syncing"
      : p.initialized
        ? "ready"
        : "not synced yet";
    const path = card.querySelector(".remote-path");
    path.textContent = `${p.local}  ⇄  ${p.remote}`;
    path.title = path.textContent;

    const line = card.querySelector(".sync-progress");
    if (p.lastRun) {
      line.textContent =
        p.lastResult === "ok"
          ? `last sync ${p.lastRun} UTC`
          : `last sync failed: ${p.lastResult}`;
      line.classList.toggle("failed-text", p.lastResult !== "ok");
    } else {
      line.textContent = "never synced";
    }

    const actions = card.querySelector(".remote-actions");
    if (running) {
      actions.append(
        makeBtn("Stop", "", async () => {
          const job = syncJobs.get(p.name);
          if (job) await invoke("sync_stop", { jobid: job.jobid }).catch(() => {});
        })
      );
    } else {
      actions.append(
        makeBtn("Sync now", "primary", () => startSync(p)),
        makeBtn("⚙", "icon", () => openPairDialog(p), "Settings for this pair"),
        makeBtn("Remove", "danger", () => removePair(p))
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
    $("firstsync-text").textContent =
      `"${pair.name}" has not been synced yet. Monti will compare ` +
      `${pair.local} and ${pair.remote} and make them match.`;
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
    dlg.showModal();
  });
}

async function startSync(pair, force = false) {
  showError("");
  let resyncMode = null;
  if (!pair.initialized) {
    resyncMode = await askFirstSync(pair);
    if (!resyncMode) return; // cancelled
  }
  let jobid;
  try {
    jobid = await invoke("sync_run", {
      name: pair.name,
      resync: !pair.initialized,
      resyncMode,
      dryRun: false,
      force,
    });
  } catch (e) {
    showError(`Sync of "${pair.name}" could not start: ${e}`);
    return;
  }
  syncJobs.set(pair.name, { jobid, resync: !pair.initialized, force });
  await refreshPairs();
  followSync(pair.name);
}

// Deleting on one side means deleting on the other, and rclone refuses to do
// that until someone says so — through the RC it stops at the very first
// removed file. Say what it is about to delete, in files, and let the answer
// stick for this pair.
async function confirmDeletes(pair, n, total) {
  const { ok, extra } = await ask({
    title: "Files were deleted",
    text:
      n && total
        ? `${n} of ${total} file(s) are gone from one side of "${pair.name}". ` +
          "Syncing will remove them from the other side too."
        : `Files are gone from one side of "${pair.name}". Syncing will ` +
          "remove them from the other side too.",
    points: [
      `on this computer: ${pair.local}`,
      `in the cloud: ${pair.remote}`,
      "if this is not what you expected, cancel and check both folders first",
    ],
    okLabel: "Delete them",
    danger: true,
    extra: { label: "Stop asking for this pair", checked: false },
  });
  return { ok, remember: !!extra };
}

// bisync of a real folder takes minutes; follow the job and keep the card
// honest about what is happening.
function followSync(name) {
  const tick = async () => {
    const job = syncJobs.get(name);
    if (!job) return;
    let p;
    try {
      p = await invoke("sync_progress", { jobid: job.jobid });
    } catch {
      setTimeout(tick, 3000);
      return;
    }
    if (!p.finished) {
      const card = $("sync-list").querySelector(`[data-name="${CSS.escape(name)}"]`);
      const line = card && card.querySelector(".sync-progress");
      if (line) {
        line.textContent = p.transfers
          ? `syncing — ${p.transfers} file(s), ${fmtBytes(p.bytes)}`
          : `syncing — checking ${p.checks} file(s)`;
      }
      setTimeout(tick, 2000);
      return;
    }
    syncJobs.delete(name);

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
      showError(`Sync of "${name}" failed: ${p.error}`);
      notify("Monti: sync failed", `"${name}" did not finish: ${p.error}`);
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
  head.textContent = `${list.length} file(s) changed on both sides`;
  box.append(head);
  for (const c of list.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "conflict-row";
    const name_ = document.createElement("span");
    name_.className = "transfer-name mono";
    name_.textContent = c.loser.split("/").pop();
    name_.title = c.loser;
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
    row.append(
      settle("winner", "keep current", "Delete this older copy"),
      settle("loser", "keep this", "Put this copy back under the original name"),
      settle("both", "keep both", "Rename it to “(copy)” and stop calling it a conflict")
    );
    box.append(row);
  }
  card.append(box);
}

let editingPair = null;

async function openPairDialog(pair = null) {
  editingPair = pair;
  showError("");
  const remotes = await invoke("list_remotes").catch(() => []);
  const sel = $("pair-remote");
  sel.innerHTML = "";
  for (const r of remotes) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    sel.append(opt);
  }
  $("pair-title").textContent = pair ? `${pair.name} — sync settings` : "New sync";
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
  $("pair-dialog").showModal();
}

async function savePairFromDialog() {
  const name = $("pair-name").value.trim();
  const local = $("pair-local").value.trim(); // "~/..." is expanded by the backend
  const remote = `${$("pair-remote").value}:${$("pair-path").value.trim().replace(/^\/+/, "")}`;
  if (!$("pair-remote").value) {
    showError("Connect a cloud first — there is nothing to sync with.");
    return;
  }
  try {
    await invoke("sync_pair_save", {
      pair: {
        name,
        local,
        remote,
        schedule: $("pair-schedule").value,
        conflictResolve: $("pair-conflict").value,
        initialized: editingPair ? editingPair.initialized : false,
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
    title: `Stop syncing "${pair.name}"?`,
    text: "Monti forgets this pair. Nothing is deleted:",
    points: [
      `${pair.local} stays exactly as it is`,
      `${pair.remote} stays exactly as it is`,
      "the two simply stop being kept the same",
    ],
    okLabel: "Stop syncing",
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
    if (p.schedule === "start" && p.initialized) await startSync(p).catch(() => {});
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
        startSync(p).catch(() => {});
      }
    }
  }, 60000);
}

// ---------- drive settings dialog ----------

let dialogRemote = null;
// Public half of the key as stored in config when the dialog opened; the
// secret itself never reaches the webview (list_remotes is sanitized).
let dialogKey = { id: "" };

async function openRemoteDialog(name) {
  dialogRemote = name;
  showError("");
  const pref = prefFor(name);
  $("remote-title").textContent = `${name} — settings`;
  $("remote-mountpoint").value = pref.mountPoint || "";
  $("remote-automount").checked = !!pref.automount;
  const vfs = pref.vfs || {};
  $("remote-readonly").checked = !!vfs.readOnly;
  $("remote-cache-size").value = vfs.maxSize || "";
  $("remote-cache-age").value = vfs.maxAge || "";

  const remotes = await invoke("list_remotes");
  const info = remotes.find((r) => r.name === name) || {};
  dialogKey = { id: info.clientId || "" };
  $("remote-client-id").value = dialogKey.id;
  $("remote-client-secret").value = "";
  $("remote-client-secret").placeholder = info.hasOwnKey
    ? "unchanged — enter a new one to replace"
    : "";
  $("remote-key-status").textContent = dialogKey.id
    ? "Using your own API key."
    : "Using rclone's shared key — it is being retired during 2026, " +
      "switching to your own key is recommended.";

  // Say what the empty limit field actually means, instead of "unlimited".
  invoke("cache_info")
    .then((c) => {
      $("remote-cache-size").placeholder = `${fmtLimit(c.defaultLimit)} · e.g. 10G`;
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
    el.textContent =
      `Only ${fmtBytes(free)} left on this disk. Clear a drive's cache ` +
      `in its settings, or lower its cache size limit.`;
    el.classList.remove("hidden");
    // Once per crossing, not once per redraw: this check runs on every
    // refresh, and a notification per refresh would be its own problem.
    if (!lowDiskTold) {
      lowDiskTold = true;
      notify(
        "Monti: this disk is nearly full",
        `Only ${fmtBytes(free)} left. Clear a drive's cache or lower its limit.`
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
  label.textContent = "counting…";
  btn.disabled = true;
  const used = await invoke("vfs_cache_size", { name }).catch(() => 0);
  const mounted = ownMounts.has(name);
  label.textContent = used ? fmtBytes(used) : "nothing cached";
  btn.disabled = !used || mounted;
  btn.title = mounted
    ? "Unmount the drive first — rclone is using these files right now"
    : "Delete the downloaded copies kept on this computer";
}

// ---------- views ----------

function switchView(view) {
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
    box.textContent = "The engine isn't running.";
    return;
  }
  if (!list.length) {
    box.textContent = "Nothing transferred since the engine started.";
    return;
  }
  box.innerHTML = "";
  for (const t of list.slice(-12).reverse()) {
    const row = document.createElement("div");
    row.className = "transfer-row";
    const name = document.createElement("span");
    name.className = "transfer-name mono";
    name.textContent = t.name || "(unnamed)";
    name.title = t.name || "";
    const meta = document.createElement("span");
    meta.className = t.error ? "transfer-meta failed" : "transfer-meta";
    meta.textContent = t.error
      ? "failed"
      : `${fmtBytes(t.bytes || t.size || 0)}${t.checked ? " · checked" : ""}`;
    row.append(name, meta);
    box.append(row);
  }
}

async function initSettings() {
  const info = await invoke("app_info");
  $("about-version").textContent = `v${info.appVersion}`;
  $("about-rclone").textContent = info.rcloneVersion || "not installed";
  $("about-rclone-path").textContent = info.rclonePath || "—";
  $("about-config").textContent = info.configPath || "—";
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
    status.textContent = "Downloading rclone… (10–40 MB)";
    status.classList.remove("hidden");
    try {
      const path = await invoke("install_rclone");
      status.textContent = `Done — installed to ${path}. Takes effect on the next engine restart.`;
      const fresh = await invoke("app_info");
      $("about-rclone").textContent = fresh.rcloneVersion || "not installed";
      $("about-rclone-path").textContent = fresh.rclonePath || "—";
    } catch (e) {
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
    $("tray-hint").textContent =
      "Tray isn't available on this desktop — closing the window quits Monti. " +
      "(On Arch/Manjaro: install libayatana-appindicator.)";
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
    await autoRemount();
    await refreshRemotes();
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
  for (const id of [
    "add-dialog",
    "confirm-dialog",
    "remote-dialog",
    "pair-dialog",
    "firstsync-dialog",
  ]) {
    closeOnBackdropClick($(id));
  }
  boot();
  initSettings().catch((e) => showError(String(e)));

  // Live progress for the engine download (first install and reinstall).
  listen("engine-download", (e) => {
    const { downloaded, total } = e.payload;
    const text = total
      ? `Downloading rclone… ${Math.round((downloaded / total) * 100)}% of ${fmtBytes(total)}`
      : `Downloading rclone… ${fmtBytes(downloaded)}`;
    for (const id of ["install-status", "reinstall-status"]) {
      const el = $(id);
      if (el && !el.classList.contains("hidden") && el.textContent.startsWith("Downloading")) {
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
    $("install-status").textContent = "Downloading rclone… (10–40 MB)";
    try {
      await invoke("install_rclone");
      $("install-status").textContent = "Done!";
      await boot();
    } catch (e) {
      $("install-status").textContent = "";
      showError(String(e));
    } finally {
      btn.disabled = false;
    }
  });

  // --- synced folders ---
  $("add-pair-btn").addEventListener("click", () => openPairDialog().catch((e) => showError(String(e))));
  $("pair-cancel").addEventListener("click", () => $("pair-dialog").close());
  $("pair-form").addEventListener("submit", (e) => {
    e.preventDefault(); // saving can fail, and the dialog must stay open then
    savePairFromDialog().catch((err) => showError(String(err)));
  });

  // --- add cloud dialog ---
  $("add-btn").addEventListener("click", () => {
    $("add-form").reset();
    showError("");
    $("add-status").classList.add("hidden");
    $("add-advanced").open = false;
    updateAddForm();
    $("add-dialog").showModal();
  });
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
    $("add-status").textContent = oauth
      ? "⏳ Waiting for you to authorize in the browser… Press Cancel to abort."
      : "⏳ Connecting…";
  };
  $("add-provider").addEventListener("change", updateAddForm);

  // Non-OAuth providers: collect their form fields and check the required
  // ones (native `required` can't be used — the fields are often hidden).
  const collectParams = (p) => {
    const v = (id) => $(id).value.trim();
    if (p === "webdav") {
      if (!v("webdav-url")) return "Server URL is required.";
      return {
        url: v("webdav-url"),
        vendor: $("webdav-vendor").value,
        user: v("webdav-user"),
        pass: $("webdav-pass").value,
      };
    }
    if (p === "s3") {
      if (!v("s3-access") || !$("s3-secret").value)
        return "Access key ID and Secret access key are required.";
      if ($("s3-provider").value !== "AWS" && !v("s3-endpoint"))
        return "Endpoint is required for non-Amazon S3 services.";
      return {
        provider: $("s3-provider").value,
        access_key_id: v("s3-access"),
        secret_access_key: $("s3-secret").value,
        endpoint: v("s3-endpoint"),
        region: v("s3-region"),
      };
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
    return null;
  };

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("add-name").value.trim();
    const provider = $("add-provider").value;
    const params = collectParams(provider);
    if (typeof params === "string") {
      showError(params);
      return;
    }
    $("add-submit").disabled = true;
    showError("");
    const ok = await withAuth($("add-status"), () =>
      invoke("create_remote", {
        name,
        provider,
        clientId: $("add-client-id").value.trim() || null,
        clientSecret: $("add-client-secret").value.trim() || null,
        params,
      })
    );
    $("add-submit").disabled = false;
    if (ok) {
      // Sensible default: new drives mount automatically from now on.
      setPref(name, { automount: true });
      $("add-dialog").close();
      await refreshRemotes();
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
      title: "Clear the local cache?",
      text: `${fmtBytes(used)} of downloaded copies of "${name}" will be deleted from this computer.`,
      points: [
        "Files in the cloud are not touched.",
        "They download again the next time you open them.",
      ],
      okLabel: "Clear cache",
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
      showError(`"${maxSize}" is not a size — try something like 500M or 10G.`);
      return;
    }
    if (maxAge && !AGE_RE.test(maxAge)) {
      showError(`"${maxAge}" is not a duration — try something like 30m, 24h or 7d.`);
      return;
    }
    setPref(dialogRemote, {
      mountPoint: $("remote-mountpoint").value.trim() || null,
      automount: $("remote-automount").checked,
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
    const keyChanged = newId !== dialogKey.id || newSecret !== "";

    if (keyChanged) {
      if (newId && newId !== dialogKey.id && !newSecret) {
        showError("Enter the Client secret that pairs with the new Client ID.");
        return;
      }
      if (!newId && newSecret) {
        showError("Enter the Client ID that pairs with this Client secret.");
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
  });
});
