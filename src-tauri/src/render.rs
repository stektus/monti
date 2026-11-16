//! Which rendering path WebKitGTK is asked for, and what happens when the
//! fast one does not work on this machine.
//!
//! WebKitGTK composites through DMABUF by default. Where that path cannot
//! create an EGL display — NVIDIA's proprietary driver, hybrid graphics,
//! some virtual machines — it does not fall back: it prints
//! `Could not create EGL display` and the window comes up blank, or the
//! process aborts. One such report (Manjaro, v0.4.4) is why Monti used to
//! set `WEBKIT_DISABLE_DMABUF_RENDERER=1` for everybody.
//!
//! That cost every other user smooth scrolling: with software compositing a
//! list of drive cards scrolls in visible steps. So the choice is made per
//! machine instead, in this order:
//!
//! 1. `WEBKIT_DISABLE_DMABUF_RENDERER` set by hand always wins.
//! 2. The preference saved in Settings, if it is not "auto".
//! 3. A machine where the accelerated path has already been caught failing
//!    keeps a marker file and goes straight to software.
//! 4. Otherwise a short-lived child process asks EGL for a display the way
//!    WebKit is about to. No display, no acceleration. It runs as a child
//!    because a driver that aborts instead of returning an error would
//!    otherwise take Monti down with it.
//!
//! And if WebKit fails anyway — the probe can only approximate what it
//! does — its complaint on stderr is recognised, the marker is written and
//! Monti restarts itself in software. Once: the marker keeps the next start
//! from trying again.

use std::ffi::c_void;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::AppHandle;

use crate::engine::local_stamp;

pub const DMABUF_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
/// Hidden argument that turns a copy of Monti into the EGL probe.
pub const PROBE_ARG: &str = "--egl-probe";
/// Written once the accelerated path has been seen to fail here.
const MARKER: &str = "software-rendering";
/// "auto" (or missing), "on", "off" — what Settings asked for.
const PREFERENCE: &str = "rendering";

const APP_ID: &str = "io.github.stektus.monti";

/// Set once the window exists, so the stderr watcher can ask for a clean
/// restart instead of replacing the process behind the engine's back.
static APP: OnceLock<AppHandle> = OnceLock::new();
/// One fallback per run, however many times WebKit repeats itself.
static FALLING_BACK: AtomicBool = AtomicBool::new(false);
/// The environment variable decided this run, so nothing else may.
static ENV_FORCED: AtomicBool = AtomicBool::new(false);
/// What `choose` settled on, for the problem report and for Settings.
static DECISION: OnceLock<Decision> = OnceLock::new();

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Decision {
    /// Accelerated, and nothing has objected yet.
    Accelerated,
    /// Software, because the probe failed or a fallback happened before.
    SoftwareAuto,
    /// Software or accelerated because somebody said so.
    Forced(bool),
}

impl Decision {
    pub fn accelerated(self) -> bool {
        !matches!(self, Decision::SoftwareAuto | Decision::Forced(false))
    }
}

/// `$XDG_DATA_HOME/io.github.stektus.monti`, the same folder Tauri will
/// hand out as `app_data_dir` once there is an app to ask.
///
/// Worked out by hand because this runs before the app is built: the
/// rendering path has to be picked before the first webview exists.
fn data_dir() -> Option<PathBuf> {
    let base = match std::env::var_os("XDG_DATA_HOME") {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(std::env::var_os("HOME")?).join(".local/share"),
    };
    Some(base.join(APP_ID))
}

/// Append to the same log the rest of Monti writes, before `log_line` can
/// be used: a machine that comes up blank has nothing else to send.
fn log(msg: &str) {
    let Some(dir) = data_dir() else { return };
    let _ = fs::create_dir_all(&dir);
    let mut opts = fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    if let Ok(mut f) = opts.open(dir.join("monti.log")) {
        use std::io::Write;
        let _ = writeln!(f, "{} {}", local_stamp(), msg);
    }
}

/// What Settings asked for: `Some(true)` accelerated, `Some(false)`
/// software, `None` to let Monti decide.
fn preference() -> Option<bool> {
    let raw = fs::read_to_string(data_dir()?.join(PREFERENCE)).ok()?;
    match raw.trim() {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    }
}

/// Why the accelerated path was given up on here, if it was.
pub fn fallback_reason() -> Option<String> {
    let text = fs::read_to_string(data_dir()?.join(MARKER)).ok()?;
    Some(text.trim().to_string())
}

/// Pick the rendering path and set the environment WebKitGTK reads.
///
/// Called before the Tauri builder, because the webview is created with it.
pub fn choose() -> Decision {
    let decision = decide();
    if !decision.accelerated() {
        std::env::set_var(DMABUF_ENV, "1");
    }
    let _ = DECISION.set(decision);
    decision
}

fn decide() -> Decision {
    // Somebody who sets the variable by hand is debugging; stay out of it,
    // including the automatic fallback — a restart loop is a worse answer
    // than the blank window they asked to see.
    if let Some(v) = std::env::var_os(DMABUF_ENV) {
        ENV_FORCED.store(true, Ordering::SeqCst);
        return Decision::Forced(v == "0");
    }
    if let Some(want) = preference() {
        // An explicit "on" also means "forget what failed last time".
        if want {
            if let Some(dir) = data_dir() {
                let _ = fs::remove_file(dir.join(MARKER));
            }
        }
        return Decision::Forced(want);
    }
    if fallback_reason().is_some() {
        return Decision::SoftwareAuto;
    }
    if egl_probe_passes() {
        Decision::Accelerated
    } else {
        log("no EGL display on this machine: rendering in software");
        Decision::SoftwareAuto
    }
}

/// What `choose` settled on. `Accelerated` until it has run.
pub fn decision() -> Decision {
    *DECISION.get().unwrap_or(&Decision::Accelerated)
}

/// Run the probe in a child and wait briefly for an answer. A driver that
/// hangs or aborts counts as "no".
fn egl_probe_passes() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let mut child = match std::process::Command::new(exe)
        .arg(PROBE_ARG)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return false;
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return false,
        }
    }
}

/// The child side of the probe: can EGL give a display here at all?
///
/// Three ways are tried, because WebKit does not use just one. Its DMABUF
/// renderer composites off-screen, so it asks for a surfaceless display or
/// one on a render node, and only falls back to the display server's own —
/// which is why `eglGetDisplay(EGL_DEFAULT_DISPLAY)` alone says "no" under
/// a bare X server where WebKit is perfectly happy.
///
/// Any one of them working counts as yes. The probe exists to spare the
/// obviously broken stacks a restart, not to predict WebKit exactly: when
/// it guesses wrong the stderr watcher is what catches it.
pub fn probe_exit_code() -> i32 {
    // EGL_PLATFORM_SURFACELESS_MESA and EGL_PLATFORM_GBM_KHR.
    const SURFACELESS: u32 = 0x31DD;
    const GBM: u32 = 0x31D7;

    unsafe {
        let lib = libc::dlopen(c"libEGL.so.1".as_ptr(), libc::RTLD_NOW);
        if lib.is_null() {
            return 1;
        }
        let init = libc::dlsym(lib, c"eglInitialize".as_ptr());
        if init.is_null() {
            return 1;
        }
        type Initialize = unsafe extern "C" fn(*mut c_void, *mut i32, *mut i32) -> u32;
        let init: Initialize = std::mem::transmute(init);
        let usable = |display: *mut c_void| -> bool {
            if display.is_null() {
                return false;
            }
            let (mut major, mut minor) = (0i32, 0i32);
            // EGL_TRUE is 1.
            init(display, &mut major, &mut minor) == 1
        };

        type GetPlatform = unsafe extern "C" fn(u32, *mut c_void, *const isize) -> *mut c_void;
        // eglGetPlatformDisplay is EGL 1.5; the EXT spelling is what older
        // drivers export.
        let platform = {
            let p = libc::dlsym(lib, c"eglGetPlatformDisplay".as_ptr());
            if p.is_null() {
                libc::dlsym(lib, c"eglGetPlatformDisplayEXT".as_ptr())
            } else {
                p
            }
        };
        if !platform.is_null() {
            let platform: GetPlatform = std::mem::transmute(platform);
            if usable(platform(
                SURFACELESS,
                std::ptr::null_mut(),
                std::ptr::null(),
            )) {
                return 0;
            }
            if let Some(device) = gbm_device() {
                if usable(platform(GBM, device, std::ptr::null())) {
                    return 0;
                }
            }
        }

        let get = libc::dlsym(lib, c"eglGetDisplay".as_ptr());
        if !get.is_null() {
            type GetDisplay = unsafe extern "C" fn(*mut c_void) -> *mut c_void;
            let get: GetDisplay = std::mem::transmute(get);
            // EGL_DEFAULT_DISPLAY is a null pointer; so is EGL_NO_DISPLAY
            // on the way back.
            if usable(get(std::ptr::null_mut())) {
                return 0;
            }
        }
        1
    }
}

/// A GBM device on the first render node, for the GBM half of the probe.
/// `None` on a machine with no render node, which is an answer in itself.
unsafe fn gbm_device() -> Option<*mut c_void> {
    let gbm = libc::dlopen(c"libgbm.so.1".as_ptr(), libc::RTLD_NOW);
    if gbm.is_null() {
        return None;
    }
    let create = libc::dlsym(gbm, c"gbm_create_device".as_ptr());
    if create.is_null() {
        return None;
    }
    type Create = unsafe extern "C" fn(i32) -> *mut c_void;
    let create: Create = std::mem::transmute(create);
    for node in [c"/dev/dri/renderD128", c"/dev/dri/card0"] {
        let fd = libc::open(node.as_ptr(), libc::O_RDWR | libc::O_CLOEXEC);
        if fd < 0 {
            continue;
        }
        let device = create(fd);
        if !device.is_null() {
            return Some(device);
        }
        libc::close(fd);
    }
    None
}

/// Keep the webview's complaints readable while watching them for the one
/// failure a probe cannot predict.
///
/// Monti's own stderr is replaced with a pipe; everything read from it is
/// written straight back out, so journald and a terminal see what they saw
/// before.
pub fn watch_for_egl_failure() {
    if !decision().accelerated() || ENV_FORCED.load(Ordering::SeqCst) {
        return;
    }
    unsafe {
        let mut fds = [0i32; 2];
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return;
        }
        let (read_fd, write_fd) = (fds[0], fds[1]);
        let saved = libc::dup(2);
        if saved < 0 || libc::dup2(write_fd, 2) < 0 {
            libc::close(read_fd);
            libc::close(write_fd);
            return;
        }
        libc::close(write_fd);
        std::thread::spawn(move || sniff(read_fd, saved));
    }
}

/// WebKit's words for "the accelerated path is not available here".
///
/// Deliberately narrow: Mesa's `failed to create dri2 screen` is a warning
/// on machines where everything then works, and must not cost them their
/// acceleration.
fn is_egl_failure(text: &str) -> bool {
    text.contains("Could not create EGL display")
        || text.contains("Could not create default EGL display")
        || text.contains("failed to create EGL display")
        || text.contains("EGL_BAD_PARAMETER")
        || text.contains("EGL_BAD_DISPLAY")
}

/// Whether the last syscall was cut short by a signal rather than failing.
fn interrupted() -> bool {
    std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted
}

fn sniff(read_fd: i32, saved_stderr: i32) {
    let mut buf = [0u8; 4096];
    // Enough to hold a message split across two reads.
    let mut tail = String::new();
    loop {
        let n = unsafe { libc::read(read_fd, buf.as_mut_ptr() as *mut c_void, buf.len()) };
        // A signal interrupting the read is not the end of the stream. Give
        // up here and the pipe fills up instead, and the next thing Monti
        // writes to stderr blocks the whole app.
        if n < 0 && interrupted() {
            continue;
        }
        if n <= 0 {
            return;
        }
        let n = n as usize;
        // Pass it through first: a watcher must not swallow the log.
        let mut written = 0;
        while written < n {
            let w = unsafe {
                libc::write(
                    saved_stderr,
                    buf[written..n].as_ptr() as *const c_void,
                    n - written,
                )
            };
            if w < 0 && interrupted() {
                continue;
            }
            if w <= 0 {
                break;
            }
            written += w as usize;
        }
        let chunk = String::from_utf8_lossy(&buf[..n]);
        tail.push_str(&chunk);
        if is_egl_failure(&tail) {
            fall_back_to_software(saved_stderr);
            return;
        }
        // Keep only enough for a message that straddles the next read.
        if tail.len() > 512 {
            let cut = tail.len() - 256;
            let cut = (0..=cut)
                .rev()
                .find(|i| tail.is_char_boundary(*i))
                .unwrap_or(0);
            tail = tail[cut..].to_string();
        }
    }
}

/// Remember that acceleration does not work here, then come back up
/// without it.
fn fall_back_to_software(saved_stderr: i32) {
    if FALLING_BACK.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(dir) = data_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(
            dir.join(MARKER),
            "WebKitGTK could not create an EGL display\n",
        );
        // Also as a preference, not only as a marker: a machine where
        // Settings asked for acceleration would otherwise start, fail,
        // restart and fail again for ever. Settings says who turned it off,
        // and turning it back on clears both files.
        let _ = fs::write(dir.join(PREFERENCE), "off\n");
    }
    log("the accelerated renderer failed; restarting Monti in software rendering");
    // Hand the real stderr back before leaving, or the next process inherits
    // a pipe nobody reads.
    unsafe {
        libc::dup2(saved_stderr, 2);
    }
    // A restart through Tauri stops the engine and the mounts the way a
    // normal exit does. Only if the app is not up yet is the process
    // replaced directly.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(app) = APP.get() {
            app.restart();
        }
        if Instant::now() > deadline {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // Inside an AppImage the running binary lives on a mount this process
    // holds open, so the thing to start again is the .AppImage itself.
    let again = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok());
    if let Some(exe) = again {
        use std::os::unix::process::CommandExt;
        let _ = std::process::Command::new(exe)
            .args(std::env::args_os().skip(1))
            .env(DMABUF_ENV, "1")
            .exec();
    }
    std::process::exit(1);
}

/// Let the watcher restart the app cleanly once there is an app.
pub fn remember_app(app: AppHandle) {
    let _ = APP.set(app);
}

/// Which path is in use and why, in a few words.
pub fn describe() -> String {
    match decision() {
        Decision::Accelerated => "accelerated".to_string(),
        Decision::SoftwareAuto => match fallback_reason() {
            Some(why) => format!("software (fell back: {why})"),
            None => "software (no EGL display here)".to_string(),
        },
        Decision::Forced(true) => "accelerated (asked for)".to_string(),
        Decision::Forced(false) => "software (asked for)".to_string(),
    }
}

/// One line for the problem report.
pub fn report_line() -> String {
    format!("rendering    {}\n", describe())
}

/// What Settings shows: the preference, and what it actually amounts to.
pub fn state() -> (String, bool) {
    let pref = match preference() {
        Some(true) => "on",
        Some(false) => "off",
        None => "auto",
    };
    (pref.to_string(), decision().accelerated())
}

/// Save what Settings asked for. Takes effect on the next start.
pub fn set_preference(value: &str) -> Result<(), String> {
    let dir = data_dir().ok_or("No home directory to save the setting in.")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    match value {
        "auto" => {
            let _ = fs::remove_file(dir.join(PREFERENCE));
            // "Auto" means "work it out again", including the failure that
            // was recorded last time.
            let _ = fs::remove_file(dir.join(MARKER));
        }
        "on" | "off" => {
            fs::write(dir.join(PREFERENCE), format!("{value}\n")).map_err(|e| e.to_string())?;
            if value == "on" {
                let _ = fs::remove_file(dir.join(MARKER));
            }
        }
        _ => return Err(format!("Unknown rendering preference: {value}")),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mesa_warnings_do_not_cost_acceleration() {
        // Seen on machines where WebKit then renders perfectly well.
        assert!(!is_egl_failure(
            "libEGL warning: egl: failed to create dri2 screen\n"
        ));
        assert!(!is_egl_failure("MESA-LOADER: failed to open iris\n"));
        assert!(!is_egl_failure(
            "Gtk-WARNING **: Locale not supported by C library.\n"
        ));
    }

    #[test]
    fn webkit_giving_up_is_recognised() {
        assert!(is_egl_failure(
            "Could not create EGL display: EGL_BAD_PARAMETER. Aborting...\n"
        ));
        assert!(is_egl_failure("Could not create default EGL display\n"));
    }

    #[test]
    fn a_message_split_across_reads_is_still_seen() {
        let mut tail = String::from("Could not create EGL ");
        assert!(!is_egl_failure(&tail));
        tail.push_str("display: EGL_BAD_PARAMETER");
        assert!(is_egl_failure(&tail));
    }

    #[test]
    fn decisions_know_what_they_mean() {
        assert!(Decision::Accelerated.accelerated());
        assert!(Decision::Forced(true).accelerated());
        assert!(!Decision::Forced(false).accelerated());
        assert!(!Decision::SoftwareAuto.accelerated());
    }
}
