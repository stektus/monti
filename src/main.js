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

async function refreshRemotes() {
  const [dump, mounts] = await Promise.all([
    rc("config/dump"),
    rc("mount/listmounts"),
  ]);
  const mounted = new Map(
    (mounts.mountPoints || []).map((m) => [m.Fs.replace(/:$/, ""), m.MountPoint])
  );
  const names = Object.keys(dump).sort();
  const list = $("remotes-list");
  list.innerHTML = "";
  $("empty-hint").classList.toggle("hidden", names.length > 0);

  for (const name of names) {
    const type = dump[name].type || "?";
    const mountPoint = mounted.get(name);
    const card = document.createElement("div");
    card.className = "card remote-card";
    card.innerHTML = `
      <div class="remote-info">
        <div class="remote-title">
          <span class="remote-name"></span>
          <span class="chip provider"></span>
          <span class="chip state ${mountPoint ? "on" : ""}">${
            mountPoint ? "mounted" : "not mounted"
          }</span>
        </div>
        <div class="remote-path muted"></div>
      </div>
      <div class="remote-actions"></div>`;
    card.querySelector(".remote-name").textContent = name;
    card.querySelector(".provider").textContent = PROVIDER_LABELS[type] || type;
    card.querySelector(".remote-path").textContent = mountPoint || "";

    const actions = card.querySelector(".remote-actions");
    if (mountPoint) {
      actions.append(
        makeBtn("Open folder", "", () => openPath(mountPoint)),
        makeBtn("Unmount", "", async () => {
          await invoke("unmount_remote", { mountPoint });
          await refreshRemotes();
        })
      );
    } else {
      actions.append(
        makeBtn("Mount", "primary", async () => {
          await invoke("mount_remote", { name });
          await refreshRemotes();
        }),
        makeBtn("Remove", "danger", async () => {
          if (!confirm(`Disconnect "${name}"? Files in the cloud are not touched.`))
            return;
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

  $("add-btn").addEventListener("click", () => {
    $("add-form").reset();
    $("add-status").classList.add("hidden");
    $("add-dialog").showModal();
  });
  $("add-cancel").addEventListener("click", () => $("add-dialog").close());

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("add-name").value.trim();
    const provider = $("add-provider").value;
    $("add-submit").disabled = true;
    $("add-status").classList.remove("hidden");
    showError("");
    try {
      await invoke("create_remote", { name, provider });
      $("add-dialog").close();
      await refreshRemotes();
    } catch (err) {
      showError(String(err));
    } finally {
      $("add-submit").disabled = false;
      $("add-status").classList.add("hidden");
    }
  });
});
