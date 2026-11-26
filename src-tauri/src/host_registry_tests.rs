//! What a host build binds at launch from its own support folder
//! (host_registry.rs), with every registry file and legacy pointer planted.

use super::*;
use crate::app_identity::{claim_for, owns_shared_state, refuse_existing_vault_for, settle_scratch_for, STANDALONE_IDENTIFIER};
use crate::corpus::{CorpusRegistry, CorpusRoot, CorpusStore, DEFAULT_ROOT_ID};
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
    // round 5 nit: a linked support folder vouches for no registry in it,
    // even one that would pass unchanged
    fs::write(support.join("corpus.json"), json!({ "version": 1, "corpus": { "absPath": own } }).to_string()).unwrap();
    let linked = home.path().join("linked support");
    std::os::unix::fs::symlink(&support, &linked).unwrap();
    assert!(secure_registry_for(HOST, &linked).is_err(), "a registry behind a linked support folder was vetted");
}

/// Round 5: commands after launch re-read the registry (the current vault a
/// choice, switch, new vault or copy moves or carries settings from, the
/// connected vault a refresh reopens, the roots the chat and note commands
/// write into), and anything that writes the support folder can rewrite it
/// while the app runs. A host build takes only roots it has open; the
/// standalone build keeps what its registry names. The headless CLI walks
/// below each root once per process, as the launch does, so a Rotli vault
/// made inside one of the host's own folders is dropped there too.
#[test]
fn after_launch_a_host_takes_only_the_roots_it_has_open() {
    let home = tempfile::tempdir().unwrap();
    let mark = |name: &str| {
        let folder = canonical(home.path().join(name));
        fs::create_dir_all(&folder).unwrap();
        let folder = canonical(folder);
        claim_for(HOST, &folder).unwrap();
        claim_for(crate::app_identity::APP_IDENTIFIER, &folder).unwrap();
        folder
    };
    crate::memex::scaffold_memex(&home.path().join("work")).unwrap();
    let (own, work) = (mark("own"), mark("work"));
    let vault = rotli_vault(home.path(), "someone's vault");
    let open_state = |with_default: bool| {
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.into());
        if with_default {
            registry.insert(DEFAULT_ROOT_ID.into(), CorpusStore::open(own.clone()).unwrap()).unwrap();
        }
        let mut connected = CorpusStore::open(work.clone()).unwrap();
        connected.set_perms_read_only(true);
        registry.insert("work".into(), connected).unwrap();
        crate::corpus::CorpusState(std::sync::Mutex::new(registry))
    };
    let state = open_state(true);
    let mut holes = Vec::new();
    for (id, open) in [(DEFAULT_ROOT_ID, &own), ("work", &work)] {
        if live_root_for(HOST, Some(&state), id, Some(vault.clone())).as_ref() != Some(open) {
            holes.push(format!("{id}: a registry naming a Rotli vault decided the root a command reads"));
        }
        assert_eq!(live_root_for(STANDALONE_IDENTIFIER, Some(&state), id, Some(vault.clone())), Some(vault.clone()));
    }
    if live_root_for(HOST, None, DEFAULT_ROOT_ID, Some(vault.clone())).is_some() {
        holes.push("nothing open, yet a root was taken".into());
    }
    // the registry rewritten after launch: a Rotli vault as the current vault,
    // opened in place, a writable vault, and the read-only open one writable
    let brain = |id: &str, path: &Path| crate::corpus::ConnectedBrain {
        id: id.into(),
        label: "B".into(),
        abs_path: path.to_path_buf(),
        memex_id: None,
        mode: None,
        perms: crate::memex::MemexPerms::ChatsInbox,
    };
    let rewritten = |brains| CorpusConfig {
        version: 1,
        corpus: CorpusRef { abs_path: vault.clone(), adopted: true },
        brains,
        folders: Vec::new(),
        active_brain_id: Some("b".into()),
    };
    let planted = rewritten(vec![brain("b", &vault), brain("work", &work)]);
    let shown = live_config_for(HOST, Some(&state), planted.clone()).expect("the default store is open");
    if shown.corpus.abs_path != own || shown.brains.iter().any(|brain| brain.abs_path == vault) || shown.brains.len() != 1 {
        holes.push("Settings reads the folders a rewritten registry names".into());
    }
    if shown.corpus.adopted || shown.active_brain_id.is_some() {
        holes.push("Settings takes the current vault's adopted flag or the active vault from a rewritten registry".into());
    }
    if crate::memex::memex_write_allowed(&shown, &work) {
        holes.push("a rewritten brain.perms opens the memex write lane on a read-only vault".into());
    }
    if live_config_for(HOST, Some(&open_state(false)), planted.clone()).is_some() {
        holes.push("with no open default store, Settings reads the registry's current vault".into());
    }
    if live_reopen_for(HOST, &state, DEFAULT_ROOT_ID, &planted).ok() != Some((own.clone(), false)) {
        holes.push("a rewritten adopted flag reopens the current vault in place".into());
    }
    if !live_roots_for(HOST, Some(&state), rewritten(Vec::new())).contains(&work) {
        holes.push("a registry that drops an open root shuts the chat and note commands out of it".into());
    }
    if live_roots_for(HOST, Some(&state), planted.clone()).contains(&vault) {
        holes.push("the chat and note commands accept a Rotli vault the registry names".into());
    }
    let json = |config: CorpusConfig| serde_json::to_value(config).unwrap();
    assert_eq!(json(live_config_for(STANDALONE_IDENTIFIER, None, planted.clone()).unwrap()), json(planted.clone()));
    assert_eq!(live_reopen_for(STANDALONE_IDENTIFIER, &state, DEFAULT_ROOT_ID, &planted), Ok((own.clone(), true)));
    assert!(live_roots_for(STANDALONE_IDENTIFIER, Some(&state), planted).contains(&vault));
    fs::create_dir_all(work.join("later").join(".rotli")).unwrap();
    let folder = CorpusRoot { id: "f".into(), label: "F".into(), abs_path: work.clone(), adopted: false };
    let config = CorpusConfig {
        version: 1,
        corpus: CorpusRef { abs_path: own.clone(), adopted: false },
        brains: Vec::new(),
        folders: vec![folder],
        active_brain_id: None,
    };
    let vetted = vet_config(config).unwrap();
    assert_eq!(vetted.corpus.abs_path, own);
    if vetted.folders.len() != usize::from(owns_shared_state()) {
        holes.push("the CLI binds a folder holding a Rotli vault".into());
    }
    assert!(holes.is_empty(), "{}", holes.join("\n"));
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
