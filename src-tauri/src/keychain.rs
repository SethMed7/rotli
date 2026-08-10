//! macOS Keychain-backed secrets (Settings → AI Models). Native Keychain
//! Services via `security-framework` — the value never rides argv or `ps`,
//! never touches a config file (the CARL secrets law), and never crosses IPC
//! BACK to the webview: `get_secret` is crate-internal, the commands only
//! store / probe / delete. Names are allowlisted so the webview can't turn
//! this into a generic keychain browser.

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The Keychain "service" every rotli secret lives under. Byte-identical to
/// ROTLI_KEYCHAIN_SERVICE in breve-runtime/scripts/keychain-names.ts (parity.json).
pub(crate) const SERVICE: &str = "rotli";

/// The only secret names the webview may address — every literal site in the
/// crate imports these (parity.json keychainAllowedAccounts).
pub(crate) const GEMINI_API_KEY_ACCOUNT: &str = "gemini-api-key";
pub(crate) const BRAVE_SEARCH_API_KEY_ACCOUNT: &str = "brave-search-api-key";
pub(crate) const BREVE_RESEND_ACCOUNT: &str = "breve-resend-api-key";
pub(crate) const ALLOWED: &[&str] = &[
    GEMINI_API_KEY_ACCOUNT,
    BRAVE_SEARCH_API_KEY_ACCOUNT,
    BREVE_RESEND_ACCOUNT,
];

/// errSecItemNotFound — deleting a secret that isn't there is not an error.
const NOT_FOUND: i32 = -25300;
static DEV_SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn dev_secrets() -> &'static Mutex<HashMap<String, String>> {
    DEV_SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn allow(name: &str) -> Result<(), String> {
    if ALLOWED.contains(&name) {
        Ok(())
    } else {
        Err(format!("unknown secret \"{name}\""))
    }
}

/// Crate-internal read — the transport that needs a key calls this; the
/// webview never sees the value.
pub(crate) fn get_secret(name: &str) -> Option<String> {
    if cfg!(debug_assertions) {
        return dev_secrets().lock().ok().and_then(|values| values.get(name).cloned());
    }
    get_generic_password(SERVICE, name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Debug review surfaces may report whether a production credential exists,
/// but never receive its value. Writes still go to the isolated dev store.
pub(crate) fn production_secret_exists_for_dev(name: &str) -> bool {
    if allow(name).is_err() {
        return false;
    }
    get_generic_password(SERVICE, name)
        .ok()
        .is_some_and(|bytes| bytes.iter().any(|byte| !byte.is_ascii_whitespace()))
}

pub(crate) fn store_secret(name: &str, value: &str) -> Result<(), String> {
    allow(name)?;
    let value = value.trim();
    if value.is_empty() {
        return Err("the key is empty".into());
    }
    if cfg!(debug_assertions) {
        dev_secrets()
            .lock()
            .map_err(|_| "dev keychain lock poisoned")?
            .insert(name.to_string(), value.to_string());
        return Ok(());
    }
    set_generic_password(SERVICE, name, value.as_bytes()).map_err(|e| e.to_string())
}

pub(crate) fn delete_secret(name: &str) -> Result<(), String> {
    allow(name)?;
    if cfg!(debug_assertions) {
        dev_secrets()
            .lock()
            .map_err(|_| "dev keychain lock poisoned")?
            .remove(name);
        return Ok(());
    }
    match delete_generic_password(SERVICE, name) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == NOT_FOUND => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_store(name: String, value: String) -> Result<(), String> {
    store_secret(&name, &value)
}

#[tauri::command]
pub fn secret_exists(name: String) -> Result<bool, String> {
    allow(&name)?;
    Ok(get_secret(&name).is_some())
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    delete_secret(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_names_are_refused() {
        assert!(allow(GEMINI_API_KEY_ACCOUNT).is_ok());
        assert!(allow(BRAVE_SEARCH_API_KEY_ACCOUNT).is_ok());
        assert!(allow(BREVE_RESEND_ACCOUNT).is_ok());
        assert!(allow("com.apple.anything").is_err());
        assert!(allow("").is_err());
    }

    #[test]
    fn brave_webview_lane_can_probe_but_never_read_the_saved_value() {
        // Debug tests use DEV_SECRETS, never the developer's live Keychain.
        store_secret(BRAVE_SEARCH_API_KEY_ACCOUNT, "fixture-brave-key").unwrap();
        assert!(secret_exists(BRAVE_SEARCH_API_KEY_ACCOUNT.to_string()).unwrap());
        delete_secret(BRAVE_SEARCH_API_KEY_ACCOUNT).unwrap();
        assert!(!secret_exists(BRAVE_SEARCH_API_KEY_ACCOUNT.to_string()).unwrap());
        // There is intentionally no Tauri `secret_get` command. Only the
        // crate-internal search adapter may call get_secret.
    }
}
