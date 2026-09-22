use super::*;
use tempfile::TempDir;

/// A served vault over a fresh folder, with a picker that answers `pick`.
fn served(pick: Option<PathBuf>) -> (TempDir, TempDir, ServedVault) {
    let vault = TempDir::new().unwrap();
    let config = TempDir::new().unwrap();
    let picked = pick.clone();
    let served = ServedVault::new(config.path(), Box::new(move || Ok(picked.clone())));
    (vault, config, served)
}

fn serving() -> (TempDir, TempDir, ServedVault) {
    let (vault, config, served) = served(None);
    served.choose(vault.path()).unwrap();
    (vault, config, served)
}

/// A verb as the bound page sends it: with the served vault's id.
fn call(served: &ServedVault, command: &str, mut args: Value) -> Result<Value, Refusal> {
    if let (Some(config), Some(map)) = (served.current(), args.as_object_mut()) {
        map.entry("vaultId").or_insert_with(|| Value::String(config.id));
    }
    served.dispatch(command, &args)
}

#[test]
fn paths_that_could_leave_the_vault_are_refused_before_the_filesystem() {
    for bad in ["../x", "wiki/../../etc", "a\\b", "C:/x", "wiki/a:stream", "x\0y"] {
        assert!(parse_rel(bad).is_err(), "{bad} must be refused");
    }
    assert_eq!(parse_rel("/wiki//a.md").unwrap(), vec!["wiki", "a.md"]);
    assert_eq!(parse_rel("").unwrap(), Vec::<String>::new());
    assert_eq!(parse_rel("./.rotli/main.json").unwrap(), vec![".rotli", "main.json"]);
}

#[test]
fn nothing_is_served_until_a_vault_is_chosen() {
    let (_vault, _config, served) = served(None);
    assert_eq!(call(&served, "vault_info", json!({})).unwrap(), Value::Null);
    let refused = call(&served, "vault_list", json!({ "path": "" })).unwrap_err();
    assert_eq!(refused.0, 409);
}

#[test]
fn the_picker_chooses_the_root_and_a_closed_picker_changes_nothing() {
    let folder = TempDir::new().unwrap();
    let (_unused, config, served) = served(Some(folder.path().to_path_buf()));
    let info = call(&served, "vault_choose", json!({})).unwrap();
    assert_eq!(info["empty"], true);
    let id = info["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("hv_"));
    // the choice is persisted owner-only and survives a restart
    let again = ServedVault::new(config.path(), Box::new(|| Ok(None)));
    assert_eq!(again.current().unwrap().id, id);
    assert_eq!(call(&again, "vault_choose", json!({})).unwrap(), Value::Null);
    assert_eq!(again.current().unwrap().id, id, "cancel keeps the vault");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = fs::metadata(config.path().join(CONFIG_FILE)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn the_same_root_keeps_its_id_and_a_new_root_gets_a_new_one() {
    let (vault, config, served) = serving();
    let first = served.current().unwrap().id;
    assert_eq!(served.choose(vault.path()).unwrap().id, first);
    let other = TempDir::new().unwrap();
    let path = config.path().join(CONFIG_FILE);
    assert_ne!(choose_config(&path, other.path()).unwrap().id, first);
    // the running helper follows a config rewritten by `--vault`
    std::thread::sleep(std::time::Duration::from_millis(20));
    assert_eq!(served.current().unwrap().root, fs::canonicalize(other.path()).unwrap());
}

#[test]
fn write_read_stat_list_and_walk_round_trip() {
    let (_vault, _config, served) = serving();
    let written = call(&served, "vault_write", json!({ "path": "wiki/ideas/a.md", "text": "# A — note\n" })).unwrap();
    assert_eq!(written["size"], "# A — note\n".len());
    assert_eq!(call(&served, "vault_read", json!({ "path": "wiki/ideas/a.md" })).unwrap(), "# A — note\n");
    let stat = call(&served, "vault_stat", json!({ "path": "wiki/ideas/a.md" })).unwrap();
    assert_eq!(stat, written, "stat and the write agree on the revision stamp");
    assert_eq!(call(&served, "vault_stat", json!({ "path": "wiki/ideas" })).unwrap()["size"], 0);
    assert_eq!(call(&served, "vault_stat", json!({ "path": "nope.md" })).unwrap(), Value::Null);
    let listed = call(&served, "vault_list", json!({ "path": "wiki" })).unwrap();
    assert_eq!(listed, json!([{ "name": "ideas", "kind": "directory" }]));
    assert_eq!(call(&served, "vault_list", json!({ "path": "missing" })).unwrap(), json!([]));
    let walked = call(&served, "vault_walk", json!({ "path": "" })).unwrap();
    let paths: Vec<&str> = walked.as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap()).collect();
    assert!(paths.contains(&"wiki") && paths.contains(&"wiki/ideas") && paths.contains(&"wiki/ideas/a.md"), "{paths:?}");
    let missing = call(&served, "vault_read", json!({ "path": "wiki/none.md" })).unwrap_err();
    assert_eq!(missing.0, 404);
}

#[test]
fn bytes_travel_base64_both_ways() {
    let (_vault, _config, served) = serving();
    let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n\x00\xff");
    call(&served, "vault_write", json!({ "path": "storage/a.png", "base64": png })).unwrap();
    let back = call(&served, "vault_read", json!({ "path": "storage/a.png", "encoding": "base64" })).unwrap();
    assert_eq!(back, png);
    assert_eq!(call(&served, "vault_write", json!({ "path": "x.md" })).unwrap_err().0, 400);
}

#[test]
fn a_stale_revision_is_refused_and_a_fresh_one_writes() {
    let (_vault, _config, served) = serving();
    // "0" = must not exist yet
    call(&served, "vault_write", json!({ "path": "a.md", "text": "one", "expectedRevision": "0" })).unwrap();
    let stale = call(&served, "vault_write", json!({ "path": "a.md", "text": "two", "expectedRevision": "0" }));
    assert_eq!(stale.unwrap_err().0, 409);
    let stat = call(&served, "vault_stat", json!({ "path": "a.md" })).unwrap();
    let revision = format!("{}:{}", stat["lastModified"], stat["size"]);
    call(&served, "vault_write", json!({ "path": "a.md", "text": "two", "expectedRevision": revision })).unwrap();
    assert_eq!(call(&served, "vault_read", json!({ "path": "a.md" })).unwrap(), "two");
}

#[test]
fn read_many_answers_in_one_call_and_names_missing_files_null() {
    let (_vault, _config, served) = serving();
    call(&served, "vault_write", json!({ "path": "a.md", "text": "A" })).unwrap();
    let answer = call(&served, "vault_read_many", json!({ "paths": ["a.md", "b.md"] })).unwrap();
    assert_eq!(answer["files"]["a.md"], "A");
    assert_eq!(answer["files"]["b.md"], Value::Null);
    assert_eq!(answer["more"], json!([]));
}

#[test]
fn move_mkdir_and_remove_follow_the_page_port() {
    let (_vault, _config, served) = serving();
    call(&served, "vault_write", json!({ "path": "wiki/_inbox/a.md", "text": "A" })).unwrap();
    call(&served, "vault_move", json!({ "from": "wiki/_inbox/a.md", "to": "wiki/Welcome/a.md" })).unwrap();
    assert_eq!(call(&served, "vault_read", json!({ "path": "wiki/Welcome/a.md" })).unwrap(), "A");
    assert_eq!(call(&served, "vault_stat", json!({ "path": "wiki/_inbox/a.md" })).unwrap(), Value::Null);
    call(&served, "vault_mkdir", json!({ "path": "chats/2026" })).unwrap();
    call(&served, "vault_mkdir", json!({ "path": "chats/2026" })).unwrap();
    assert_eq!(call(&served, "vault_remove", json!({ "path": "wiki/Welcome" })).unwrap_err().0, 409);
    call(&served, "vault_remove", json!({ "path": "wiki/Welcome/a.md" })).unwrap();
    call(&served, "vault_remove", json!({ "path": "wiki/Welcome" })).unwrap();
    call(&served, "vault_remove", json!({ "path": "wiki/Welcome" })).unwrap();
    assert_eq!(call(&served, "vault_remove", json!({ "path": "" })).unwrap_err().0, 400);
    assert_eq!(call(&served, "vault_move", json!({ "from": "nope.md", "to": "b.md" })).unwrap_err().0, 404);
}

#[test]
fn git_is_never_written() {
    let (vault, _config, served) = serving();
    fs::create_dir(vault.path().join(".git")).unwrap();
    fs::write(vault.path().join("a.md"), "A").unwrap();
    for (command, args) in [
        ("vault_write", json!({ "path": ".git/config", "text": "x" })),
        ("vault_write", json!({ "path": "wiki/.git/config", "text": "x" })),
        ("vault_write", json!({ "path": ".GIT/config", "text": "x" })),
        ("vault_mkdir", json!({ "path": ".git/hooks" })),
        ("vault_remove", json!({ "path": ".git" })),
        ("vault_move", json!({ "from": "a.md", "to": ".git/a.md" })),
        ("vault_move", json!({ "from": ".git/HEAD", "to": "b.md" })),
    ] {
        assert_eq!(call(&served, command, args).unwrap_err().0, 403, "{command}");
    }
    let walked = call(&served, "vault_walk", json!({ "path": "" })).unwrap();
    assert!(walked.as_array().unwrap().iter().all(|e| e["path"] != ".git"));
}

#[cfg(unix)]
#[test]
fn symlinks_are_neither_listed_nor_followed() {
    let (vault, _config, served) = serving();
    let outside = TempDir::new().unwrap();
    fs::write(outside.path().join("secret.md"), "outside").unwrap();
    std::os::unix::fs::symlink(outside.path(), vault.path().join("escape")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), vault.path().join("link.md")).unwrap();
    fs::write(vault.path().join("real.md"), "inside").unwrap();
    let walked = call(&served, "vault_walk", json!({ "path": "" })).unwrap();
    assert_eq!(walked.as_array().unwrap().len(), 1, "{walked}");
    assert_eq!(call(&served, "vault_list", json!({ "path": "" })).unwrap(), json!([{ "name": "real.md", "kind": "file" }]));
    for (command, args) in [
        ("vault_read", json!({ "path": "escape/secret.md" })),
        ("vault_read", json!({ "path": "link.md" })),
        ("vault_write", json!({ "path": "escape/new.md", "text": "x" })),
        ("vault_mkdir", json!({ "path": "escape/dir" })),
    ] {
        assert_eq!(call(&served, command, args).unwrap_err().0, 400, "{command}");
    }
    assert!(!outside.path().join("new.md").exists());
    assert!(!outside.path().join("dir").exists());
}

#[test]
fn a_moved_vault_is_no_longer_served() {
    let (vault, config, served) = serving();
    let path = vault.path().to_path_buf();
    drop(vault);
    assert!(!path.exists());
    let restarted = ServedVault::new(config.path(), Box::new(|| Ok(None)));
    assert_eq!(restarted.current(), None);
    drop(served);
}

#[test]
fn info_reports_an_empty_folder_the_way_the_page_does() {
    let (vault, _config, served) = serving();
    fs::write(vault.path().join(".DS_Store"), "").unwrap();
    fs::create_dir(vault.path().join(".rotli")).unwrap();
    assert_eq!(call(&served, "vault_info", json!({})).unwrap()["empty"], true);
    fs::write(vault.path().join("MAP.md"), "# MAP\n").unwrap();
    assert_eq!(call(&served, "vault_info", json!({})).unwrap()["empty"], false);
}

#[test]
fn a_root_holding_the_helpers_own_settings_is_refused() {
    let home = TempDir::new().unwrap();
    let config = home.path().join(".rotli-helper").join(CONFIG_FILE);
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    let refused = choose_config(&config, home.path()).unwrap_err();
    assert!(refused.contains("Rotli Helper's own settings"), "{refused}");
    // and a config hand-edited to point at it is not served
    fs::write(&config, json!({ "root": home.path(), "id": "hv_x" }).to_string()).unwrap();
    let served = ServedVault::new(config.parent().unwrap(), Box::new(|| Ok(None)));
    assert_eq!(served.current(), None);
}

#[test]
fn a_page_bound_to_another_vault_is_refused_before_disk() {
    let (vault, _config, served) = serving();
    for command in ["vault_write", "vault_walk", "vault_read", "vault_remove"] {
        let refused = served
            .dispatch(command, &json!({ "path": "a.md", "text": "x", "vaultId": "hv_other" }))
            .unwrap_err();
        assert_eq!(refused.0, 409, "{command}");
        assert!(refused.1.contains("vault changed"), "{command}");
    }
    let unbound = served.dispatch("vault_list", &json!({ "path": "" })).unwrap_err();
    assert_eq!(unbound.0, 409);
    assert!(!vault.path().join("a.md").exists());
}

#[test]
fn a_move_never_replaces_an_existing_note() {
    let (vault, _config, served) = serving();
    fs::write(vault.path().join("a.md"), "A").unwrap();
    fs::write(vault.path().join("b.md"), "B").unwrap();
    let refused = call(&served, "vault_move", json!({ "from": "a.md", "to": "b.md" })).unwrap_err();
    assert_eq!(refused.0, 409);
    assert_eq!(fs::read_to_string(vault.path().join("b.md")).unwrap(), "B");
    assert_eq!(fs::read_to_string(vault.path().join("a.md")).unwrap(), "A");
}

#[test]
fn a_content_revision_catches_a_same_size_same_instant_edit() {
    let (vault, _config, served) = serving();
    fs::write(vault.path().join("a.md"), "one").unwrap();
    let known = crate::fsutil::revision(b"one");
    // same size, and (on a coarse clock) the same mtime: only the content differs
    fs::write(vault.path().join("a.md"), "two").unwrap();
    let refused = call(&served, "vault_write", json!({ "path": "a.md", "text": "mine", "expectedContent": known }));
    assert_eq!(refused.unwrap_err().0, 409);
    assert_eq!(fs::read_to_string(vault.path().join("a.md")).unwrap(), "two");
    let current = crate::fsutil::revision(b"two");
    call(&served, "vault_write", json!({ "path": "a.md", "text": "mine", "expectedContent": current })).unwrap();
    assert_eq!(fs::read_to_string(vault.path().join("a.md")).unwrap(), "mine");
    assert!(!vault.path().join("a.md.lock").exists(), "the desktop's lock sidecar is released");
}

/// The page computes the same content revision in TypeScript
/// (`contentRevision`, src/lib/helperVaultDir.ts); these values are pinned there too.
#[test]
fn the_content_revision_matches_the_pages_twin() {
    assert_eq!(crate::fsutil::revision(b"one"), "fnv1a64:1a08aa1921ca5caf");
    assert_eq!(crate::fsutil::revision("# Welcome — ✓\n".as_bytes()), "fnv1a64:4b5f65bd38bda967");
    assert_eq!(crate::fsutil::revision(b""), "fnv1a64:cbf29ce484222325");
}
