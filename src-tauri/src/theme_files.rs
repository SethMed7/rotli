//! Personal custom themes: one small JSON file per theme in a `themes` folder
//! beside the app settings. Rust owns where they live — the folder, the id as
//! the filename stem, the size cap and the atomic write; TypeScript owns the
//! schema and the colours (src/brand/themeEngine/themeFile.ts). Colour is not
//! a trust boundary, so it is not implemented twice. The id rule and the cap
//! are shared through scripts/fixtures/parity.json.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use tauri::Manager;

/// Byte-identical to MAX_THEME_FILE_BYTES in src/brand/themeEngine/themeFile.ts (parity.json).
pub(crate) const MAX_THEME_FILE_BYTES: usize = 64 * 1024;
const MAX_THEME_ID_CHARS: usize = 48;

/// `^[a-z0-9][a-z0-9-]{0,47}$`, the same rule as THEME_ID_PATTERN in TS.
pub(crate) fn valid_theme_id(id: &str) -> bool {
    let mut chars = id.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit() => {}
        _ => return false,
    }
    id.chars().count() <= MAX_THEME_ID_CHARS
        && chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

fn themes_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // a development build keeps its own themes, as it keeps its own settings
    let name = if cfg!(debug_assertions) { "themes.dev" } else { "themes" };
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|e| e.to_string())
}

fn theme_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_theme_id(id) {
        return Err("not a theme id".into());
    }
    Ok(dir.join(format!("{id}.json")))
}

fn is_json_object(text: &str) -> bool {
    serde_json::from_str::<Value>(text).is_ok_and(|value| value.is_object())
}

/// The ids of the theme files in `dir`, sorted. Anything else there is left alone.
fn list_in(dir: &Path) -> Result<Vec<String>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut ids: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let id = name.strip_suffix(".json")?;
            valid_theme_id(id).then(|| id.to_string())
        })
        .collect();
    ids.sort();
    Ok(ids)
}

/// A theme file's text, or None when it isn't there. A link or a file over
/// the cap is refused unread.
fn read_in(dir: &Path, id: &str) -> Result<Option<String>, String> {
    let path = theme_path(dir, id)?;
    let meta = match fs::symlink_metadata(&path) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.file_type().is_file() {
        return Err("a theme must be a plain file".into());
    }
    if meta.len() > MAX_THEME_FILE_BYTES as u64 {
        return Err("this file is too large to be a theme".into());
    }
    // raw read (outside-vault): personal themes live beside the app settings
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// Write a theme atomically. A file already there that Rotli could not read
/// is never replaced.
fn write_in(dir: &Path, id: &str, contents: &str) -> Result<(), String> {
    let path = theme_path(dir, id)?;
    if contents.len() > MAX_THEME_FILE_BYTES {
        return Err("this theme is too large to save".into());
    }
    if !is_json_object(contents) {
        return Err("a theme must be a JSON object".into());
    }
    match read_in(dir, id) {
        Ok(Some(existing)) if !is_json_object(&existing) => {
            return Err("there is a file with this name Rotli couldn't read; it was left as it is".into())
        }
        Ok(_) => {}
        Err(e) if path.exists() => return Err(e),
        Err(_) => {}
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::fsutil::atomic_write(&path, contents, ".rotli-theme-")
}

fn remove_in(dir: &Path, id: &str) -> Result<(), String> {
    let path = theme_path(dir, id)?;
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.file_type().is_file() => fs::remove_file(&path).map_err(|e| e.to_string()),
        Ok(_) => Err("a theme must be a plain file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The save panel's suggested name: the theme's name, without anything a
/// path could use, ending `.rotli-theme.json`.
fn export_file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, '/' | '\\' | ':'))
        .take(48)
        .collect();
    let clean = clean.trim().trim_start_matches('.');
    format!("{}.rotli-theme.json", if clean.is_empty() { "Theme" } else { clean })
}

#[tauri::command]
pub fn theme_files_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    list_in(&themes_dir(&app)?)
}

#[tauri::command]
pub fn theme_file_read(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    read_in(&themes_dir(&app)?, &id)
}

#[tauri::command]
pub fn theme_file_write(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    write_in(&themes_dir(&app)?, &id, &contents)
}

#[tauri::command]
pub fn theme_file_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    remove_in(&themes_dir(&app)?, &id)
}

/// Export a saved theme through the macOS save panel. `Ok(false)` when the
/// person cancels.
#[tauri::command]
pub async fn theme_file_export(app: tauri::AppHandle, id: String, name: String) -> Result<bool, String> {
    let dir = themes_dir(&app)?;
    let contents = read_in(&dir, &id)?.ok_or("that theme isn't on this Mac")?;
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let dialog_state = app.state::<crate::NativeDialogOpen>();
        let _native_dialog = dialog_state.begin();
        let mut picker = app
            .dialog()
            .file()
            .set_title("Export theme")
            .set_file_name(export_file_name(&name))
            .add_filter("Rotli theme", &["json"]);
        if let Some(parent) = app.get_webview_window("main") {
            picker = picker.set_parent(&parent);
        }
        match picker.blocking_save_file() {
            Some(target) => {
                let path = target.into_path().map_err(|e| e.to_string())?;
                crate::fsutil::atomic_write(&path, &contents, ".rotli-theme-export-")?;
                Ok(true)
            }
            None => Ok(false),
        }
    })
    .await
    .map_err(|e| format!("theme export failed ({e})"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    const FOREST: &str = r##"{"rotliTheme":1,"id":"forest","seeds":{"light":{"page":"#f6f1e7","accent":"#3f7d51"}}}"##;

    #[test]
    fn ids_are_filename_stems_and_nothing_else() {
        for id in ["a", "forest-paper", "0-9", &"a".repeat(48)] {
            assert!(valid_theme_id(id), "{id}");
        }
        for id in ["", "-a", "A", "a_b", "../x", "a/b", "a.json", " a", "é", &"a".repeat(49)] {
            assert!(!valid_theme_id(id), "{id}");
        }
    }

    #[test]
    fn every_path_stays_inside_the_themes_folder() {
        let dir = tempfile::tempdir().unwrap();
        for id in ["../escape", "/etc/passwd", "a/../../b", "..", "."] {
            assert!(read_in(dir.path(), id).is_err(), "{id}");
            assert!(write_in(dir.path(), id, FOREST).is_err(), "{id}");
            assert!(remove_in(dir.path(), id).is_err(), "{id}");
        }
        assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
    }

    #[test]
    fn write_read_list_and_remove_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let themes = dir.path().join("themes");
        assert_eq!(list_in(&themes).unwrap(), Vec::<String>::new());
        assert_eq!(read_in(&themes, "forest").unwrap(), None);
        write_in(&themes, "forest", FOREST).unwrap();
        write_in(&themes, "dusk", FOREST).unwrap();
        fs::write(themes.join("notes.txt"), "x").unwrap();
        fs::write(themes.join("Bad Name.json"), FOREST).unwrap();
        assert_eq!(list_in(&themes).unwrap(), vec!["dusk", "forest"]);
        assert_eq!(read_in(&themes, "forest").unwrap().as_deref(), Some(FOREST));
        remove_in(&themes, "forest").unwrap();
        remove_in(&themes, "forest").unwrap();
        assert_eq!(list_in(&themes).unwrap(), vec!["dusk"]);
    }

    #[test]
    fn a_file_rotli_could_not_read_is_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("forest.json"), "{ not json").unwrap();
        assert!(write_in(dir.path(), "forest", FOREST).is_err());
        assert_eq!(fs::read_to_string(dir.path().join("forest.json")).unwrap(), "{ not json");
    }

    #[test]
    fn only_a_json_object_under_the_cap_is_written_or_read() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write_in(dir.path(), "a", "[]").is_err());
        assert!(write_in(dir.path(), "a", "not json").is_err());
        let big = format!(r#"{{"pad":"{}"}}"#, "x".repeat(MAX_THEME_FILE_BYTES));
        assert!(write_in(dir.path(), "a", &big).is_err());
        fs::write(dir.path().join("big.json"), &big).unwrap();
        assert!(read_in(dir.path(), "big").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_not_followed() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside.json");
        fs::write(&outside, FOREST).unwrap();
        let themes = dir.path().join("themes");
        fs::create_dir(&themes).unwrap();
        std::os::unix::fs::symlink(&outside, themes.join("linked.json")).unwrap();
        assert!(read_in(&themes, "linked").is_err());
        assert!(remove_in(&themes, "linked").is_err());
        assert!(list_in(&themes).unwrap().is_empty());
        assert!(outside.exists());
    }

    #[test]
    fn export_names_cannot_carry_a_path() {
        assert_eq!(export_file_name("Forest Paper"), "Forest Paper.rotli-theme.json");
        assert_eq!(export_file_name("../../etc/passwd"), "etcpasswd.rotli-theme.json");
        assert_eq!(export_file_name("  "), "Theme.rotli-theme.json");
        assert_eq!(export_file_name("a\u{0}b:c"), "abc.rotli-theme.json");
    }
}
