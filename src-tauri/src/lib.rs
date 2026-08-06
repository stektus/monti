// Monti — mount your clouds. A friendly GUI for rclone.
//
// Architecture: this backend manages an `rclone rcd` daemon (the "engine",
// see engine.rs) and proxies JSON-RPC calls to it. The frontend never
// talks to rclone directly and never sees the RC credentials.

mod engine;

use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, RunEvent, State, WindowEvent,
};

use engine::{
    app_bin_dir, build_vfs_opt, die_with_parent, engine_alive, find_rclone, log_line, rc_raw,
    remote_exists, restart_engine_preserving_mounts, save_engine_file, start_engine_locked,
    stop_engine_locked, Engine, EngineState, MountEntry,
};

/// Runtime toggles shared between the window-event handler and commands.
struct Flags {
    /// Closing the window hides to tray instead of quitting (only honored
    /// when the tray actually built — see `tray_ok`).
    close_to_tray: AtomicBool,
    /// Whether the system tray icon was created successfully. On Linux this
    /// needs a StatusNotifier host (present on KDE/GNOME with extension).
    tray_ok: AtomicBool,
    /// Quitting leaves mounted drives (and the engine) running; the next
    /// Monti session re-adopts the engine via the state file.
    keep_mounts: AtomicBool,
}

/// The in-flight `rclone config create` process (browser OAuth), if any.
/// Kept separately so the Cancel button can kill it while `create_remote`
/// is still polling.
struct CreateState(Mutex<Option<Child>>);

// ---------- system mounts ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SystemMount {
    remote: String,
    mount_point: String,
}

/// All rclone FUSE mounts on the machine, including ones created outside
/// Monti (systemd units, manual `rclone mount`, another instance).
fn read_proc_mounts() -> Vec<SystemMount> {
    let Ok(data) = fs::read_to_string("/proc/mounts") else {
        return Vec::new();
    };
    data.lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let src = fields.next()?;
            let mount_point = fields.next()?;
            if fields.next()? != "fuse.rclone" {
                return None;
            }
            Some(SystemMount {
                remote: src.split(':').next()?.to_string(),
                // /proc/mounts octal-escapes spaces and tabs
                mount_point: mount_point.replace("\\040", " ").replace("\\011", "\t"),
            })
        })
        .collect()
}

#[tauri::command]
fn list_system_mounts() -> Vec<SystemMount> {
    read_proc_mounts()
}

// ---------- commands ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    rclone_found: bool,
    rclone_path: Option<String>,
    version: Option<String>,
    engine_running: bool,
}

#[tauri::command]
async fn engine_status(
    app: AppHandle,
    state: State<'_, EngineState>,
) -> Result<EngineStatus, String> {
    let rclone = find_rclone(&app);
    let version = rclone.as_ref().and_then(|p| {
        Command::new(p)
            .arg("version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.lines().next().map(str::to_string))
    });
    let mut eng = state.0.lock().unwrap();
    let running = engine_alive(&mut eng);
    Ok(EngineStatus {
        rclone_found: rclone.is_some(),
        rclone_path: rclone.map(|p| p.display().to_string()),
        version,
        engine_running: running,
    })
}

/// Download the latest rclone build into the app data dir — this is what
/// makes Monti "just install and click" on distros without rclone.
#[tauri::command]
async fn install_rclone(app: AppHandle) -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => return Err(format!("unsupported architecture: {other}")),
    };
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(600))
        .build();
    let fetch_text = |url: &str| -> Result<String, String> {
        agent
            .get(url)
            .call()
            .map_err(|e| format!("download failed: {e}"))?
            .into_string()
            .map_err(|e| e.to_string())
    };

    // Resolve the concrete version so the archive can be verified against
    // its published SHA256SUMS — "current" has no stable checksum entry.
    let version = fetch_text("https://downloads.rclone.org/version.txt")?;
    let version = version
        .trim()
        .strip_prefix("rclone ")
        .map(str::to_string)
        .ok_or("unexpected version.txt format")?;
    let file_name = format!("rclone-{version}-linux-{arch}.zip");
    let mut bytes = Vec::new();
    agent
        .get(&format!("https://downloads.rclone.org/{version}/{file_name}"))
        .call()
        .map_err(|e| format!("download failed: {e}"))?
        .into_reader()
        .take(200 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;

    let sums = fetch_text(&format!("https://downloads.rclone.org/{version}/SHA256SUMS"))?;
    let expected = sums
        .lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            Some((it.next()?, it.next()?))
        })
        .find(|(_, name)| *name == file_name)
        .map(|(hash, _)| hash.to_lowercase())
        .ok_or("checksum for the downloaded archive not found in SHA256SUMS")?;
    let actual = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(&bytes))
    };
    if actual != expected {
        return Err("downloaded rclone failed checksum verification — try again later".into());
    }

    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let bin_dir = app_bin_dir(&app)?;
    fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let target = bin_dir.join("rclone");

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.name().ends_with("/rclone") {
            let mut out = fs::File::create(&target).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&target, fs::Permissions::from_mode(0o755))
                    .map_err(|e| e.to_string())?;
            }
            return Ok(target.display().to_string());
        }
    }
    Err("rclone binary not found inside the downloaded archive".into())
}

#[tauri::command]
async fn start_engine(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    start_engine_locked(&app, &mut eng)
}

/// Read-only proxy to rclone's RC API: credentials never leave the Rust
/// side, and only the endpoints the UI actually needs are reachable —
/// anything with side effects goes through a dedicated command above.
#[tauri::command]
async fn rc(state: State<'_, EngineState>, path: String, body: Value) -> Result<Value, String> {
    const ALLOWED: &[&str] = &["config/dump", "mount/listmounts", "core/stats", "vfs/stats"];
    if !ALLOWED.contains(&path.as_str()) {
        return Err(format!("rc path not allowed: {path}"));
    }
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    rc_raw(port, &pass, &path, &body)
}

/// Run an rclone subcommand that ends in a browser OAuth wait (config
/// create / config reconnect). The child is polled instead of blocked on,
/// so the user can cancel and we time out instead of hanging forever.
fn run_auth_child(rclone: &PathBuf, create: &CreateState, args: &[String]) -> Result<(), String> {
    // Drain stderr on a thread: a child that fills the pipe buffer while
    // nobody reads would block forever and we'd "time out" a healthy run.
    let stderr_buf = std::sync::Arc::new(Mutex::new(String::new()));
    let mut reader = None;
    {
        let mut guard = create.0.lock().unwrap();
        if guard.is_some() {
            return Err("another authorization is already in progress".into());
        }
        let mut cmd = Command::new(rclone);
        cmd.args(args)
            .arg("--auto-confirm") // never wait on an interactive y/n
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        die_with_parent(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        if let Some(mut pipe) = child.stderr.take() {
            let buf = std::sync::Arc::clone(&stderr_buf);
            reader = Some(thread::spawn(move || {
                let mut s = String::new();
                let _ = pipe.read_to_string(&mut s);
                *buf.lock().unwrap() = s;
            }));
        }
        *guard = Some(child);
    }

    const TIMEOUT: Duration = Duration::from_secs(300);
    let started = std::time::Instant::now();
    loop {
        thread::sleep(Duration::from_millis(500));
        let mut guard = create.0.lock().unwrap();
        let Some(child) = guard.as_mut() else {
            // Taken away by cancel_create_remote.
            return Err("Authorization cancelled.".to_string());
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut child = guard.take().unwrap();
                let _ = child.wait();
                drop(guard);
                if let Some(handle) = reader.take() {
                    let _ = handle.join(); // stderr hits EOF once the child died
                }
                if status.success() {
                    return Ok(());
                }
                let stderr = stderr_buf.lock().unwrap();
                let msg = stderr.trim();
                return Err(if msg.is_empty() {
                    "rclone exited with an error".to_string()
                } else {
                    msg.to_string()
                });
            }
            Ok(None) => {
                if started.elapsed() > TIMEOUT {
                    let mut child = guard.take().unwrap();
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Authorization timed out after 5 minutes.".to_string());
                }
            }
            Err(e) => {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                return Err(e.to_string());
            }
        }
    }
}

/// Create a remote via the rclone CLI: for OAuth providers it opens the
/// system browser. Optional client_id/client_secret let the user connect
/// through their own API key instead of rclone's shared one (which is
/// being retired in 2026).
#[tauri::command]
async fn create_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    create: State<'_, CreateState>,
    name: String,
    provider: String,
    client_id: Option<String>,
    client_secret: Option<String>,
    params: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let ok_name = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok_name {
        return Err("remote name may contain only letters, digits, '-' and '_'".into());
    }
    // OAuth providers need the CLI (it opens the browser); everything else
    // is created through the RC API so passwords travel in a localhost
    // request body — never on a world-readable command line — and the
    // daemon sees the change without a restart.
    const OAUTH: &[&str] = &["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"];
    let allowed_params: &[&str] = match provider.as_str() {
        p if OAUTH.contains(&p) => {
            let rclone = find_rclone(&app).ok_or("rclone not found")?;
            let existed = remote_exists(&rclone, &name);
            let mut args: Vec<String> = vec![
                "config".into(),
                "create".into(),
                name.clone(),
                provider.clone(),
            ];
            if let Some(id) = client_id.filter(|s| !s.trim().is_empty()) {
                args.push(format!("client_id={}", id.trim()));
            }
            if let Some(secret) = client_secret.filter(|s| !s.trim().is_empty()) {
                args.push(format!("client_secret={}", secret.trim()));
            }
            if let Err(e) = run_auth_child(&rclone, &create, &args) {
                // `config create` writes the remote before OAuth finishes;
                // an aborted flow must not leave a broken token-less remote.
                if !existed {
                    let _ = Command::new(&rclone)
                        .args(["config", "delete", &name])
                        .status();
                }
                return Err(e);
            }
            return restart_engine_preserving_mounts(&app, &state);
        }
        "webdav" => &["url", "vendor", "user", "pass"],
        "s3" => &[
            "provider",
            "access_key_id",
            "secret_access_key",
            "endpoint",
            "region",
        ],
        "sftp" => &["host", "port", "user", "pass", "key_file"],
        _ => return Err(format!("unsupported provider: {provider}")),
    };

    let mut parameters = serde_json::Map::new();
    for (key, value) in params.unwrap_or_default() {
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if !allowed_params.contains(&key.as_str()) {
            return Err(format!("unexpected option: {key}"));
        }
        parameters.insert(key, Value::String(value.to_string()));
    }
    if provider == "s3" {
        // Keys come from the form, never from env vars / IAM profiles.
        parameters.insert("env_auth".into(), Value::String("false".into()));
    }
    let eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "config/create",
        &json!({
            "name": name,
            "type": provider,
            "parameters": parameters,
            // obscure: store password fields rclone-obscured;
            // nonInteractive: never fall into a token/oauth prompt.
            "opt": { "obscure": true, "nonInteractive": true },
        }),
    )?;
    Ok(())
}

/// Re-run the browser authorization for an existing remote — after the
/// user switches to their own API key, or when a token expires.
#[tauri::command]
async fn reconnect_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    create: State<'_, CreateState>,
    name: String,
) -> Result<(), String> {
    let rclone = find_rclone(&app).ok_or("rclone not found")?;
    let args: Vec<String> = vec!["config".into(), "reconnect".into(), format!("{name}:")];
    run_auth_child(&rclone, &create, &args)?;
    restart_engine_preserving_mounts(&app, &state)
}

/// Switch an existing remote to a different API key (client_id/secret) and
/// re-authorize in one browser trip. Empty values reset the remote back to
/// rclone's shared key.
#[tauri::command]
async fn update_remote_key(
    app: AppHandle,
    state: State<'_, EngineState>,
    create: State<'_, CreateState>,
    name: String,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let rclone = find_rclone(&app).ok_or("rclone not found")?;
    let args: Vec<String> = vec![
        "config".into(),
        "update".into(),
        name,
        format!("client_id={}", client_id.trim()),
        format!("client_secret={}", client_secret.trim()),
    ];
    run_auth_child(&rclone, &create, &args)?;
    restart_engine_preserving_mounts(&app, &state)
}

/// Abort an in-flight browser authorization (Cancel button).
#[tauri::command]
fn cancel_create_remote(create: State<CreateState>) {
    if let Some(mut child) = create.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Delete a remote from the rclone config. Done through the RC API, which
/// updates both the daemon's memory and the config file — no engine
/// restart, so other mounted drives are untouched.
#[tauri::command]
async fn delete_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    name: String,
) -> Result<(), String> {
    // Deleting the config of a mounted remote would strand the mount
    // (and a systemd-managed one would break on its next restart).
    if let Some(m) = read_proc_mounts().into_iter().find(|m| m.remote == name) {
        return Err(format!(
            "\"{name}\" is mounted at {} — unmount it first.",
            m.mount_point
        ));
    }
    let eng = state.0.lock().unwrap();
    rc_raw(eng.port, &eng.pass, "config/delete", &json!({ "name": name }))?;
    log_line(&app, &format!("deleted remote {name}"));
    Ok(())
}

#[tauri::command]
async fn mount_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    name: String,
    mount_point: Option<String>,
    vfs: Option<Value>,
) -> Result<String, String> {
    // Refuse to mount a remote that is already mounted anywhere on the
    // system: two VFS caches over one remote can corrupt files.
    if let Some(existing) = read_proc_mounts().into_iter().find(|m| m.remote == name) {
        return Err(format!(
            "\"{name}\" is already mounted at {} (outside Monti). \
             Use that folder, or unmount it there first.",
            existing.mount_point
        ));
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let mount_point = match mount_point
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(custom) => {
            let path = match custom.strip_prefix("~/") {
                Some(rest) => home.join(rest),
                None => PathBuf::from(custom),
            };
            if !path.is_absolute() {
                return Err("mount folder must be an absolute path (or start with ~/)".into());
            }
            path
        }
        None => home.join("CloudDrives").join(&name),
    };
    fs::create_dir_all(&mount_point).map_err(|e| e.to_string())?;
    // FUSE needs an empty directory to mount over.
    if fs::read_dir(&mount_point)
        .map_err(|e| e.to_string())?
        .next()
        .is_some()
    {
        return Err(format!(
            "mount folder {} is not empty — pick an empty folder",
            mount_point.display()
        ));
    }
    let vfs_opt = build_vfs_opt(vfs.as_ref());
    let mut eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "mount/mount",
        &json!({
            "fs": format!("{name}:"),
            "mountPoint": mount_point,
            "vfsOpt": vfs_opt,
        }),
    )?;
    eng.mounts.insert(
        format!("{name}:"),
        MountEntry {
            mount_point: mount_point.display().to_string(),
            vfs_opt,
        },
    );
    save_engine_file(&app, &eng);
    log_line(&app, &format!("mounted {name}: at {}", mount_point.display()));
    Ok(mount_point.display().to_string())
}

#[tauri::command]
async fn unmount_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    mount_point: String,
) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "mount/unmount",
        &json!({ "mountPoint": mount_point }),
    )?;
    eng.mounts.retain(|_, e| e.mount_point != mount_point);
    save_engine_file(&app, &eng);
    log_line(&app, &format!("unmounted {mount_point}"));
    Ok(())
}

/// Unmount an rclone mount that was made outside Monti (systemd unit,
/// manual `rclone mount`). Validated against /proc/mounts so this can
/// never be pointed at an arbitrary path.
#[tauri::command]
async fn unmount_external(mount_point: String) -> Result<(), String> {
    if !read_proc_mounts()
        .iter()
        .any(|m| m.mount_point == mount_point)
    {
        return Err("not an rclone mount".into());
    }
    for bin in ["fusermount3", "fusermount"] {
        match Command::new(bin).args(["-uz", &mount_point]).output() {
            Ok(out) if out.status.success() => return Ok(()),
            Ok(out) => {
                return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
            }
            Err(_) => continue, // binary not found, try the next name
        }
    }
    Err("fusermount not found".into())
}

// ---------- app settings ----------

fn autostart_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("autostart")
        .join("monti.desktop"))
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    autostart_file(&app).map(|p| p.is_file()).unwrap_or(false)
}

/// Start Monti on login via the XDG autostart spec (KDE, GNOME, XFCE, …).
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let file = autostart_file(&app)?;
    if !enabled {
        if file.exists() {
            fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let entry = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Monti\n\
         Comment=Mount your clouds\n\
         Exec=\"{}\"\n\
         Icon=monti\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n",
        exe.display()
    );
    fs::write(&file, entry).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_close_to_tray(flags: State<Flags>, enabled: bool) {
    flags.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_keep_mounts(flags: State<Flags>, enabled: bool) {
    flags.keep_mounts.store(enabled, Ordering::Relaxed);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    app_version: String,
    rclone_version: Option<String>,
    rclone_path: Option<String>,
    config_path: Option<String>,
    tray_available: bool,
}

#[tauri::command]
async fn app_info(app: AppHandle, flags: State<'_, Flags>) -> Result<AppInfo, String> {
    let rclone = find_rclone(&app);
    let rclone_version = rclone.as_ref().and_then(|p| {
        Command::new(p)
            .arg("version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.lines().next().map(str::to_string))
    });
    // `rclone config file` prints a header line, then the path.
    let config_path = rclone.as_ref().and_then(|p| {
        Command::new(p)
            .args(["config", "file"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| s.lines().last().map(str::to_string))
    });
    Ok(AppInfo {
        app_version: app.package_info().version.to_string(),
        rclone_version,
        rclone_path: rclone.map(|p| p.display().to_string()),
        config_path,
        tray_available: flags.tray_ok.load(Ordering::Relaxed),
    })
}

// ---------- tray ----------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open Monti", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &sep, &quit])?;
    TrayIconBuilder::with_id("monti-tray")
        .icon(
            app.default_window_icon()
                .expect("bundle has icons")
                .clone(),
        )
        .tooltip("Monti — cloud drives")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

// ---------- entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin. A second launch (tray apps get started
        // twice all the time) focuses the existing window instead of
        // spawning a rival supervisor for the same engine.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(EngineState(Mutex::new(Engine::default())))
        .manage(CreateState(Mutex::new(None)))
        .manage(Flags {
            close_to_tray: AtomicBool::new(true),
            tray_ok: AtomicBool::new(false),
            keep_mounts: AtomicBool::new(true),
        })
        .setup(|app| {
            // libappindicator-sys PANICS (not errors) when the appindicator
            // .so is absent, which would crash the whole app on distros
            // without it. Catch the panic: no tray is a degraded mode, not
            // a fatal one.
            let handle = app.handle().clone();
            let ok = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                build_tray(&handle).is_ok()
            }))
            .unwrap_or(false);
            if !ok {
                eprintln!(
                    "monti: system tray unavailable (install libayatana-appindicator \
                     for close-to-tray support); window close will quit the app"
                );
            }
            app.state::<Flags>().tray_ok.store(ok, Ordering::Relaxed);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray so mounted drives stay alive — but only when
                // a tray icon actually exists, otherwise the app would
                // become unreachable.
                let flags = window.state::<Flags>();
                if flags.tray_ok.load(Ordering::Relaxed)
                    && flags.close_to_tray.load(Ordering::Relaxed)
                {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_status,
            install_rclone,
            start_engine,
            rc,
            create_remote,
            reconnect_remote,
            update_remote_key,
            cancel_create_remote,
            delete_remote,
            mount_remote,
            unmount_remote,
            unmount_external,
            list_system_mounts,
            get_autostart,
            set_autostart,
            set_close_to_tray,
            set_keep_mounts,
            app_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let create: State<CreateState> = app.state();
                if let Some(mut child) = create.0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                let state: State<EngineState> = app.state();
                let mut eng = state.0.lock().unwrap();
                // "Keep drives mounted": if anything is mounted and the
                // user asked for it, leave the daemon running — the next
                // session re-adopts it via the engine file.
                let keep = app.state::<Flags>().keep_mounts.load(Ordering::Relaxed);
                let has_mounts = eng.port != 0
                    && rc_raw(eng.port, &eng.pass, "mount/listmounts", &json!({}))
                        .ok()
                        .and_then(|v| {
                            v.get("mountPoints")
                                .and_then(Value::as_array)
                                .map(|a| !a.is_empty())
                        })
                        .unwrap_or(false);
                if keep && has_mounts {
                    eng.child = None; // drop the handle; the process lives on
                } else {
                    stop_engine_locked(app, &mut eng);
                }
            }
        });
}
