//! The drives Monti mounts, in the file manager's sidebar — the ones the
//! desktop will not show by itself.
//!
//! A GTK file manager (Files, Nemo, Caja, Thunar, PCManFM) and every GTK
//! file dialog list the mounts they find under the home directory, with an
//! eject button, all by themselves; Dolphin lists every rclone mount
//! wherever it is. Measured, not assumed: a chooser opened on a sandbox
//! home showed the drive mounted inside that home and did not show the
//! rclone drive mounted outside it, while Dolphin beside it showed both.
//!
//! So Monti stays out of the way for the usual case — its own default,
//! `~/CloudDrives/<name>`, is inside the home directory and needs no help,
//! and a second entry for the same folder would be clutter. What it does
//! fix is the drive mounted somewhere else, `/mnt/work` or `/srv/backup`,
//! which is exactly the "my rclone mount is nowhere in Files" complaint:
//! that one gets a line in `~/.config/gtk-3.0/bookmarks`.
//!
//! Someone else's file is a thing to be careful with. Monti only ever adds
//! lines it wrote and removes lines it wrote, and never rewrites the rest.
//! It also keeps a record of exactly what it added, so a crash, a kill, or
//! a drive that vanishes while Monti is not running leaves nothing behind —
//! the next start reads the record and clears what is stale.

use std::fs;
use std::path::{Path, PathBuf};

/// The two files this works with.
pub struct Places {
    /// `$XDG_CONFIG_HOME/gtk-3.0/bookmarks`.
    pub gtk: PathBuf,
    /// Monti's own record of what it put in there.
    pub record: PathBuf,
    /// The home directory, which decides whether a drive needs a line at
    /// all.
    pub home: PathBuf,
}

impl Places {
    /// The usual spots, from the directories the desktop gave this app.
    pub fn new(config_dir: &Path, home_dir: &Path, app_data_dir: &Path) -> Self {
        Places {
            gtk: config_dir.join("gtk-3.0").join("bookmarks"),
            record: app_data_dir.join("sidebar.json"),
            home: home_dir.to_path_buf(),
        }
    }

    /// Whether this drive needs a line of its own. A folder the file
    /// manager already lists does not: it would simply appear twice.
    pub fn worth_adding(&self, mount_point: &str) -> bool {
        !shown_by_the_desktop(mount_point, &self.home)
    }

    /// Put a mounted drive in the sidebar. Already there is not an error.
    pub fn add(&self, mount_point: &str, label: &str) {
        if !self.worth_adding(mount_point) {
            return;
        }
        let uri = file_uri(mount_point);
        let text = fs::read_to_string(&self.gtk).unwrap_or_default();
        if let Some(next) = gtk_with(&text, &uri, label) {
            if let Some(dir) = self.gtk.parent() {
                let _ = fs::create_dir_all(dir);
            }
            let _ = write_atomically(&self.gtk, &next);
        }
        let mut kept = self.recorded();
        if !kept.iter().any(|p| p == mount_point) {
            kept.push(mount_point.to_string());
            self.remember(&kept);
        }
    }

    /// Take one drive back out, whatever became of it.
    pub fn forget(&self, mount_point: &str) {
        let uri = file_uri(mount_point);
        if let Ok(text) = fs::read_to_string(&self.gtk) {
            let next = gtk_without(&text, &uri);
            if next != text {
                let _ = write_atomically(&self.gtk, &next);
            }
        }
        let kept: Vec<String> = self
            .recorded()
            .into_iter()
            .filter(|p| p != mount_point)
            .collect();
        self.remember(&kept);
    }

    /// Take out everything Monti ever put in — for the switch being turned
    /// off, and for quitting with the drives unmounted.
    pub fn forget_all(&self) {
        for point in self.recorded() {
            self.forget(&point);
        }
        let _ = fs::remove_file(&self.record);
    }

    /// The places Monti believes it added.
    pub fn recorded(&self) -> Vec<String> {
        fs::read_to_string(&self.record)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn remember(&self, points: &[String]) {
        if let Some(dir) = self.record.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string(points) {
            let _ = write_atomically(&self.record, &text);
        }
    }
}

/// Write beside the file and rename over it: a file manager reading the
/// sidebar at that moment sees the old file or the new one, never half.
fn write_atomically(path: &Path, text: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("monti-tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)
}

/// `/home/me/My Drive` -> `file:///home/me/My%20Drive`.
///
/// Everything outside the unreserved set is escaped, because a bookmarks
/// line ends at the first space and an XBEL attribute ends at the first
/// quote — a drive called "My Drive" would otherwise break both files.
fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for b in path.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Whether a GTK file manager puts this mount in its sidebar on its own.
///
/// The rule glib follows for a mount it finds in /proc/mounts: inside the
/// person's home directory, or in one of the places removable media are
/// mounted. Everything else — /mnt, /srv, a second disk — it ignores, and
/// that is the gap worth filling.
fn shown_by_the_desktop(mount_point: &str, home: &Path) -> bool {
    let path = Path::new(mount_point);
    path.starts_with(home) || path.starts_with("/media") || path.starts_with("/run/media")
}

/// The bookmarks file with this place in it, or None when it is already
/// there. One line, `<uri> <label>`, appended: GTK shows them in file
/// order, and the newest drive belongs at the bottom of the list.
fn gtk_with(text: &str, uri: &str, label: &str) -> Option<String> {
    if text.lines().any(|l| line_is(l, uri)) {
        return None;
    }
    let mut next = String::from(text);
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(uri);
    next.push(' ');
    next.push_str(label);
    next.push('\n');
    Some(next)
}

/// The same file without this place, and with everything else untouched.
fn gtk_without(text: &str, uri: &str) -> String {
    let mut next: String = text
        .lines()
        .filter(|l| !line_is(l, uri))
        .map(|l| format!("{l}\n"))
        .collect();
    if next.trim().is_empty() {
        next.clear();
    }
    next
}

/// A bookmarks line is the URI, then an optional label. Matching on the
/// URI alone means a drive that was renamed is still found.
fn line_is(line: &str, uri: &str) -> bool {
    line.split_whitespace().next() == Some(uri)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_space_in_the_drive_name_cannot_break_the_file() {
        let uri = file_uri("/mnt/clouds/My Drive");
        assert_eq!(uri, "file:///mnt/clouds/My%20Drive");
        let line = gtk_with("", &uri, "My Drive").unwrap();
        assert_eq!(line, "file:///mnt/clouds/My%20Drive My Drive\n");
        // A bookmarks line ends at the first space: the URI is what gets
        // opened, the rest is the label a person reads.
        assert_eq!(line.split_whitespace().next().unwrap(), uri);
    }

    #[test]
    fn the_same_drive_is_not_added_twice() {
        let once = gtk_with("", "file:///x", "X").unwrap();
        assert!(gtk_with(&once, "file:///x", "X").is_none());
    }

    #[test]
    fn removing_leaves_every_other_line_alone() {
        let text = "file:///home/me/Documents Docs\nfile:///x X\nfile:///home/me/Music\n";
        let next = gtk_without(text, "file:///x");
        assert_eq!(
            next,
            "file:///home/me/Documents Docs\nfile:///home/me/Music\n"
        );
        // Nothing of ours left, and nothing of theirs lost.
        assert_eq!(gtk_without(&next, "file:///x"), next);
    }

    #[test]
    fn the_bookmarks_file_ends_up_empty_rather_than_blank() {
        let text = gtk_with("", "file:///x", "X").unwrap();
        assert_eq!(gtk_without(&text, "file:///x"), "");
    }

    #[test]
    fn a_line_without_a_label_is_still_ours() {
        assert_eq!(gtk_without("file:///x\n", "file:///x"), "");
    }

    /// The whole point of the module: the file manager shows the usual
    /// mount by itself, and a bookmark for it would be a second copy of
    /// the same folder in the same list.
    #[test]
    fn only_the_drives_the_file_manager_hides_get_a_line() {
        let home = Path::new("/home/me");
        assert!(shown_by_the_desktop("/home/me/CloudDrives/Work", home));
        assert!(shown_by_the_desktop("/media/me/stick", home));
        assert!(shown_by_the_desktop("/run/media/me/stick", home));

        assert!(!shown_by_the_desktop("/mnt/work", home));
        assert!(!shown_by_the_desktop("/srv/backup", home));
        // Another person's home is not this person's sidebar either.
        assert!(!shown_by_the_desktop("/home/someone/Cloud", home));
    }
}
