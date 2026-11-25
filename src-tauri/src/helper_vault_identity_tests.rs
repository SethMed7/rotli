//! The helper under a host identity: its own settings folder, and the same
//! existing-vault refusal as the app.

use crate::helper_vault::{choose_config_as, read_config, CONFIG_FILE};
use std::fs;
use tempfile::TempDir;

/// A host identity's helper refuses a folder Rotli already uses as a vault,
/// as the app does, and writes nothing. A config that names that vault
/// vouches for nothing; the standalone helper refuses nothing.
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
    assert!(choose_config_as(HOST, &path, vault.path()).is_err(), "a config naming a vault vouches for nothing");
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

/// Review should-fix: a host's helper loaded a config naming a Rotli vault
/// without refusing it, and (12:04Z item 2) couldn't serve the host app's
/// own vault. It serves exactly the folders its identity marked: one it
/// chose, and the host app's own vaults.
#[test]
fn a_host_helper_serves_only_folders_its_identity_marked() {
    const HOST: &str = "com.example.host";
    let config = TempDir::new().unwrap();
    let path = config.path().join(CONFIG_FILE);
    let vault = TempDir::new().unwrap();
    fs::create_dir(vault.path().join(".rotli")).unwrap();
    let planted = serde_json::json!({ "root": vault.path(), "id": "hv_planted" });
    fs::write(&path, planted.to_string()).unwrap();
    assert!(read_config(HOST, &path).is_none(), "a planted config serves no Rotli vault");
    assert!(read_config(crate::app_identity::STANDALONE_IDENTIFIER, &path).is_some());
    let hosts = TempDir::new().unwrap();
    fs::create_dir(hosts.path().join(".rotli")).unwrap();
    crate::app_identity::claim_for(HOST, hosts.path()).unwrap();
    assert!(choose_config_as(HOST, &path, hosts.path()).is_ok(), "the host app's own vault");
    assert!(read_config(HOST, &path).is_some());
    let plain = TempDir::new().unwrap();
    choose_config_as(HOST, &path, plain.path()).unwrap();
    fs::write(plain.path().join("note.md"), "# Mine\n").unwrap();
    assert!(crate::app_identity::claimed_by(&fs::canonicalize(plain.path()).unwrap(), HOST), "a chosen folder is marked");
    assert!(read_config(HOST, &path).is_some());
    // round 5: the helper walks below its folder when it starts, as the app's launch does
    let ours = crate::app_identity::APP_IDENTIFIER;
    choose_config_as(ours, &path, plain.path()).unwrap();
    fs::create_dir_all(plain.path().join("later").join(".rotli")).unwrap();
    let restarted = crate::helper_vault::ServedVault::new(config.path(), Box::new(|| Ok(None)));
    assert_eq!(restarted.current().is_some(), crate::app_identity::owns_shared_state(), "a Rotli vault made inside is served");
}
