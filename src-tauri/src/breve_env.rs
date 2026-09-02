//! The environment every Breve runtime process gets from Rotli — one place, so
//! the supervisor, an on-demand job, a delivery test, and the themed PDF
//! renderer agree on where the vault, its storage lane, the routine config,
//! and the toolchain are (audit 2026-09-02 §1.4: an entry point that lacked
//! `ROTLI_BREVE_CONFIG` silently rendered the default palette).

use std::ffi::OsString;
use std::path::Path;

use crate::routines::{MANAGED_DIR, ROUTINE_CONFIG};

/// The variables `breve-runtime/scripts/config.ts`, `config-path.ts`, and
/// `paths.ts` resolve, plus a PATH that reaches bun and the user's tools no
/// matter how Rotli itself was launched.
pub(crate) fn breve_runtime_env(root: &Path) -> Vec<(&'static str, OsString)> {
    let home_dir = std::env::var("HOME").unwrap_or_default();
    let inherited = std::env::var("PATH").unwrap_or_default();
    let path = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{home_dir}/.bun/bin:{home_dir}/.claude/local:{home_dir}/.local/bin:{inherited}"
    );
    vec![
        ("ROTLI_BREVE_HOME", root.join(MANAGED_DIR).into()),
        ("ROTLI_BREVE_CONFIG", root.join(ROUTINE_CONFIG).into()),
        ("BREVE_KNOWLEDGE", root.as_os_str().to_os_string()),
        ("BREVE_STORAGE", root.join("storage").into()),
        ("PATH", path.into()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_env_pins_home_config_and_lanes_to_the_vault() {
        let root = Path::new("/tmp/vault");
        let env = breve_runtime_env(root);
        let get = |k: &str| env.iter().find(|(key, _)| *key == k).map(|(_, v)| v.clone()).unwrap();
        assert_eq!(get("ROTLI_BREVE_HOME"), OsString::from("/tmp/vault/.rotli/breve"));
        assert_eq!(get("ROTLI_BREVE_CONFIG"), OsString::from("/tmp/vault/.rotli/routines/config.json"));
        assert_eq!(get("BREVE_KNOWLEDGE"), OsString::from("/tmp/vault"));
        assert_eq!(get("BREVE_STORAGE"), OsString::from("/tmp/vault/storage"));
        assert!(get("PATH").to_string_lossy().contains("/.bun/bin"));
    }
}
