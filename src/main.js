const { invoke } = window.__TAURI__.core;
const { openPath } = window.__TAURI__.opener;

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
  const names = Object.keys(dump).sort();
  const list = $("remotes-list");
  list.innerHTML = "";
  $("empty-hint").classList.toggle("hidden", names.length > 0);

  for (const name of names) {
    const type = dump[name].type || "?";
    const ownPoint = own.get(name);
    const extPoint = external.get(name);

    const card = document.createElement("div");
    card.className = "card remote-card";
    card.innerHTML = `
      <div class="remote-head">
        <span class="remote-name"></span>
        <span class="chip provider"></span>
        <span class="spacer"></span>
        ${
          ownPoint
            ? '<span class="chip state on">mounted</span>'
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

function openRemoteDialog(name) {
  dialogRemote = name;
  const pref = prefFor(name);
  $("remote-title").textContent = `${name} — settings`;
  $("remote-mountpoint").value = pref.mountPoint || "";
  $("remote-automount").checked = !!pref.automount;
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
      "Tray isn't available on this desktop — closing the window quits Monti.";
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
  let authInProgress = false;
  let userCancelled = false;

  const abortAuth = async () => {
    if (!authInProgress) return;
    userCancelled = true;
    await invoke("cancel_create_remote").catch(() => {});
  };

  $("add-btn").addEventListener("click", () => {
    $("add-form").reset();
    $("add-status").classList.add("hidden");
    $("add-dialog").showModal();
  });
  $("add-cancel").addEventListener("click", async () => {
    await abortAuth();
    $("add-dialog").close();
  });
  $("add-dialog").addEventListener("cancel", () => abortAuth());

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("add-name").value.trim();
    const provider = $("add-provider").value;
    $("add-submit").disabled = true;
    $("add-status").classList.remove("hidden");
    showError("");
    authInProgress = true;
    userCancelled = false;
    try {
      await invoke("create_remote", { name, provider });
      // Sensible default: new drives mount automatically from now on.
      setPref(name, { automount: true });
      $("add-dialog").close();
      await refreshRemotes();
    } catch (err) {
      if (!userCancelled) showError(String(err));
    } finally {
      authInProgress = false;
      $("add-submit").disabled = false;
      $("add-status").classList.add("hidden");
    }
  });

  // --- drive settings dialog ---
  $("remote-cancel").addEventListener("click", () => $("remote-dialog").close());
  $("remote-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (dialogRemote) {
      setPref(dialogRemote, {
        mountPoint: $("remote-mountpoint").value.trim() || null,
        automount: $("remote-automount").checked,
      });
    }
    $("remote-dialog").close();
    refreshRemotes();
  });
});
