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
    process::Command,
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
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};

use engine::{
    app_bin_dir, build_vfs_opt, engine_alive, find_rclone, log_line, rc_raw,
    restart_engine_preserving_mounts, save_engine_file, start_engine_locked, stop_engine_locked,
    Engine, EngineState, MountEntry,
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

/// The jobid of the in-flight authorization step on the daemon, if any.
/// Kept separately so the Cancel button can stop it while the config
/// state machine is still polling. None inside = no flow running.
struct AuthState(Mutex<Option<u64>>);

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
    let resp = agent
        .get(&format!(
            "https://downloads.rclone.org/{version}/{file_name}"
        ))
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let total = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok());
    // Stream in chunks so the UI can show progress instead of freezing on
    // a 20 MB read.
    let mut reader = resp.into_reader().take(200 * 1024 * 1024);
    let mut bytes = Vec::new();
    let mut buf = [0u8; 128 * 1024];
    let mut last_percent = -1i64;
    let mut last_bytes = 0usize;
    loop {
        let n = std::io::Read::read(&mut reader, &mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&buf[..n]);
        // Emit on every whole percent, or every megabyte when the server
        // didn't send a length.
        let due = match total {
            Some(t) if t > 0 => {
                let percent = (bytes.len() as u64 * 100 / t) as i64;
                let due = percent != last_percent;
                last_percent = percent;
                due
            }
            _ => bytes.len() - last_bytes >= 1024 * 1024,
        };
        if due {
            last_bytes = bytes.len();
            let _ = app.emit(
                "engine-download",
                json!({ "downloaded": bytes.len(), "total": total }),
            );
        }
    }

    let sums = fetch_text(&format!(
        "https://downloads.rclone.org/{version}/SHA256SUMS"
    ))?;
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
            // Unpack next to the target and rename into place so a crash or
            // full disk never leaves a half-written binary at the final path.
            let tmp = bin_dir.join("rclone.download");
            let mut out = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            out.sync_all().map_err(|e| e.to_string())?;
            drop(out);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))
                    .map_err(|e| e.to_string())?;
            }
            fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
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

/// Cheap liveness probe for the UI's health poller. The RC call runs
/// WITHOUT holding the engine lock (a dead socket would otherwise queue
/// every other command behind its timeout) and with a short timeout.
#[tauri::command]
async fn engine_health(state: State<'_, EngineState>) -> Result<bool, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    if port == 0 {
        return Ok(false);
    }
    let alive = engine::rc_raw_with_timeout(port, &pass, "rc/noop", &json!({}), 3).is_ok();
    if !alive {
        // Reap the child handle so a later start doesn't think it's alive.
        let mut eng = state.0.lock().unwrap();
        if let Some(child) = &mut eng.child {
            if !matches!(child.try_wait(), Ok(None)) {
                eng.child = None;
            }
        }
    }
    Ok(alive)
}

/// Bring a dead engine back and remount everything the user had, with
/// the exact vfs options recorded in engine.json. Deliberately manual
/// (a button, not an auto-loop): a broken config would otherwise cause
/// an endless restart cycle behind the user's back.
#[tauri::command]
async fn restart_engine(app: AppHandle, state: State<'_, EngineState>) -> Result<(), String> {
    log_line(&app, "manual engine restart requested");
    restart_engine_preserving_mounts(&app, &state)
}

/// Read-only proxy to rclone's RC API: credentials never leave the Rust
/// side, and only the endpoints the UI actually needs are reachable —
/// anything with side effects goes through a dedicated command above.
#[tauri::command]
async fn rc(state: State<'_, EngineState>, path: String, body: Value) -> Result<Value, String> {
    const ALLOWED: &[&str] = &["mount/listmounts", "core/stats", "vfs/stats"];
    if !ALLOWED.contains(&path.as_str()) {
        return Err(format!("rc path not allowed: {path}"));
    }
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    rc_raw(port, &pass, &path, &body)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInfo {
    name: String,
    #[serde(rename = "type")]
    typ: String,
    has_own_key: bool,
    client_id: String,
}

/// Sanitized view of the config for the UI: names, types and the public
/// half of the API key. Secrets (client_secret, tokens, passwords) never
/// reach the webview — the full config/dump stays on the Rust side.
#[tauri::command]
async fn list_remotes(state: State<'_, EngineState>) -> Result<Vec<RemoteInfo>, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let dump = rc_raw(port, &pass, "config/dump", &json!({}))?;
    let mut out: Vec<RemoteInfo> = dump
        .as_object()
        .map(|obj| {
            obj.iter()
                .map(|(name, conf)| {
                    let client_id = conf
                        .get("client_id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    RemoteInfo {
                        name: name.clone(),
                        typ: conf
                            .get("type")
                            .and_then(Value::as_str)
                            .unwrap_or("?")
                            .to_string(),
                        has_own_key: !client_id.is_empty(),
                        client_id,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Drive rclone's interactive config state machine over the RC API
/// (config/create / config/update with opt.nonInteractive). Each step is
/// submitted `_async` so Cancel (job/stop) and a hard 5-minute deadline
/// work; for OAuth backends the daemon itself opens the browser and runs
/// the localhost callback server. Compared to the old CLI spawn this
/// needs no engine restart, keeps secrets out of argv and leaves the
/// config file with a single writer — the daemon.
///
/// Protocol notes (verified against rclone v1.74): every continue call
/// must repeat name/type/parameters; answers use Option.DefaultStr,
/// except config_is_local which we force to "true".
#[allow(clippy::too_many_arguments)]
fn config_state_machine(
    app: &AppHandle,
    port: u16,
    pass: &str,
    auth: &AuthState,
    endpoint: &str,
    name: &str,
    typ: Option<&str>,
    parameters: &Value,
) -> Result<(), String> {
    {
        let mut slot = auth.0.lock().unwrap();
        if slot.is_some() {
            return Err("another authorization is already in progress".into());
        }
        *slot = Some(0); // claimed, no job yet
    }
    log_line(app, &format!("auth flow started ({endpoint} {name})"));
    let result = drive_state_machine(port, pass, auth, endpoint, name, typ, parameters);
    *auth.0.lock().unwrap() = None;
    match &result {
        Ok(()) => log_line(app, &format!("auth flow finished ({name})")),
        Err(e) => log_line(app, &format!("auth flow failed ({name}): {e}")),
    }
    result
}

fn drive_state_machine(
    port: u16,
    pass: &str,
    auth: &AuthState,
    endpoint: &str,
    name: &str,
    typ: Option<&str>,
    parameters: &Value,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let stop_job = |jobid: u64| {
        let _ = rc_raw(port, pass, "job/stop", &json!({ "jobid": jobid }));
    };
    let mut opt = json!({ "nonInteractive": true, "obscure": true });

    for _ in 0..20 {
        let mut body = json!({
            "name": name,
            "parameters": parameters,
            "opt": opt,
            "_async": true,
        });
        if let Some(t) = typ {
            body["type"] = t.into();
        }
        let jobid = rc_raw(port, pass, endpoint, &body)?["jobid"]
            .as_u64()
            .ok_or("daemon did not return a job id")?;
        {
            let mut slot = auth.0.lock().unwrap();
            if slot.is_none() {
                stop_job(jobid);
                return Err("Authorization cancelled.".into());
            }
            *slot = Some(jobid);
        }

        // Poll this step; the OAuth step blocks here until the user
        // finishes in the browser.
        let output = loop {
            thread::sleep(Duration::from_millis(500));
            if auth.0.lock().unwrap().is_none() {
                stop_job(jobid);
                return Err("Authorization cancelled.".into());
            }
            if std::time::Instant::now() > deadline {
                stop_job(jobid);
                return Err("Authorization timed out after 5 minutes.".into());
            }
            let status = rc_raw(port, pass, "job/status", &json!({ "jobid": jobid }))?;
            if status["finished"].as_bool() == Some(true) {
                if status["success"].as_bool() != Some(true) {
                    let e = status["error"].as_str().unwrap_or("authorization failed");
                    return Err(e.to_string());
                }
                break status["output"].clone();
            }
        };

        let step_err = output["Error"].as_str().unwrap_or("");
        if !step_err.is_empty() {
            return Err(step_err.to_string());
        }
        let state = output["State"].as_str().unwrap_or("");
        if state.is_empty() {
            return Ok(()); // machine done — token stored by the daemon
        }
        let option = &output["Option"];
        let answer = if option["Name"].as_str() == Some("config_is_local") {
            "true".to_string() // we are the machine with the browser
        } else if let Some(s) = option["DefaultStr"].as_str() {
            s.to_string()
        } else {
            match &option["Default"] {
                Value::String(s) => s.clone(),
                Value::Null => String::new(),
                v => v.to_string(),
            }
        };
        opt = json!({
            "nonInteractive": true,
            "obscure": true,
            "continue": true,
            "state": state,
            "result": answer,
        });
    }
    Err("authorization did not finish (too many configuration steps)".into())
}

/// Create a remote through the daemon's RC config API. For OAuth
/// providers the daemon opens the browser and runs the callback server;
/// optional client_id/client_secret let the user connect through their
/// own API key instead of rclone's shared one (retired during 2026).
/// No engine restart, no secrets in argv, single writer of the config.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn create_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    auth: State<'_, AuthState>,
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
    // `config create` silently OVERWRITES an existing remote of the same
    // name — before OAuth even starts. Refuse: the user almost certainly
    // wants a second account, not to destroy the first one.
    {
        let eng = state.0.lock().unwrap();
        let dump = rc_raw(eng.port, &eng.pass, "config/dump", &json!({}))?;
        if dump.get(&name).is_some() {
            return Err(format!(
                "A drive named \"{name}\" already exists — pick another name, \
                 or remove the existing one first."
            ));
        }
    }
    const OAUTH: &[&str] = &["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"];
    let allowed_params: &[&str] = match provider.as_str() {
        p if OAUTH.contains(&p) => {
            let (port, pass) = {
                let eng = state.0.lock().unwrap();
                (eng.port, eng.pass.clone())
            };
            let mut parameters = serde_json::Map::new();
            if let Some(id) = client_id.filter(|s| !s.trim().is_empty()) {
                parameters.insert("client_id".into(), Value::String(id.trim().into()));
            }
            if let Some(secret) = client_secret.filter(|s| !s.trim().is_empty()) {
                parameters.insert("client_secret".into(), Value::String(secret.trim().into()));
            }
            if let Err(e) = config_state_machine(
                &app,
                port,
                &pass,
                &auth,
                "config/create",
                &name,
                Some(&provider),
                &Value::Object(parameters),
            ) {
                // The section is written before OAuth finishes; an aborted
                // flow must not leave a broken token-less remote. The
                // duplicate-name guard above proved it did not exist.
                let _ = rc_raw(port, &pass, "config/delete", &json!({ "name": name }));
                return Err(e);
            }
            return Ok(());
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
    auth: State<'_, AuthState>,
    name: String,
) -> Result<(), String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    config_state_machine(
        &app,
        port,
        &pass,
        &auth,
        "config/update",
        &name,
        None,
        &json!({}),
    )
}

/// Switch an existing remote to a different API key (client_id/secret) and
/// re-authorize in one browser trip. Empty values reset the remote back to
/// rclone's shared key.
#[tauri::command]
async fn update_remote_key(
    app: AppHandle,
    state: State<'_, EngineState>,
    auth: State<'_, AuthState>,
    name: String,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    config_state_machine(
        &app,
        port,
        &pass,
        &auth,
        "config/update",
        &name,
        None,
        &json!({
            "client_id": client_id.trim(),
            "client_secret": client_secret.trim(),
        }),
    )
}

/// Abort an in-flight browser authorization (Cancel button): empty the
/// slot — the polling loop notices and stops the daemon-side job.
#[tauri::command]
fn cancel_create_remote(state: State<EngineState>, auth: State<AuthState>) {
    let jobid = auth.0.lock().unwrap().take();
    if let Some(jobid) = jobid.filter(|&j| j > 0) {
        let (port, pass) = {
            let eng = state.0.lock().unwrap();
            (eng.port, eng.pass.clone())
        };
        let _ = rc_raw(port, &pass, "job/stop", &json!({ "jobid": jobid }));
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
    rc_raw(
        eng.port,
        &eng.pass,
        "config/delete",
        &json!({ "name": name }),
    )?;
    log_line(&app, &format!("deleted remote {name}"));
    Ok(())
}

/// rclone's local VFS cache for one remote: vfs/<name> holds file copies,
/// vfsMeta/<name> their metadata.
fn vfs_cache_dirs(app: &AppHandle, name: &str) -> Result<Vec<PathBuf>, String> {
    // The name lands in a filesystem path — refuse anything that could
    // escape the cache root. rclone itself forbids '/' in remote names.
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(format!("invalid remote name: {name:?}"));
    }
    let cache = app.path().cache_dir().map_err(|e| e.to_string())?; // ~/.cache
    let root = cache.join("rclone");
    Ok(vec![
        root.join("vfs").join(name),
        root.join("vfsMeta").join(name),
    ])
}

fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Bytes of cached file copies a remote keeps under ~/.cache/rclone.
#[tauri::command]
fn vfs_cache_size(app: AppHandle, name: String) -> Result<u64, String> {
    Ok(vfs_cache_dirs(&app, &name)?
        .iter()
        .map(|d| dir_size(d))
        .sum())
}

/// Delete a remote's local VFS cache (offered by the UI after the remote
/// itself is removed). Cloud data is not touched.
#[tauri::command]
fn clear_vfs_cache(app: AppHandle, name: String) -> Result<(), String> {
    for dir in vfs_cache_dirs(&app, &name)? {
        if dir.is_dir() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    log_line(&app, &format!("cleared vfs cache of {name}"));
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
    let created_dir = !mount_point.exists();
    fs::create_dir_all(&mount_point).map_err(|e| e.to_string())?;
    // If anything below fails, don't leave behind an empty folder we
    // created ourselves.
    let cleanup = |err: String| {
        if created_dir {
            let _ = fs::remove_dir(&mount_point);
        }
        err
    };
    // FUSE needs an empty directory to mount over.
    if fs::read_dir(&mount_point)
        .map_err(|e| cleanup(e.to_string()))?
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
    )
    .map_err(&cleanup)?;
    eng.mounts.insert(
        format!("{name}:"),
        MountEntry {
            mount_point: mount_point.display().to_string(),
            vfs_opt,
        },
    );
    save_engine_file(&app, &eng);
    log_line(
        &app,
        &format!("mounted {name}: at {}", mount_point.display()),
    );
    Ok(mount_point.display().to_string())
}

#[tauri::command]
async fn unmount_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    mount_point: String,
    force: Option<bool>,
) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    // Unmounting while the writeback queue is busy risks the user
    // shutting down before the cache ever gets another chance to flush.
    // The UI turns this marker into a confirm dialog and retries with
    // force=true.
    if force != Some(true) {
        if let Some((fs_name, _)) = eng
            .mounts
            .iter()
            .find(|(_, e)| e.mount_point == mount_point)
        {
            let pending = engine::pending_uploads(eng.port, &eng.pass, fs_name);
            if pending > 0 {
                return Err(format!("UPLOADS_PENDING:{pending}"));
            }
        }
    }
    rc_raw(
        eng.port,
        &eng.pass,
        "mount/unmount",
        &json!({ "mountPoint": mount_point }),
    )?;
    eng.mounts.retain(|e_key, e| {
        let _ = e_key;
        e.mount_point != mount_point
    });
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
    // Inside an AppImage current_exe() is the throwaway squashfs mount under
    // /tmp/.mount_*; $APPIMAGE holds the real, persistent file the user runs.
    let exe = match std::env::var_os("APPIMAGE") {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => std::env::current_exe().map_err(|e| e.to_string())?,
    };
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
        .icon(app.default_window_icon().expect("bundle has icons").clone())
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
        .manage(AuthState(Mutex::new(None)))
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
            engine_health,
            restart_engine,
            install_rclone,
            start_engine,
            rc,
            list_remotes,
            create_remote,
            reconnect_remote,
            update_remote_key,
            cancel_create_remote,
            delete_remote,
            vfs_cache_size,
            clear_vfs_cache,
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
                let state: State<EngineState> = app.state();
                let mut eng = state.0.lock().unwrap();
                // A dangling authorization must not ride into the next
                // session on a surviving daemon.
                let auth: State<AuthState> = app.state();
                if let Some(jobid) = auth.0.lock().unwrap().take().filter(|&j| j > 0) {
                    let _ = rc_raw(eng.port, &eng.pass, "job/stop", &json!({ "jobid": jobid }));
                }
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
                    // Bounded drain: give the writeback queue up to 15s
                    // before the daemon goes down. (The cache would survive
                    // and resume on next mount, but only if there IS a next
                    // mount — don't gamble when quitting for good.)
                    for _ in 0..15 {
                        let busy = eng.mounts.keys().any(|fs_name| {
                            engine::pending_uploads(eng.port, &eng.pass, fs_name) > 0
                        });
                        if !busy {
                            break;
                        }
                        thread::sleep(Duration::from_secs(1));
                    }
                    stop_engine_locked(app, &mut eng);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Child, Command, Stdio};

    struct TestDaemon {
        child: Child,
        port: u16,
        pass: String,
        _conf: tempdir::TempDirGuard,
    }

    mod tempdir {
        pub struct TempDirGuard(pub std::path::PathBuf);
        impl Drop for TempDirGuard {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }

    fn spawn_test_rcd() -> Option<TestDaemon> {
        // Tests need a real rclone; skip silently where it's absent (CI
        // without rclone) — the protocol was verified there separately.
        let dir = std::env::temp_dir().join(format!("monti-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).ok()?;
        let conf = dir.join("rclone.conf");
        std::fs::write(&conf, "").ok()?;
        let port = engine::free_port().ok()?;
        let pass = "testpass".to_string();
        let child = Command::new("rclone")
            .args(["rcd", &format!("--rc-addr=127.0.0.1:{port}")])
            .env("RCLONE_CONFIG", &conf)
            .env("RCLONE_RC_USER", engine::RC_USER)
            .env("RCLONE_RC_PASS", &pass)
            // Never open a real browser from tests: no display, and a
            // no-op $BROWSER for whatever ignores the missing display.
            .env("BROWSER", "true")
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("XDG_CURRENT_DESKTOP")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        for _ in 0..50 {
            if rc_raw(port, &pass, "rc/noop", &json!({})).is_ok() {
                return Some(TestDaemon {
                    child,
                    port,
                    pass,
                    _conf: tempdir::TempDirGuard(dir),
                });
            }
            thread::sleep(Duration::from_millis(100));
        }
        None
    }

    impl Drop for TestDaemon {
        fn drop(&mut self) {
            let _ = rc_raw(self.port, &self.pass, "core/quit", &json!({}));
            thread::sleep(Duration::from_millis(200));
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    #[test]
    fn state_machine_completes_for_questionless_backend() {
        let Some(d) = spawn_test_rcd() else { return };
        let auth = AuthState(Mutex::new(Some(0)));
        let r = drive_state_machine(
            d.port,
            &d.pass,
            &auth,
            "config/create",
            "tlocal",
            Some("local"),
            &json!({}),
        );
        assert_eq!(r, Ok(()));
        let dump = rc_raw(d.port, &d.pass, "config/dump", &json!({})).unwrap();
        assert!(dump.get("tlocal").is_some(), "remote not created: {dump}");
    }

    #[test]
    fn state_machine_cancel_unblocks_oauth_wait() {
        let Some(d) = spawn_test_rcd() else { return };
        let auth = std::sync::Arc::new(AuthState(Mutex::new(Some(0))));
        let (port, pass) = (d.port, d.pass.clone());
        let auth2 = std::sync::Arc::clone(&auth);
        let flow = thread::spawn(move || {
            drive_state_machine(
                port,
                &pass,
                &auth2,
                "config/create",
                "tdrive",
                Some("drive"),
                &json!({}),
            )
        });
        // Give the machine time to reach the browser-wait step, then cancel.
        thread::sleep(Duration::from_secs(4));
        auth.0.lock().unwrap().take();
        let r = flow.join().unwrap();
        assert_eq!(r, Err("Authorization cancelled.".to_string()));
        // Clean the half-written section like create_remote's error path does.
        let _ = rc_raw(
            d.port,
            &d.pass,
            "config/delete",
            &json!({ "name": "tdrive" }),
        );
        let dump = rc_raw(d.port, &d.pass, "config/dump", &json!({})).unwrap();
        assert!(dump.get("tdrive").is_none());
    }
}
