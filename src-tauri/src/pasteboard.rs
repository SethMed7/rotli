//! Finder ⌘C → ⌘V. WKWebView hands a paste of copied Finder files to the page
//! as the FILE NAME in `text/plain` (no path, no bytes), so the webview cannot
//! import them on its own. The host reads the file URLs from the macOS general
//! pasteboard and issues the SAME one-shot import grants a native drop gets
//! (`ImportAuthorizations`), so a paste rides the drop's import path exactly.
//!
//! Authority. A drop grant is tied to an OS drop event; a picker grant to a
//! native dialog. A pasteboard read is webview-triggered, so this lane is
//! bounded two ways: it only ever yields files the person themselves put on
//! the pasteboard (Finder file references — never arbitrary paths from the
//! webview), and it grants at most ONCE per pasteboard change (`changeCount`).
//! A webview that calls again without a new copy gets nothing; pasting the
//! same file twice means copying it in Finder again. Files come IN, so egress
//! is unaffected.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::corpus::ImportAuthorizations;

/// The pasteboard `changeCount` the last grant was issued for.
#[derive(Default)]
pub struct PasteboardGrants(Mutex<Option<isize>>);

impl PasteboardGrants {
    /// True the first time a given pasteboard change is seen, false after.
    fn admit(&self, change_count: isize) -> bool {
        let Ok(mut last) = self.0.lock() else {
            return false;
        };
        if *last == Some(change_count) {
            return false;
        }
        *last = Some(change_count);
        true
    }
}

/// Grant one import per file reference on the pasteboard, once per change.
/// Relative paths never qualify; `authorize_native_drop` canonicalizes and
/// drops anything that is not an existing regular file (folders, broken
/// references).
fn grant_pasteboard_files(
    gate: &PasteboardGrants,
    grants: &ImportAuthorizations,
    change_count: isize,
    paths: &[PathBuf],
) -> Vec<String> {
    let files: Vec<PathBuf> = paths.iter().filter(|path| path.is_absolute()).cloned().collect();
    if files.is_empty() || !gate.admit(change_count) {
        return Vec::new();
    }
    grants.authorize_native_drop(&files)
}

/// The pasteboard's change counter and the file paths its items reference.
#[cfg(target_os = "macos")]
fn read_file_references() -> (isize, Vec<PathBuf>) {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;

    let pasteboard = NSPasteboard::generalPasteboard();
    let change_count = pasteboard.changeCount();
    // SAFETY: an AppKit-provided immutable NSString constant.
    let file_url_type = unsafe { NSPasteboardTypeFileURL };
    let paths = pasteboard
        .pasteboardItems()
        .map(|items| items.to_vec())
        .unwrap_or_default()
        .iter()
        .filter_map(|item| item.stringForType(file_url_type))
        .filter_map(|string| NSURL::URLWithString(&string))
        // Finder writes file REFERENCE urls (file:///.file/id=…); resolve them
        .filter_map(|url| url.filePathURL())
        .filter_map(|url| url.to_file_path())
        .collect();
    (change_count, paths)
}

/// Whether the pasteboard currently carries Finder file references. Reads the
/// type list only — never the contents — so the webview can decide
/// synchronously, at paste time, whether a paste is a file paste.
#[tauri::command]
pub fn clipboard_has_files() -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
        // SAFETY: an AppKit-provided immutable NSString constant.
        let file_url_type = unsafe { NSPasteboardTypeFileURL };
        NSPasteboard::generalPasteboard()
            .types()
            .is_some_and(|types| types.containsObject(file_url_type))
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// The copied Finder files as canonical paths holding fresh single-use import
/// grants; empty when nothing new was copied since the last grant.
#[tauri::command]
pub fn clipboard_file_paths(
    gate: tauri::State<'_, PasteboardGrants>,
    grants: tauri::State<'_, ImportAuthorizations>,
) -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let (change_count, paths) = read_file_references();
        grant_pasteboard_files(&gate, &grants, change_count, &paths)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (gate, grants, grant_pasteboard_files);
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_copied_file_is_granted_once_per_pasteboard_change() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("shot.png");
        fs::write(&image, b"png").unwrap();
        let gate = PasteboardGrants::default();
        let grants = ImportAuthorizations::default();

        let first = grant_pasteboard_files(&gate, &grants, 7, std::slice::from_ref(&image));
        assert_eq!(first, vec![fs::canonicalize(&image).unwrap().to_string_lossy().to_string()]);
        // the webview asking again without a new copy gets nothing
        assert!(grant_pasteboard_files(&gate, &grants, 7, std::slice::from_ref(&image)).is_empty());
        // a new copy in Finder bumps changeCount and grants again
        assert_eq!(grant_pasteboard_files(&gate, &grants, 8, std::slice::from_ref(&image)).len(), 1);
    }

    #[test]
    fn folders_missing_files_and_relative_paths_are_never_granted() {
        let dir = tempfile::tempdir().unwrap();
        let gate = PasteboardGrants::default();
        let grants = ImportAuthorizations::default();
        let missing = dir.path().join("gone.png");
        let relative = PathBuf::from("storage/shot.png");

        assert!(grant_pasteboard_files(&gate, &grants, 1, &[dir.path().to_path_buf()]).is_empty());
        assert!(grant_pasteboard_files(&gate, &grants, 2, &[missing]).is_empty());
        assert!(grant_pasteboard_files(&gate, &grants, 3, &[relative]).is_empty());
    }

    #[test]
    fn an_empty_pasteboard_does_not_spend_the_change() {
        let dir = tempfile::tempdir().unwrap();
        let image = dir.path().join("shot.png");
        fs::write(&image, b"png").unwrap();
        let gate = PasteboardGrants::default();
        let grants = ImportAuthorizations::default();

        assert!(grant_pasteboard_files(&gate, &grants, 4, &[]).is_empty());
        assert_eq!(grant_pasteboard_files(&gate, &grants, 4, &[image]).len(), 1);
    }
}
