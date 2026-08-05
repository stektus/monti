// Mountie — a friendly GUI for rclone.
//
// Architecture: this backend manages an `rclone rcd` daemon (the "engine")
// and proxies JSON-RPC calls to it. The frontend never talks to rclone
// directly and never sees the RC credentials.

use std::{
    fs,
    io::Read,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, RunEvent, State};

const RC_USER: &str = "mountie";

#[derive(Default)]
struct Engine {
    child: Option<Child>,
    port: u16,
    pass: String,
}

struct EngineState(Mutex<Engine>);

/// The in-flight `rclone config create` process (browser OAuth), if any.
/// Kept separately so the Cancel button can kill it while `create_remote`
/// is still polling.
struct CreateState(Mutex<Option<Child>>);

// ---------- helpers ----------

fn app_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    Ok(dir)
}

/// rclone bundled into app data takes priority over the system one,
/// so "Install engine" works even on distros where rclone is absent.
fn find_rclone(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_bin_dir(app) {
        let bundled = dir.join("rclone");
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    let path = std::env::var("PATH").ok()?;
    std::env::split_paths(&path)
        .map(|d| d.join("rclone"))
        .find(|c| c.is_file())
}

fn rand_hex(n_bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; n_bytes];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Make a child process receive SIGTERM when we die, so no rclone process
/// ever outlives the app (covers dev-mode Ctrl+C and crashes).
#[cfg(target_os = "linux")]
fn die_with_parent(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn die_with_parent(_cmd: &mut Command) {}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener); // tiny race window, acceptable for a local daemon
    Ok(port)
}

fn rc_raw(port: u16, pass: &str, path: &str, body: &Value) -> Result<Value, String> {
    if port == 0 {
        return Err("engine is not running".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("http://127.0.0.1:{port}/{path}"))
        .basic_auth(RC_USER, Some(pass))
        .json(body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let value: Value = resp
        .json()
        .unwrap_or_else(|e| json!({ "error": e.to_string() }));
    if status.is_success() {
        Ok(value)
    } else {
        Err(value["error"]
            .as_str()
            .unwrap_or("rclone rc call failed")
            .to_string())
    }
}

fn start_engine_locked(app: &AppHandle, eng: &mut Engine) -> Result<(), String> {
    // Already running?
    if let Some(child) = &mut eng.child {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
        eng.child = None;
    }
    let rclone = find_rclone(app).ok_or("rclone not found")?;
    let port = free_port()?;
    let pass = rand_hex(16)?;
    let mut cmd = Command::new(&rclone);
    cmd.args([
        "rcd",
        &format!("--rc-addr=127.0.0.1:{port}"),
        &format!("--rc-user={RC_USER}"),
        &format!("--rc-pass={pass}"),
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    die_with_parent(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start rclone: {e}"))?;

    // Wait until the RC API answers.
    for _ in 0..50 {
        if rc_raw(port, &pass, "rc/noop", &json!({})).is_ok() {
            eng.child = Some(child);
            eng.port = port;
            eng.pass = pass;
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("rclone engine did not become ready in 5s".into())
}

fn stop_engine_locked(eng: &mut Engine) {
    if let Some(mut child) = eng.child.take() {
        // Unmount everything first so FUSE mounts don't go stale.
        let _ = rc_raw(eng.port, &eng.pass, "mount/unmountall", &json!({}));
        let _ = rc_raw(eng.port, &eng.pass, "core/quit", &json!({}));
        thread::sleep(Duration::from_millis(300));
        let _ = child.kill();
        let _ = child.wait();
    }
    eng.port = 0;
    eng.pass.clear();
}

// ---------- system mounts ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SystemMount {
    remote: String,
    mount_point: String,
}

/// All rclone FUSE mounts on the machine, including ones created outside
/// Mountie (systemd units, manual `rclone mount`, another instance).
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
fn engine_status(app: AppHandle, state: State<EngineState>) -> EngineStatus {
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
    let running = eng
        .child
        .as_mut()
        .is_some_and(|c| matches!(c.try_wait(), Ok(None)));
    EngineStatus {
        rclone_found: rclone.is_some(),
        rclone_path: rclone.map(|p| p.display().to_string()),
        version,
        engine_running: running,
    }
}

/// Download the latest rclone build into the app data dir — this is what
/// makes Mountie "just install and click" on distros without rclone.
#[tauri::command]
fn install_rclone(app: AppHandle) -> Result<String, String> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => return Err(format!("unsupported architecture: {other}")),
    };
    let url = format!("https://downloads.rclone.org/rclone-current-linux-{arch}.zip");
    let bytes = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?
        .get(&url)
        .send()
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .map_err(|e| e.to_string())?;

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
fn start_engine(app: AppHandle, state: State<EngineState>) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    start_engine_locked(&app, &mut eng)
}

/// Generic proxy: the frontend calls rclone's RC API through this,
/// credentials never leave the Rust side.
#[tauri::command]
fn rc(state: State<EngineState>, path: String, body: Value) -> Result<Value, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    rc_raw(port, &pass, &path, &body)
}

/// Create a remote via the rclone CLI: for OAuth providers it opens the
/// system browser. We poll the child instead of blocking on it, so the
/// user can cancel (browser closed, changed their mind) and we time out
/// instead of hanging forever. The engine is restarted afterwards so the
/// daemon picks up the new config.
#[tauri::command]
fn create_remote(
    app: AppHandle,
    state: State<EngineState>,
    create: State<CreateState>,
    name: String,
    provider: String,
) -> Result<(), String> {
    let ok_name = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok_name {
        return Err("remote name may contain only letters, digits, '-' and '_'".into());
    }
    const ALLOWED: &[&str] = &["drive", "dropbox", "onedrive", "box", "pcloud", "yandex"];
    if !ALLOWED.contains(&provider.as_str()) {
        return Err(format!("unsupported provider: {provider}"));
    }
    let rclone = find_rclone(&app).ok_or("rclone not found")?;

    {
        let mut guard = create.0.lock().unwrap();
        if guard.is_some() {
            return Err("another connection attempt is already in progress".into());
        }
        let mut cmd = Command::new(&rclone);
        cmd.args(["config", "create", &name, &provider])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        die_with_parent(&mut cmd);
        *guard = Some(cmd.spawn().map_err(|e| e.to_string())?);
    }

    const TIMEOUT: Duration = Duration::from_secs(300);
    let started = std::time::Instant::now();
    let result = loop {
        thread::sleep(Duration::from_millis(500));
        let mut guard = create.0.lock().unwrap();
        let Some(child) = guard.as_mut() else {
            // Taken away by cancel_create_remote.
            break Err("Authorization cancelled.".to_string());
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut child = guard.take().unwrap();
                let mut stderr = String::new();
                if let Some(mut pipe) = child.stderr.take() {
                    let _ = pipe.read_to_string(&mut stderr);
                }
                let _ = child.wait();
                if status.success() {
                    break Ok(());
                }
                let msg = stderr.trim();
                break Err(if msg.is_empty() {
                    "rclone config create failed".to_string()
                } else {
                    msg.to_string()
                });
            }
            Ok(None) => {
                if started.elapsed() > TIMEOUT {
                    let mut child = guard.take().unwrap();
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("Authorization timed out after 5 minutes.".to_string());
                }
            }
            Err(e) => {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
                break Err(e.to_string());
            }
        }
    };

    if result.is_ok() {
        let mut eng = state.0.lock().unwrap();
        stop_engine_locked(&mut eng);
        start_engine_locked(&app, &mut eng)?;
    }
    result
}

/// Abort an in-flight browser authorization (Cancel button).
#[tauri::command]
fn cancel_create_remote(create: State<CreateState>) {
    if let Some(mut child) = create.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn delete_remote(app: AppHandle, state: State<EngineState>, name: String) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "config/delete",
        &json!({ "name": name }),
    )?;
    stop_engine_locked(&mut eng);
    start_engine_locked(&app, &mut eng)
}

#[tauri::command]
fn mount_remote(app: AppHandle, state: State<EngineState>, name: String) -> Result<String, String> {
    // Refuse to mount a remote that is already mounted anywhere on the
    // system: two VFS caches over one remote can corrupt files.
    if let Some(existing) = read_proc_mounts().into_iter().find(|m| m.remote == name) {
        return Err(format!(
            "\"{name}\" is already mounted at {} (outside Mountie). \
             Use that folder, or unmount it there first.",
            existing.mount_point
        ));
    }
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let mount_point = home.join("CloudDrives").join(&name);
    fs::create_dir_all(&mount_point).map_err(|e| e.to_string())?;
    let eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "mount/mount",
        &json!({
            "fs": format!("{name}:"),
            "mountPoint": mount_point,
            // CacheMode 3 = "full": required so apps like KeePassXC can
            // save files in place (atomic rename over FUSE).
            "vfsOpt": { "CacheMode": 3 },
        }),
    )?;
    Ok(mount_point.display().to_string())
}

#[tauri::command]
fn unmount_remote(state: State<EngineState>, mount_point: String) -> Result<(), String> {
    let eng = state.0.lock().unwrap();
    rc_raw(
        eng.port,
        &eng.pass,
        "mount/unmount",
        &json!({ "mountPoint": mount_point }),
    )?;
    Ok(())
}

// ---------- entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(EngineState(Mutex::new(Engine::default())))
        .manage(CreateState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            engine_status,
            install_rclone,
            start_engine,
            rc,
            create_remote,
            cancel_create_remote,
            delete_remote,
            mount_remote,
            unmount_remote,
            list_system_mounts,
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
                stop_engine_locked(&mut eng);
            }
        });
}
