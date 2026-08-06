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

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub const RC_USER: &str = "monti";

/// One mounted drive as the engine layer knows it: where it is mounted
/// and with which vfs options. Persisted in engine.json so an adopted or
/// restarted daemon can restore exactly what the user had.
#[derive(Clone, Serialize, Deserialize)]
pub struct MountEntry {
    pub mount_point: String,
    pub vfs_opt: Value,
}

#[derive(Default)]
pub struct Engine {
    /// Present when this session spawned the daemon; None when a daemon
    /// from a previous session was adopted (see `try_adopt_engine`).
    pub child: Option<Child>,
    pub pid: u32,
    /// /proc/<pid>/stat start time of the daemon — pids get reused, the
    /// (pid, starttime) pair identifies one concrete process forever.
    pub starttime: u64,
    pub port: u16,
    pub pass: String,
    /// Mounts made through Monti, keyed by fs ("name:").
    pub mounts: HashMap<String, MountEntry>,
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

/// stderr of the current rcd, truncated on each spawn — the only place
/// rclone startup errors (encrypted config, bad binary, busy port) exist.
pub fn engine_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("engine.log"))
}

fn monti_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("monti.log"))
}

/// Epoch seconds → "YYYY-MM-DD HH:MM:SS" (UTC), no chrono dependency.
fn utc_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86400, secs % 86400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // Howard Hinnant's civil_from_days
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}")
}

/// Append one line to monti.log (plain text diary of engine/mount/auth
/// events — never secrets). Rotates to .old at 512 KiB.
pub fn log_line(app: &AppHandle, msg: &str) {
    let Some(path) = monti_log_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(&path).map(|m| m.len() > 512 * 1024).unwrap_or(false) {
        let _ = fs::rename(&path, path.with_extension("log.old"));
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write;
        let _ = writeln!(f, "{} {}", utc_stamp(), msg);
    }
}

/// Turn the engine.log tail into something a person can act on.
fn friendly_engine_error(app: &AppHandle) -> String {
    let tail = engine_log_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| {
            let n = s.len().saturating_sub(2048);
            s[n..].trim().to_string()
        })
        .unwrap_or_default();
    if tail.contains("unable to decrypt") || tail.contains("couldn't decrypt") {
        return "Your rclone config file is password-protected — Monti cannot unlock it. \
                Run `rclone config` in a terminal and remove the configuration password \
                (Set configuration password → Remove), then try again."
            .into();
    }
    if tail.is_empty() {
        "rclone engine did not start (no error output captured)".into()
    } else {
        format!("rclone engine failed to start:\n{tail}")
    }
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

/// Field 22 of /proc/<pid>/stat — the process start time in clock ticks.
/// Parsed after the last ')' because field 2 (comm) may contain anything.
pub fn proc_starttime(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rest = &stat[stat.rfind(')')? + 1..];
    rest.split_whitespace().nth(19)?.parse().ok()
}

fn boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Same pid + same start time + rcd-looking cmdline = the exact process
/// we spawned. Any mismatch means the pid was recycled — hands off.
fn is_our_daemon(pid: u32, saved_starttime: u64) -> bool {
    saved_starttime != 0
        && proc_starttime(pid) == Some(saved_starttime)
        && is_rcd_pid(pid)
}

/// Does <pid> hold the LISTEN socket for 127.0.0.1:<port>? Looked up via
/// /proc/net/tcp (inode) and the process's fd table. Guards against a
/// stranger's service squatting on our saved port — we must never send
/// the RC password there.
fn pid_owns_port(pid: u32, port: u16) -> bool {
    let Ok(tcp) = fs::read_to_string("/proc/net/tcp") else {
        return false;
    };
    let needle = format!("0100007F:{port:04X}");
    let Some(inode) = tcp.lines().skip(1).find_map(|line| {
        let mut f = line.split_whitespace();
        let local = f.nth(1)?;
        let state = f.nth(1)?;
        if local == needle && state == "0A" {
            f.nth(4).map(str::to_string) // inode column
        } else {
            None
        }
    }) else {
        return false;
    };
    let target = format!("socket:[{inode}]");
    let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else {
        return false;
    };
    fds.filter_map(|e| e.ok())
        .filter_map(|e| fs::read_link(e.path()).ok())
        .any(|l| l.to_string_lossy() == target)
}

/// SIGTERM the daemon — but only after re-checking it is still the exact
/// process we remembered, so a recycled pid never kills a bystander.
fn safe_kill(app: &AppHandle, pid: u32, starttime: u64) {
    if pid != 0 && is_our_daemon(pid, starttime) {
        log_line(app, &format!("terminating engine (pid {pid})"));
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
}

pub fn save_engine_file(app: &AppHandle, eng: &Engine) {
    let Some(path) = engine_file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let data = json!({
        "version": 2,
        "port": eng.port,
        "pass": eng.pass,
        "pid": eng.pid,
        "starttime": eng.starttime,
        "boot_id": boot_id(),
        "mounts": eng.mounts,
    });
    let _ = fs::write(&path, data.to_string());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
}

/// Try to reconnect to an engine left by a previous session. Each check
/// closes its own attack/mistake vector; on any mismatch nothing is
/// killed unless the process is provably ours.
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
    let starttime = saved["starttime"].as_u64().unwrap_or(0);
    let saved_boot = saved["boot_id"].as_str().unwrap_or("");
    let cleanup = || {
        let _ = fs::remove_file(&path);
        false
    };
    if port == 0 || pass.is_empty() || pid == 0 {
        return cleanup();
    }
    // After a reboot nothing survived — and every pid belongs to someone else.
    if !saved_boot.is_empty() && saved_boot != boot_id() {
        return cleanup();
    }
    if starttime != 0 {
        // v2 file: full identity chain.
        if !is_our_daemon(pid, starttime) {
            return cleanup(); // recycled pid — not ours, do not touch
        }
        if !pid_owns_port(pid, port) {
            // Our daemon lost the port / someone else has it: never send
            // credentials there; put our process down and start fresh.
            safe_kill(app, pid, starttime);
            return cleanup();
        }
    }
    // Final proof of life + identity: the daemon itself reports our pid.
    let daemon_pid = rc_raw(port, &pass, "core/pid", &json!({}))
        .ok()
        .and_then(|v| v["pid"].as_u64())
        .unwrap_or(0) as u32;
    if daemon_pid == pid {
        eng.child = None;
        eng.pid = pid;
        eng.starttime = if starttime != 0 {
            starttime
        } else {
            proc_starttime(pid).unwrap_or(0)
        };
        eng.port = port;
        eng.pass = pass;
        eng.mounts = saved
            .get("mounts")
            .and_then(|m| serde_json::from_value(m.clone()).ok())
            .unwrap_or_default();
        save_engine_file(app, eng); // upgrade legacy files to v2
        log_line(app, &format!("adopted running engine (pid {pid}, port {port})"));
        return true;
    }
    // Unreachable or imposter — reap only what is provably ours.
    log_line(app, &format!("engine leftover unusable (pid {pid}), cleaning up"));
    safe_kill(app, pid, starttime);
    cleanup()
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
    rc_raw_with_timeout(port, pass, path, body, 120)
}

pub fn rc_raw_with_timeout(
    port: u16,
    pass: &str,
    path: &str,
    body: &Value,
    timeout_secs: u64,
) -> Result<Value, String> {
    if port == 0 {
        return Err("engine is not running".into());
    }
    use base64::Engine as _;
    let auth = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("{RC_USER}:{pass}"))
    );
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(timeout_secs))
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

    // Startup errors (encrypted config, busy port, broken binary) only
    // ever appear on the daemon's stderr — keep them.
    let stderr: Stdio = engine_log_path(app)
        .and_then(|p| {
            if let Some(dir) = p.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let mut opts = fs::OpenOptions::new();
            opts.create(true).write(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            opts.open(&p).ok()
        })
        .map(Into::into)
        .unwrap_or_else(Stdio::null);

    let mut cmd = Command::new(&rclone);
    // Credentials go through the environment: /proc/<pid>/cmdline is
    // world-readable, /proc/<pid>/environ is not. No PDEATHSIG here:
    // the daemon must be able to outlive the app to keep drives mounted.
    // ASK_PASSWORD=false: an encrypted config must fail loudly instead of
    // waiting forever on a /dev/null stdin.
    cmd.args(["rcd", &format!("--rc-addr=127.0.0.1:{port}")])
        .env("RCLONE_RC_USER", RC_USER)
        .env("RCLONE_RC_PASS", &pass)
        .env("RCLONE_ASK_PASSWORD", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);
    detach_child(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start rclone: {e}"))?;

    // Wait until the RC API answers.
    for _ in 0..50 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            // Died during startup — the log has the reason.
            let err = friendly_engine_error(app);
            log_line(app, &format!("engine failed to start: {err}"));
            return Err(err);
        }
        if rc_raw(port, &pass, "rc/noop", &json!({})).is_ok() {
            eng.pid = child.id();
            eng.starttime = proc_starttime(eng.pid).unwrap_or(0);
            eng.child = Some(child);
            eng.port = port;
            eng.pass = pass;
            save_engine_file(app, eng);
            log_line(app, &format!("engine started (pid {}, port {port})", eng.pid));
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
    log_line(app, "engine did not become ready in 5s");
    Err(friendly_engine_error(app))
}

pub fn stop_engine_locked(app: &AppHandle, eng: &mut Engine) {
    if eng.port != 0 {
        log_line(app, &format!("stopping engine (pid {}, port {})", eng.pid, eng.port));
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
            if !is_our_daemon(eng.pid, eng.starttime) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        safe_kill(app, eng.pid, eng.starttime);
    }
    if let Some(path) = engine_file(app) {
        let _ = fs::remove_file(path);
    }
    eng.pid = 0;
    eng.starttime = 0;
    eng.port = 0;
    eng.pass.clear();
    eng.mounts.clear();
}

/// True when the path is (still) listed as a fuse.rclone mount — after a
/// daemon death these turn into "Transport endpoint is not connected"
/// zombies that must be lazily unmounted before mounting over them.
fn is_fuse_mounted(mount_point: &str) -> bool {
    fs::read_to_string("/proc/mounts")
        .map(|data| {
            data.lines().any(|line| {
                let mut f = line.split_whitespace();
                let _src = f.next();
                let mp = f.next().unwrap_or("");
                let ty = f.next().unwrap_or("");
                ty == "fuse.rclone"
                    && mp.replace("\\040", " ").replace("\\011", "\t") == mount_point
            })
        })
        .unwrap_or(false)
}

/// Mount everything recorded in eng.mounts with the exact options the
/// user chose — used after an engine restart or recovery. Stale FUSE
/// leftovers of a dead daemon are lazily unmounted first.
pub fn remount_saved(app: &AppHandle, eng: &Engine) {
    for (fs_name, entry) in &eng.mounts {
        if is_fuse_mounted(&entry.mount_point) {
            let _ = Command::new("fusermount3")
                .args(["-uz", &entry.mount_point])
                .output();
        }
        let result = rc_raw(
            eng.port,
            &eng.pass,
            "mount/mount",
            &json!({
                "fs": fs_name,
                "mountPoint": entry.mount_point,
                "vfsOpt": entry.vfs_opt,
            }),
        );
        match result {
            Ok(_) => log_line(app, &format!("remounted {fs_name} at {}", entry.mount_point)),
            Err(e) => log_line(app, &format!("remount of {fs_name} failed: {e}")),
        }
    }
}

/// Restart the rcd daemon and remount everything that was mounted.
/// Needed after CLI config changes the daemon can't see; users should
/// never lose a mounted drive because they added or re-authorized one.
pub fn restart_engine_preserving_mounts(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    let saved_mounts = eng.mounts.clone();
    stop_engine_locked(app, &mut eng);
    eng.mounts = saved_mounts;
    start_engine_locked(app, &mut eng)?;
    remount_saved(app, &eng);
    save_engine_file(app, &eng);
    Ok(())
}
