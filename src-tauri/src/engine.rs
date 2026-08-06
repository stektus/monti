// Engine layer: everything about the rclone rcd daemon — spawning it
// detached, talking to its RC API, persisting its coordinates and
// re-adopting a daemon left running by a previous session.

use std::{
    collections::HashMap,
    fs,
    io::Read,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub const RC_USER: &str = "monti";

#[derive(Default)]
pub struct Engine {
    /// Present when this session spawned the daemon; None when a daemon
    /// from a previous session was adopted (see `try_adopt_engine`).
    pub child: Option<Child>,
    pub pid: u32,
    pub port: u16,
    pub pass: String,
    /// vfsOpt used for each mounted fs ("name:"), so an engine restart can
    /// remount drives with the same options the user chose.
    pub vfs_opts: HashMap<String, Value>,
}

pub struct EngineState(pub Mutex<Engine>);

/// Build the vfsOpt for a mount: CacheMode "full" is always forced (apps
/// like KeePassXC corrupt saves without it), the rest is a whitelist of
/// user-tunable options. Values are validated by rclone at mount time.
pub fn build_vfs_opt(user: Option<&Value>) -> Value {
    let mut opt = json!({ "CacheMode": 3 });
    if let Some(Value::Object(map)) = user {
        for (key, value) in map {
            let ok = match key.as_str() {
                "ReadOnly" => value.is_boolean(),
                "CacheMaxSize" | "CacheMaxAge" => {
                    value.as_str().is_some_and(|s| !s.trim().is_empty())
                }
                _ => false,
            };
            if ok {
                opt[key] = value.clone();
            }
        }
    }
    opt
}

pub fn app_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    Ok(dir)
}

/// rclone bundled into app data takes priority over the system one,
/// so "Install engine" works even on distros where rclone is absent.
pub fn find_rclone(app: &AppHandle) -> Option<PathBuf> {
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

pub fn rand_hex(n_bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; n_bytes];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut buf))
        .map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Make a child process receive SIGTERM when we die, so short-lived
/// helpers (OAuth flows) never outlive the app.
#[cfg(target_os = "linux")]
pub fn die_with_parent(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
            Ok(())
        });
    }
    clean_appimage_env(cmd);
}

#[cfg(not(target_os = "linux"))]
pub fn die_with_parent(_cmd: &mut Command) {}

/// For the rcd daemon: new session (detached from our lifetime and any
/// terminal) and a clean environment — but NO parent-death signal, so it
/// can keep drives mounted after Monti quits.
#[cfg(target_os = "linux")]
pub fn detach_child(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    clean_appimage_env(cmd);
}

/// Strip AppImage-injected paths from a child's environment. The AppRun
/// wrapper points LD_LIBRARY_PATH & co. at libraries bundled for the
/// build distro; a browser launched down the chain (rclone → xdg-open)
/// loads them and crashes silently — the OAuth window never appears.
#[cfg(target_os = "linux")]
pub fn clean_appimage_env(cmd: &mut Command) {
    let Ok(appdir) = std::env::var("APPDIR") else {
        return;
    };
    if appdir.is_empty() {
        return;
    }
    for (key, value) in std::env::vars() {
        if !value.contains(&appdir) {
            continue;
        }
        // Path lists keep their system components; single-path vars go.
        let kept: Vec<&str> = value
            .split(':')
            .filter(|part| !part.is_empty() && !part.contains(&appdir))
            .collect();
        if kept.is_empty() {
            cmd.env_remove(&key);
        } else {
            cmd.env(&key, kept.join(":"));
        }
    }
}

/// True if the rclone config already has a remote with this name.
pub fn remote_exists(rclone: &PathBuf, name: &str) -> bool {
    Command::new(rclone)
        .arg("listremotes")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .is_some_and(|s| s.lines().any(|l| l.trim().trim_end_matches(':') == name))
}

/// The engine deliberately survives Monti when "keep mounts on quit" is
/// on, so its coordinates (port, password, pid) are persisted 0600 in
/// app data. The next session adopts a live daemon instead of spawning a
/// second one; an unreachable leftover is killed.
pub fn engine_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("engine.json"))
}

pub fn is_rcd_pid(pid: u32) -> bool {
    let cmdline = fs::read_to_string(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    cmdline.contains("rclone") && cmdline.contains("rcd")
}

pub fn save_engine_file(app: &AppHandle, eng: &Engine) {
    let Some(path) = engine_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let data = json!({ "port": eng.port, "pass": eng.pass, "pid": eng.pid });
    let _ = fs::write(&path, data.to_string());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
}

/// Try to reconnect to an engine left by a previous session. Returns true
/// on success; kills an unreachable stale daemon as a side effect.
pub fn try_adopt_engine(app: &AppHandle, eng: &mut Engine) -> bool {
    let Some(path) = engine_file(app) else {
        return false;
    };
    let Ok(saved) = fs::read_to_string(&path) else {
        return false;
    };
    let saved: Value = serde_json::from_str(&saved).unwrap_or_default();
    let port = saved["port"].as_u64().unwrap_or(0) as u16;
    let pass = saved["pass"].as_str().unwrap_or("").to_string();
    let pid = saved["pid"].as_u64().unwrap_or(0) as u32;
    if port != 0 && !pass.is_empty() && rc_raw(port, &pass, "rc/noop", &json!({})).is_ok() {
        eng.child = None;
        eng.pid = pid;
        eng.port = port;
        eng.pass = pass;
        return true;
    }
    // Unreachable — if the pid is still an rcd, put it down before
    // spawning a fresh daemon.
    if pid != 0 && is_rcd_pid(pid) {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    let _ = fs::remove_file(&path);
    false
}

pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener); // tiny race window, acceptable for a local daemon
    Ok(port)
}

// ureq instead of reqwest on purpose: commands run on tokio worker
// threads, and dropping reqwest's blocking client there panics the
// runtime ("Cannot drop a runtime in a context where blocking is not
// allowed"). ureq is plain blocking I/O with no runtime inside.
pub fn rc_raw(port: u16, pass: &str, path: &str, body: &Value) -> Result<Value, String> {
    if port == 0 {
        return Err("engine is not running".into());
    }
    use base64::Engine as _;
    let auth = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("{RC_USER}:{pass}"))
    );
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .build();
    match agent
        .post(&format!("http://127.0.0.1:{port}/{path}"))
        .set("Authorization", &auth)
        .send_json(body)
    {
        Ok(resp) => resp.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(_, resp)) => {
            let value: Value = resp.into_json().unwrap_or(json!({}));
            Err(value["error"]
                .as_str()
                .unwrap_or("rclone rc call failed")
                .to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn engine_alive(eng: &mut Engine) -> bool {
    if let Some(child) = &mut eng.child {
        return matches!(child.try_wait(), Ok(None));
    }
    // Adopted daemon: no process handle, probe the API instead.
    eng.port != 0 && rc_raw(eng.port, &eng.pass, "rc/noop", &json!({})).is_ok()
}

pub fn start_engine_locked(app: &AppHandle, eng: &mut Engine) -> Result<(), String> {
    if engine_alive(eng) {
        return Ok(());
    }
    eng.child = None;
    if try_adopt_engine(app, eng) {
        return Ok(());
    }
    let rclone = find_rclone(app).ok_or("rclone not found")?;
    let port = free_port()?;
    let pass = rand_hex(16)?;
    let mut cmd = Command::new(&rclone);
    // Credentials go through the environment: /proc/<pid>/cmdline is
    // world-readable, /proc/<pid>/environ is not. No PDEATHSIG here:
    // the daemon must be able to outlive the app to keep drives mounted.
    cmd.args(["rcd", &format!("--rc-addr=127.0.0.1:{port}")])
        .env("RCLONE_RC_USER", RC_USER)
        .env("RCLONE_RC_PASS", &pass)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_child(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start rclone: {e}"))?;

    // Wait until the RC API answers.
    for _ in 0..50 {
        if rc_raw(port, &pass, "rc/noop", &json!({})).is_ok() {
            eng.pid = child.id();
            eng.child = Some(child);
            eng.port = port;
            eng.pass = pass;
            save_engine_file(app, eng);
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = { child }.kill();
    Err("rclone engine did not become ready in 5s".into())
}

pub fn stop_engine_locked(app: &AppHandle, eng: &mut Engine) {
    if eng.port != 0 {
        // Unmount everything first so FUSE mounts don't go stale.
        let _ = rc_raw(eng.port, &eng.pass, "mount/unmountall", &json!({}));
        let _ = rc_raw(eng.port, &eng.pass, "core/quit", &json!({}));
    }
    // Give the daemon a moment to exit on its own; killing it mid-write
    // is what the VFS cache protects against, but no need to test that.
    if let Some(mut child) = eng.child.take() {
        for _ in 0..20 {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    } else if eng.pid != 0 {
        // Adopted daemon: no Child handle, watch /proc and then SIGTERM.
        for _ in 0..20 {
            if !is_rcd_pid(eng.pid) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if is_rcd_pid(eng.pid) {
            unsafe {
                libc::kill(eng.pid as i32, libc::SIGTERM);
            }
        }
    }
    if let Some(path) = engine_file(app) {
        let _ = fs::remove_file(path);
    }
    eng.pid = 0;
    eng.port = 0;
    eng.pass.clear();
}

/// Restart the rcd daemon and remount everything that was mounted.
/// Needed after CLI config changes the daemon can't see; users should
/// never lose a mounted drive because they added or re-authorized one.
pub fn restart_engine_preserving_mounts(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    let mounts = rc_raw(eng.port, &eng.pass, "mount/listmounts", &json!({}))
        .ok()
        .and_then(|v| v.get("mountPoints").cloned());
    stop_engine_locked(app, &mut eng);
    start_engine_locked(app, &mut eng)?;
    if let Some(Value::Array(list)) = mounts {
        for m in list {
            if let (Some(fs), Some(mp)) = (
                m.get("Fs").and_then(Value::as_str),
                m.get("MountPoint").and_then(Value::as_str),
            ) {
                let vfs_opt = eng
                    .vfs_opts
                    .get(fs)
                    .cloned()
                    .unwrap_or_else(|| json!({ "CacheMode": 3 }));
                let _ = rc_raw(
                    eng.port,
                    &eng.pass,
                    "mount/mount",
                    &json!({ "fs": fs, "mountPoint": mp, "vfsOpt": vfs_opt }),
                );
            }
        }
    }
    Ok(())
}
