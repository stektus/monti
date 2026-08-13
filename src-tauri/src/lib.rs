// Monti — mount your clouds. A friendly GUI for rclone.
//
// Architecture: this backend manages an `rclone rcd` daemon (the "engine",
// see engine.rs) and proxies JSON-RPC calls to it. The frontend never
// talks to rclone directly and never sees the RC credentials.

mod engine;
mod sync;

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
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
    app_bin_dir, build_vfs_opt, detach_child, engine_alive, find_rclone, log_line, rc_raw,
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

#[tauri::command(async)]
fn list_system_mounts() -> Vec<SystemMount> {
    read_proc_mounts()
}

/// Resolve a mount point the way /proc/mounts writes it, without ever
/// touching the mounted filesystem itself: only the parent directory is
/// canonicalized, so a hung or dead FUSE mount cannot block the caller.
fn canonical_mount_point(point: &str) -> String {
    let path = Path::new(point);
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => fs::canonicalize(parent)
            .map(|p| p.join(name).to_string_lossy().into_owned())
            .unwrap_or_else(|_| point.to_string()),
        _ => point.to_string(),
    }
}

/// Drives Monti mounted that are not mounted any more — someone ran
/// `fusermount -u` in a terminal, or the mount died. Neither the app nor the
/// engine is told: rclone drops such a mount from its list without a word,
/// so the drive keeps looking mounted in a window nobody reloaded, and the
/// folder is quietly empty.
///
/// Only Monti's own record can answer this, and a drive is reported once —
/// the record is dropped with it, so an engine restart does not resurrect a
/// mount the person deliberately took down.
#[tauri::command]
async fn lost_mounts(app: AppHandle, state: State<'_, EngineState>) -> Result<Vec<String>, String> {
    let (port, pass, recorded) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone(), eng.mounts.clone())
    };
    if recorded.is_empty() {
        return Ok(Vec::new());
    }
    let listed = engine::rc_raw_with_timeout(port, &pass, "mount/listmounts", &json!({}), 5)?;
    let by_engine: HashSet<String> = listed
        .get("mountPoints")
        .and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .filter_map(|m| m.get("MountPoint").and_then(Value::as_str))
                .map(canonical_mount_point)
                .collect()
        })
        .unwrap_or_default();
    let by_kernel: HashSet<String> = read_proc_mounts()
        .iter()
        .map(|m| canonical_mount_point(&m.mount_point))
        .collect();

    let gone: Vec<String> = recorded
        .iter()
        .filter(|(_, entry)| {
            let point = canonical_mount_point(&entry.mount_point);
            !by_engine.contains(&point) || !by_kernel.contains(&point)
        })
        .map(|(fs, _)| fs.clone())
        .collect();
    if gone.is_empty() {
        return Ok(Vec::new());
    }
    {
        let mut eng = state.0.lock().unwrap();
        for fs in &gone {
            eng.mounts.remove(fs);
        }
        engine::save_engine_file(&app, &eng);
    }
    for fs in &gone {
        log_line(
            &app,
            &format!("{fs} is no longer mounted (unmounted outside Monti)"),
        );
    }
    // "gdrive:" and, for a local remote, "gdrive:." — the name is what comes
    // before the colon either way.
    Ok(gone
        .iter()
        .map(|fs| fs.split(':').next().unwrap_or(fs).to_string())
        .collect())
}

// ---------- opening folders and links ----------

/// Hand a folder or link to the desktop's handler.
///
/// Done here rather than through tauri-plugin-opener because inside an
/// AppImage the bundled `xdg-open` (1.1.3) wins the PATH lookup, and its
/// KDE branch only knows session versions 4 and 5 — on Plasma 6 it matches
/// nothing, runs no command and reports success, so folders and links
/// silently never opened. `detach_child` strips the AppImage entries from
/// PATH, so the system xdg-open is used and the child outlives Monti.
fn spawn_opener(target: &str) -> Result<(), String> {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_child(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not run xdg-open: {e}"))?;
    // xdg-open returns as soon as it has handed the target over; reap it
    // so it doesn't linger as a zombie.
    thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

/// Open a folder in the file manager. Directories only: pointing xdg-open
/// at a file would let a `.desktop` file execute instead of being shown.
#[tauri::command(async)]
fn open_folder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err(format!("{path} is not a folder"));
    }
    spawn_opener(&p.display().to_string())
}

/// Open an https link in the browser. Only https, so a crafted link can't
/// reach file:// or a custom scheme handler.
#[tauri::command(async)]
fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("only https links can be opened".into());
    }
    spawn_opener(&url)
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
    /// For drives mounted by Monti: whether the LIVE mount is read-only
    /// (the pref may have changed since it was mounted).
    mounted_read_only: Option<bool>,
    /// For an encrypted drive: where its files really live ("gdrive:Encrypted").
    /// A path, never a secret — and without it the card would not say which
    /// cloud is carrying the encrypted copy.
    wraps: Option<String>,
}

/// Sanitized view of the config for the UI: names, types and the public
/// half of the API key. Secrets (client_secret, tokens, passwords) never
/// reach the webview — the full config/dump stays on the Rust side.
#[tauri::command]
async fn list_remotes(state: State<'_, EngineState>) -> Result<Vec<RemoteInfo>, String> {
    let (port, pass, live_mounts) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone(), eng.mounts.clone())
    };
    let dump = rc_raw(port, &pass, "config/dump", &json!({}))?;
    let mut out: Vec<RemoteInfo> =
        dump.as_object()
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
                            mounted_read_only: live_mounts.get(&format!("{name}:")).map(|m| {
                                m.vfs_opt
                                    .get("ReadOnly")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false)
                            }),
                            wraps: (conf.get("type").and_then(Value::as_str) == Some("crypt"))
                                .then(|| {
                                    conf.get("remote")
                                        .and_then(Value::as_str)
                                        .unwrap_or("")
                                        .to_string()
                                }),
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

/// The fields a form may send, per provider. Anything else is dropped: the
/// webview must not be able to set arbitrary rclone options, and a name the
/// backend does not have would be stored and then quietly ignored.
///
/// `None` means Monti does not offer this provider. Adding one to the dialog
/// without adding it here is exactly the mistake a test below looks for.
fn allowed_params(provider: &str) -> Option<&'static [&'static str]> {
    Some(match provider {
        // An encrypted drive is a drive on top of another one. rclone stores
        // the password obscured (reversible, not encrypted) in its config, so
        // what this protects is the copy in the cloud — the dialog says so.
        "crypt" => &["remote", "password", "password2"],
        "webdav" => &["url", "vendor", "user", "pass"],
        "s3" => &[
            "provider",
            "access_key_id",
            "secret_access_key",
            "endpoint",
            "region",
        ],
        "b2" => &["account", "key"],
        // Koofr and Digi Storage know their own endpoint; "other" is the
        // one variant that has to be told where to connect.
        "koofr" => &["provider", "endpoint", "user", "password"],
        "mega" => &["user", "pass"],
        // Proton exchanges the one-time code for session tokens and writes
        // those itself; the form only ever sends these three.
        "protondrive" => &["username", "password", "2fa"],
        "sftp" => &["host", "port", "user", "pass", "key_file"],
        _ => return None,
    })
}

/// Providers whose sign-in is a browser round trip rather than a form.
const OAUTH_PROVIDERS: &[&str] = &["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"];

/// Of the fields a form provider takes, the ones that may be shown again:
/// an address, a user name, a key id. Never a password — everything left
/// out of this list comes back to the dialog blank, which for a secret is
/// the only right answer.
fn public_params(provider: &str) -> &'static [&'static str] {
    match provider {
        "webdav" => &["url", "vendor", "user"],
        // The access key id names the key; the secret access key is the key.
        "s3" => &["provider", "access_key_id", "endpoint", "region"],
        "b2" => &["account"],
        "koofr" => &["provider", "endpoint", "user"],
        "mega" => &["user"],
        "protondrive" => &["username"],
        "sftp" => &["host", "port", "user", "key_file"],
        _ => &[],
    }
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
    let allowed_params: &[&str] = match provider.as_str() {
        p if OAUTH_PROVIDERS.contains(&p) => {
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
        p => allowed_params(p).ok_or_else(|| format!("unsupported provider: {p}"))?,
    };

    let mut parameters = serde_json::Map::new();
    for (key, value) in params.unwrap_or_default() {
        // A password is taken exactly as typed. Trimming one changes it
        // silently, and with an encrypted drive nobody would find out until
        // the files no longer open.
        let is_password = provider == "crypt" && key.starts_with("password");
        let value = if is_password {
            value
        } else {
            value.trim().to_string()
        };
        if value.is_empty() {
            continue;
        }
        if !allowed_params.contains(&key.as_str()) {
            return Err(format!("unexpected option: {key}"));
        }
        parameters.insert(key, Value::String(value));
    }
    if provider == "crypt" {
        // Without a password rclone would happily make a remote that
        // encrypts with an empty key — protection that is not protection.
        if !parameters.contains_key("password") {
            return Err("an encrypted drive needs a password".into());
        }
        let target = parameters
            .get("remote")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let base = target.split(':').next().unwrap_or_default();
        let eng = state.0.lock().unwrap();
        let dump = rc_raw(eng.port, &eng.pass, "config/dump", &json!({}))?;
        if base.is_empty() || dump.get(base).is_none() {
            return Err(format!(
                "\"{base}\" is not a drive on this computer — an encrypted \
                 drive is stored inside one you already have."
            ));
        }
    }
    if provider == "s3" {
        // Keys come from the form, never from env vars / IAM profiles.
        parameters.insert("env_auth".into(), Value::String("false".into()));
    }
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    rc_raw(
        port,
        &pass,
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

    verify_or_undo(port, &pass, &name, &provider)
}

/// Providers whose sign-in can be proved on the spot, by asking for the
/// root listing right after the drive is written.
///
/// S3 is deliberately not here: keys are routinely scoped to one bucket,
/// and listing the root then fails for a key that is perfectly good.
/// Neither is crypt — the folder it encrypts into does not have to exist
/// yet, so "not found" is the normal answer for a new one.
const VERIFY_ON_CREATE: &[&str] = &["b2", "koofr", "mega", "protondrive", "sftp", "webdav"];

/// Prove the credentials work before the drive is allowed to stay.
///
/// Writing a password into a config file does not check it: rclone signs in
/// the first time the drive is actually used, which is when somebody presses
/// Mount. A typo therefore became a drive in the list that looked fine and
/// failed minutes later, somewhere that could no longer say which field was
/// wrong — and for Proton it could not work at all, because a one-time code
/// is dead by then. So the sign-in happens here, while the form is still on
/// screen; if it is refused, the half-made drive goes away instead of waiting
/// in the list to fail later.
fn verify_or_undo(port: u16, pass: &str, name: &str, provider: &str) -> Result<(), String> {
    if !VERIFY_ON_CREATE.contains(&provider) {
        return Ok(());
    }
    if let Err(e) = rc_raw(
        port,
        pass,
        "operations/list",
        &json!({ "fs": format!("{name}:"), "remote": "" }),
    ) {
        let _ = rc_raw(port, pass, "config/delete", &json!({ "name": name }));
        return Err(e);
    }
    if provider == "protondrive" {
        // The code is spent. Leaving it behind would make a session that
        // expires months from now fail as "incorrect credentials" instead of
        // saying the drive needs signing in again.
        let _ = rc_raw(
            port,
            pass,
            "config/update",
            &json!({
                "name": name,
                "parameters": { "2fa": "" },
                "opt": { "nonInteractive": true },
            }),
        );
    }
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

/// What the sign-in form should show when it is opened for a drive that
/// already exists: the provider, and the fields that are not secrets.
#[tauri::command]
async fn remote_credentials(state: State<'_, EngineState>, name: String) -> Result<Value, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let dump = rc_raw(port, &pass, "config/dump", &json!({}))?;
    let section = dump
        .get(&name)
        .ok_or_else(|| format!("there is no drive called \"{name}\""))?;
    let provider = section["type"].as_str().unwrap_or_default().to_string();
    let mut fields = serde_json::Map::new();
    for key in public_params(&provider) {
        if let Some(value) = section.get(*key).and_then(Value::as_str) {
            fields.insert((*key).into(), Value::String(value.into()));
        }
    }
    Ok(json!({ "type": provider, "fields": fields }))
}

/// Write new sign-in details for a drive that already exists, keeping the
/// drive itself — its name, mount folder, hidden folders and cache stay.
///
/// Verified before it is kept. A password is typed blind, and a drive whose
/// details were replaced by a typo would be a working drive turned broken,
/// so the provider is asked to answer with them first and the old details go
/// back if it refuses. Fields left blank are left alone: a form that shows
/// an empty password box must not read that as "the password is now empty".
fn apply_credentials(
    port: u16,
    pass: &str,
    name: &str,
    params: HashMap<String, String>,
) -> Result<(), String> {
    let dump = rc_raw(port, pass, "config/dump", &json!({}))?;
    let section = dump
        .get(name)
        .ok_or_else(|| format!("there is no drive called \"{name}\""))?;
    let provider = section["type"].as_str().unwrap_or_default().to_string();
    if OAUTH_PROVIDERS.contains(&provider.as_str()) {
        return Err("this drive signs in through the browser — use Re-authorize".into());
    }
    if provider == "crypt" {
        // Not a sign-in at all: the password is the key. A new one does not
        // unlock what the old one locked, it just stops the files opening.
        return Err(
            "an encrypted drive's password cannot be changed: everything \
                    already stored in it was encrypted with the old one."
                .into(),
        );
    }
    let allowed =
        allowed_params(&provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;

    let mut parameters = serde_json::Map::new();
    for (key, value) in params {
        let value = value.trim().to_string();
        if value.is_empty() {
            continue;
        }
        if !allowed.contains(&key.as_str()) {
            return Err(format!("unexpected option: {key}"));
        }
        parameters.insert(key, Value::String(value));
    }
    if parameters.is_empty() {
        return Err("nothing to change — fill in what should be different".into());
    }

    // What goes back if the new details are refused. Passwords come out of
    // the config already obscured, so they are put back untouched: obscuring
    // an obscured password produces a third, wrong password.
    let previous: serde_json::Map<String, Value> = parameters
        .keys()
        .map(|key| {
            (
                key.clone(),
                section
                    .get(key)
                    .cloned()
                    .unwrap_or_else(|| Value::String(String::new())),
            )
        })
        .collect();
    let restore = |port: u16, pass: &str| {
        let _ = rc_raw(
            port,
            pass,
            "config/update",
            &json!({
                "name": name,
                "parameters": previous,
                "opt": { "noObscure": true, "nonInteractive": true },
            }),
        );
    };

    rc_raw(
        port,
        pass,
        "config/update",
        &json!({
            "name": name,
            "parameters": parameters,
            "opt": { "obscure": true, "nonInteractive": true },
        }),
    )?;

    if let Err(e) = rc_raw(
        port,
        pass,
        "operations/list",
        &json!({ "fs": format!("{name}:"), "remote": "" }),
    ) {
        restore(port, pass);
        return Err(e);
    }
    if provider == "protondrive" {
        // Spent the moment the sign-in above went through, exactly as at
        // creation; leaving it behind breaks the next session instead.
        let _ = rc_raw(
            port,
            pass,
            "config/update",
            &json!({
                "name": name,
                "parameters": { "2fa": "" },
                "opt": { "nonInteractive": true },
            }),
        );
    }
    Ok(())
}

/// New sign-in details for a form-based drive, and a fresh mount if the
/// drive was mounted with the old ones.
#[tauri::command]
async fn update_remote_credentials(
    app: AppHandle,
    state: State<'_, EngineState>,
    name: String,
    params: HashMap<String, String>,
) -> Result<(), String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    apply_credentials(port, &pass, &name, params)?;
    log_line(&app, &format!("new sign-in details for {name}:"));

    // rclone builds a drive once, when it is mounted, and keeps using what
    // it was built with. A mount made with the details that stopped working
    // would go on failing until the next restart, which reads as "the fix
    // did nothing" — so it is made again here.
    let fs_name = format!("{name}:");
    let entry = {
        let eng = state.0.lock().unwrap();
        eng.mounts.get(&fs_name).cloned()
    };
    if let Some(entry) = entry {
        let _ = rc_raw(
            port,
            &pass,
            "mount/unmount",
            &json!({ "mountPoint": entry.mount_point }),
        );
        engine::mount_guarded(port, &pass, &fs_name, &entry)?;
        log_line(&app, &format!("remounted {fs_name} with the new details"));
    }
    Ok(())
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
    mount_point: Option<String>,
) -> Result<(), String> {
    // Deleting the config of a mounted remote would strand the mount
    // (and a systemd-managed one would break on its next restart).
    if let Some(m) = read_proc_mounts().into_iter().find(|m| m.remote == name) {
        return Err(format!(
            "\"{name}\" is mounted at {} — unmount it first.",
            m.mount_point
        ));
    }
    {
        let eng = state.0.lock().unwrap();
        rc_raw(
            eng.port,
            &eng.pass,
            "config/delete",
            &json!({ "name": name }),
        )?;
    }
    // Leave no trace: drop the now-unused mount folder(s). remove_dir
    // refuses non-empty directories, so user files are never at risk.
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let clouddrives = home.join("CloudDrives");
    if !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.starts_with('.') {
        let _ = fs::remove_dir(clouddrives.join(&name));
    }
    if let Some(custom) = mount_point
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        let p = match custom.strip_prefix("~/") {
            Some(rest) => home.join(rest),
            None => PathBuf::from(custom),
        };
        // Only tidy inside the user's home, and never the home dir itself.
        if p.starts_with(&home) && p != home {
            let _ = fs::remove_dir(&p);
        }
    }
    let _ = fs::remove_dir(&clouddrives); // gone too once the last drive leaves
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

/// What the provider says about space on one remote.
///
/// Every field is optional on purpose: backends disagree about what they
/// can answer — Drive reports all of it, S3 nothing — and a number nobody
/// knows must be shown as absent, not as zero.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AboutInfo {
    total: Option<u64>,
    used: Option<u64>,
    free: Option<u64>,
    trashed: Option<u64>,
}

/// Space used in the cloud, so nobody has to open a web interface to find
/// out whether their Drive is full.
///
/// This one call goes to the provider, so it gets a timeout of its own: a
/// slow or unreachable backend must leave the drive card usable rather
/// than hold up the whole list.
#[tauri::command]
async fn remote_about(state: State<'_, EngineState>, name: String) -> Result<AboutInfo, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let v = engine::rc_raw_with_timeout(
        port,
        &pass,
        "operations/about",
        &json!({ "fs": format!("{name}:") }),
        20,
    )?;
    let num = |key: &str| v.get(key).and_then(Value::as_u64);
    Ok(AboutInfo {
        total: num("total"),
        used: num("used"),
        free: num("free"),
        trashed: num("trashed"),
    })
}

/// Bytes of cached file copies a remote keeps under ~/.cache/rclone.
#[tauri::command(async)]
fn vfs_cache_size(app: AppHandle, name: String) -> Result<u64, String> {
    Ok(vfs_cache_dirs(&app, &name)?
        .iter()
        .map(|d| dir_size(d))
        .sum())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfo {
    /// Bytes cached by all drives together.
    used: u64,
    /// Free space left on the disk that holds the cache.
    free: u64,
    /// Limit a drive gets when the user has not chosen one.
    default_limit: String,
}

/// The engine's list of finished transfers, newest first.
///
/// Answers "is this thing actually doing anything?" — the question behind
/// most "my mount is broken" reports, where the real answer is usually
/// "yes, it uploaded that file an hour ago".
///
/// The list lives in the daemon and starts empty after every restart; it
/// is a session log, not a history, and the interface says so.
#[tauri::command]
async fn transfer_history(state: State<'_, EngineState>) -> Result<Value, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    engine::rc_raw_with_timeout(port, &pass, "core/transferred", &json!({}), 5)
}

/// Read or set the engine's transfer speed limit.
///
/// `rate` is an rclone bandwidth string ("1M", "500k", "off") or None to
/// only ask. The limit applies to the whole engine and takes effect at
/// once, which is the point: someone throttles Monti because an upload is
/// making a video call stutter *now*.
#[tauri::command]
async fn bandwidth_limit(
    state: State<'_, EngineState>,
    rate: Option<String>,
) -> Result<String, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let body = match &rate {
        Some(r) => json!({ "rate": r }),
        None => json!({}),
    };
    let v = engine::rc_raw_with_timeout(port, &pass, "core/bwlimit", &body, 5)?;
    // rclone answers with "rate" ("off" or e.g. "1M"); older builds only
    // send the byte counts, so fall back to those rather than show nothing.
    Ok(v.get("rate")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| match v.get("bytesPerSecond").and_then(Value::as_i64) {
            Some(n) if n <= 0 => "off".into(),
            Some(n) => format!("{n}"),
            None => "off".into(),
        }))
}

/// Put a message on the desktop for something the person must not miss —
/// the engine dying, the disk filling up.
///
/// Linux notifications go through a D-Bus service that only exists if a
/// notification daemon is running: standard on KDE, GNOME, XFCE and the
/// rest, absent on a bare window manager without dunst or mako. A missing
/// daemon must be as harmless as a missing tray icon, so failure is logged
/// and swallowed — the same event is always on screen inside the app too.
#[tauri::command(async)]
fn notify_user(app: AppHandle, title: String, body: String) {
    // Showing a notification is a D-Bus round trip; on a session bus with no
    // daemon it fails, and either way it has no business blocking a command.
    std::thread::spawn(move || {
        let sent = notify_rust::Notification::new()
            .appname("Monti")
            .summary(&title)
            .body(&body)
            .icon("monti")
            .show();
        if let Err(e) = sent {
            log_line(&app, &format!("desktop notification unavailable: {e}"));
        }
    });
}

/// Free space on the disk holding the cache — one statvfs, no directory
/// walk, so the drives screen can ask for it every time it redraws.
#[tauri::command(async)]
fn disk_free(app: AppHandle) -> Result<u64, String> {
    let root = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("rclone");
    Ok(engine::free_space(&root)
        .or_else(|| engine::free_space(std::path::Path::new("/")))
        .unwrap_or(0))
}

/// Cache totals for the Settings screen and the low-disk warning.
#[tauri::command(async)]
fn cache_info(app: AppHandle) -> Result<CacheInfo, String> {
    let root = app
        .path()
        .cache_dir()
        .map_err(|e| e.to_string())?
        .join("rclone");
    Ok(CacheInfo {
        used: dir_size(&root.join("vfs")) + dir_size(&root.join("vfsMeta")),
        free: engine::free_space(&root)
            .or_else(|| engine::free_space(std::path::Path::new("/")))
            .unwrap_or(0),
        default_limit: engine::default_cache_max_size(&root),
    })
}

/// Delete a remote's local VFS cache. Cloud data is not touched.
///
/// Refuses while the remote is mounted: rclone keeps open handles into
/// these files, and pulling them out from under a live mount can fail
/// reads and drop writes that were still queued for upload.
#[tauri::command(async)]
fn clear_vfs_cache(app: AppHandle, name: String) -> Result<(), String> {
    if let Some(m) = read_proc_mounts().into_iter().find(|m| m.remote == name) {
        return Err(format!(
            "\"{name}\" is mounted at {} — unmount it before clearing the cache.",
            m.mount_point
        ));
    }
    for dir in vfs_cache_dirs(&app, &name)? {
        if dir.is_dir() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    log_line(&app, &format!("cleared vfs cache of {name}"));
    Ok(())
}

/// Whether this drive's provider can hand out a link to a file. Google
/// Drive, Dropbox, OneDrive and pCloud can; S3, SFTP and WebDAV cannot, and
/// a button that fails for half the drives is worse than no button.
#[tauri::command]
async fn supports_links(state: State<'_, EngineState>, name: String) -> Result<bool, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let info = engine::rc_raw_with_timeout(
        port,
        &pass,
        "operations/fsinfo",
        &json!({ "fs": format!("{name}:") }),
        20,
    )?;
    Ok(info
        .get("Features")
        .and_then(|f| f.get("PublicLink"))
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// Pick a file inside a mounted drive and ask the provider for a link to it.
///
/// The file chooser starts in the drive's own folder, so what comes back is
/// a path Monti can turn into the remote path the provider expects.
/// Returns None when the chooser was dismissed.
#[tauri::command]
async fn share_link(state: State<'_, EngineState>, name: String) -> Result<Option<String>, String> {
    let (port, pass, mount_point) = {
        let eng = state.0.lock().unwrap();
        let point = eng
            .mounts
            .get(&format!("{name}:"))
            .map(|m| PathBuf::from(&m.mount_point))
            .ok_or("mount the drive first — links are made from its files")?;
        (eng.port, eng.pass.clone(), point)
    };
    let Some(file) = rfd::FileDialog::new()
        .set_title("Pick a file to share")
        .set_directory(&mount_point)
        .pick_file()
    else {
        return Ok(None);
    };
    let remote = file
        .strip_prefix(&mount_point)
        .map_err(|_| {
            format!(
                "pick a file inside {} — that folder is the drive",
                mount_point.display()
            )
        })?
        .to_string_lossy()
        .into_owned();
    let out = engine::rc_raw_with_timeout(
        port,
        &pass,
        "operations/publiclink",
        &json!({ "fs": format!("{name}:"), "remote": remote }),
        60,
    )?;
    out.get("url")
        .and_then(Value::as_str)
        .map(|u| Some(u.to_string()))
        .ok_or_else(|| "the provider returned no link".into())
}

/// Ask for a folder with the system's own chooser.
///
/// Typing a path is fine until it is not: a typo in a mount folder shows up
/// as a mount that fails for no visible reason.
///
/// The dialog must NOT be opened from the main thread. rfd's GTK backend
/// runs it on a GTK thread of its own and blocks the caller until it closes,
/// so asking the main thread to do that deadlocks the whole app — measured,
/// with the main thread parked in a futex and the window frozen. Commands
/// declared `async` run off the main thread, which is exactly what is wanted.
#[tauri::command]
async fn pick_folder(app: AppHandle, start: Option<String>) -> Result<Option<String>, String> {
    let home = app.path().home_dir().ok();
    let mut dialog = rfd::FileDialog::new().set_title("Choose a folder");
    // Start where the person already is, or at home — never at "/".
    let start_dir = start
        .map(|s| match s.strip_prefix("~/") {
            Some(rest) => home.clone().map(|h| h.join(rest)).unwrap_or(rest.into()),
            None => PathBuf::from(s),
        })
        .filter(|p| p.is_dir())
        .or(home);
    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(dir);
    }
    Ok(dialog.pick_folder().map(|p| p.display().to_string()))
}

/// The drives Monti itself mounted: drive name → folder.
///
/// The interface cannot get this from rclone's own listing. `mount/listmounts`
/// answers with the canonical fs, and that is "gdrive:" for a cloud, "name:."
/// for a local remote and a bare filesystem path for an alias — the last of
/// which carries no drive name at all, so the card said "not mounted" while
/// the folder was mounted and full. Monti's own record always knows.
#[tauri::command]
fn own_mounts(state: State<'_, EngineState>) -> HashMap<String, String> {
    let eng = state.0.lock().unwrap();
    eng.mounts
        .iter()
        .map(|(fs, entry)| {
            (
                fs.trim_end_matches(':').to_string(),
                entry.mount_point.clone(),
            )
        })
        .collect()
}

/// The folders directly inside `path` of a drive, for the "choose which
/// folders to keep" picker. Directories only: a picker that lists a
/// hundred thousand files helps nobody, and only folders can be left out.
///
/// Paths come back the way rclone spells them — relative to the drive root,
/// which is exactly what the exclusion list stores.
#[tauri::command]
async fn list_cloud_dirs(
    state: State<'_, EngineState>,
    name: String,
    path: Option<String>,
) -> Result<Vec<String>, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let body = json!({
        "fs": format!("{name}:"),
        "remote": path.unwrap_or_default(),
        "opt": { "dirsOnly": true },
    });
    // A cold cloud folder can take a while; the caller shows a spinner
    // rather than a frozen dialog, but it must not hang forever either.
    let out = engine::rc_raw_with_timeout(port, &pass, "operations/list", &body, 60)?;
    let mut dirs: Vec<String> = out
        .get("list")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|e| e.get("Path").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    dirs.sort_by_key(|d| d.to_lowercase());
    Ok(dirs)
}

#[tauri::command]
async fn mount_remote(
    app: AppHandle,
    state: State<'_, EngineState>,
    name: String,
    mount_point: Option<String>,
    vfs: Option<Value>,
    excludes: Option<Vec<String>>,
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
    let entry = MountEntry {
        mount_point: mount_point.display().to_string(),
        vfs_opt: build_vfs_opt(&app, vfs.as_ref()),
        excludes: excludes.unwrap_or_default(),
    };
    let mut eng = state.0.lock().unwrap();
    let fs_name = format!("{name}:");
    engine::mount_guarded(eng.port, &eng.pass, &fs_name, &entry).map_err(&cleanup)?;
    eng.mounts.insert(fs_name, entry);
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
    // The folder is a plain empty directory again, and a save into it would
    // now land on the local disk instead of the cloud. Close it.
    engine::close_mount_folder(&mount_point);
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

#[tauri::command(async)]
fn get_autostart(app: AppHandle) -> bool {
    autostart_file(&app).map(|p| p.is_file()).unwrap_or(false)
}

/// Start Monti on login via the XDG autostart spec (KDE, GNOME, XFCE, …).
#[tauri::command(async)]
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
    // --hidden: logging in should bring the drives up, not a window. The
    // window is one click away — from the tray, or by starting Monti again.
    let entry = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Monti\n\
         Comment=Mount your clouds\n\
         Exec=\"{}\" --hidden\n\
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

/// One drive as the tray shows it.
#[derive(serde::Deserialize)]
struct TrayDrive {
    name: String,
    mounted: bool,
}

/// The words the tray shows. They arrive from the interface already
/// translated — and already counted, because "5 drives" takes three
/// different endings in Ukrainian and the rules for that live in the
/// browser's Intl, not here. Only the drive name is still substituted
/// below, since Rust is the one that decides which drives fit.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayLabels {
    open: String,
    quit: String,
    status: String,
    mount: String,
    unmount: String,
    all_drives: String,
    unmount_all: String,
    tooltip: String,
}

impl TrayLabels {
    /// English, for the tray built at startup — the interface has not had a
    /// chance to say anything yet.
    fn english(engine_running: bool) -> Self {
        Self {
            open: "Open Monti".into(),
            quit: "Quit".into(),
            status: if engine_running {
                "Engine running".into()
            } else {
                "Engine stopped".into()
            },
            mount: "Mount \u{201c}{name}\u{201d}".into(),
            unmount: "Unmount \u{201c}{name}\u{201d}".into(),
            all_drives: "All drives in Monti\u{2026}".into(),
            unmount_all: "Unmount all drives".into(),
            tooltip: "Monti \u{2014} cloud drives".into(),
        }
    }
}

/// The tray menu: what is going on, and the one action per drive worth
/// having without opening the window.
fn tray_menu(
    app: &AppHandle,
    engine_running: bool,
    drives: &[TrayDrive],
    labels: &TrayLabels,
) -> tauri::Result<Menu<tauri::Wry>> {
    let show = MenuItem::with_id(app, "show", &labels.open, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
    let mounted = drives.iter().filter(|d| d.mounted).count();
    // A disabled item is how a menu says something rather than offers it.
    let status = MenuItem::with_id(app, "status", &labels.status, false, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &status])?;

    // A tray menu is a shortcut, not a second interface. Someone with forty
    // drives cannot pick one out of a forty-item list hanging off their
    // panel — and the menu is rebuilt on every state change, so the list
    // costs something every time. Show a handful and let the window do what
    // the window is for. Mounted drives come first: with a long list, the
    // action worth having in one click is unmounting the one that is up.
    const SHOWN: usize = 8;
    let ordered = drives
        .iter()
        .filter(|d| d.mounted)
        .chain(drives.iter().filter(|d| !d.mounted));
    for drive in ordered.take(SHOWN) {
        let (id, label) = if drive.mounted {
            (
                format!("unmount:{}", drive.name),
                labels.unmount.replace("{name}", &drive.name),
            )
        } else {
            (
                format!("mount:{}", drive.name),
                labels.mount.replace("{name}", &drive.name),
            )
        };
        menu.append(&MenuItem::with_id(
            app,
            id,
            label,
            engine_running,
            None::<&str>,
        )?)?;
    }
    if drives.len() > SHOWN {
        menu.append(&MenuItem::with_id(
            app,
            "show",
            &labels.all_drives,
            true,
            None::<&str>,
        )?)?;
    }
    // Before undocking, before suspending, before pulling the cable: the one
    // bulk action that is worth a click, and only when it would do anything.
    if mounted > 1 {
        menu.append_items(&[
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "unmountall",
                &labels.unmount_all,
                engine_running,
                None::<&str>,
            )?,
        ])?;
    }
    menu.append_items(&[&PredefinedMenuItem::separator(app)?, &quit])?;
    Ok(menu)
}

/// Redraw the tray. Called by the interface whenever the drive list changes,
/// because the interface is where mount preferences live: the tray asks it to
/// act rather than acting itself.
#[tauri::command]
fn update_tray(
    app: AppHandle,
    engine_running: bool,
    drives: Vec<TrayDrive>,
    labels: TrayLabels,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("monti-tray") else {
        return Ok(()); // no tray on this desktop; the window says it all
    };
    let menu = tray_menu(&app, engine_running, &drives, &labels).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(&labels.tooltip))
        .map_err(|e| e.to_string())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    TrayIconBuilder::with_id("monti-tray")
        .icon(app.default_window_icon().expect("bundle has icons").clone())
        .tooltip("Monti — cloud drives")
        .menu(&tray_menu(app, true, &[], &TrayLabels::english(true))?)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            match id {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                }
                "quit" => app.exit(0),
                "unmountall" => {
                    let _ = app.emit("tray-action", json!({ "action": "unmountall" }));
                }
                _ => {
                    // Mounting needs the drive's saved options, and those live
                    // in the interface — so the tray asks it to do the work,
                    // window open or not.
                    for (prefix, action) in [("mount:", "mount"), ("unmount:", "unmount")] {
                        if let Some(name) = id.strip_prefix(prefix) {
                            let _ =
                                app.emit("tray-action", json!({ "action": action, "name": name }));
                            break;
                        }
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

// ---------- entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A bug report starts with "which version?", and the answer must not
    // require opening the window — on the machines that need reporting most,
    // the window is exactly what does not come up.
    if let Some(flag) = std::env::args().nth(1) {
        match flag.as_str() {
            "--version" | "-V" => {
                println!("monti {}", env!("CARGO_PKG_VERSION"));
                return;
            }
            "--help" | "-h" => {
                println!(
                    "monti {}\n\
                     Mount your clouds. Google Drive, Dropbox and more as local folders.\n\n\
                     Usage: monti [--hidden] [--version] [--help]\n\n\
                     --hidden   start without opening the window: drives mount and the\n\
                                app waits in the tray. Starting Monti again opens it.\n\
                                This is what the autostart entry uses.\n\n\
                     Logs live in ~/.local/share/io.github.stektus.monti/.",
                    env!("CARGO_PKG_VERSION")
                );
                return;
            }
            _ => {}
        }
    }

    // WebKitGTK renders through DMABUF by default, and on setups where that
    // path cannot create an EGL display — NVIDIA's proprietary driver,
    // hybrid graphics, VMs — it does not fall back: it prints "Could not
    // create default EGL display: EGL_BAD_PARAMETER" and the window stays
    // blank or the process aborts.
    //
    // This does not cover every blank window (the AppImage had its own
    // cause: see the release workflow's libwayland-client step), but it is
    // free for a page of static cards, so prefer it and let anyone who wants
    // the accelerated path ask with WEBKIT_DISABLE_DMABUF_RENDERER=0.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

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
        .manage(EngineState(Mutex::new(Engine::default())))
        .manage(AuthState(Mutex::new(None)))
        .manage(Flags {
            close_to_tray: AtomicBool::new(true),
            tray_ok: AtomicBool::new(false),
            keep_mounts: AtomicBool::new(true),
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // First line of every run. A user whose window never draws has
            // no drives, no mounts and therefore nothing in the log to send
            // with a report — that is exactly what happened with the blank
            // window on Manjaro, and it cost two rounds of questions.
            log_line(
                &handle,
                &format!(
                    "monti {} starting: session={} wayland={} x11={} appimage={}",
                    handle.package_info().version,
                    std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "?".into()),
                    std::env::var("WAYLAND_DISPLAY").unwrap_or_else(|_| "-".into()),
                    std::env::var("DISPLAY").unwrap_or_else(|_| "-".into()),
                    if std::env::var_os("APPIMAGE").is_some() {
                        "yes"
                    } else {
                        "no"
                    },
                ),
            );

            // libappindicator-sys PANICS (not errors) when the appindicator
            // .so is absent, which would crash the whole app on distros
            // without it. Catch the panic: no tray is a degraded mode, not
            // a fatal one.
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

            // The window is configured invisible and shown here, so a start
            // that is meant to be quiet never flashes one. Autostart passes
            // --hidden: logging in should get the drives mounted, not a
            // window in the way. Starting Monti again opens it — the
            // single-instance hook above turns the second launch into
            // "show" — and with a tray there is also the icon.
            let hidden = std::env::args().any(|a| a == "--hidden");
            if let Some(w) = handle.get_webview_window("main") {
                if hidden {
                    log_line(
                        &handle,
                        if ok {
                            "started hidden: waiting in the tray"
                        } else {
                            "started hidden with no tray: start Monti again to open the window"
                        },
                    );
                } else {
                    let _ = w.show();
                }
            }
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
            remote_credentials,
            update_remote_credentials,
            cancel_create_remote,
            delete_remote,
            vfs_cache_size,
            remote_about,
            cache_info,
            disk_free,
            notify_user,
            bandwidth_limit,
            transfer_history,
            lost_mounts,
            sync::sync_pairs,
            sync::sync_pair_save,
            sync::sync_pair_remove,
            sync::sync_estimate,
            sync::sync_run,
            sync::sync_progress,
            sync::sync_finished,
            sync::sync_stop,
            sync::sync_conflicts,
            sync::sync_resolve,
            clear_vfs_cache,
            list_cloud_dirs,
            pick_folder,
            supports_links,
            share_link,
            own_mounts,
            update_tray,
            mount_remote,
            unmount_remote,
            unmount_external,
            list_system_mounts,
            open_folder,
            open_link,
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
        // The port is picked first because it also names the directory:
        // one per daemon, not one per process. Sharing it meant every test
        // wrote into the same rclone.conf — and the first one to finish
        // deleted it from under the others.
        let port = engine::free_port().ok()?;
        let dir = std::env::temp_dir().join(format!("monti-test-{}-{port}", std::process::id()));
        std::fs::create_dir_all(&dir).ok()?;
        let conf = dir.join("rclone.conf");
        std::fs::write(&conf, "").ok()?;
        let pass = "testpass".to_string();

        // A test must never put a Google consent page in front of whoever is
        // running it. Hiding the display is not enough: rclone opens links
        // with xdg-open, which reaches the real session over D-Bus and opens
        // the browser anyway. So PATH gets a stub that swallows the call, and
        // the session bus is taken away as well.
        let stub_dir = dir.join("nobrowser");
        std::fs::create_dir_all(&stub_dir).ok()?;
        for name in ["xdg-open", "x-www-browser", "sensible-browser", "kde-open"] {
            let stub = stub_dir.join(name);
            std::fs::write(&stub, "#!/bin/sh\nexit 0\n").ok()?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).ok()?;
        }

        let child = Command::new("rclone")
            .args(["rcd", &format!("--rc-addr=127.0.0.1:{port}")])
            .env("RCLONE_CONFIG", &conf)
            .env("RCLONE_RC_USER", engine::RC_USER)
            .env("RCLONE_RC_PASS", &pass)
            .env("BROWSER", "true")
            // Stub directory first, so the stubs win the lookup; the rest of
            // PATH stays so rclone itself is still found.
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    stub_dir.display(),
                    std::env::var("PATH").unwrap_or_default()
                ),
            )
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env_remove("XDG_CURRENT_DESKTOP")
            .env_remove("DBUS_SESSION_BUS_ADDRESS")
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

    // ---------- providers, against real servers ----------
    //
    // Three of the providers Monti offers speak protocols rclone can also
    // serve — WebDAV, S3 and SFTP. So the test stands up a server on
    // localhost with the same binary the app ships, connects to it exactly
    // the way the Add-cloud dialog does, mounts it, writes a file through
    // the mount and reads it back out of the server's own directory. No
    // account, no network, and nothing simulated: the only difference from
    // Nextcloud or Backblaze is which machine answers.
    //
    // The OAuth providers cannot be reached this way — their sign-in is a
    // browser and a real account — so what is covered here is everything
    // downstream of sign-in, which is where mounting actually breaks.

    struct TestServer {
        child: Child,
        port: u16,
        data: PathBuf,
        _dir: tempdir::TempDirGuard,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }

    /// `rclone serve <protocol>` over a fresh directory holding one file.
    /// HOME points into that directory as well: `serve sftp` generates host
    /// keys, and they have no business landing in the home of whoever runs
    /// the tests.
    fn serve(protocol: &str, extra: &[&str]) -> Option<TestServer> {
        let dir = std::env::temp_dir().join(format!(
            "monti-serve-{}-{protocol}-{}",
            std::process::id(),
            engine::free_port().ok()?
        ));
        let data = dir.join("data");
        std::fs::create_dir_all(data.join("Docs")).ok()?;
        std::fs::write(data.join("Docs/note.txt"), b"from the server\n").ok()?;
        let port = engine::free_port().ok()?;

        let child = Command::new("rclone")
            .arg("serve")
            .arg(protocol)
            .arg("--addr")
            .arg(format!("127.0.0.1:{port}"))
            .args(extra)
            .arg(&data)
            .env("HOME", &dir)
            .env("XDG_CACHE_HOME", dir.join("cache"))
            .env("RCLONE_CONFIG", dir.join("serve.conf"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;

        for _ in 0..60 {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                return Some(TestServer {
                    child,
                    port,
                    data,
                    _dir: tempdir::TempDirGuard(dir),
                });
            }
            thread::sleep(Duration::from_millis(100));
        }
        None
    }

    /// A test that quietly does nothing is worse than no test, so every
    /// place this one gives up says why. The run still passes: a machine
    /// without FUSE cannot be asked to mount anything.
    fn skipped(kind: &str, why: &str) {
        eprintln!("  {kind}: skipped — {why}");
    }

    /// Wait for a path to turn up: a write through the mount reaches the
    /// server after the cache has flushed it, not the moment it is closed.
    fn appears(path: &Path, secs: u64) -> bool {
        for _ in 0..(secs * 10) {
            if path.exists() {
                return true;
            }
            thread::sleep(Duration::from_millis(100));
        }
        false
    }

    /// Create the remote, list it, mount it, write through it, unmount.
    /// `parameters` is what the Add-cloud dialog would have collected.
    fn provider_round_trip(kind: &str, server: &TestServer, parameters: Value) {
        let Some(d) = spawn_test_rcd() else {
            return skipped(kind, "no rclone daemon");
        };

        // Exactly the call create_remote() makes for a provider that needs
        // no browser.
        rc_raw(
            d.port,
            &d.pass,
            "config/create",
            &json!({
                "name": format!("srv_{kind}"),
                "type": kind,
                "parameters": parameters,
                "opt": { "obscure": true, "nonInteractive": true },
            }),
        )
        .unwrap_or_else(|e| panic!("{kind}: creating the remote failed: {e}"));

        let listed = rc_raw(
            d.port,
            &d.pass,
            "operations/list",
            &json!({ "fs": format!("srv_{kind}:"), "remote": "Docs" }),
        )
        .unwrap_or_else(|e| panic!("{kind}: listing failed: {e}"));
        let names = listed["list"]
            .as_array()
            .map(|l| {
                l.iter()
                    .filter_map(|f| f["Name"].as_str().map(String::from))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        assert!(
            names.iter().any(|n| n == "note.txt"),
            "{kind}: the file on the server is not in the listing: {names:?}"
        );

        // Mounting needs FUSE. Where there is none, everything above still
        // ran; say nothing and stop rather than fail for the wrong reason.
        if !Path::new("/dev/fuse").exists() {
            return skipped(kind, "no /dev/fuse");
        }
        let mount_point = server._dir.0.join("mnt");
        std::fs::create_dir_all(&mount_point).unwrap();
        let entry = engine::MountEntry {
            mount_point: mount_point.display().to_string(),
            vfs_opt: json!({}),
            excludes: vec![],
        };
        if let Err(e) = engine::mount_guarded(d.port, &d.pass, &format!("srv_{kind}:"), &entry) {
            return skipped(kind, &format!("mounting is unavailable here: {e}"));
        }

        let read_back = std::fs::read_to_string(mount_point.join("Docs/note.txt"));
        let written = std::fs::write(
            mount_point.join("Docs/through-the-mount.txt"),
            b"round trip\n",
        );
        let landed = appears(&server.data.join("Docs/through-the-mount.txt"), 20);

        let _ = rc_raw(
            d.port,
            &d.pass,
            "mount/unmount",
            &json!({ "mountPoint": entry.mount_point }),
        );
        thread::sleep(Duration::from_millis(300));

        assert_eq!(
            read_back.as_deref().ok(),
            Some("from the server\n"),
            "{kind}: reading through the mount did not give the file back"
        );
        assert!(written.is_ok(), "{kind}: writing into the mount failed");
        assert!(landed, "{kind}: what was written never reached the server");

        // The folder a drive was mounted on is left closed, so a save into
        // it while the drive is away fails instead of vanishing onto the
        // local disk.
        engine::close_mount_folder(&entry.mount_point);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&mount_point)
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o500, "{kind}: the empty mount folder was left open");
        }
    }

    /// Every provider the Add-cloud dialog offers has to be one the backend
    /// will accept. They live in different files and different languages, and
    /// the first time they disagreed the dialog said "unsupported provider"
    /// after the person had already pasted their keys in.
    /// What the Add-cloud dialog offers, read out of the markup so a
    /// provider cannot be added to the interface and missed by the tests.
    fn providers_in_dialog() -> Vec<&'static str> {
        let html = include_str!("../../src/index.html");
        let select = html
            .split_once(r#"id="add-provider""#)
            .and_then(|(_, rest)| rest.split_once("</select>"))
            .map(|(inside, _)| inside)
            .expect("the dialog should have a provider list");
        let found: Vec<&str> = select
            .split(r#"<option value=""#)
            .skip(1)
            .filter_map(|chunk| chunk.split('"').next())
            .collect();
        assert!(
            found.len() > 5,
            "the provider list did not parse: {found:?}"
        );
        found
    }

    #[test]
    fn every_provider_in_the_dialog_reaches_the_backend() {
        for provider in providers_in_dialog() {
            assert!(
                OAUTH_PROVIDERS.contains(&provider) || allowed_params(provider).is_some(),
                "the dialog offers {provider}, which create_remote() refuses"
            );
        }
    }

    /// Backblaze cannot be served on localhost, and neither can any provider
    /// that needs an account — so what is checked for all of them is the one
    /// mistake that is easy to make and invisible until someone signs in:
    /// a field name the backend does not have. rclone publishes the option
    /// names of every backend, so what Monti allows is held against that list.
    #[test]
    fn every_form_sends_option_names_rclone_knows() {
        let Some(d) = spawn_test_rcd() else {
            return skipped("forms", "no rclone daemon");
        };
        let answer = rc_raw(d.port, &d.pass, "config/providers", &json!({}))
            .expect("rclone should list its providers");
        let providers = answer["providers"]
            .as_array()
            .expect("providers should be a list");

        // The list comes from the dialog and the fields from the backend, so
        // a provider added to both is checked without anyone remembering to.
        let mut forms: Vec<(&str, &[&str])> = providers_in_dialog()
            .into_iter()
            .map(|kind| {
                let fields: &[&str] = if OAUTH_PROVIDERS.contains(&kind) {
                    // A browser provider sends only its own key, if there is one.
                    &["client_id", "client_secret"]
                } else {
                    allowed_params(kind).expect("the other test proves this exists")
                };
                (kind, fields)
            })
            .collect();
        // s3 additionally pins env_auth off, so keys can only come from the form.
        forms.push(("s3", &["env_auth"]));

        for (kind, fields) in &forms {
            let backend = providers
                .iter()
                .find(|p| p["Name"].as_str() == Some(kind))
                .unwrap_or_else(|| panic!("rclone has no backend called {kind}"));
            let empty = Vec::new();
            let known: HashSet<&str> = backend["Options"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .filter_map(|o| o["Name"].as_str())
                .collect();
            for field in *fields {
                assert!(
                    known.contains(field),
                    "the {kind} form sends {field}, which rclone's {kind} backend \
                     has no option for"
                );
            }
        }
    }

    #[test]
    fn webdav_drive_mounts_and_carries_files() {
        let Some(server) = serve("webdav", &[]) else {
            return skipped("webdav", "the local server did not come up");
        };
        provider_round_trip(
            "webdav",
            &server,
            json!({
                "url": format!("http://127.0.0.1:{}", server.port),
                "vendor": "other",
            }),
        );
    }

    #[test]
    fn s3_drive_mounts_and_carries_files() {
        let Some(server) = serve("s3", &["--auth-key", "TESTKEY,TESTSECRET"]) else {
            return skipped("s3", "the local server did not come up");
        };
        provider_round_trip(
            "s3",
            &server,
            json!({
                "provider": "Other",
                "access_key_id": "TESTKEY",
                "secret_access_key": "TESTSECRET",
                "endpoint": format!("http://127.0.0.1:{}", server.port),
                "env_auth": "false",
            }),
        );
    }

    #[test]
    fn sftp_drive_mounts_and_carries_files() {
        let Some(server) = serve("sftp", &["--user", "tester", "--pass", "secret"]) else {
            return skipped("sftp", "the local server did not come up");
        };
        provider_round_trip(
            "sftp",
            &server,
            json!({
                "host": "127.0.0.1",
                "port": server.port.to_string(),
                "user": "tester",
                "pass": "secret",
            }),
        );
    }

    /// A drive whose password is refused must not be left in the list. It
    /// was: writing the config file checks nothing, so the drive looked
    /// added and failed minutes later at Mount, where the dialog that knew
    /// which field was wrong is long gone.
    #[test]
    fn a_drive_that_cannot_sign_in_is_never_added() {
        let Some(server) = serve("webdav", &["--user", "tester", "--pass", "secret"]) else {
            return skipped("verify", "the local server did not come up");
        };
        let Some(d) = spawn_test_rcd() else {
            return skipped("verify", "no rclone daemon");
        };
        let create = |pass: &str| {
            rc_raw(
                d.port,
                &d.pass,
                "config/create",
                &json!({
                    "name": "srv_new",
                    "type": "webdav",
                    "parameters": {
                        "url": format!("http://127.0.0.1:{}", server.port),
                        "vendor": "other", "user": "tester", "pass": pass,
                    },
                    "opt": { "obscure": true, "nonInteractive": true },
                }),
            )
            .expect("writing the config always works — that is the problem")
        };
        let exists = || {
            rc_raw(d.port, &d.pass, "config/dump", &json!({}))
                .map(|dump| dump.get("srv_new").is_some())
                .unwrap_or(false)
        };

        create("wrong");
        let refused = verify_or_undo(d.port, &d.pass, "srv_new", "webdav")
            .expect_err("a password the server refuses must not pass");
        assert!(!refused.is_empty());
        assert!(
            !exists(),
            "the drive stayed in the list after being refused"
        );

        create("secret");
        verify_or_undo(d.port, &d.pass, "srv_new", "webdav")
            .expect("the right password should pass");
        assert!(exists(), "a working drive was thrown away");

        // S3 keys are routinely scoped to one bucket, so a root listing
        // proves nothing there — that provider must be left alone.
        assert!(!VERIFY_ON_CREATE.contains(&"s3") && !VERIFY_ON_CREATE.contains(&"crypt"));
    }

    /// A password that stopped working has to be fixable without deleting
    /// the drive — deleting it also throws away the mount folder, the hidden
    /// folders and the cache. And a second wrong password must leave the
    /// drive exactly as it was: the fix must not be able to break it.
    #[test]
    fn a_password_can_be_replaced_and_a_wrong_one_rolls_back() {
        let Some(server) = serve("webdav", &["--user", "tester", "--pass", "secret"]) else {
            return skipped("credentials", "the local server did not come up");
        };
        let Some(d) = spawn_test_rcd() else {
            return skipped("credentials", "no rclone daemon");
        };
        let url = format!("http://127.0.0.1:{}", server.port);
        let list = || {
            rc_raw(
                d.port,
                &d.pass,
                "operations/list",
                &json!({ "fs": "srv_creds:", "remote": "Docs" }),
            )
        };
        let params = |pass: &str| HashMap::from([("pass".to_string(), pass.to_string())]);

        rc_raw(
            d.port,
            &d.pass,
            "config/create",
            &json!({
                "name": "srv_creds",
                "type": "webdav",
                "parameters": { "url": url, "vendor": "other", "user": "tester", "pass": "wrong" },
                "opt": { "obscure": true, "nonInteractive": true },
            }),
        )
        .expect("creating the remote should work — it is the sign-in that fails");
        assert!(list().is_err(), "the wrong password was accepted");

        apply_credentials(d.port, &d.pass, "srv_creds", params("secret"))
            .expect("the right password should be taken");
        assert!(list().is_ok(), "the drive did not start working again");

        // The one that matters: a typo must not cost the drive.
        let refused = apply_credentials(d.port, &d.pass, "srv_creds", params("nonsense"))
            .expect_err("a wrong password should be refused");
        assert!(!refused.is_empty());
        assert!(
            list().is_ok(),
            "a refused password was left in place: the drive is broken now"
        );

        // Secrets stay on this side of the wall; the address does not.
        let public = public_params("webdav");
        assert!(public.contains(&"url") && !public.contains(&"pass"));

        // An encrypted drive is not offered this at all, and must refuse it
        // if it ever is: there the password is the key, and a new one does
        // not unlock what the old one locked.
        rc_raw(
            d.port,
            &d.pass,
            "config/create",
            &json!({
                "name": "srv_vault",
                "type": "crypt",
                "parameters": { "remote": "srv_creds:vault", "password": "opensesame" },
                "opt": { "obscure": true, "nonInteractive": true },
            }),
        )
        .expect("the encrypted drive should be created");
        let refused = apply_credentials(
            d.port,
            &d.pass,
            "srv_vault",
            HashMap::from([("password".to_string(), "something else".to_string())]),
        )
        .expect_err("an encrypted drive's password must not be replaceable");
        assert!(refused.contains("encrypted"), "{refused}");
        assert!(public_params("crypt").is_empty());
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
        let cancelled_at = std::time::Instant::now();
        let r = flow.join().unwrap();

        // What must hold is that the wait ends at once. Whether the cancel
        // wins the race is not ours to decide: with no browser to answer it,
        // rclone's own auth server sometimes fails the step first (its
        // listener is shared between steps, so a late callback lands on the
        // next step and the state does not match). Both are correct
        // endings; hanging until the five-minute deadline is not, and that
        // is what a broken cancel looks like.
        assert!(
            cancelled_at.elapsed() < Duration::from_secs(60),
            "cancel did not unblock the wait: took {:?}",
            cancelled_at.elapsed()
        );
        assert!(r.is_err(), "authorization cannot succeed without a browser");
        let err = r.unwrap_err();
        assert!(
            !err.contains("timed out"),
            "flow ran to the deadline instead of stopping: {err}"
        );
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
