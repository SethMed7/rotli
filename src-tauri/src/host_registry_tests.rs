//! What a host build binds at launch from its own support folder
//! (host_registry.rs), with every registry file and legacy pointer planted.

use super::*;
use crate::app_identity::{claim_for, refuse_existing_vault_for, settle_scratch_for, STANDALONE_IDENTIFIER};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

/// A host identity for tests; never a real product's ID.
const HOST: &str = "com.example.host";
const SCRATCH: &str = "Scratch vault";

/// A folder Rotli already uses as a vault, with a note in it.
fn rotli_vault(base: &Path, name: &str) -> PathBuf {
    let vault = base.join(name);
    fs::create_dir_all(vault.join(".rotli")).unwrap();
    fs::write(vault.join("memex.json"), r#"{"id":"mx_fixture"}"#).unwrap();
    fs::write(vault.join("note.md"), "# Someone's note\n").unwrap();
    fs::canonicalize(vault).unwrap()
}

fn canonical(path: PathBuf) -> PathBuf {
    fs::canonicalize(&path).unwrap_or(path)
}

/// Every root a launch would bind from `support`: each registry file it can
/// read (a release or debug build, or their backups), else the first-run
/// config.
fn bound_roots(identifier: &str, support: &Path) -> Vec<PathBuf> {
    let read: Vec<CorpusConfig> =
        REGISTRY_FILES.iter().filter_map(|name| crate::corpus::read_config_path(&support.join(name))).collect();
    let configs = match read.is_empty() {
        true => vec![first_config_for(identifier, support, &support.join(SCRATCH))],
        false => read,
    };
    configs
        .into_iter()
        .flat_map(|config| {
            let brains = config.brains.into_iter().map(|brain| brain.abs_path);
            let folders = config.folders.into_iter().map(|folder| folder.abs_path);
            std::iter::once(config.corpus.abs_path).chain(brains).chain(folders).collect::<Vec<_>>()
        })
        .map(canonical)
        .collect()
}

/// The launch, in the app's order: settle the scratch vault, secure the
/// registry, then read what to bind.
fn launch(identifier: &str, support: &Path) -> Vec<PathBuf> {
    let registry_exists = REGISTRY_FILES.iter().any(|name| support.join(name).exists());
    settle_scratch_for(identifier, support, registry_exists).unwrap();
    secure_registry_for(identifier, support).unwrap();
    bound_roots(identifier, support)
}

fn refused(folder: &Path) -> bool {
    refuse_existing_vault_for(HOST, folder).is_err()
}

/// Review hold 1: anything that can write to a host's support folder could
/// name a Rotli vault in its registry, its backup, its debug registry, or a
/// legacy pointer, and the launch bound it with no refusal. Now none of them
/// is bound, the host comes up on its own scratch vault, and the vault is
/// untouched. The standalone build still migrates its own pointers.
#[test]
fn a_host_launch_binds_no_planted_registry_or_legacy_pointer() {
    let temp = tempfile::tempdir().unwrap();
    let vault = rotli_vault(temp.path(), "someone's vault");
    let pointer = vault.to_string_lossy().to_string();
    let primary = json!({ "version": 1, "corpus": { "absPath": vault } }).to_string();
    let plants = |scratch: &Path| -> Vec<(&str, String)> {
        let library = json!({
            "version": 1,
            "corpus": { "absPath": scratch },
            "brains": [{ "id": "b", "label": "B", "absPath": vault, "perms": "read-only" }],
            "folders": [{ "id": "f", "label": "F", "absPath": vault }],
            "activeBrainId": "b"
        });
        let roots = json!({ "version": 1, "roots": [{ "id": "default", "label": "Notes", "absPath": vault }] });
        let instances = json!({ "activeId": "x", "instances": [{ "id": "x", "label": "X", "absPath": vault, "perms": "read-only" }] });
        let [root_txt, memex_root_txt, roots_json, instances_json] = crate::corpus::LEGACY_CONFIG_FILES;
        vec![
            ("corpus.json", primary.clone()),
            ("corpus.json", library.to_string()),
            ("corpus.json.bak", primary.clone()),
            ("corpus.dev.json", primary.clone()),
            (memex_root_txt, pointer.clone()),
            (root_txt, pointer.clone()),
            (roots_json, roots.to_string()),
            (instances_json, instances.to_string()),
        ]
    };
    let mut bound = Vec::new();
    for case in 0..plants(Path::new("")).len() {
        let home = tempfile::tempdir().unwrap();
        let support = home.path().join("support");
        fs::create_dir(&support).unwrap();
        let (name, body) = plants(&support.join(SCRATCH)).swap_remove(case);
        fs::write(support.join(name), body).unwrap();
        let roots = launch(HOST, &support);
        if roots.contains(&vault) || !roots.contains(&canonical(support.join(SCRATCH))) {
            bound.push(format!("{name} (case {case}): {roots:?}"));
        }
        assert_eq!(fs::read_to_string(vault.join("note.md")).unwrap(), "# Someone's note\n");
    }
    assert!(bound.is_empty(), "a planted file decided what launch binds:\n{}", bound.join("\n"));
    let support = tempfile::tempdir().unwrap();
    fs::write(support.path().join(crate::corpus::LEGACY_CONFIG_FILES[0]), &pointer).unwrap();
    let standalone = first_config_for(STANDALONE_IDENTIFIER, support.path(), &support.path().join(SCRATCH));
    assert_eq!(standalone.corpus.abs_path, vault, "the standalone build keeps its migration");
}

/// Review hold 2 and the scratch should-fix: with a registry present (one
/// that won't parse, or one that does), a Rotli vault moved to the scratch
/// path used to count as the scratch vault and was bound. So did a scratch
/// folder with a forged mark and a link inside it to a Rotli vault, with or
/// without a registry. Now each is set aside whole and the launch binds a
/// fresh scratch vault.
#[cfg(unix)]
#[test]
fn a_vault_at_the_scratch_path_is_never_bound_even_with_a_registry() {
    let registries = [None, Some("{ not json".to_string()), Some(json!({ "version": 1, "corpus": { "absPath": "SCRATCH" } }).to_string())];
    for (registry, forged) in registries.iter().flat_map(|registry| [(registry, false), (registry, true)]).skip(1) {
        let home = tempfile::tempdir().unwrap();
        let support = home.path().join("support");
        fs::create_dir(&support).unwrap();
        let planted = rotli_vault(&support, SCRATCH);
        if forged {
            let elsewhere = rotli_vault(home.path(), "someone's vault");
            fs::remove_dir_all(planted.join(".rotli")).unwrap();
            fs::remove_file(planted.join("memex.json")).unwrap();
            claim_for(HOST, &planted).unwrap();
            std::os::unix::fs::symlink(&elsewhere, planted.join("shortcut")).unwrap();
        }
        let registry = registry.clone().unwrap_or_default().replace("SCRATCH", &support.join(SCRATCH).to_string_lossy());
        if !registry.is_empty() {
            fs::write(support.join("corpus.json"), &registry).unwrap();
        }
        let roots = launch(HOST, &support);
        let scratch = canonical(support.join(SCRATCH));
        assert!(roots.contains(&scratch), "{registry}: {roots:?}");
        assert!(!scratch.join("note.md").exists(), "{registry}: the moved-in vault was bound");
        let aside: Vec<_> = fs::read_dir(&support)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("Scratch vault (set aside"))
            .collect();
        assert_eq!(aside.len(), 1, "{registry}");
        assert!(aside[0].path().join("note.md").exists(), "set aside whole");
    }
}

/// 12:04Z items 2 and 3: a host owns the folders it marked, however its
/// registry spells them (through a link a person made, or `..`), so it
/// still binds them and may pick them, or a folder inside them, again. A
/// stored link that later points at a Rotli vault binds nothing.
#[cfg(unix)]
#[test]
fn a_host_keeps_its_own_vault_however_the_registry_spells_it() {
    let home = tempfile::tempdir().unwrap();
    let support = home.path().join("support");
    fs::create_dir(&support).unwrap();
    let own = canonical(home.path().join("own"));
    fs::create_dir_all(own.join(".rotli")).unwrap();
    let own = canonical(own);
    claim_for(HOST, &own).unwrap();
    let notes = home.path().join("notes");
    std::os::unix::fs::symlink(&own, &notes).unwrap();
    let registry = json!({
        "version": 1,
        "corpus": { "absPath": notes },
        "folders": [{ "id": "f", "label": "F", "absPath": own.join("..").join("own").join(".") }]
    });
    fs::write(support.join("corpus.json"), registry.to_string()).unwrap();
    let roots = launch(HOST, &support);
    assert_eq!(roots.iter().filter(|root| **root == own).count(), 2, "{roots:?}");
    assert!(!refused(&own));
    fs::create_dir(own.join("projects")).unwrap();
    assert!(!refused(&canonical(own.join("projects"))));
    let vault = rotli_vault(home.path(), "someone's vault");
    fs::remove_file(&notes).unwrap();
    std::os::unix::fs::symlink(&vault, &notes).unwrap();
    let roots = launch(HOST, &support);
    assert!(!roots.contains(&vault), "{roots:?}");
}

/// A fresh scratch vault holds only this build's mark, and its first open
/// must still be a first run: the same folders, notes and sidecars as an
/// empty folder gets.
#[test]
fn a_marked_scratch_vault_opens_like_an_empty_one() {
    let tree = |root: &Path| -> Vec<String> {
        let mut paths: Vec<String> = walkdir(root)
            .into_iter()
            .map(|path| path.strip_prefix(root).unwrap().to_string_lossy().into_owned())
            .filter(|path| !path.starts_with(".rotli/bound-by") && !path.starts_with(".rotli/search"))
            .collect();
        paths.sort();
        paths
    };
    let empty = tempfile::tempdir().unwrap();
    let marked = tempfile::tempdir().unwrap();
    claim_for(HOST, marked.path()).unwrap();
    crate::corpus::CorpusStore::open(empty.path().to_path_buf()).unwrap();
    crate::corpus::CorpusStore::open(marked.path().to_path_buf()).unwrap();
    assert!(tree(empty.path()).len() > 1, "{:?}", tree(empty.path()));
    assert_eq!(tree(marked.path()), tree(empty.path()));
}

fn walkdir(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(root).unwrap().flatten() {
        out.push(entry.path());
        if entry.file_type().unwrap().is_dir() {
            out.extend(walkdir(&entry.path()));
        }
    }
    out
}
