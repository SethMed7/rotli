//! The identity, the vault refusal and the scratch vault (app_identity.rs).

use super::*;

/// A host identity for tests; never a real product's ID.
const HOST: &str = "com.example.host";

fn config_identifier(path: &str) -> String {
    let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    value["identifier"].as_str().unwrap().to_string()
}

/// The identifier this build was compiled as: `ROTLI_APP_IDENTIFIER`, else
/// the overlay cargo was given (`TAURI_CONFIG`), else `tauri.conf.json`.
/// Holds for every identity: plain `cargo test` is the standalone one; from
/// src-tauri, `ROTLI_APP_IDENTIFIER=com.example.host CARGO_TARGET_DIR=<own
/// dir> cargo test --lib` is a host build.
#[test]
fn this_build_is_the_identity_it_was_compiled_for() {
    // the same variables, read again where the test runs
    let overlay = std::env::var("TAURI_CONFIG")
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| value["identifier"].as_str().map(str::to_string));
    let expected = std::env::var("ROTLI_APP_IDENTIFIER")
        .ok()
        .filter(|id| !id.is_empty())
        .or(overlay)
        .unwrap_or_else(|| config_identifier("tauri.conf.json"));
    assert_eq!(APP_IDENTIFIER, expected);
    let standalone = expected == STANDALONE_IDENTIFIER;
    assert_eq!(owns_shared_state(), standalone);
    assert_eq!(require_shared_state().is_ok(), standalone);
    let support = support_dir(Path::new("/Users/someone"));
    assert!(support.ends_with(&expected), "{support:?}");
    assert_eq!(scratch_vault_in(&support).is_none(), standalone);
    // `rotli open` with an instance running: standalone keeps `open -a
    // rotli`; a host build nudges its own instance (single_instance_tests.rs)
    let reaching = crate::single_instance::plan_for(standalone, true, Path::new(""));
    assert_eq!(reaching.unwrap() == crate::single_instance::OpenPlan::Nudge, !standalone);
    if !standalone {
        assert!(!support.to_string_lossy().contains(STANDALONE_IDENTIFIER));
    }
    assert!(matches_runtime(&expected));
    assert!(!matches_runtime(if standalone { HOST } else { STANDALONE_IDENTIFIER }));
}

#[test]
fn the_standalone_config_keeps_its_identifier() {
    assert_eq!(config_identifier("tauri.conf.json"), STANDALONE_IDENTIFIER);
}

#[test]
fn every_identity_derives_its_paths_from_its_identifier() {
    let home = Path::new("/Users/someone");
    assert_eq!(
        support_dir_for(home, STANDALONE_IDENTIFIER),
        home.join(if cfg!(target_os = "macos") {
            "Library/Application Support/com.rotli.app"
        } else {
            ".config/com.rotli.app"
        })
    );
    let host = support_dir_for(home, HOST);
    assert!(host.ends_with(HOST), "{host:?}");
    assert!(!host.to_string_lossy().contains("com.rotli.app"));
    assert_eq!(scratch_vault_for(&support_dir_for(home, STANDALONE_IDENTIFIER), STANDALONE_IDENTIFIER), None);
    assert_eq!(scratch_vault_for(&host, HOST), Some(host.join("Scratch vault")));
    assert_eq!(support_dir(home), support_dir_for(home, APP_IDENTIFIER));
}

#[test]
fn only_the_standalone_identifier_owns_shared_state() {
    assert!(owns_shared_state_for("com.rotli.app"));
    for other in [HOST, "com.rotli.dev", "", "com.rotli.app.extra", "COM.ROTLI.APP"] {
        assert!(!owns_shared_state_for(other), "{other}");
    }
}

/// Under a host identity, every writer of state outside the support folder
/// refuses before it reaches the disk or launchd: the login item, the
/// local-model agent, the Finder quick action. Runs only in a host build
/// (see the command above); the pure checks below hold in every build.
#[test]
fn a_host_build_refuses_every_shared_writer() {
    if owns_shared_state() {
        return;
    }
    let refused = Err(stays_with_rotli());
    if crate::feature_policy::breve_enabled() {
        assert_eq!(crate::breve::install_rotli_login_agent(), refused);
    }
    assert_eq!(crate::localmodel::local_model_set_default("any-model".into()), refused);
    assert_eq!(crate::localmodel::local_model_uninstall("any-model".into()), refused);
    assert_eq!(crate::finder_quick_action::finder_quick_action_status(), Ok("unavailable".to_string()));
    let loose = Path::new("/usr/local/bin/rotli");
    assert_eq!(crate::single_instance::plan_for(false, false, loose), Err(crate::single_instance::NOT_IN_APP.into()));
}

#[test]
fn rotli_words_are_neutral_until_a_host_supplies_its_own() {
    let defaults = HostWords::default();
    for sentence in [&defaults.shared_state, &defaults.no_keychain, &defaults.existing_vault, &defaults.existing_vault_file] {
        assert!(!sentence.is_empty());
        assert!(sentence.ends_with('.'), "{sentence}");
    }
    assert_eq!(stays_with_rotli(), words().shared_state);
    assert_eq!(no_keychain(), words().no_keychain);
    // no first note of its own: the seeding keeps Rotli's, under any identifier
    assert_eq!((defaults.welcome_note.as_deref(), welcome_note()), (None, None));
    // a host's note names itself on its first line, with no fence of its own
    assert!(is_note_body("# Welcome to Synthetic\r\n\r\nBody.\n"));
    for malformed in ["", "---\nid: x\n---\n# Title\n", "Title only\n", "\n# Late heading\n", "## Too deep\n", "# \n"] {
        assert!(!is_note_body(malformed), "{malformed:?}");
    }
}

/// Rotli's sentences say "Rotli" and its wordmark "rotli" until a host names
/// itself; a blank name keeps Rotli's (docs/architecture/host-seams.md).
#[test]
fn sentences_name_the_app_a_host_names_and_rotli_otherwise() {
    let standalone = HostWords::default();
    assert_eq!((app_name_in(&standalone), product_name_in(&standalone)), ("Rotli", "rotli"));
    assert_eq!((STANDALONE_APP_NAME, STANDALONE_PRODUCT_NAME), ("Rotli", "rotli"));
    let host = HostWords { product_name: Some("Synthetic".into()), ..HostWords::default() };
    assert_eq!((app_name_in(&host), product_name_in(&host)), ("Synthetic", "Synthetic"));
    for blank in ["", "   "] {
        let host = HostWords { product_name: Some(blank.into()), ..HostWords::default() };
        assert_eq!((app_name_in(&host), product_name_in(&host)), ("Rotli", "rotli"), "{blank:?}");
    }
    // this process registered no host: the routed sentences read as before
    assert_eq!((app_name(), product_name()), ("Rotli", "rotli"));
}

/// A file gets the file sentence where a folder gets the folder's; any other
/// refusal passes through unchanged.
#[test]
fn a_refused_file_reads_as_a_file_and_a_folder_as_it_always_has() {
    assert_eq!(
        for_a_file(words().existing_vault.clone()),
        words().existing_vault_file
    );
    assert_ne!(words().existing_vault_file, words().existing_vault);
    assert_eq!(for_a_file("the walk stopped".into()), "the walk stopped");
    assert_eq!(
        HostWords::default().existing_vault,
        "Rotli already uses this folder as a vault, so this app won't open it. Choose another folder.",
        "the folder sentence is unchanged"
    );
}

fn folder(base: &Path, relative: &str) -> PathBuf {
    let path = base.join(relative);
    std::fs::create_dir_all(&path).unwrap();
    std::fs::canonicalize(path).unwrap()
}

fn make_vault(path: &Path) {
    std::fs::create_dir_all(path.join(".rotli")).unwrap();
}

fn existing_vault_refusal() -> Result<(), String> {
    Err(HostWords::default().existing_vault)
}

/// A scratch vault just made: nothing in it but this build's mark.
fn assert_fresh(scratch: &Path) {
    let names: Vec<_> = std::fs::read_dir(scratch).unwrap().flatten().map(|entry| entry.file_name()).collect();
    assert_eq!(names, vec![std::ffi::OsString::from(".rotli")], "{scratch:?}");
    assert!(claimed_by(scratch, HOST));
}

/// The one rule, both ways: a host identity refuses a folder Rotli
/// already uses; the standalone identity owns every vault.
#[test]
fn a_host_identity_refuses_a_folder_rotli_already_uses() {
    let temp = tempfile::tempdir().unwrap();
    let vault = folder(temp.path(), "vault");
    make_vault(&vault);
    assert_eq!(refuse_existing_vault_for(HOST, &vault), existing_vault_refusal());
    assert_eq!(refuse_existing_vault_for(STANDALONE_IDENTIFIER, &vault), Ok(()));
}

#[test]
fn a_host_identity_refuses_every_mark_of_a_vault() {
    let temp = tempfile::tempdir().unwrap();
    let marked = folder(temp.path(), "marked");
    std::fs::write(marked.join("memex.json"), r#"{"id":"mx_fixture"}"#).unwrap();
    assert_eq!(refuse_existing_vault_for(HOST, &marked), existing_vault_refusal());
    let sidecar_only = folder(temp.path(), "sidecar-only");
    std::fs::create_dir_all(sidecar_only.join(".rotli")).unwrap();
    assert_eq!(refuse_existing_vault_for(HOST, &sidecar_only), existing_vault_refusal());
}

#[test]
fn a_host_identity_refuses_a_folder_inside_or_around_a_vault() {
    let temp = tempfile::tempdir().unwrap();
    let vault = folder(temp.path(), "outer/vault");
    make_vault(&vault);
    let inside = folder(&vault, "wiki/people");
    assert_eq!(refuse_existing_vault_for(HOST, &inside), existing_vault_refusal());
    let around = folder(temp.path(), "outer");
    assert_eq!(refuse_existing_vault_for(HOST, &around), existing_vault_refusal());
}

#[test]
fn a_host_identity_opens_plain_folders_and_its_own_vaults() {
    let temp = tempfile::tempdir().unwrap();
    let plain = folder(temp.path(), "plain");
    std::fs::write(plain.join("note.md"), "# A note\n").unwrap();
    folder(&plain, "sub");
    assert_eq!(refuse_existing_vault_for(HOST, &plain), Ok(()));
    let own = folder(temp.path(), "own");
    make_vault(&own);
    assert_eq!(refuse_existing_vault_for(HOST, &own), existing_vault_refusal(), "not marked yet");
    claim_for(HOST, &own).unwrap();
    assert!(claimed_by(&own, HOST) && !claimed_by(&own, "com.example.other"));
    assert_eq!(refuse_existing_vault_for(HOST, &own), Ok(()));
    let inside_own = folder(&own, "projects");
    assert_eq!(refuse_existing_vault_for(HOST, &inside_own), Ok(()));
    // its own vault never excuses another one beside it
    let other = folder(&own, "projects/other");
    make_vault(&other);
    assert_eq!(refuse_existing_vault_for(HOST, &own), existing_vault_refusal());
    assert_eq!(claim_for(STANDALONE_IDENTIFIER, &other), Ok(()));
    assert!(!other.join(".rotli/bound-by").exists(), "the standalone build marks nothing");
}

#[test]
fn this_build_refuses_exactly_as_its_identity_says() {
    let temp = tempfile::tempdir().unwrap();
    let vault = folder(temp.path(), "vault");
    make_vault(&vault);
    let verdict = refuse_existing_vault(&vault);
    if owns_shared_state() {
        assert_eq!(verdict, Ok(()));
    } else {
        assert_eq!(verdict, Err(words().existing_vault.clone()));
    }
}

#[cfg(unix)]
fn link(target: &Path, at: &Path) {
    std::os::unix::fs::symlink(target, at).unwrap();
}

/// The scratch vault is trusted only as a real folder directly inside the
/// support folder: a link there (to a person's vault, say) never is, and
/// neither is a full folder without this build's mark.
#[cfg(unix)]
#[test]
fn only_a_real_scratch_folder_this_build_made_is_trusted() {
    let temp = tempfile::tempdir().unwrap();
    let support = folder(temp.path(), "support");
    assert_eq!(scratch_state(&support, HOST), ScratchState::Missing);
    let vault = folder(temp.path(), "someone's vault");
    make_vault(&vault);
    link(&vault, &support.join(SCRATCH_VAULT));
    assert_eq!(scratch_state(&support, HOST), ScratchState::Untrusted);
    assert_eq!(trusted_scratch_for(&support, HOST), None);
    std::fs::remove_file(support.join(SCRATCH_VAULT)).unwrap();
    std::fs::write(support.join(SCRATCH_VAULT), "not a folder").unwrap();
    assert_eq!(scratch_state(&support, HOST), ScratchState::Untrusted);
    std::fs::remove_file(support.join(SCRATCH_VAULT)).unwrap();
    let planted = folder(&support, SCRATCH_VAULT);
    make_vault(&planted);
    assert_eq!(scratch_state(&support, HOST), ScratchState::Untrusted, "full, and not marked by this build");
    claim_for(HOST, &planted).unwrap();
    assert_eq!(scratch_state(&support, HOST), ScratchState::Trusted);
    assert_eq!(trusted_scratch_for(&support, HOST), Some(planted));
    assert_eq!(scratch_state(&support, "com.example.other"), ScratchState::Untrusted);
}

/// First run sets an untrusted scratch path aside (the link itself, never
/// its target) and starts on a fresh empty folder.
#[cfg(unix)]
#[test]
fn first_run_sets_a_linked_scratch_aside_and_starts_empty() {
    let temp = tempfile::tempdir().unwrap();
    let support = folder(temp.path(), "support");
    let vault = folder(temp.path(), "someone's vault");
    make_vault(&vault);
    std::fs::write(vault.join("note.md"), "# Kept\n").unwrap();
    link(&vault, &support.join(SCRATCH_VAULT));
    settle_scratch_for(HOST, &support, false).unwrap();
    let scratch = support.join(SCRATCH_VAULT);
    assert!(!std::fs::symlink_metadata(&scratch).unwrap().file_type().is_symlink());
    assert_fresh(&scratch);
    assert_eq!(std::fs::read_to_string(vault.join("note.md")).unwrap(), "# Kept\n", "the target is untouched");
    let set_aside: Vec<_> = std::fs::read_dir(&support)
        .unwrap()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("Scratch vault (set aside"))
        .collect();
    assert_eq!(set_aside.len(), 1);
    assert!(set_aside[0].file_type().unwrap().is_symlink());
    assert_eq!(scratch_state(&support, HOST), ScratchState::Trusted);
}

/// A folder holding a link to a vault holds that vault.
#[cfg(unix)]
#[test]
fn a_host_identity_refuses_a_folder_that_links_to_a_vault() {
    let temp = tempfile::tempdir().unwrap();
    let vault = folder(temp.path(), "vault");
    make_vault(&vault);
    let inside = folder(&vault, "wiki");
    for target in [&vault, &inside] {
        let holder = folder(temp.path(), &format!("holder-{}", target.file_name().unwrap().to_string_lossy()));
        link(target, &holder.join("shortcut"));
        assert_eq!(refuse_existing_vault_for(HOST, &holder), existing_vault_refusal(), "{target:?}");
    }
    let plain = folder(temp.path(), "plain");
    let holder = folder(temp.path(), "holder-plain");
    link(&plain, &holder.join("shortcut"));
    assert_eq!(refuse_existing_vault_for(HOST, &holder), Ok(()));
}

/// A planted vault at the scratch path on a first run is set aside like a
/// link, and a second set-aside never takes the first one's name.
#[test]
fn first_run_sets_a_planted_scratch_aside_without_collisions() {
    let temp = tempfile::tempdir().unwrap();
    let support = folder(temp.path(), "support");
    for round in 1..=2 {
        let _ = std::fs::remove_dir_all(support.join(SCRATCH_VAULT)); // a new plant in place of the last scratch
        let planted = folder(&support, SCRATCH_VAULT);
        make_vault(&planted);
        std::fs::write(planted.join("note.md"), format!("# Planted {round}\n")).unwrap();
        settle_scratch_for(HOST, &support, false).unwrap();
        assert_fresh(&support.join(SCRATCH_VAULT));
        let aside = std::fs::read_dir(&support)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with("Scratch vault (set aside"))
            .count();
        assert_eq!(aside, round);
    }
    // and once a registry exists, the folder it bound is kept as it is
    std::fs::write(support.join(SCRATCH_VAULT).join("note.md"), "# Mine\n").unwrap();
    settle_scratch_for(HOST, &support, true).unwrap();
    assert!(support.join(SCRATCH_VAULT).join("note.md").exists());
    // a person who moved on from it keeps it gone
    std::fs::remove_dir_all(support.join(SCRATCH_VAULT)).unwrap();
    settle_scratch_for(HOST, &support, true).unwrap();
    assert_eq!(scratch_state(&support, HOST), ScratchState::Missing);
}

/// A support folder reached through a link isn't this build's own, so its
/// scratch vault is never trusted.
#[cfg(unix)]
#[test]
fn a_scratch_vault_inside_a_linked_support_folder_is_not_trusted() {
    let temp = tempfile::tempdir().unwrap();
    let elsewhere = folder(temp.path(), "elsewhere");
    folder(&elsewhere, SCRATCH_VAULT);
    let support = temp.path().join("support");
    link(&elsewhere, &support);
    assert_eq!(scratch_state(&support, HOST), ScratchState::Untrusted);
    assert_eq!(trusted_scratch_for(&support, HOST), None);
    // nothing is renamed through it: setting aside can't make it safe
    assert!(settle_scratch_for(HOST, &support, false).is_err());
    let names: Vec<_> = std::fs::read_dir(&elsewhere).unwrap().flatten().map(|entry| entry.file_name()).collect();
    assert_eq!(names, vec![std::ffi::OsString::from(SCRATCH_VAULT)]);
}

/// The walk follows a link once: a link back up the tree is not a vault
/// and doesn't loop, and a link into this build's own vault is not a hit.
#[cfg(unix)]
#[test]
fn the_walk_follows_links_once_and_honours_its_own_vaults() {
    let temp = tempfile::tempdir().unwrap();
    let plain = folder(temp.path(), "plain");
    let deep = folder(&plain, "a/b");
    link(&plain, &deep.join("back to the top"));
    link(&deep, &plain.join("loop"));
    assert_eq!(refuse_existing_vault_for(HOST, &plain), Ok(()));
    let own = folder(temp.path(), "own");
    make_vault(&own);
    let holder = folder(temp.path(), "holder");
    link(&own, &holder.join("mine"));
    assert_eq!(refuse_existing_vault_for(HOST, &holder), existing_vault_refusal());
    claim_for(HOST, &own).unwrap();
    assert_eq!(refuse_existing_vault_for(HOST, &holder), Ok(()));
}

/// A folder too large to check refuses: it isn't known to be free of a
/// vault. The standalone build never walks.
#[test]
fn a_folder_too_large_to_check_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let big = folder(temp.path(), "big");
    for n in 0..5 {
        folder(&big, &format!("sub-{n}"));
    }
    assert_eq!(refuse_existing_vault_within(HOST, &big, 6), Ok(()));
    assert_eq!(refuse_existing_vault_within(HOST, &big, 5), Err(TOO_LARGE.to_string()));
    assert_eq!(refuse_existing_vault_within(STANDALONE_IDENTIFIER, &big, 0), Ok(()));
}

/// An unreadable folder below the candidate is skipped: this app can't
/// read a vault through it either, and the folders beside it still count.
#[cfg(unix)]
#[test]
fn an_unreadable_folder_in_the_walk_is_skipped() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let outer = folder(temp.path(), "outer");
    let locked = folder(&outer, "locked");
    make_vault(&folder(&locked, "inner"));
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let readable = std::fs::read_dir(&locked).is_ok(); // root reads anything
    let verdict = refuse_existing_vault_for(HOST, &outer);
    let beside = folder(&outer, "beside");
    make_vault(&beside);
    let with_beside = refuse_existing_vault_for(HOST, &outer);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    if !readable {
        assert_eq!(verdict, Ok(()));
    }
    assert_eq!(with_beside, existing_vault_refusal());
}

/// A top-level function's source, up to its closing brace (spelled as a
/// char so this file's own braces stay balanced for source scanners).
fn body_of<'a>(source: &'a str, signature: &str) -> &'a str {
    let start = source.find(signature).unwrap_or_else(|| panic!("{signature} exists"));
    let end = format!("\n{}\n", '\u{7d}');
    &source[start..start + source[start..].find(&end).unwrap()]
}

/// At launch, in order: a host build takes its instance lock in `launch()`,
/// before the Tauri builder, so a second process runs no plugin, window or
/// setup step (single_instance.rs); the headless CLI returns before
/// `launch()` and never holds it. Then the identity check exits 78 on a
/// mismatch, setup confirms Tauri's support folder is the one locked, and
/// the scratch vault is made safe (exit 73 when it can't be) before any
/// root is repaired, registered or watched. The root check trusts only
/// the scratch vault this build owns.
#[test]
fn launch_checks_identity_then_settles_scratch_before_binding_anything() {
    let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs")).unwrap();
    let launch = &lib[lib.find("fn launch(").expect("launch exists")..];
    let lock = launch.find("single_instance::hold_at_launch(&context.config().identifier)").expect("launch takes the instance lock");
    assert!(lock < launch.find("tauri::Builder::default()").unwrap(), "the lock precedes the builder");
    let main = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/main.rs")).unwrap();
    assert!(main.find("run_headless_if_requested(").unwrap() < main.find("rotli_lib::run(").unwrap());
    let setup = &lib[lib.find(".setup(move |app| {").expect("setup exists")..];
    let identity = setup.find("app_identity::matches_runtime(").unwrap();
    let mismatch_exit = setup.find("std::process::exit(78)").unwrap();
    let locked_folder = setup.find("single_instance::confirm_support_folder(").expect("setup confirms the locked folder");
    let scratch = setup.find("app_identity::ensure_scratch_vault(").unwrap();
    let scratch_exit = setup.find("std::process::exit(73)").unwrap();
    let repair = setup.find("vault_location::repair_vault_locations(").unwrap();
    assert!(mismatch_exit < locked_folder && locked_folder < scratch);
    assert!(identity < mismatch_exit && mismatch_exit < scratch && scratch < scratch_exit && scratch_exit < repair);
    assert!(setup.contains("single_instance::listen(app.handle())"));
    let check = body_of(&lib, "pub(crate) fn reject_privileged_root(");
    assert!(check.contains("app_identity::owned_scratch_vault(app)"), "{check}");
    assert!(!check.contains("app_identity::scratch_vault(app)"), "{check}");
}

/// The headless CLI's root pin refuses what the app refuses: an existing
/// vault in a host build, nothing in the standalone one. (A host build's
/// own registry is read where it lives; on a machine without that build
/// it is absent, so no root is owned.)
#[test]
fn the_cli_root_pin_meets_the_same_refusal() {
    let temp = tempfile::tempdir().unwrap();
    let vault = folder(temp.path(), "vault");
    make_vault(&vault);
    let plain = folder(temp.path(), "plain");
    assert_eq!(refuse_pinned_root(&plain), Ok(()));
    if owns_shared_state() {
        assert_eq!(refuse_pinned_root(&vault), Ok(()));
    } else {
        assert_eq!(refuse_pinned_root(&vault), Err(words().existing_vault.clone()));
    }
}

/// Every way a person binds a folder as notes passes through
/// `reject_privileged_root`, and that check consults the vault refusal
/// before anything writes to the folder.
#[test]
fn every_root_choice_meets_the_vault_refusal() {
    let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs")).unwrap();
    let start = lib.find("pub(crate) fn reject_privileged_root(").expect("the root check exists");
    let body = &lib[start..start + lib[start..].find("\n}\n").unwrap()];
    assert!(body.contains("app_identity::refuse_existing_vault("), "{body}");
    let choose = &lib[lib.find("fn corpus_choose_folder_blocking(").unwrap()..];
    let check = choose.find("reject_privileged_root(").unwrap();
    let heal = choose.find("vault_marker::heal_best_effort(").unwrap();
    assert!(check < heal, "the refusal must run before the heal writes to the folder");
}

/// Hold 1's place in the launch: the registry is secured after the scratch
/// vault, before the bookmark repair reads a root and again after it
/// rewrites registry paths, before anything binds, and exit 73 stops a
/// launch that can't secure it. Every registry writer marks the root it adds after
/// its caller's refusal; the scratch vault still meets the vault refusal;
/// the headless CLI vets the registry it reads.
#[test]
fn launch_secures_the_registry_and_writers_mark_their_roots() {
    let src = |file: &str| std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file)).unwrap();
    let lib = src("lib.rs");
    let setup = &lib[lib.find(".setup(move |app| {").expect("setup exists")..];
    let repair = setup.find("vault_location::repair_vault_locations(").unwrap();
    let secure = setup.find("host_registry::secure_registry(").expect("the launch secures the registry");
    let first_read = setup.find("corpus::is_configured(app.handle())").unwrap();
    assert!(secure < repair, "the registry is vetted before the bookmark repair reads a root");
    assert!(setup[secure..repair].contains("std::process::exit(73)") && setup[secure..repair].contains("secure_registry();"));
    assert!(setup[repair..first_read].contains("secure_registry();"), "the repair's rewrite is vetted again");
    assert!(first_read < setup.find("corpus::startup_roots(").unwrap());
    let check = body_of(&lib, "pub(crate) fn reject_privileged_root(");
    assert!(check.contains("== Some(&candidate) {\n        return app_identity::refuse_existing_vault(&candidate);"), "{check}");
    let corpus = src("corpus.rs");
    for writer in ["fn persist_corpus_path(", "pub fn upsert_brain(", "pub fn add_folder("] {
        let body = body_of(&corpus, writer);
        let claim = body.find("app_identity::claim(").unwrap_or_else(|| panic!("{writer} marks its root"));
        assert!(claim < body.find("write_corpus_config(").unwrap(), "{writer}");
    }
    assert!(body_of(&src("workspace.rs"), "fn root_targets(").contains("host_registry::vet_config("));
    // demo mode binds a sibling of the corpus (`memex-demo`), so a host build has none
    assert!(body_of(&corpus, "pub fn demo_active(").contains("app_identity::owns_shared_state()"));
    assert!(body_of(&corpus, "pub fn set_demo(").contains("app_identity::require_shared_state()?"));
    // round 5: after launch the registry is re-read, so a host takes a root
    // from its open stores (or refuses the folder), never from that read
    let after_launch = [
        ("lib.rs", "fn corpus_reveal(", "host_registry::live_root("),
        ("lib.rs", "fn corpus_choose_folder_blocking(", "host_registry::live_root("),
        ("lib.rs", "fn refresh_vault_blocking(", "host_registry::live_reopen("),
        ("lib.rs", "fn corpus_switch_vault_blocking(", "host_registry::live_root("),
        ("lib.rs", "fn corpus_init_memex_blocking(", "host_registry::live_root("),
        ("lib.rs", "async fn corpus_inspect_folder(", "if !app_identity::owns_shared_state() {\n            reject_privileged_root("),
        ("lib.rs", "fn corpus_list_config(", "host_registry::live_config("),
        ("vault_import.rs", "fn copy_vault_blocking(", "host_registry::live_root("),
        ("vault_location.rs", "pub(crate) fn picker_start(", "host_registry::live_root("),
        ("memex.rs", "pub(crate) fn registered_root(", "host_registry::live_roots("),
        ("memex.rs", "fn registered_write_root(", "host_registry::live_config("),
    ];
    let unvetted: Vec<_> = after_launch.iter().filter(|(file, f, gate)| !body_of(&src(file), f).contains(gate)).collect();
    assert!(unvetted.is_empty(), "these take a folder from the registry after launch: {unvetted:?}");
}
