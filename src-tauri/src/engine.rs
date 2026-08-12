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
    /// Folders the person left out of this drive, as paths from the drive
    /// root ("Photos/2019"). Kept as paths rather than filter rules so the
    /// picker can tick the boxes back on and the rules stay ours to build.
    #[serde(default)]
    pub excludes: Vec<String>,
}

/// Turn "leave these folders out" into rclone filter rules.
///
/// Two things make this less obvious than it looks:
///
/// * The rule must be anchored (`/Photos/**`), or `Photos/**` would also
///   match `Backup/Photos` — a folder the person never touched.
/// * rclone reads `*?[]{}` as pattern syntax, so a real folder called
///   "Photos [2024]" produces a rule that matches nothing and silently keeps
///   showing the folder. Every special character is escaped.
pub fn exclude_rules(excludes: &[String]) -> Vec<String> {
    excludes
        .iter()
        .filter_map(|path| {
            let trimmed = path.trim().trim_matches('/');
            if trimmed.is_empty() {
                return None;
            }
            let mut rule = String::from("/");
            for ch in trimmed.chars() {
                if matches!(ch, '*' | '?' | '[' | ']' | '{' | '}' | '\\') {
                    rule.push('\\');
                }
                rule.push(ch);
            }
            rule.push_str("/**");
            Some(rule)
        })
        .collect()
}

/// The `_filter` object for an RC call, or None when nothing is excluded —
/// sending an empty rule list is not the same as sending none.
pub fn filter_opt(excludes: &[String]) -> Option<Value> {
    let rules = exclude_rules(excludes);
    (!rules.is_empty()).then(|| json!({ "ExcludeRule": rules }))
}

/// The body of a `mount/mount` call. One place, because a mount made here
/// must be identical to the one remade after a restart — an excluded folder
/// that quietly comes back on the next remount is worse than never hiding it.
pub fn mount_body(fs_name: &str, entry: &MountEntry) -> Value {
    let mut body = json!({
        "fs": fs_name,
        "mountPoint": entry.mount_point,
        "vfsOpt": entry.vfs_opt,
    });
    if let Some(filter) = filter_opt(&entry.excludes) {
        body["_filter"] = filter;
    }
    body
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

/// Free space on the filesystem holding `path`, in bytes.
///
/// statvfs needs a path that exists, and the cache directory is missing
/// until the first mount writes to it — so walk up to the nearest existing
/// ancestor, which is on the same filesystem in every layout we care about.
pub fn free_space(path: &std::path::Path) -> Option<u64> {
    use std::ffi::CString;
    let mut probe = path;
    loop {
        if probe.exists() {
            break;
        }
        probe = probe.parent()?;
    }
    let c = CString::new(probe.as_os_str().as_encoded_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some(st.f_bavail as u64 * st.f_frsize as u64)
}

/// How large the on-disk cache of one drive may grow when the user has not
/// chosen a limit.
///
/// Mounts always run with CacheMode full, so every file that gets opened is
/// written to disk. Left unbounded — rclone's own default — that quietly
/// eats the disk, which is the most common complaint about rclone mounts.
/// A tenth of the free space, clamped to 1–20 GB, keeps the cache useful
/// without letting one drive take the machine down.
pub fn default_cache_max_size(cache_root: &std::path::Path) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    let tenth = free_space(cache_root).map(|f| f / 10).unwrap_or(10 * GB);
    let bytes = tenth.clamp(GB, 20 * GB);
    format!("{}M", bytes / (1024 * 1024))
}

/// Build the vfsOpt for a mount: CacheMode "full" is always forced (apps
/// like KeePassXC corrupt saves without it), the rest is a whitelist of
/// user-tunable options. Values are validated by rclone at mount time.
pub fn build_vfs_opt(app: &AppHandle, user: Option<&Value>) -> Value {
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
    if opt.get("CacheMaxSize").is_none() {
        let root = app
            .path()
            .cache_dir()
            .unwrap_or_else(|_| PathBuf::from("/tmp"));
        opt["CacheMaxSize"] = json!(default_cache_max_size(&root));
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
pub fn utc_stamp() -> String {
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
    let Some(path) = monti_log_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::metadata(&path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(false)
    {
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
fn is_executable(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.is_file()
        && fs::metadata(p)
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

pub fn find_rclone(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app_bin_dir(app) {
        let bundled = dir.join("rclone");
        if is_executable(&bundled) {
            return Some(bundled);
        }
    }
    let path = std::env::var("PATH").ok()?;
    std::env::split_paths(&path)
        .map(|d| d.join("rclone"))
        .find(|c| is_executable(c))
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
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("engine.json"))
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
    saved_starttime != 0 && proc_starttime(pid) == Some(saved_starttime) && is_rcd_pid(pid)
}

/// Does <pid> hold a LISTEN socket on <port>? Looked up via the kernel's
/// socket tables (inode) and the process's fd table. Guards against a
/// stranger's service squatting on our saved port — we must never send
/// the RC password there.
///
/// Both /proc/net/tcp and /proc/net/tcp6 are scanned, and any local
/// address is accepted: ownership is decided by the fd table, so a
/// listener that is not ours simply won't match the pid.
fn pid_owns_port(pid: u32, port: u16) -> bool {
    let suffix = format!(":{port:04X}");
    let mut inodes = Vec::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let Ok(tcp) = fs::read_to_string(table) else {
            continue;
        };
        // Columns: sl local rem st tx:rx tr:when retrnsmt uid timeout
        // inode … — after taking `local` (idx 1) and `st` (idx 3), the
        // inode is 5 fields further on.
        inodes.extend(tcp.lines().skip(1).filter_map(|line| {
            let mut f = line.split_whitespace();
            let local = f.nth(1)?;
            let state = f.nth(1)?;
            if local.ends_with(&suffix) && state == "0A" {
                f.nth(5).map(str::to_string)
            } else {
                None
            }
        }));
    }
    if inodes.is_empty() {
        return false;
    }
    let targets: Vec<String> = inodes.iter().map(|i| format!("socket:[{i}]")).collect();
    let Ok(fds) = fs::read_dir(format!("/proc/{pid}/fd")) else {
        return false;
    };
    fds.filter_map(|e| e.ok())
        .filter_map(|e| fs::read_link(e.path()).ok())
        .any(|l| targets.iter().any(|t| *t == l.to_string_lossy()))
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
    // Write a 0600-from-birth temp file and rename over the target: no
    // window where the RC password is world-readable or the file is
    // half-written (the adoption path parses this on every start).
    // The temp name carries the pid: two Monti processes can overlap for a
    // moment (a second launch, or one quitting as another starts), and with
    // one shared temp name whoever renames second finds it already gone and
    // loses the write — "failed to save engine.json: No such file or
    // directory", with the mount list left behind stale.
    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let ok = opts
        .open(&tmp)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(data.to_string().as_bytes())?;
            f.sync_all()
        })
        .and_then(|_| fs::rename(&tmp, &path));
    if let Err(e) = ok {
        log_line(app, &format!("failed to save engine.json: {e}"));
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
        // Legacy files (or lost records): reconcile with what the daemon
        // actually has mounted, so recovery knows about every drive.
        if eng.mounts.is_empty() {
            if let Ok(v) = rc_raw(port, &eng.pass, "mount/listmounts", &json!({})) {
                if let Some(list) = v.get("mountPoints").and_then(Value::as_array) {
                    for m in list {
                        if let (Some(fs_name), Some(mp)) = (
                            m.get("Fs").and_then(Value::as_str),
                            m.get("MountPoint").and_then(Value::as_str),
                        ) {
                            eng.mounts.insert(
                                fs_name.to_string(),
                                MountEntry {
                                    mount_point: mp.to_string(),
                                    vfs_opt: json!({ "CacheMode": 3 }),
                                    excludes: Vec::new(),
                                },
                            );
                        }
                    }
                }
            }
        }
        save_engine_file(app, eng); // upgrade legacy files to v2
        log_line(
            app,
            &format!("adopted running engine (pid {pid}, port {port})"),
        );
        return true;
    }
    // Unreachable or imposter — reap only what is provably ours.
    log_line(
        app,
        &format!("engine leftover unusable (pid {pid}), cleaning up"),
    );
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

/// Turn what the provider said into what it means.
///
/// rclone reports the API's own words — `googleapi: Error 403: The user's
/// Drive storage quota has been exceeded., storageQuotaExceeded` — and the
/// person reading it wanted to copy a file. The raw text is kept at the end
/// of the sentence, because a bug report needs it and because guessing wrong
/// must not hide the truth.
pub fn friendly_cloud_error(raw: &str) -> String {
    let low = raw.to_lowercase();
    let explain = |what: &str| format!("{what}\n\nThe provider said: {raw}");

    // Google answers 403 for both "you are out of space" and "you are going
    // too fast", and the word "quota" appears in both — so decide which one
    // this is before saying anything.
    let rate_limited = low.contains("ratelimitexceeded")
        || low.contains("userratelimit")
        || low.contains("rate limit")
        || low.contains("too many requests")
        || low.contains("error 429");
    if !rate_limited
        && (low.contains("storagequotaexceeded")
            || low.contains("quota has been exceeded")
            || low.contains("quotaexceeded")
            || low.contains("insufficient storage"))
    {
        return explain(
            "The cloud is full — the provider refused to store more. \
             Free some space in the account, or buy more, and try again.",
        );
    }
    if rate_limited {
        return explain(
            "The provider is asking Monti to slow down (too many requests in \
             a short time). It usually clears in a few minutes; a speed limit \
             in Settings → Transfers makes it much less likely.",
        );
    }
    // Proton answers 422 for both halves of the sign-in, with different
    // words. Which half failed is the whole of what the person needs to know.
    if low.contains("/auth/v4/2fa") || low.contains("incorrect login credentials") {
        return explain(
            "The two-factor code was not accepted. A code is only good for \
             about half a minute — take a fresh one from your authenticator \
             and press Connect again. The rest of the form is still filled in.",
        );
    }
    if low.contains("the password is not correct") {
        return explain(
            "The password was not accepted. Check it, and note that Proton's \
             two-password mode — where the mailbox has a second password — \
             cannot be used here.",
        );
    }
    if low.contains("invalid_grant")
        || low.contains("token expired")
        || low.contains("cannot fetch token")
        || low.contains("error 401")
        || low.contains("unauthenticated")
    {
        return explain(
            "The saved sign-in for this drive is no longer accepted — it \
             expired, or access was withdrawn in the account's security \
             settings. Open the drive's settings and press Re-authorize.",
        );
    }
    if low.contains("no such host")
        || low.contains("network is unreachable")
        || low.contains("connection refused")
        || low.contains("i/o timeout")
        || low.contains("dial tcp")
        || low.contains("tls handshake timeout")
    {
        return explain(
            "The provider could not be reached. This is a network problem on \
             this side more often than an outage: check the connection and \
             try again.",
        );
    }
    if low.contains("error 403") || low.contains("forbidden") {
        return explain(
            "The provider refused the request (403). Either the account has \
             no permission for that folder, or the API key in use is not \
             allowed to — a personal API key in the drive's settings solves \
             the second case.",
        );
    }
    if low.contains("fusermount") && low.contains("not found") {
        return explain(
            "FUSE is missing on this computer, so nothing can be mounted. \
             Install the fuse3 package from your distribution and try again.",
        );
    }
    if low.contains("directory not empty") {
        return explain(
            "The mount folder is not empty. FUSE can only mount over an empty \
             folder — pick another one in the drive's settings.",
        );
    }
    raw.to_string()
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
            Err(friendly_cloud_error(
                value["error"].as_str().unwrap_or("rclone rc call failed"),
            ))
        }
        Err(e) => Err(friendly_transport_error(&e.to_string(), timeout_secs)),
    }
}

/// What to say when the call to the engine itself did not complete.
///
/// This is not the provider's error — it is Monti's own HTTP call to
/// 127.0.0.1 — and printing it raw produced the worst message in the app:
/// "http://127.0.0.1:37185/operations/list: Network Error: Network Error:
/// Error encountered in the status line: timed out reading response", which
/// reads like the user's network is broken when what happened is that the
/// cloud took too long to answer.
fn friendly_transport_error(raw: &str, timeout_secs: u64) -> String {
    let low = raw.to_lowercase();
    if low.contains("timed out") || low.contains("timeout") {
        return format!(
            "The engine did not finish this in {timeout_secs} seconds. That \
             usually means the cloud is slow to answer, or cannot be reached \
             at all — rclone keeps retrying in the background. Try again in \
             a moment."
        );
    }
    if low.contains("connection refused") || low.contains("connection reset") {
        return "The rclone engine is not answering — it looks like it stopped. \
                Press “Restart engine” at the top of the window."
            .into();
    }
    raw.to_string()
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
            log_line(
                app,
                &format!("engine started (pid {}, port {port})", eng.pid),
            );
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
        log_line(
            app,
            &format!("stopping engine (pid {}, port {})", eng.pid, eng.port),
        );
        // Unmount everything first so FUSE mounts don't go stale.
        let _ = rc_raw(eng.port, &eng.pass, "mount/unmountall", &json!({}));
        let _ = rc_raw(eng.port, &eng.pass, "core/quit", &json!({}));
        // Every one of those folders is an ordinary empty directory again,
        // and a save into one would go to the local disk instead of the
        // cloud — this is the moment to close them.
        for entry in eng.mounts.values() {
            close_mount_folder(&entry.mount_point);
        }
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

/// How many files the VFS cache of `fs` still has to upload (in flight +
/// queued writeback). 0 on any error — this gates warnings, not safety.
pub fn pending_uploads(port: u16, pass: &str, fs: &str) -> u64 {
    rc_raw_with_timeout(port, pass, "vfs/stats", &json!({ "fs": fs }), 5)
        .ok()
        .map(|v| {
            let dc = &v["diskCache"];
            dc["uploadsInProgress"].as_u64().unwrap_or(0)
                + dc["uploadsQueued"].as_u64().unwrap_or(0)
        })
        .unwrap_or(0)
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

/// Mount a drive, leaving the folder underneath closed to writing.
///
/// While a drive is mounted that folder is unreachable — everything at the
/// path belongs to rclone. It becomes reachable again the moment the drive
/// is not mounted, and then a save into what still looks like the cloud
/// folder lands on the local disk: no error, nothing in the cloud, and the
/// next mount refused outright, because FUSE will not mount over a folder
/// with anything in it. `r-x` turns that save into "permission denied",
/// where the person can still do something about it.
///
/// Two measured details decide the shape of this:
/// * `fusermount3` rejects a mount point it cannot write to
///   ("user has no write access to mountpoint"), so the folder has to be
///   opened up for the moment of mounting;
/// * after the mount, the path leads into rclone's filesystem, so the mode
///   has to be set through a handle opened *before* it — that handle still
///   refers to the directory underneath.
pub fn mount_guarded(
    port: u16,
    pass: &str,
    fs_name: &str,
    entry: &MountEntry,
) -> Result<Value, String> {
    #[cfg(unix)]
    let under = fs::File::open(&entry.mount_point).ok();
    #[cfg(unix)]
    if under.is_some() {
        set_mode(&entry.mount_point, 0o700);
    }
    let result = rc_raw(port, pass, "mount/mount", &mount_body(fs_name, entry));
    #[cfg(unix)]
    if let Some(dir) = under {
        use std::os::unix::fs::PermissionsExt;
        let _ = dir.set_permissions(fs::Permissions::from_mode(0o500));
    }
    result
}

#[cfg(unix)]
fn set_mode(path: &str, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
}

/// Close an unmounted folder against stray writes — the other half of
/// [`mount_guarded`], for the moment a drive is taken away.
///
/// A folder that still has something in it is left alone: it is either not
/// ours, or it holds exactly what this is meant to save — something written
/// while the drive was away, which the person still has to see.
pub fn close_mount_folder(path: &str) {
    #[cfg(unix)]
    if fs::read_dir(path)
        .map(|mut d| d.next().is_none())
        .unwrap_or(false)
    {
        set_mode(path, 0o500);
    }
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
        let result = mount_guarded(eng.port, &eng.pass, fs_name, entry);
        match result {
            Ok(_) => log_line(
                app,
                &format!("remounted {fs_name} at {}", entry.mount_point),
            ),
            Err(e) => {
                log_line(app, &format!("remount of {fs_name} failed: {e}"));
                retry_mount(app, eng.port, &eng.pass, fs_name, entry);
            }
        }
    }
}

/// How long to wait before each further attempt at a mount that failed.
/// Autostart puts Monti on screen while NetworkManager is still bringing
/// the connection up, so the first mount of the session can fail purely
/// because there is no route yet — a minute later there is.
const REMOUNT_DELAYS: [u64; 4] = [10, 30, 60, 120];

/// Keep trying a mount that failed, in the background, for about four
/// minutes. Gives up quietly: a wrong password or a deleted folder fails
/// the same way every time, and the drive is on screen as unmounted with a
/// Mount button either way.
fn retry_mount(app: &AppHandle, port: u16, pass: &str, fs_name: &str, entry: &MountEntry) {
    let app = app.clone();
    let pass = pass.to_string();
    let fs_name = fs_name.to_string();
    let entry = entry.clone();
    thread::spawn(move || {
        for (attempt, delay) in REMOUNT_DELAYS.iter().enumerate() {
            thread::sleep(Duration::from_secs(*delay));
            // Someone may have mounted it by hand while we waited, and the
            // daemon may have been restarted onto another port — in both
            // cases this retry has nothing left to do.
            match rc_raw(port, &pass, "mount/listmounts", &json!({})) {
                Ok(v) => {
                    let already =
                        v.get("mountPoints")
                            .and_then(Value::as_array)
                            .is_some_and(|points| {
                                points.iter().any(|m| {
                                    m.get("MountPoint").and_then(Value::as_str)
                                        == Some(entry.mount_point.as_str())
                                })
                            });
                    if already {
                        return;
                    }
                }
                Err(_) => return, // engine gone or replaced; not our mount to fix
            }
            let result = mount_guarded(port, &pass, &fs_name, &entry);
            match result {
                Ok(_) => {
                    log_line(
                        &app,
                        &format!(
                            "mounted {fs_name} at {} on retry {}",
                            entry.mount_point,
                            attempt + 1
                        ),
                    );
                    return;
                }
                Err(e) => log_line(
                    &app,
                    &format!("retry {} for {fs_name} failed: {e}", attempt + 1),
                ),
            }
        }
    });
}

/// Restart the rcd daemon and remount everything that was mounted.
/// Needed after CLI config changes the daemon can't see; users should
/// never lose a mounted drive because they added or re-authorized one.
pub fn restart_engine_preserving_mounts(
    app: &AppHandle,
    state: &EngineState,
) -> Result<(), String> {
    let mut eng = state.0.lock().unwrap();
    let saved_mounts = eng.mounts.clone();
    stop_engine_locked(app, &mut eng);
    eng.mounts = saved_mounts;
    start_engine_locked(app, &mut eng)?;
    remount_saved(app, &eng);
    save_engine_file(app, &eng);
    Ok(())
}

#[cfg(test)]
mod port_tests {
    /// A live rcd must be recognized as the owner of its own RC port —
    /// a parser regression here once made adoption kill healthy daemons.
    #[test]
    fn pid_owns_its_rc_port() {
        use std::process::{Command, Stdio};
        let port = super::free_port().unwrap();
        let Ok(mut child) = Command::new("rclone")
            .args([
                "rcd",
                "--rc-no-auth",
                &format!("--rc-addr=127.0.0.1:{port}"),
            ])
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            return; // no rclone on this machine — skip
        };
        let mut owned = false;
        for _ in 0..50 {
            if super::pid_owns_port(child.id(), port) {
                owned = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let foreign = super::pid_owns_port(std::process::id(), port);
        let _ = child.kill();
        let _ = child.wait();
        assert!(owned, "live daemon not recognized as owner of its port");
        // The lookup accepts any local address, so ownership must still be
        // decided by the fd table alone: a bystander pid never matches.
        assert!(!foreign, "someone else's port reported as ours");
    }
}

#[cfg(test)]
mod error_tests {
    use super::friendly_cloud_error;

    /// Real messages, copied from rclone and from Google's API. The two 403s
    /// are the pair worth pinning: "you are out of space" and "you are going
    /// too fast" read almost alike and need opposite answers.
    #[test]
    fn the_two_403s_are_told_apart_and_the_original_survives() {
        let full = friendly_cloud_error(
            "googleapi: Error 403: The user's Drive storage quota has been \
             exceeded., storageQuotaExceeded",
        );
        assert!(full.starts_with("The cloud is full"), "{full}");
        assert!(full.contains("storageQuotaExceeded"), "raw text dropped");

        let fast = friendly_cloud_error(
            "googleapi: Error 403: Rate Limit Exceeded, userRateLimitExceeded",
        );
        assert!(fast.contains("slow down"), "{fast}");

        let stale = friendly_cloud_error(
            "failed to get token: oauth2: cannot fetch token: 400 Bad Request \
             invalid_grant",
        );
        assert!(stale.contains("Re-authorize"), "{stale}");

        let offline = friendly_cloud_error(
            "Get \"https://www.googleapis.com/drive/v3/files\": dial tcp: \
             lookup www.googleapis.com: no such host",
        );
        assert!(offline.contains("could not be reached"), "{offline}");

        // Proton says 422 for both halves of the sign-in, and the two need
        // opposite answers: take a fresh code, or check the password. These
        // are the messages the log showed when a code went stale.
        let stale_code = friendly_cloud_error(
            "couldn't initialize a new proton drive instance: 422 POST \
             https://drive-api.proton.me/auth/v4/2fa: Incorrect login \
             credentials. Please try again. (Code=8002, Status=422)",
        );
        assert!(stale_code.contains("two-factor code"), "{stale_code}");

        let bad_password = friendly_cloud_error(
            "couldn't initialize a new proton drive instance: 422 POST \
             https://drive-api.proton.me/auth/v4: The password is not \
             correct. Please try again with a different password. \
             (Code=8002, Status=422)",
        );
        assert!(
            bad_password.contains("password was not accepted"),
            "{bad_password}"
        );

        // Anything unrecognised must come through untouched: a wrong guess
        // that hides the real message is worse than no guess.
        let odd = "mount helper error: unknown option";
        assert_eq!(friendly_cloud_error(odd), odd);
    }

    /// Monti's own call to 127.0.0.1 failing is not the cloud failing, and
    /// the raw text said "Network Error" twice while naming a localhost port.
    #[test]
    fn a_stalled_engine_call_reads_as_what_it_is() {
        let slow = super::friendly_transport_error(
            "http://127.0.0.1:37185/operations/list: Network Error: Network \
             Error: Error encountered in the status line: timed out reading \
             response",
            60,
        );
        assert!(slow.contains("60 seconds"), "{slow}");
        assert!(!slow.contains("127.0.0.1"), "localhost port leaked: {slow}");

        let dead = super::friendly_transport_error(
            "http://127.0.0.1:37185/rc/noop: Network Error: connection refused",
            5,
        );
        assert!(dead.contains("Restart engine"), "{dead}");
    }
}

#[cfg(test)]
mod mount_folder_tests {
    use super::close_mount_folder;
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("monti-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mode(p: &PathBuf) -> u32 {
        fs::metadata(p).unwrap().permissions().mode() & 0o777
    }

    /// An empty mount folder is closed against writing: a save into it while
    /// the drive is away would go to the local disk instead of the cloud,
    /// and would then keep the drive from mounting at all.
    #[test]
    fn an_empty_mount_folder_is_closed() {
        let dir = scratch("empty");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        close_mount_folder(dir.to_str().unwrap());
        assert_eq!(mode(&dir), 0o500, "an empty folder should end up read-only");
        assert!(
            fs::write(dir.join("nope.txt"), b"x").is_err(),
            "writing into a closed folder must fail"
        );
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    /// A folder with something in it is left alone. Those files are either
    /// not ours, or they are exactly what this protects — something saved
    /// while the drive was away, which the person still has to be able to
    /// reach and move somewhere real.
    #[test]
    fn a_folder_with_files_is_left_alone() {
        let dir = scratch("full");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(dir.join("stray.txt"), b"written while unmounted").unwrap();
        close_mount_folder(dir.to_str().unwrap());
        assert_eq!(mode(&dir), 0o700, "a folder with files must stay writable");
        fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod filter_tests {
    use super::{exclude_rules, filter_opt};

    /// A rule built from a folder name must match that folder and nothing
    /// else. Both properties were measured against rclone v1.75: an
    /// unanchored rule catches a same-named folder elsewhere, and an
    /// unescaped "[" turns the rule into a character class that matches
    /// nothing at all — the folder stays visible and the person is told it
    /// is hidden.
    #[test]
    fn rules_are_anchored_and_escaped() {
        assert_eq!(exclude_rules(&["Photos".into()]), vec!["/Photos/**"]);
        assert_eq!(
            exclude_rules(&["Docs/private".into()]),
            vec!["/Docs/private/**"]
        );
        // Leading and trailing slashes are the picker's, not the person's.
        assert_eq!(exclude_rules(&["/Photos/".into()]), vec!["/Photos/**"]);
        assert_eq!(
            exclude_rules(&["Photos [2024]".into(), "Mix{a,b}".into()]),
            vec![r"/Photos \[2024\]/**", r"/Mix\{a,b\}/**"]
        );
        // Nothing excluded means no filter at all: an empty rule list is a
        // different thing to rclone than no rules.
        assert!(filter_opt(&[]).is_none());
        assert!(filter_opt(&["  ".into()]).is_none());
        assert!(filter_opt(&["Photos".into()]).is_some());
    }
}

#[cfg(test)]
mod cache_limit_tests {
    use std::path::Path;

    /// The default cache cap must stay inside its bounds and must not fall
    /// back to a guess just because the cache directory is not there yet.
    #[test]
    fn default_limit_is_bounded_and_survives_missing_dir() {
        let missing = Path::new("/tmp/monti-does-not-exist-12345/vfs");
        let limit = super::default_cache_max_size(missing);
        let mb: u64 = limit.trim_end_matches('M').parse().expect("MB value");
        assert!((1024..=20480).contains(&mb), "limit out of bounds: {limit}");
        assert!(
            super::free_space(missing).is_some(),
            "free space must resolve through a missing directory"
        );
    }
}
