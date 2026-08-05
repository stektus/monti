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

// Remotes the user mounted through Mountie — remounted on next launch.
const AUTOMOUNT_KEY = "mountie.automount";
const getAutomount = () => {
  try {
    return JSON.parse(localStorage.getItem(AUTOMOUNT_KEY)) || [];
  } catch {
    return [];
  }
};
const setAutomount = (names) =>
  localStorage.setItem(AUTOMOUNT_KEY, JSON.stringify([...new Set(names)]));

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

// ---------- rendering ----------

async function fetchState() {
  const [dump, mounts, sysMounts] = await Promise.all([
    rc("config/dump"),
    rc("mount/listmounts"),
    invoke("list_system_mounts"),
  ]);
  // Mounts owned by our engine.
  const own = new Map(
    (mounts.mountPoints || []).map((m) => [m.Fs.replace(/:$/, ""), m.MountPoint])
  );
  // Mounts made outside Mountie (systemd units, manual rclone mount, …).
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
    const stateChip = ownPoint
      ? '<span class="chip state on">mounted</span>'
      : extPoint
        ? '<span class="chip state ext" title="Mounted outside Mountie (e.g. a systemd service). Mountie won\'t touch it.">mounted · system</span>'
        : '<span class="chip state">not mounted</span>';

    const card = document.createElement("div");
    card.className = "card remote-card";
    card.innerHTML = `
      <div class="remote-info">
        <div class="remote-title">
          <span class="remote-name"></span>
          <span class="chip provider"></span>
          ${stateChip}
        </div>
        <div class="remote-path muted"></div>
      </div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = PROVIDER_LABELS[type] || type;
    card.querySelector(".remote-path").textContent = ownPoint || extPoint || "";

    const actions = card.querySelector(".remote-actions");
    if (ownPoint) {
      actions.append(
        makeBtn("Open folder", "", () => openPath(ownPoint)),
        makeBtn("Unmount", "", async () => {
          await invoke("unmount_remote", { mountPoint: ownPoint });
          setAutomount(getAutomount().filter((n) => n !== name));
          await refreshRemotes();
        })
      );
    } else if (extPoint) {
      // Managed elsewhere: only offer to open it. Mounting again would
      // double-mount; removing would break the external setup's config.
      actions.append(makeBtn("Open folder", "", () => openPath(extPoint)));
    } else {
      actions.append(
        makeBtn("Mount", "primary", async () => {
          await invoke("mount_remote", { name });
          setAutomount([...getAutomount(), name]);
          await refreshRemotes();
        }),
        makeBtn("Remove", "danger", async () => {
          if (!confirm(`Disconnect "${name}"? Files in the cloud are not touched.`))
            return;
          setAutomount(getAutomount().filter((n) => n !== name));
          await invoke("delete_remote", { name });
          await refreshRemotes();
        })
      );
    }
    list.append(card);
  }
}

function makeBtn(label, extra, onClick) {
  const b = document.createElement("button");
  b.className = `btn ${extra}`;
  b.textContent = label;
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

// Remount everything the user had mounted last time.
async function autoRemount() {
  const wanted = getAutomount();
  if (!wanted.length) return;
  const { dump, own, external } = await fetchState();
  for (const name of wanted) {
    if (!(name in dump)) continue; // remote was deleted elsewhere
    if (own.has(name) || external.has(name)) continue; // already mounted
    try {
      await invoke("mount_remote", { name });
    } catch (e) {
      showError(`Auto-mount of "${name}" failed: ${e}`);
    }
  }
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
  // Esc key closes the dialog — abort a pending authorization too.
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
      $("add-dialog").close();
      await refreshRemotes();
    } catch (err) {
      // Deliberate cancel isn't an error worth shouting about.
      if (!userCancelled) showError(String(err));
    } finally {
      authInProgress = false;
      $("add-submit").disabled = false;
      $("add-status").classList.add("hidden");
    }
  });
});
