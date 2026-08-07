//! Machine-level preferences that must exist before a notes folder does.
//!
//! Vault knowledge remains inside `<vault>/.rotli/`; this sidecar contains only
//! app-shell/onboarding preferences owned by the installation. The frontend
//! owns the JSON shape, just as it owns `.rotli/settings.json`.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::Manager;

const MAX_SETTINGS_BYTES: usize = 2 * 1024 * 1024;

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let name = if cfg!(debug_assertions) {
        "app-settings.dev.json"
    } else {
        "app-settings.json"
    };
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(name))
        .map_err(|e| e.to_string())
}

fn validate(contents: &str) -> Result<(), String> {
    if contents.len() > MAX_SETTINGS_BYTES {
        return Err("app settings are too large".into());
    }
    let value: Value = serde_json::from_str(contents).map_err(|e| format!("invalid app settings: {e}"))?;
    if !value.is_object() {
        return Err("app settings must be a JSON object".into());
    }
    Ok(())
}

#[tauri::command]
pub fn app_settings_read(app: tauri::AppHandle) -> Result<String, String> {
    let path = settings_file(&app)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn app_settings_write(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    validate(&contents)?;
    let path = settings_file(&app)?;
    let parent = path.parent().ok_or("no app config directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    crate::fsutil::atomic_write(&path, &contents, ".rotli-app-settings-")
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_an_object_and_refuses_other_json_shapes() {
        assert!(validate(r#"{"onboarded":true}"#).is_ok());
        assert!(validate("[]").is_err());
        assert!(validate("not json").is_err());
    }
}
