const { invoke } = window.__TAURI__.core;
const { openPath, openUrl } = window.__TAURI__.opener;

const PROVIDER_LABELS = {
  drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  box: "Box",
  pcloud: "pCloud",
  yandex: "Yandex Disk",
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

function setEngine(stateClass, label) {
  $("engine-dot").className = `dot ${stateClass}`;
  $("engine-label").textContent = label;
}

function showError(msg) {
  const el = $("global-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

async function rc(path, body = {}) {
  return invoke("rc", { path, body });
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

// Run an action that ends in a browser OAuth wait, toggling a status line.
async function withAuth(statusEl, action) {
  authInProgress = true;
  userCancelled = false;
  statusEl.classList.remove("hidden");
  try {
    await action();
    return true;
  } catch (err) {
    if (!userCancelled) showError(String(err));
    return false;
  } finally {
    authInProgress = false;
    statusEl.classList.add("hidden");
  }
}

// ---------- activity indicator ----------

let ownMounts = new Map(); // remote name -> mount point, kept fresh by refreshRemotes
let activityTimer = null;

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
  const [dump, mounts, sysMounts] = await Promise.all([
    rc("config/dump"),
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
  return { dump, own, external };
}

async function refreshRemotes() {
  const { dump, own, external } = await fetchState();
  ownMounts = own;
  const names = Object.keys(dump).sort();
  const list = $("remotes-list");
  list.innerHTML = "";
  $("empty-hint").classList.toggle("hidden", names.length > 0);

  for (const name of names) {
    const type = dump[name].type || "?";
    const ownPoint = own.get(name);
    const extPoint = external.get(name);
    const ownKey = !!(dump[name].client_id || "").trim();

    const card = document.createElement("div");
    card.className = "card remote-card";
    card.dataset.name = name;
    card.innerHTML = `
      <div class="remote-head">
        <span class="remote-name"></span>
        <span class="chip provider"></span>
        ${ownKey ? '<span class="chip key" title="Connected through your own API key">own key</span>' : ""}
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
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = PROVIDER_LABELS[type] || type;
    card.querySelector(".remote-path").textContent =
      ownPoint || extPoint || prefFor(name).mountPoint || `~/CloudDrives/${name}`;

    const actions = card.querySelector(".remote-actions");

    if (ownPoint) {
      actions.append(
        makeBtn("Open folder", "primary", () => openPath(ownPoint)),
        makeBtn("Unmount", "", async () => {
          await invoke("unmount_remote", { mountPoint: ownPoint });
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), "Drive settings")
      );
    } else if (extPoint) {
      actions.append(
        makeBtn("Open folder", "primary", () => openPath(extPoint)),
        makeBtn("Unmount", "", async () => {
          const ok = confirm(
            `"${name}" is mounted by something outside Monti (a systemd service ` +
              `or a manual rclone mount).\n\nUnmount it anyway? If a service ` +
              `manages it, it may remount it or need to be disabled separately.`
          );
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
          await invoke("mount_remote", { name, mountPoint: mp });
          await refreshRemotes();
        }),
        makeBtn("⚙", "icon", () => openRemoteDialog(name), "Drive settings"),
        makeBtn("Remove", "danger", async () => {
          const ok = confirm(
            `Disconnect "${name}" from this computer?\n\n` +
              `Files in the cloud are NOT touched. The saved sign-in for this ` +
              `drive is removed from the rclone config on this machine.`
          );
          if (!ok) return;
          const all = loadPrefs();
          delete all[name];
          savePrefs(all);
          await invoke("delete_remote", { name });
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
  const { dump, own, external } = await fetchState();
  for (const name of wanted) {
    if (!(name in dump) || own.has(name) || external.has(name)) continue;
    try {
      await invoke("mount_remote", {
        name,
        mountPoint: prefs[name].mountPoint || null,
      });
    } catch (e) {
      showError(`Auto-mount of "${name}" failed: ${e}`);
    }
  }
}

// ---------- drive settings dialog ----------

let dialogRemote = null;
let dialogKey = { id: "", secret: "" }; // key as stored in config when opened

async function openRemoteDialog(name) {
  dialogRemote = name;
  const pref = prefFor(name);
  $("remote-title").textContent = `${name} — settings`;
  $("remote-mountpoint").value = pref.mountPoint || "";
  $("remote-automount").checked = !!pref.automount;

  const dump = await rc("config/dump");
  const conf = dump[name] || {};
  dialogKey = { id: conf.client_id || "", secret: conf.client_secret || "" };
  $("remote-client-id").value = dialogKey.id;
  $("remote-client-secret").value = dialogKey.secret;
  $("remote-key-status").textContent = dialogKey.id
    ? "Using your own API key."
    : "Using rclone's shared key — it is being retired during 2026, " +
      "switching to your own key is recommended.";

  $("remote-dialog").showModal();
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
      openPath(dir).catch((e) => showError(String(e)));
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
  } catch (e) {
    setEngine("err", "engine failed");
    showError(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  boot();
  initSettings().catch((e) => showError(String(e)));

  document.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  // External links must open in the system browser, not inside the app.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='http']");
    if (!a) return;
    e.preventDefault();
    openUrl(a.href).catch((err) => showError(String(err)));
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
    $("add-status").classList.add("hidden");
    $("add-advanced").open = false;
    $("add-dialog").showModal();
  });
  $("add-cancel").addEventListener("click", async () => {
    await abortAuth();
    $("add-dialog").close();
  });
  $("add-dialog").addEventListener("cancel", () => abortAuth());

  // The step-by-step key guide is written for Google Drive.
  $("add-provider").addEventListener("change", () => {
    const isDrive = $("add-provider").value === "drive";
    $("key-help-drive").classList.toggle("hidden", !isDrive);
  });

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("add-name").value.trim();
    const provider = $("add-provider").value;
    $("add-submit").disabled = true;
    showError("");
    const ok = await withAuth($("add-status"), () =>
      invoke("create_remote", {
        name,
        provider,
        clientId: $("add-client-id").value.trim() || null,
        clientSecret: $("add-client-secret").value.trim() || null,
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
    setPref(dialogRemote, {
      mountPoint: $("remote-mountpoint").value.trim() || null,
      automount: $("remote-automount").checked,
    });

    const newId = $("remote-client-id").value.trim();
    const newSecret = $("remote-client-secret").value.trim();
    const keyChanged = newId !== dialogKey.id || newSecret !== dialogKey.secret;

    if (keyChanged) {
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
