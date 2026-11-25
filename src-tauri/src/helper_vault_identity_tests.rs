//! The helper under a host identity: its own settings folder, and the same
//! existing-vault refusal as the app.

use crate::helper_vault::{choose_config_as, CONFIG_FILE};
use std::fs;
use tempfile::TempDir;

/// A host identity's helper refuses a folder Rotli already uses as a vault,
/// as the app does, and writes nothing. The root it already serves stays its
/// own; the standalone helper refuses nothing.
#[test]
fn a_host_helper_refuses_a_folder_rotli_already_uses() {
    const HOST: &str = "com.example.host";
    let config = TempDir::new().unwrap();
    let path = config.path().join(CONFIG_FILE);
    let vault = TempDir::new().unwrap();
    fs::create_dir(vault.path().join(".rotli")).unwrap();
    let refused = choose_config_as(HOST, &path, vault.path()).unwrap_err();
    assert_eq!(refused, crate::app_identity::HostWords::default().existing_vault);
    assert!(!path.exists(), "a refused choice writes no config");
    let around = TempDir::new().unwrap();
    fs::create_dir_all(around.path().join("inner/.rotli")).unwrap();
    assert!(choose_config_as(HOST, &path, around.path()).is_err());
    assert!(choose_config_as(crate::app_identity::STANDALONE_IDENTIFIER, &path, vault.path()).is_ok());
    assert!(choose_config_as(HOST, &path, vault.path()).is_ok(), "the root it already serves");
    let plain = TempDir::new().unwrap();
    assert!(choose_config_as(HOST, &path, plain.path()).is_ok());
}

/// The helper's settings live where its identity says: the standalone
/// helper keeps `~/.rotli-helper`; a host's helper keeps its own folder inside
/// its own support folder, so it never serves the vault Rotli's helper chose.
#[test]
fn each_identity_keeps_its_own_helper_settings() {
    let home = std::path::Path::new("/Users/helper-owner");
    assert_eq!(
        crate::helper_token::helper_dir_for(home, crate::app_identity::STANDALONE_IDENTIFIER),
        home.join(".rotli-helper")
    );
    let host = crate::helper_token::helper_dir_for(home, "com.example.host");
    assert!(host.starts_with(crate::app_identity::support_dir_for(home, "com.example.host")), "helper settings at {host:?}");
    assert!(!host.starts_with(home.join(".rotli-helper")));
}
