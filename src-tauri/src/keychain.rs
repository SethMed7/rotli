//! macOS Keychain-backed secrets (Settings → AI Models). Native Keychain
//! Services via `security-framework` — the value never rides argv or `ps`,
//! never touches a config file (the CARL secrets law), and never crosses IPC
//! BACK to the webview: `get_secret` is crate-internal, and generic commands
//! only store / probe / delete. The remote-agent pairing command is the narrow
//! exception: its Keychain bundle holds independent device/client tokens and it
//! returns only the newly generated client authorization once so the user can
//! copy it; there is no later read command. Names are allowlisted so the
//! webview can't turn this into a generic keychain browser.

#[cfg(target_os = "macos")]
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

/// Off macOS there is no system keychain wired yet (the cross-platform
/// punch-list): every production read misses and every write refuses, loudly.
/// Same three signatures, so the module body compiles unchanged on Linux CI.
#[cfg(not(target_os = "macos"))]
mod passwords {
    #[derive(Debug)]
    pub struct Error(&'static str);
    impl Error {
        pub fn code(&self) -> i32 {
            -1
        }
    }
    impl std::fmt::Display for Error {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(self.0)
        }
    }
    const UNAVAILABLE: &str = "the system keychain is available only on macOS";
    pub fn get_generic_password(_service: &str, _account: &str) -> Result<Vec<u8>, Error> {
        Err(Error(UNAVAILABLE))
    }
    pub fn set_generic_password(_service: &str, _account: &str, _value: &[u8]) -> Result<(), Error> {
        Err(Error(UNAVAILABLE))
    }
    pub fn delete_generic_password(_service: &str, _account: &str) -> Result<(), Error> {
        Err(Error(UNAVAILABLE))
    }
}
#[cfg(not(target_os = "macos"))]
use passwords::{delete_generic_password, get_generic_password, set_generic_password};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The Keychain "service" every rotli secret lives under. Byte-identical to
/// ROTLI_KEYCHAIN_SERVICE in breve-runtime/scripts/keychain-names.ts (parity.json).
pub(crate) const SERVICE: &str = "rotli";

/// Named Keychain accounts. Only WEBVIEW_ALLOWED may ride the generic IPC
/// commands; the remote pairing bundle is connector-internal.
pub(crate) const BRAVE_SEARCH_API_KEY_ACCOUNT: &str = "brave-search-api-key";
pub(crate) const BREVE_RESEND_ACCOUNT: &str = "breve-resend-api-key";
pub(crate) const REMOTE_AGENT_TOKEN_ACCOUNT: &str = "remote-agent-token";
pub(crate) const WEBVIEW_ALLOWED: &[&str] = &[BRAVE_SEARCH_API_KEY_ACCOUNT, BREVE_RESEND_ACCOUNT];
const INTERNAL_ALLOWED: &[&str] = &[
    BRAVE_SEARCH_API_KEY_ACCOUNT,
    BREVE_RESEND_ACCOUNT,
    REMOTE_AGENT_TOKEN_ACCOUNT,
];

/// errSecItemNotFound — deleting a secret that isn't there is not an error.
const NOT_FOUND: i32 = -25300;
static DEV_SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn dev_secrets() -> &'static Mutex<HashMap<String, String>> {
    DEV_SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn allow(name: &str) -> Result<(), String> {
    if INTERNAL_ALLOWED.contains(&name) {
        Ok(())
    } else {
        Err(format!("unknown secret \"{name}\""))
    }
}

fn allow_webview(name: &str) -> Result<(), String> {
    if WEBVIEW_ALLOWED.contains(&name) {
        Ok(())
    } else {
        Err(format!("unknown webview secret \"{name}\""))
    }
}

/// A host build has no Keychain access: the `rotli` service is the
/// standalone app's, and a service of its own is a later decision.
/// Checked before the debug store so no build but the standalone one reaches
/// Keychain Services through this file.
fn keychain_open() -> Result<(), String> {
    if crate::app_identity::owns_shared_state() { Ok(()) } else { Err(crate::app_identity::no_keychain()) }
}

/// Crate-internal read — the transport that needs a key calls this; the
/// webview never sees the value.
pub(crate) fn get_secret(name: &str) -> Option<String> {
    keychain_open().ok()?;
    if cfg!(debug_assertions) {
        return dev_secrets()
            .lock()
            .ok()
            .and_then(|values| values.get(name).cloned());
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
    if keychain_open().is_err() || allow(name).is_err() {
        return false;
    }
    get_generic_password(SERVICE, name)
        .ok()
        .is_some_and(|bytes| bytes.iter().any(|byte| !byte.is_ascii_whitespace()))
}

pub(crate) fn store_secret(name: &str, value: &str) -> Result<(), String> {
    keychain_open()?;
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
    keychain_open()?;
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
    allow_webview(&name)?;
    store_secret(&name, &value)
}

#[tauri::command]
pub fn secret_exists(name: String) -> Result<bool, String> {
    allow_webview(&name)?;
    Ok(get_secret(&name).is_some())
}

#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    allow_webview(&name)?;
    delete_secret(&name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_names_are_refused() {
        assert!(allow(BRAVE_SEARCH_API_KEY_ACCOUNT).is_ok());
        assert!(allow(BREVE_RESEND_ACCOUNT).is_ok());
        assert!(allow(REMOTE_AGENT_TOKEN_ACCOUNT).is_ok());
        assert!(allow_webview(REMOTE_AGENT_TOKEN_ACCOUNT).is_err());
        assert!(allow("com.apple.anything").is_err());
        assert!(allow("").is_err());
    }

    /// A host build (see app_identity.rs for the command) refuses every lane before Keychain Services or the
    /// debug store; the standalone build is covered by the test below.
    #[test]
    fn a_host_build_never_reaches_the_keychain() {
        if crate::app_identity::owns_shared_state() {
            return;
        }
        let refused = Err(crate::app_identity::no_keychain());
        assert_eq!(store_secret(BRAVE_SEARCH_API_KEY_ACCOUNT, "fixture"), refused);
        assert_eq!(delete_secret(BRAVE_SEARCH_API_KEY_ACCOUNT), refused);
        assert_eq!(secret_store(BREVE_RESEND_ACCOUNT.into(), "fixture".into()), refused);
        assert_eq!(get_secret(BRAVE_SEARCH_API_KEY_ACCOUNT), None);
        assert_eq!(get_secret(REMOTE_AGENT_TOKEN_ACCOUNT), None);
        assert_eq!(secret_exists(BRAVE_SEARCH_API_KEY_ACCOUNT.into()), Ok(false));
        assert!(!production_secret_exists_for_dev(BREVE_RESEND_ACCOUNT));
        assert!(dev_secrets().lock().unwrap().is_empty(), "not even the debug store");
    }

    /// Code-path fence for both builds: Keychain Services is called from this
    /// file only, and every call sits behind `keychain_open()`; the one other
    /// way in (Breve's secret.ts, which shells out to `security`) is spawned
    /// only from functions that check the identity first.
    #[test]
    fn every_keychain_path_checks_the_identity_first() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for entry in std::fs::read_dir(&src).unwrap().flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension().is_none_or(|ext| ext != "rs") || name.contains("_tests") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let production = text.split("\nmod tests").next().unwrap_or_default();
            // the function each line belongs to, from its signature line to the next
            let mut body = String::new();
            for line in production.lines() {
                // a signature names `fn` among its first few words, whatever its visibility
                let signature = line.split_whitespace().take(4).any(|word| word == "fn");
                if signature {
                    body.clear();
                }
                body.push_str(line);
                body.push('\n');
                let stub = signature && ["get", "set", "delete"].iter().any(|verb| line.contains(&format!("fn {verb}_generic_password(")));
                if line.contains("_generic_password(") && !stub {
                    assert_eq!(name, "keychain.rs", "Keychain Services called outside keychain.rs");
                    assert!(body.contains("keychain_open()"), "an ungated Keychain call: {body}");
                }
                // Breve's Keychain helper, named in pieces so this fence isn't read as a caller
                if line.contains(&["scripts", "secret.ts"].join("/")) {
                    assert!(body.contains("owns_shared_state()"), "secret.ts spawned without the identity gate in {name}: {body}");
                }
            }
        }
    }

    #[test]
    fn brave_webview_lane_can_probe_but_never_read_the_saved_value() {
        // Debug tests use DEV_SECRETS, never the developer's live Keychain.
        if !crate::app_identity::owns_shared_state() {
            return; // a host build's refusal is the test above
        }
        store_secret(BRAVE_SEARCH_API_KEY_ACCOUNT, "fixture-brave-key").unwrap();
        assert!(secret_exists(BRAVE_SEARCH_API_KEY_ACCOUNT.to_string()).unwrap());
        delete_secret(BRAVE_SEARCH_API_KEY_ACCOUNT).unwrap();
        assert!(!secret_exists(BRAVE_SEARCH_API_KEY_ACCOUNT.to_string()).unwrap());
        // There is intentionally no Tauri `secret_get` command. Only the
        // crate-internal search adapter may call get_secret.
    }
}
