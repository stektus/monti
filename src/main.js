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
  const slots = ["global-error", "add-error", "remote-error"];
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

// ---------- engine health ----------

let healthTimer = null;
let engineDown = false;

async function healthTick() {
  if (document.hidden) return;
  let alive;
  try {
    alive = await invoke("engine_health");
  } catch {
    return; // IPC hiccup — decide on the next tick
  }
  if (!alive && !engineDown) {
    engineDown = true;
    setEngine("err", "engine stopped");
    $("engine-restart").classList.remove("hidden");
    showError(
      "The rclone engine stopped unexpectedly — your drives are disconnected. " +
        "Press “Restart engine” to bring them back."
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
  const own = new Map(
    (mounts.mountPoints || []).map((m) => [m.Fs.replace(/:$/, ""), m.MountPoint])
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
        <span class="chip provider"></span>
        ${ownKey ? '<span class="chip key" title="Connected through your own API key">own key</span>' : ""}
        ${readOnly ? '<span class="chip" title="Read-only: files cannot be changed">read-only</span>' : ""}
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
      <div class="remote-path muted mono"></div>
      <div class="remote-cache muted hidden"></div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = PROVIDER_LABELS[type] || type;
    card.querySelector(".remote-path").textContent =
      ownPoint || extPoint || prefFor(name).mountPoint || `~/CloudDrives/${name}`;

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
      showError(`Auto-mount of "${name}" failed: ${e}`);
    }
  }
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

  const warn = $("cache-warning");
  const GB = 1024 * 1024 * 1024;
  if (info.free < 2 * GB) {
    warn.textContent =
      `Only ${fmtBytes(info.free)} left on this disk. Clear a drive's cache ` +
      `in its settings, or lower its cache size limit.`;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
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
  $("view-settings").classList.toggle("hidden", view !== "settings");
  document
    .querySelectorAll(".seg-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
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
    await autoRemount();
    await refreshRemotes();
    if (!activityTimer) activityTimer = setInterval(pollActivity, 2000);
    if (!healthTimer) healthTimer = setInterval(healthTick, 5000);
  } catch (e) {
    setEngine("err", "engine failed");
    showError(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
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
