// Two-way folder sync: a local folder and a cloud folder kept the same in
// both directions, on top of rclone's `sync/bisync`.
//
// Mounting and syncing answer different needs and Monti offers both: a mount
// is the whole drive with no disk cost but nothing works offline; a synced
// folder is a real local copy that works on a train, at the price of
// conflicts when the same file changes on both sides.
//
// Everything here goes through the RC daemon like the rest of Monti — no
// rclone CLI, no secrets in argv.

use std::{fs, path::Path, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::engine::{log_line, rc_raw_with_timeout, utc_stamp, EngineState};

/// One folder pair. Stored in app_data/sync.json, which the backend owns:
/// this is what the product does, not how it looks, and a later version can
/// run the schedule without an open window.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPair {
    /// What the person called it; also the key.
    pub name: String,
    /// Absolute path of the local folder.
    pub local: String,
    /// Cloud side as rclone spells it: "gdrive:Documents/work".
    pub remote: String,
    /// manual | start | 15m | 1h — Monti's own scheduler, see the UI.
    #[serde(default = "default_schedule")]
    pub schedule: String,
    /// Which side wins when both changed: newer | path1 | path2.
    /// The loser is never deleted, only renamed — see `run`.
    #[serde(default = "default_conflict")]
    pub conflict_resolve: String,
    #[serde(default)]
    pub last_run: Option<String>,
    #[serde(default)]
    pub last_result: Option<String>,
    /// Let deletions through without asking. Off by default: through the RC
    /// API bisync aborts on *any* deletion (see `sync_run`), and the first
    /// time that happens the person decides — once, or for good.
    #[serde(default)]
    pub delete_without_asking: bool,
    /// False until the first (resync) run has succeeded; bisync refuses to
    /// work before one, and that run is the only moment data can be lost,
    /// so it is a deliberate answer from the person, never a default.
    #[serde(default)]
    pub initialized: bool,
    /// Folders left out of this pair, as paths under the cloud folder.
    /// Changing this list forces the pair back through the first run — see
    /// `sync_pair_save`, which is where the reason is written down.
    #[serde(default)]
    pub excludes: Vec<String>,
}

fn default_schedule() -> String {
    "manual".into()
}
fn default_conflict() -> String {
    "newer".into()
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("sync.json"))
}

pub fn load_pairs(app: &AppHandle) -> Vec<SyncPair> {
    let Some(path) = store_path(app) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<SyncPair>>(&s).ok())
        .unwrap_or_default()
}

fn save_pairs(app: &AppHandle, pairs: &[SyncPair]) -> Result<(), String> {
    let path = store_path(app).ok_or("no app data directory")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Same rule as engine.json: a temp file that is 0600 from birth, renamed
    // over the target, so a crash mid-write cannot leave half a config behind.
    // No password lives here, but the folder names someone syncs are their
    // business and not the rest of the machine's.
    let data = serde_json::to_vec_pretty(pairs).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(&tmp)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(&data)?;
            f.sync_all()
        })
        .and_then(|_| fs::rename(&tmp, &path))
        .map_err(|e| e.to_string())
}

/// Reject a pair that would fight Monti itself: syncing a folder that lives
/// inside a mounted drive means rclone copying a remote onto itself through
/// the VFS, which is slow at best and a loop at worst.
fn inside_a_mount(local: &Path) -> Option<String> {
    crate::read_proc_mounts()
        .into_iter()
        .find(|m| local.starts_with(&m.mount_point))
        .map(|m| m.mount_point)
}

#[tauri::command]
pub fn sync_pairs(app: AppHandle) -> Vec<SyncPair> {
    load_pairs(&app)
}

/// Add a pair, or replace the one with the same name.
#[tauri::command]
pub fn sync_pair_save(app: AppHandle, mut pair: SyncPair) -> Result<(), String> {
    if pair.name.trim().is_empty() {
        return Err("give this pair a name".into());
    }
    // People type "~/Documents"; only the shell expands that, and there is
    // no shell here.
    if let Some(rest) = pair.local.strip_prefix("~/") {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        pair.local = home.join(rest).to_string_lossy().into_owned();
    }
    let local = PathBuf::from(&pair.local);
    if !local.is_absolute() {
        return Err("the local folder must be an absolute path".into());
    }
    if !local.is_dir() {
        return Err(format!("{} is not a folder", local.display()));
    }
    if let Some(mount) = inside_a_mount(&local) {
        return Err(format!(
            "{} is inside the mounted drive at {mount}. Sync copies files to \
             this computer; a mounted drive is already the cloud, so pick a \
             folder outside it.",
            local.display()
        ));
    }
    if !pair.remote.contains(':') {
        return Err("the cloud side must look like \"drive:folder\"".into());
    }

    let mut pairs = load_pairs(&app);
    match pairs.iter_mut().find(|p| p.name == pair.name) {
        // Keep the history of an existing pair; the dialog only edits the
        // settings, and "never synced" must not be forgotten by a rename.
        Some(old) => {
            let keep_run = old.last_run.clone();
            let keep_result = old.last_result.clone();
            let keep_deletes = old.delete_without_asking;
            // Excluding a folder that is already synced is the one edit that
            // can destroy files. bisync compares against its own listing from
            // last time, so a folder that disappears behind a filter reads as
            // "deleted here" — and the answer to Monti's delete question
            // would wipe it from the cloud (measured: "Safety abort: too many
            // deletes (2 of 4)" after adding one exclusion). Sending the pair
            // through the first run again rebuilds that listing instead, and
            // a resync never deletes.
            let same_filter = old.excludes == pair.excludes;
            let keep_init = old.initialized && same_filter;
            *old = pair;
            old.last_run = keep_run;
            old.last_result = keep_result;
            old.initialized = keep_init;
            old.delete_without_asking = keep_deletes;
            if !same_filter {
                old.last_result = Some("folders changed — needs a first sync".into());
            }
        }
        None => pairs.push(pair),
    }
    save_pairs(&app, &pairs)
}

/// Forget a pair. Files on both sides are left exactly as they are — this
/// removes a Monti setting, not anyone's documents.
#[tauri::command]
pub fn sync_pair_remove(app: AppHandle, name: String) -> Result<(), String> {
    let mut pairs = load_pairs(&app);
    pairs.retain(|p| p.name != name);
    save_pairs(&app, &pairs)
}

/// Start a sync. Returns the daemon's job id: bisync of a real folder takes
/// minutes, so it runs as an async job and the UI follows `sync_progress`.
///
/// `resync` is the first run of a pair. It is what makes bisync usable at
/// all — without a baseline listing it refuses to run — and it is the only
/// run that can overwrite one side with the other, which is why the choice
/// (`resync_mode`) comes from the person, not from us.
#[tauri::command]
pub async fn sync_run(
    app: AppHandle,
    state: State<'_, EngineState>,
    name: String,
    resync: bool,
    resync_mode: Option<String>,
    dry_run: bool,
    force: bool,
) -> Result<u64, String> {
    let pair = load_pairs(&app)
        .into_iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("no sync pair called \"{name}\""))?;
    if !pair.initialized && !resync {
        return Err("NEEDS_RESYNC".into());
    }
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };

    let mut body = json!({
        "path1": pair.local,
        "path2": pair.remote,
        "dryRun": dry_run,
        // The loser of a conflict is renamed, never deleted: a sync that can
        // eat the version you wanted is not worth having.
        "conflictResolve": pair.conflict_resolve,
        "conflictLoser": "pathname",
        "conflictSuffix": "conflict",
        "compare": "size,modtime",
        // Recover from an interrupted run instead of demanding a fresh
        // resync — closing a laptop lid must not cost a full re-baseline.
        "recover": true,
        "resilient": true,
        "maxLock": "15m",
        "createEmptySrcDirs": true,
        // Deletions. Through the RC API bisync's safety threshold reads as
        // 0%, so it aborts with "too many deletes" on a single removed file
        // — measured, and `_config: {MaxDelete: …}` does not change it. The
        // way through is `force`, which is exactly the kind of thing a
        // person should say out loud, so the UI asks the first time and
        // remembers the answer per pair.
        "force": force || pair.delete_without_asking,
        "_async": true,
    });
    if resync {
        body["resync"] = json!(true);
        body["resyncMode"] = json!(resync_mode.unwrap_or_else(|| "newer".into()));
    }
    // Folders the person left out. The filter must be identical on every run
    // of a pair, including the first one — bisync compares this run's listing
    // against the last one, so a filter that comes and goes looks like files
    // appearing and vanishing.
    if let Some(filter) = crate::engine::filter_opt(&pair.excludes) {
        body["_filter"] = filter;
    }

    let v = rc_raw_with_timeout(port, &pass, "sync/bisync", &body, 20)?;
    let jobid = v
        .get("jobid")
        .and_then(Value::as_u64)
        .ok_or("the engine did not return a job id")?;
    log_line(
        &app,
        &format!(
            "sync \"{name}\" started (job {jobid}{}{})",
            if resync { ", first run" } else { "" },
            if dry_run { ", dry run" } else { "" }
        ),
    );
    Ok(jobid)
}

/// How a running sync is doing, and how it ended.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    finished: bool,
    success: bool,
    error: String,
    /// Bytes moved so far, and files done — straight from the job's own
    /// stats group, so two syncs at once do not report each other's work.
    bytes: u64,
    transfers: u64,
    checks: u64,
    eta: Option<u64>,
}

/// "too many deletes" is all `job/status` says; the count is only in the
/// daemon's own log, and the count is the whole point when asking someone
/// whether to go ahead.
fn delete_abort_detail(app: &AppHandle) -> Option<(u64, u64)> {
    let tail = crate::engine::engine_log_path(app).and_then(|p| fs::read_to_string(p).ok())?;
    parse_delete_abort(&tail)
}

/// Pull "2 of 3" out of the daemon's log. Split out from the file reading so
/// the shape of that line — which comes from rclone, not from us — is pinned
/// by a test.
fn parse_delete_abort(log: &str) -> Option<(u64, u64)> {
    let line = log.lines().rev().find(|l| l.contains("too many deletes"))?;
    // …too many deletes (>0%, 2 of 3) on Path1 "…"
    let inside = line.split_once('(')?.1.split_once(')')?.0;
    let mut parts = inside.split_whitespace(); // ">0%," "2" "of" "3"
    parts.next()?;
    let n = parts.next()?.parse().ok()?;
    parts.next()?;
    let total = parts.next()?.parse().ok()?;
    Some((n, total))
}

#[tauri::command]
pub async fn sync_progress(
    app: AppHandle,
    state: State<'_, EngineState>,
    jobid: u64,
) -> Result<SyncProgress, String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    let status = rc_raw_with_timeout(port, &pass, "job/status", &json!({ "jobid": jobid }), 5)?;
    let stats = rc_raw_with_timeout(
        port,
        &pass,
        "core/stats",
        &json!({ "group": format!("job/{jobid}") }),
        5,
    )
    .unwrap_or_else(|_| json!({}));
    let num = |v: &Value, key: &str| v.get(key).and_then(Value::as_u64).unwrap_or(0);
    let mut error = status["error"].as_str().unwrap_or("").to_string();
    // Turn the daemon's four words into something the UI can act on.
    if error.contains("too many deletes") {
        error = match delete_abort_detail(&app) {
            Some((n, total)) => format!("TOO_MANY_DELETES:{n}:{total}"),
            None => "TOO_MANY_DELETES:0:0".into(),
        };
    }
    Ok(SyncProgress {
        finished: status["finished"].as_bool() == Some(true),
        success: status["success"].as_bool() == Some(true),
        error,
        bytes: num(&stats, "bytes"),
        transfers: num(&stats, "transfers"),
        checks: num(&stats, "checks"),
        eta: stats.get("eta").and_then(Value::as_u64),
    })
}

/// Record how a run ended, so a card can say "synced 10 minutes ago" instead
/// of nothing at all.
#[tauri::command]
pub fn sync_finished(
    app: AppHandle,
    name: String,
    ok: bool,
    was_resync: bool,
    detail: String,
    remember_deletes: bool,
) -> Result<(), String> {
    let mut pairs = load_pairs(&app);
    if let Some(p) = pairs.iter_mut().find(|p| p.name == name) {
        p.last_run = Some(utc_stamp());
        p.last_result = Some(if ok { "ok".into() } else { detail.clone() });
        if ok && was_resync {
            p.initialized = true;
        }
        if remember_deletes {
            p.delete_without_asking = true;
        }
    }
    log_line(
        &app,
        &format!(
            "sync \"{name}\" {}",
            if ok {
                "finished".into()
            } else {
                format!("failed: {detail}")
            }
        ),
    );
    save_pairs(&app, &pairs)
}

/// Stop a running sync. bisync leaves a lock behind, which `maxLock` expires
/// and `recover` cleans up on the next run.
#[tauri::command]
pub async fn sync_stop(state: State<'_, EngineState>, jobid: u64) -> Result<(), String> {
    let (port, pass) = {
        let eng = state.0.lock().unwrap();
        (eng.port, eng.pass.clone())
    };
    rc_raw_with_timeout(port, &pass, "job/stop", &json!({ "jobid": jobid }), 5)?;
    Ok(())
}

/// Files a conflict left behind on the local side. rclone renames the losing
/// version to "<name>.conflict<n>", so these are the moments a person has to
/// decide about — and the only way to find them is to look.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// The renamed loser, absolute path.
    loser: String,
    /// The file that won and kept the original name, if it is still there.
    winner: String,
    size: u64,
}

fn walk_conflicts(dir: &Path, out: &mut Vec<Conflict>, depth: usize) {
    if depth > 12 || out.len() > 500 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_conflicts(&path, out, depth + 1);
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(cut) = file_name.find(".conflict") else {
            continue;
        };
        let winner = path.with_file_name(&file_name[..cut]);
        out.push(Conflict {
            loser: path.to_string_lossy().into_owned(),
            winner: if winner.exists() {
                winner.to_string_lossy().into_owned()
            } else {
                String::new()
            },
            size: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
}

#[tauri::command]
pub fn sync_conflicts(app: AppHandle, name: String) -> Result<Vec<Conflict>, String> {
    let pair = load_pairs(&app)
        .into_iter()
        .find(|p| p.name == name)
        .ok_or_else(|| format!("no sync pair called \"{name}\""))?;
    let mut out = Vec::new();
    walk_conflicts(Path::new(&pair.local), &mut out, 0);
    Ok(out)
}

/// Settle one conflict on the local side; the next sync carries the decision
/// to the cloud.
///
/// - `winner`: throw the renamed copy away, keep what is there now.
/// - `loser`: put the renamed copy back under the original name.
/// - `both`: leave both files, just stop calling it a conflict.
#[tauri::command]
pub fn sync_resolve(app: AppHandle, loser: String, keep: String) -> Result<(), String> {
    settle_conflict(Path::new(&loser), &keep)?;
    log_line(&app, &format!("conflict settled ({keep})"));
    Ok(())
}

/// The file half of `sync_resolve`, split out so the three outcomes can be
/// tested without a running app — they move someone's documents around.
fn settle_conflict(loser_path: &Path, keep: &str) -> Result<(), String> {
    let file_name = loser_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("not a file")?;
    let cut = file_name.find(".conflict").ok_or("not a conflict copy")?;
    let original = loser_path.with_file_name(&file_name[..cut]);

    match keep {
        "winner" => fs::remove_file(loser_path).map_err(|e| e.to_string())?,
        "loser" => {
            if original.exists() {
                fs::remove_file(&original).map_err(|e| e.to_string())?;
            }
            fs::rename(loser_path, &original).map_err(|e| e.to_string())?;
        }
        "both" => {
            // Keep the copy, but under a name that is not a conflict marker,
            // or the next run would treat it as one again.
            let stem = &file_name[..cut];
            let (base, ext) = match stem.rfind('.') {
                Some(i) => (&stem[..i], &stem[i..]),
                None => (stem, ""),
            };
            let kept = loser_path.with_file_name(format!("{base} (copy){ext}"));
            fs::rename(loser_path, &kept).map_err(|e| e.to_string())?;
        }
        _ => return Err("keep must be winner, loser or both".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    /// Settling a conflict moves someone's documents, so each of the three
    /// answers is pinned: nothing may be lost by accident, and "keep both"
    /// must not leave a name the next sync reads as a conflict again.
    #[test]
    fn settling_a_conflict_does_what_the_button_says() {
        let dir = std::env::temp_dir().join(format!("monti-conflict-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let winner = dir.join("notes.txt");
        let loser = dir.join("notes.txt.conflict1");

        // keep what is there now
        fs::write(&winner, "cloud").unwrap();
        fs::write(&loser, "laptop").unwrap();
        super::settle_conflict(&loser, "winner").unwrap();
        assert!(!loser.exists());
        assert_eq!(fs::read_to_string(&winner).unwrap(), "cloud");

        // keep the renamed copy instead
        fs::write(&loser, "laptop").unwrap();
        super::settle_conflict(&loser, "loser").unwrap();
        assert!(!loser.exists());
        assert_eq!(fs::read_to_string(&winner).unwrap(), "laptop");

        // keep both, under a name that is not a conflict marker
        fs::write(&winner, "cloud").unwrap();
        fs::write(&loser, "laptop").unwrap();
        super::settle_conflict(&loser, "both").unwrap();
        assert!(!loser.exists());
        assert_eq!(fs::read_to_string(&winner).unwrap(), "cloud");
        let kept = dir.join("notes (copy).txt");
        assert_eq!(fs::read_to_string(&kept).unwrap(), "laptop");
        assert!(!kept.to_string_lossy().contains(".conflict"));

        assert!(super::settle_conflict(&winner, "winner").is_err()); // not a conflict copy
        let _ = fs::remove_dir_all(&dir);
    }

    /// The count only exists in the daemon's log line, so its exact shape is
    /// part of the contract. This is a real line, captured from rclone
    /// v1.75.0 refusing to propagate a deletion.
    #[test]
    fn reads_the_delete_count_out_of_the_log() {
        let log = "2026/08/11 08:30:08 NOTICE: 2026/08/11 08:30:08 ERROR : Safety abort: \
                   too many deletes (>0%, 2 of 3) on Path1 \"/home/u/work/\". \
                   Run with --force if desired.\n";
        assert_eq!(super::parse_delete_abort(log), Some((2, 3)));
        assert_eq!(super::parse_delete_abort("nothing to see"), None);
    }
}
