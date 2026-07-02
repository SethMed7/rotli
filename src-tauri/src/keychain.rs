//! macOS Keychain-backed secrets (Settings → AI Models). Native Keychain
//! Services via `security-framework` — the value never rides argv or `ps`,
//! never touches a config file (the CARL secrets law), and never crosses IPC
//! BACK to the webview: `get_secret` is crate-internal, the commands only
//! store / probe / delete. Names are allowlisted so the webview can't turn
//! this into a generic keychain browser.

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

/// The Keychain "service" every rotli secret lives under.
const SERVICE: &str = "rotli";

/// The only secret names the webview may address.
const ALLOWED: &[&str] = &["gemini-api-key"];

/// errSecItemNotFound — deleting a secret that isn't there is not an error.
const NOT_FOUND: i32 = -25300;

fn allow(name: &str) -> Result<(), String> {
    if ALLOWED.contains(&name) {
        Ok(())
    } else {
        Err(format!("unknown secret \"{name}\""))
    }
}

/// Crate-internal read — the transport that needs the key (chat.rs) calls this;
/// the webview never sees the value.
pub(crate) fn get_secret(name: &str) -> Option<String> {
    get_generic_password(SERVICE, name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[tauri::command]
pub fn secret_store(name: String, value: String) -> Result<(), String> {
    allow(&name)?;
    let value = value.trim();
    if value.is_empty() {
        return Err("the key is empty".into());
    }
    set_generic_password(SERVICE, &name, value.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_exists(name: String) -> Result<bool, String> {
    allow(&name)?;
    Ok(get_secret(&name).is_some())
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    allow(&name)?;
    match delete_generic_password(SERVICE, &name) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == NOT_FOUND => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_names_are_refused() {
        assert!(allow("gemini-api-key").is_ok());
        assert!(allow("com.apple.anything").is_err());
        assert!(allow("").is_err());
    }
}
