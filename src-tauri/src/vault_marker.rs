//! Keep a vault's root marker (`memex.json`) in place when the same folder is
//! also open in other notes apps (the maintainer, 2026-09-23: "my vault should be
//! usable in ZenNotes, Obsidian, and Rotli all at the same time").
//!
//! The marker is what makes a folder a Rotli vault: its `mx_` id keys the saved
//! location, Breve, and the vault layout chosen at open. Other apps may treat
//! it as loose clutter. ZenNotes 2.x, on every launch and vault open, moves each
//! visible non-Markdown file at the root into `assets/` (and sweeps its legacy
//! `attachements/` and `_assets/` folders) — unless the folder has `.obsidian/`,
//! which it treats as another app's vault and leaves alone. Every app leaves
//! dot-entries alone.
//!
//! So, on every writable open of a folder Rotli has used before:
//! - a vault gets `.obsidian/` (the guard those sweeps honour; Obsidian fills it
//!   in when it first opens the folder) and a hidden backup of its marker in
//!   `.rotli/memex.json`;
//! - a missing marker is healed — moved back from a sweep folder (with the
//!   contract files swept alongside it), else restored from the backup — rather
//!   than the folder silently opening as a plain folder and gaining scaffolding.
//!
//! Plain Markdown and Obsidian folders never get a marker: they are adopted in
//! place without one.

use std::fs;
use std::path::{Path, PathBuf};

const MARKER: &str = "memex.json";
const BACKUP: &str = ".rotli/memex.json";
const GUARD: &str = ".obsidian";
/// Where other apps move loose root files (ZenNotes: `assets/`, plus the two
/// legacy attachment folders it still sweeps).
const SWEEP_DIRS: [&str; 3] = ["assets", "attachements", "_assets"];
/// Contract files that live beside the marker at the root and get swept with it.
const COMPANIONS: [&str; 3] = ["users.json", "memex.local.json", "identities.local.json"];

/// A regular (non-symlink) file holding a valid `mx_` marker.
fn marker_at(path: &Path) -> bool {
    let regular = fs::symlink_metadata(path).map(|m| m.file_type().is_file()).unwrap_or(false);
    regular
        && fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|value| value.get("id").and_then(|id| id.as_str()).map(|id| id.starts_with("mx_")))
            .unwrap_or(false)
}

fn used_by_rotli(root: &Path) -> bool {
    fs::symlink_metadata(root.join(".rotli")).map(|m| m.is_dir()).unwrap_or(false)
}

/// The sweep folder holding this root's displaced marker, if any.
fn swept_marker_dir(root: &Path) -> Option<PathBuf> {
    SWEEP_DIRS
        .iter()
        .map(|dir| root.join(dir))
        .find(|dir| {
            fs::symlink_metadata(dir).map(|m| m.is_dir()).unwrap_or(false) && marker_at(&dir.join(MARKER))
        })
}

/// Read-only: the root lost its marker but `heal` can bring it back. Folder
/// inspection uses it so a displaced vault reads as a vault, not a plain folder.
pub(crate) fn recoverable(root: &Path) -> bool {
    !root.join(MARKER).exists()
        && used_by_rotli(root)
        && (swept_marker_dir(root).is_some() || marker_at(&root.join(BACKUP)))
}

/// Heal a displaced marker, then protect it. Never overwrites an existing root
/// file and never touches a folder Rotli has not used. Best effort: a failure
/// leaves the folder as it was and the open continues.
pub(crate) fn heal(root: &Path) -> Result<(), String> {
    if !used_by_rotli(root) {
        return Ok(());
    }
    if !root.join(MARKER).exists() {
        if let Some(dir) = swept_marker_dir(root) {
            for name in std::iter::once(MARKER).chain(COMPANIONS) {
                let from = dir.join(name);
                let to = root.join(name);
                if fs::symlink_metadata(&from).map(|m| m.is_file()).unwrap_or(false) && !to.exists() {
                    fs::rename(&from, &to).map_err(|e| format!("restore {name}: {e}"))?;
                }
            }
            // the sweep made the folder for our files; leave it only if it holds others
            let _ = fs::remove_dir(&dir);
        } else if marker_at(&root.join(BACKUP)) {
            let text = fs::read_to_string(root.join(BACKUP)).map_err(|e| format!("read marker backup: {e}"))?;
            crate::fsutil::atomic_write(&root.join(MARKER), &text, ".memex-json-")?;
        }
    }
    if !marker_at(&root.join(MARKER)) {
        return Ok(());
    }
    let text = fs::read_to_string(root.join(MARKER)).map_err(|e| format!("read {MARKER}: {e}"))?;
    if fs::read_to_string(root.join(BACKUP)).ok().as_deref() != Some(text.as_str()) {
        crate::fsutil::atomic_write(&root.join(BACKUP), &text, ".memex-json-")?;
    }
    if !root.join(GUARD).exists() {
        fs::create_dir(root.join(GUARD)).map_err(|e| format!("create {GUARD}: {e}"))?;
    }
    Ok(())
}

/// `heal` for the open and connect paths: a heal failure is logged and the
/// folder opens exactly as it would have without it.
pub(crate) fn heal_best_effort(root: &Path) {
    if let Err(e) = heal(root) {
        eprintln!("[rotli] vault marker heal skipped: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = r#"{"id":"mx_test","contract":"3.8"}"#;

    fn vault() -> tempfile::TempDir {
        let temp = tempfile::TempDir::new().unwrap();
        fs::create_dir(temp.path().join(".rotli")).unwrap();
        fs::write(temp.path().join(MARKER), ID).unwrap();
        fs::write(temp.path().join("users.json"), "{}").unwrap();
        temp
    }

    /// What ZenNotes 2.54 did to a vault on 2026-09-23.
    fn sweep_into_assets(root: &Path) {
        fs::create_dir(root.join("assets")).unwrap();
        for name in [MARKER, "users.json"] {
            fs::rename(root.join(name), root.join("assets").join(name)).unwrap();
        }
    }

    #[test]
    fn a_vault_gains_the_sweep_guard_and_a_hidden_backup() {
        let temp = vault();
        heal(temp.path()).unwrap();
        assert!(temp.path().join(GUARD).is_dir());
        assert_eq!(fs::read_to_string(temp.path().join(BACKUP)).unwrap(), ID);
    }

    #[test]
    fn a_marker_swept_into_assets_moves_back_with_its_companions() {
        let temp = vault();
        sweep_into_assets(temp.path());
        assert!(recoverable(temp.path()));
        heal(temp.path()).unwrap();
        assert!(crate::corpus::is_memex_root(temp.path()));
        assert!(temp.path().join("users.json").is_file());
        assert!(!temp.path().join("assets").exists());
    }

    #[test]
    fn the_sweep_folder_stays_when_it_holds_the_other_apps_files() {
        let temp = vault();
        sweep_into_assets(temp.path());
        fs::write(temp.path().join("assets/photo.png"), "png").unwrap();
        heal(temp.path()).unwrap();
        assert!(temp.path().join("assets/photo.png").is_file());
    }

    #[test]
    fn a_deleted_marker_comes_back_from_the_backup() {
        let temp = vault();
        heal(temp.path()).unwrap();
        fs::remove_file(temp.path().join(MARKER)).unwrap();
        assert!(recoverable(temp.path()));
        heal(temp.path()).unwrap();
        assert_eq!(fs::read_to_string(temp.path().join(MARKER)).unwrap(), ID);
    }

    #[test]
    fn a_folder_rotli_never_used_is_left_untouched() {
        let temp = tempfile::TempDir::new().unwrap();
        fs::create_dir(temp.path().join("assets")).unwrap();
        fs::write(temp.path().join("assets").join(MARKER), ID).unwrap();
        assert!(!recoverable(temp.path()));
        heal(temp.path()).unwrap();
        assert!(!temp.path().join(MARKER).exists());
        assert!(!temp.path().join(GUARD).exists());
    }

    #[test]
    fn a_plain_folder_gets_no_marker_and_no_guard() {
        let temp = tempfile::TempDir::new().unwrap();
        fs::create_dir(temp.path().join(".rotli")).unwrap();
        fs::write(temp.path().join("note.md"), "# Note\n").unwrap();
        assert!(!recoverable(temp.path()));
        heal(temp.path()).unwrap();
        assert!(!temp.path().join(MARKER).exists());
        assert!(!temp.path().join(GUARD).exists());
    }

    #[test]
    fn an_existing_root_file_is_never_overwritten() {
        let temp = vault();
        sweep_into_assets(temp.path());
        fs::write(temp.path().join("users.json"), "mine").unwrap();
        heal(temp.path()).unwrap();
        assert_eq!(fs::read_to_string(temp.path().join("users.json")).unwrap(), "mine");
        assert!(temp.path().join("assets/users.json").is_file());
    }
}
