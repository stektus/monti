//! The password on rclone's own config file: setting one, changing it, and
//! taking it off again.
//!
//! Monti has been able to *open* an encrypted config since 0.9.2. Being able
//! to encrypt one is the other half of the same promise: telling somebody
//! their config ought to be protected and then sending them to a terminal to
//! do it is the homework this app exists to spare them.
//!
//! Everything here is done by rclone itself (`rclone config encryption
//! set|remove`), so a config Monti encrypts is a config rclone encrypted —
//! it opens in a terminal like any other, and one encrypted in a terminal
//! opens here. Monti invents no format of its own and holds no key.
//!
//! **Passwords never reach a command line.** `ps` shows every argument on the
//! machine to every user. rclone asks for the password by running the command
//! named in `--password-command`: once for the existing password, and again —
//! with `RCLONE_PASSWORD_CHANGE=1` in its environment — for the new one when
//! changing. Monti answers those calls with its own binary, which prints what
//! it was given in its environment and exits before any window exists.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
};

/// The first line rclone writes on an encrypted config file.
pub const ENCRYPTED_MARKER: &str = "# Encrypted rclone configuration File";

/// Hidden argument: this process is Monti answering rclone, not Monti
/// starting up.
pub const ASKPASS_FLAG: &str = "--rclone-askpass";

/// Where the two passwords are handed to that call. The environment of a
/// process is readable by its own user and no one else — the same place the
/// engine's config password already travels.
pub const ENV_OLD: &str = "MONTI_CONFIG_PASS_OLD";
pub const ENV_NEW: &str = "MONTI_CONFIG_PASS_NEW";

/// Answer rclone's password prompt, if that is what this process was started
/// for. Returns true when it was, and the caller must then return without
/// building a window.
pub fn served_askpass() -> bool {
    if std::env::args().nth(1).as_deref() != Some(ASKPASS_FLAG) {
        return false;
    }
    let changing = std::env::var("RCLONE_PASSWORD_CHANGE").as_deref() == Ok("1");
    let name = if changing { ENV_NEW } else { ENV_OLD };
    if let Ok(password) = std::env::var(name) {
        // No newline of our own: rclone takes the output as it comes, and a
        // password is allowed to end in a space.
        let mut out = std::io::stdout();
        let _ = out.write_all(password.as_bytes());
        let _ = out.flush();
    }
    true
}

/// The config file rclone would use, asked of rclone rather than guessed:
/// `RCLONE_CONFIG`, a legacy `~/.rclone.conf` and the XDG path all get a
/// say, and rclone is the one that knows which won. It answers this while
/// the config is locked, because it does not have to read the file to know
/// where it is.
pub fn config_file(rclone: &Path) -> Option<PathBuf> {
    let out = Command::new(rclone)
        .args(["config", "file"])
        .env("RCLONE_ASK_PASSWORD", "false")
        .output()
        .ok()?;
    // A header line, then the path.
    let text = String::from_utf8(out.stdout).ok()?;
    let last = text.lines().last()?.trim().to_string();
    if last.is_empty() {
        return None;
    }
    Some(PathBuf::from(last))
}

/// Is this config file encrypted? Read from the file rather than asked of
/// rclone: the answer is needed exactly when the config is locked, which is
/// when rclone refuses to say anything about its contents.
pub fn is_encrypted(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; 64];
    let Ok(n) = file.read(&mut head) else {
        return false;
    };
    String::from_utf8_lossy(&head[..n]).starts_with(ENCRYPTED_MARKER)
}

/// Quote one word for rclone's `SpaceSepList`, which is CSV with spaces
/// where commas would be: a home directory with a space in it is one field,
/// not two, and an unquoted one silently becomes a command with an argument.
fn quote(word: &str) -> String {
    if word.contains(' ') || word.contains('"') {
        format!("\"{}\"", word.replace('"', "\"\""))
    } else {
        word.to_string()
    }
}

/// The `--password-command` that has Monti answer rclone.
pub fn askpass_command(exe: &Path) -> String {
    format!("{} {}", quote(&exe.to_string_lossy()), ASKPASS_FLAG)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_home_with_a_space_stays_one_word() {
        let cmd = askpass_command(Path::new("/home/some one/.local/bin/monti"));
        assert_eq!(
            cmd, "\"/home/some one/.local/bin/monti\" --rclone-askpass",
            "an unquoted path would reach rclone as two words"
        );
    }

    #[test]
    fn an_ordinary_path_is_left_alone() {
        assert_eq!(
            askpass_command(Path::new("/usr/bin/monti")),
            "/usr/bin/monti --rclone-askpass"
        );
    }

    #[test]
    fn a_quote_in_the_path_is_doubled_not_dropped() {
        assert_eq!(quote("/home/o\"d/monti"), "\"/home/o\"\"d/monti\"");
    }

    #[test]
    fn the_marker_is_read_from_the_first_line() {
        let dir = std::env::temp_dir().join(format!("monti-cfg-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let locked = dir.join("locked.conf");
        let plain = dir.join("plain.conf");
        fs::write(
            &locked,
            format!("{ENCRYPTED_MARKER}\n\nRCLONE_ENCRYPT_V0:abc\n"),
        )
        .unwrap();
        fs::write(&plain, "[drive]\ntype = drive\n").unwrap();
        assert!(is_encrypted(&locked));
        assert!(!is_encrypted(&plain));
        // A file that is not there is not a locked one.
        assert!(!is_encrypted(&dir.join("nothing.conf")));
        let _ = fs::remove_dir_all(&dir);
    }
}
