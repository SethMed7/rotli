//! The `rotli-helper` pairing token: minted once, persisted owner-only, and
//! REFUSED rather than used when its file has become readable by anyone else.
//!
//! Split from `helper.rs` so the service module is only about the wire. The
//! rule here is the one a credential store owes its user: a secret that another
//! account on the machine can read is not a secret, and the honest response is
//! to stop with instructions — not to carry on and hope.

use std::io::Write;
use std::path::{Path, PathBuf};

pub(crate) fn token_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "couldn't find your home directory".to_string())?;
    Ok(PathBuf::from(home).join(".rotli-helper"))
}

/// Two v4 UUIDs without hyphens: 64 characters from the OS CSPRNG.
pub(crate) fn new_token() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// The persisted pairing token, minted on first use so a restart keeps the
/// pairing. `reset` (`--reset-token`) mints a new one regardless, which is also
/// the way out of a file this refuses to reuse.
pub(crate) fn load_or_create_token(dir: &Path, reset: bool) -> Result<String, String> {
    let path = dir.join("token");
    if !reset {
        if let Ok(existing) = std::fs::read_to_string(&path) {
            let existing = existing.trim().to_string();
            // a truncated or hand-edited file is replaced, never trusted short
            if existing.len() >= 32 {
                ensure_owner_only(&path)?;
                return Ok(existing);
            }
        }
    }
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("couldn't create {}: {error}", dir.display()))?;
    set_private(dir, 0o700)?;
    let token = new_token();
    write_private(&path, &token)?;
    Ok(token)
}

fn write_private(path: &Path, token: &str) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    // created private — never world-readable for even an instant
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("couldn't write {}: {error}", path.display()))?;
    file.write_all(token.as_bytes()).map_err(|error| error.to_string())?;
    // an existing file keeps its old mode through O_CREAT, so say it again —
    // and FAIL if that cannot be done. A token nothing can protect is not one.
    set_private(path, 0o600)
}

/// Refuse a pairing file another account could read or has written. Both
/// messages name the file and the two ways out, because the fix is the user's.
#[cfg(unix)]
fn ensure_owner_only(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
    let at = path.display();
    let about = std::fs::metadata(path).map_err(|error| format!("couldn't inspect {at}: {error}"))?;
    let mode = about.permissions().mode() & 0o777;
    if mode != 0o600 {
        return Err(format!(
            "{at} is mode {mode:o}, not 600 — another account on this machine could read your pairing code. Run `chmod 600 {at}`, or `rotli-helper --reset-token` to mint a new one."
        ));
    }
    // getuid reads this process's own identity; it takes no argument and cannot fail
    let ours = unsafe { libc::getuid() };
    if about.uid() != ours {
        return Err(format!(
            "{at} belongs to uid {} rather than to you (uid {ours}) — refusing to reuse another account's pairing token. Move it aside, or run `rotli-helper --reset-token`.",
            about.uid()
        ));
    }
    Ok(())
}

/// Windows: the token sits under the user's profile (`%USERPROFILE%`), whose
/// default ACL already denies other standard accounts; there is no mode bit
/// to check, so this is a documented residual: an administrator, or a profile
/// with a loosened ACL, can read it. `--reset-token` mints a fresh one.
#[cfg(not(unix))]
fn ensure_owner_only(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|error| format!("couldn't make {} owner-only: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_private(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_file_is_private_and_a_restart_reuses_it() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".rotli-helper");
        let first = load_or_create_token(&dir, false).unwrap();
        assert!(first.len() >= 32, "a pairing token must be at least 32 characters");
        let second = load_or_create_token(&dir, false).unwrap();
        assert_eq!(first, second, "a restart must keep the pairing");
        let third = load_or_create_token(&dir, true).unwrap();
        assert_ne!(first, third, "--reset-token must issue a new one");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(dir.join("token")).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600, "the token file must be owner-only");
        }
    }

    /// The whole point of the store: a readable pairing file stops the helper
    /// instead of being handed to whoever asks.
    #[cfg(unix)]
    #[test]
    fn a_world_readable_token_file_is_refused_and_reset_heals_it() {
        use std::os::unix::fs::PermissionsExt as _;
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".rotli-helper");
        let minted = load_or_create_token(&dir, false).unwrap();
        let path = dir.join("token");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let refusal = load_or_create_token(&dir, false).unwrap_err();
        assert!(refusal.contains("mode 644"), "{refusal}");
        assert!(refusal.contains("--reset-token"), "{refusal}");
        assert!(refusal.contains(&path.display().to_string()), "{refusal}");
        let healed = load_or_create_token(&dir, true).unwrap();
        assert_ne!(healed, minted, "the reset mints a token the exposed one cannot be");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "the reset must restore owner-only");
        assert_eq!(load_or_create_token(&dir, false).unwrap(), healed);
    }
}
