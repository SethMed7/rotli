//! Which app this build is. The same shell builds the standalone Rotli
//! (`com.rotli.app`: its own updater, `rotli://`, Keychain, LaunchAgents) and,
//! with a host (`app_host.rs`), an app under another bundle ID. build.rs reads
//! the identifier at build time and this file is its one reader; every path or
//! label that names the bundle ID derives from it.
//!
//! State that is not keyed by the bundle ID (the `rotli` Keychain service, the
//! LaunchAgents, the Finder quick action, the OS-wide shortcuts, `~/.memex/ai`,
//! `~/breve`, the update feed, existing vaults) belongs to the standalone app.
//! Any other identifier fails closed: it never touches that state, and it
//! refuses a folder Rotli already uses as a vault.
//! (docs/architecture/compatibility-and-migrations.md, "One shell, with or
//! without a host")

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The bundle ID as a literal, for `concat!` in `const` paths.
macro_rules! app_identifier {
    () => {
        env!("ROTLI_APP_IDENTIFIER")
    };
}
pub(crate) use app_identifier;

pub(crate) const APP_IDENTIFIER: &str = app_identifier!();
pub(crate) const STANDALONE_IDENTIFIER: &str = "com.rotli.app";

/// The sentences a person reads where a host build declines Rotli's shared
/// state. Rotli's defaults are neutral; a host supplies its own wording
/// (`app_host::AppHost::words`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostWords {
    /// Any refused shared-state action (LaunchAgents, shortcuts, Finder).
    pub shared_state: String,
    /// A Keychain read or write.
    pub no_keychain: String,
    /// A folder that is already a Rotli vault.
    pub existing_vault: String,
}

impl Default for HostWords {
    fn default() -> Self {
        Self {
            shared_state: "This app runs beside Rotli and leaves this to Rotli.".into(),
            no_keychain: "This app doesn't keep keys in the Keychain, so this key can't be saved here. Rotli keeps its own."
                .into(),
            existing_vault: "Rotli already uses this folder as a vault, so this app won't open it. Choose another folder."
                .into(),
        }
    }
}

static HOST_WORDS: OnceLock<HostWords> = OnceLock::new();

/// Set once, by the host entry, before the app starts. A second call is
/// ignored: the wording never changes under a running app.
pub(crate) fn set_host_words(words: HostWords) {
    let _ = HOST_WORDS.set(words);
}

fn words() -> &'static HostWords {
    HOST_WORDS.get_or_init(HostWords::default)
}

/// Shown where a host build refuses shared state.
pub(crate) fn stays_with_rotli() -> String {
    words().shared_state.clone()
}

/// Shown where a host build refuses the Keychain.
pub(crate) fn no_keychain() -> String {
    words().no_keychain.clone()
}

fn owns_shared_state_for(identifier: &str) -> bool {
    identifier == STANDALONE_IDENTIFIER
}

/// True only for the standalone build: the one build allowed to use state
/// that two installed apps would otherwise share.
pub(crate) fn owns_shared_state() -> bool {
    owns_shared_state_for(APP_IDENTIFIER)
}

/// `Err` with the host's sentence in every build but the standalone one.
pub(crate) fn require_shared_state() -> Result<(), String> {
    owns_shared_state().then_some(()).ok_or_else(stays_with_rotli)
}

fn support_dir_for(home: &Path, identifier: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    return home.join("Library/Application Support").join(identifier);
    #[cfg(not(target_os = "macos"))]
    home.join(".config").join(identifier)
}

/// This build's support folder without an app handle (the headless CLI,
/// Antigravity). Tauri's `app_config_dir` is the same folder.
pub(crate) fn support_dir(home: &Path) -> PathBuf {
    support_dir_for(home, APP_IDENTIFIER)
}

const SCRATCH_VAULT: &str = "Scratch vault";

fn scratch_vault_for(support: &Path, identifier: &str) -> Option<PathBuf> {
    (!owns_shared_state_for(identifier)).then(|| support.join(SCRATCH_VAULT))
}

/// Where a fresh host install keeps its notes until the person picks a
/// folder: a throwaway vault inside its own support folder. `None` for the
/// standalone build, which keeps its historical first-run gate.
pub(crate) fn scratch_vault_in(support: &Path) -> Option<PathBuf> {
    scratch_vault_for(support, APP_IDENTIFIER)
}

/// How `rotli open` brings the app forward. The standalone build keeps its
/// historical `open -a rotli`; a host build names itself by bundle ID, so it
/// never launches the standalone app.
pub(crate) fn open_app_args() -> [&'static str; 2] {
    if owns_shared_state() { ["-a", "rotli"] } else { ["-b", APP_IDENTIFIER] }
}

/// The running app must be the identity this binary was compiled for; a stale
/// build cache, or a host whose Tauri context names another ID, could
/// otherwise give one identity the other's behaviour.
pub(crate) fn matches_runtime(configured: &str) -> bool {
    configured == APP_IDENTIFIER
}

/// Whether this one folder is, or was, a Rotli vault: its `.rotli/` sidecar,
/// a root `memex.json`, or a marker Rotli can still recover.
fn holds_vault(folder: &Path) -> bool {
    folder.join(".rotli").exists()
        || crate::corpus::is_memex_root(folder)
        || crate::vault_marker::refuses_scaffolding(folder)
}

/// How many folders below a candidate are checked for a vault before the
/// check gives up. Giving up refuses: a folder too large to check is not
/// known to be free of a vault.
const DESCENDANT_FOLDER_LIMIT: usize = 50_000;

const TOO_LARGE: &str = "This folder is too large to check for a Rotli vault inside it, so this app won't open it. Choose a smaller folder.";

/// The first vault at or below `root` that `owned` doesn't name, without
/// following symbolic links. `Err` when the walk can't finish.
fn unowned_vault_below(root: &Path, owned: &[PathBuf]) -> Result<Option<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        seen += 1;
        if seen > DESCENDANT_FOLDER_LIMIT {
            return Err(TOO_LARGE.into());
        }
        if dir != root && holds_vault(&dir) && !owned.contains(&dir) {
            return Ok(Some(dir));
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue; // an unreadable folder can't be opened as notes either
        };
        for entry in entries.filter_map(Result::ok) {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) && entry.file_name() != ".rotli" {
                stack.push(entry.path());
            }
        }
    }
    Ok(None)
}

/// The vault refusal, for any identity. The standalone build owns every vault
/// and refuses nothing. Any other identity refuses a folder that is a Rotli
/// vault, sits inside one, or holds one, unless that vault is one this build
/// itself made or chose (`owned`: canonical paths from its own registry and
/// its scratch vault). `candidate` must already be canonical.
fn refuse_existing_vault_for(identifier: &str, candidate: &Path, owned: &[PathBuf]) -> Result<(), String> {
    if owns_shared_state_for(identifier) {
        return Ok(());
    }
    let refused = || Err(words().existing_vault.clone());
    if candidate.ancestors().any(|folder| holds_vault(folder) && !owned.iter().any(|own| own == folder)) {
        return refused();
    }
    match unowned_vault_below(candidate, owned)? {
        Some(_) => refused(),
        None => Ok(()),
    }
}

/// This build's vault refusal (`refuse_existing_vault_for`). `owned` is only
/// asked for in a host build, so the standalone build never reads more than it
/// did before; an error reading it refuses.
pub(crate) fn refuse_existing_vault(
    candidate: &Path,
    owned: impl FnOnce() -> Result<Vec<PathBuf>, String>,
) -> Result<(), String> {
    if owns_shared_state() {
        return Ok(());
    }
    refuse_existing_vault_for(APP_IDENTIFIER, candidate, &owned()?)
}

/// A host build's throwaway vault (`app_identity::scratch_vault_in`), inside
/// its own support folder; `None` in the standalone build.
pub(crate) fn scratch_vault(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let support = app.path().app_config_dir().ok()?;
    scratch_vault_in(&support)
}

/// A fresh host install comes up on its scratch vault, without a person
/// choosing a folder and without ever looking at another app's registry:
/// with no `corpus.json` of its own yet, the folder is created so the
/// first-run probe (`configured_at`) finds it and the migration binds it.
pub(crate) fn ensure_scratch_vault(app: &tauri::AppHandle) {
    let Some(scratch) = scratch_vault(app) else { return };
    if crate::corpus::corpus_config_file(app).is_some_and(|file| file.exists()) {
        return;
    }
    if let Err(error) = std::fs::create_dir_all(&scratch) {
        eprintln!("rotli: could not create the scratch vault {} ({error})", scratch.display());
    }
}

/// The folders this build itself bound as notes, canonical: its scratch vault
/// and every root in its own registry. A host build's vault refusal
/// (`app_identity::refuse_existing_vault`) lets these through. A registry that
/// exists but can't be read is an error, so the refusal holds instead.
pub(crate) fn owned_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    owned_roots_from(scratch_vault(app), crate::corpus::corpus_config_file(app))
}

/// `owned_roots` from a scratch vault and a registry file, for the headless
/// CLI, which has no app handle (`app_identity::refuse_pinned_root`).
pub(crate) fn owned_roots_from(scratch: Option<PathBuf>, registry: Option<PathBuf>) -> Result<Vec<PathBuf>, String> {
    let mut roots: Vec<PathBuf> = scratch.into_iter().collect();
    if let Some(file) = registry.filter(|file| file.exists()) {
        let config = crate::corpus::read_config_path(&file)
            .ok_or_else(|| format!("Rotli couldn't read {}, so it won't open another folder yet.", file.display()))?;
        roots.push(config.corpus.abs_path);
        roots.extend(config.brains.into_iter().map(|brain| brain.abs_path));
        roots.extend(config.folders.into_iter().map(|folder| folder.abs_path));
    }
    Ok(roots.into_iter().filter_map(|root| std::fs::canonicalize(root).ok()).collect())
}

/// The headless CLI's `ROTLI_CORPUS_ROOT` pin, under the same refusal as a
/// folder picked in the app. A host build's own roots come from its own
/// registry (`workspace::production_config_path`) and its scratch vault.
pub(crate) fn refuse_pinned_root(path: &Path) -> Result<(), String> {
    if owns_shared_state() {
        return Ok(());
    }
    let candidate = std::fs::canonicalize(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    refuse_existing_vault(&candidate, || {
        let home = std::env::var("HOME").map_err(|_| "HOME is unavailable")?;
        let scratch = scratch_vault_in(&support_dir(Path::new(&home)));
        owned_roots_from(scratch, Some(crate::workspace::production_config_path()?))
    })
}

#[cfg(test)]
mod tests {
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
        if standalone {
            assert_eq!(open_app_args(), ["-a", "rotli"]);
        } else {
            assert_eq!(open_app_args(), ["-b", expected.as_str()]);
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
        assert_eq!(open_app_args(), ["-b", APP_IDENTIFIER]);
    }

    #[test]
    fn rotli_words_are_neutral_until_a_host_supplies_its_own() {
        let defaults = HostWords::default();
        for sentence in [&defaults.shared_state, &defaults.no_keychain, &defaults.existing_vault] {
            assert!(!sentence.is_empty());
            assert!(sentence.ends_with('.'), "{sentence}");
        }
        assert_eq!(stays_with_rotli(), words().shared_state);
        assert_eq!(no_keychain(), words().no_keychain);
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

    /// The one rule, both ways: a host identity refuses a folder Rotli
    /// already uses; the standalone identity owns every vault.
    #[test]
    fn a_host_identity_refuses_a_folder_rotli_already_uses() {
        let temp = tempfile::tempdir().unwrap();
        let vault = folder(temp.path(), "vault");
        make_vault(&vault);
        assert_eq!(refuse_existing_vault_for(HOST, &vault, &[]), existing_vault_refusal());
        assert_eq!(refuse_existing_vault_for(STANDALONE_IDENTIFIER, &vault, &[]), Ok(()));
    }

    #[test]
    fn a_host_identity_refuses_every_mark_of_a_vault() {
        let temp = tempfile::tempdir().unwrap();
        let marked = folder(temp.path(), "marked");
        std::fs::write(marked.join("memex.json"), r#"{"id":"mx_fixture"}"#).unwrap();
        assert_eq!(refuse_existing_vault_for(HOST, &marked, &[]), existing_vault_refusal());
        let sidecar_only = folder(temp.path(), "sidecar-only");
        std::fs::create_dir_all(sidecar_only.join(".rotli")).unwrap();
        assert_eq!(refuse_existing_vault_for(HOST, &sidecar_only, &[]), existing_vault_refusal());
    }

    #[test]
    fn a_host_identity_refuses_a_folder_inside_or_around_a_vault() {
        let temp = tempfile::tempdir().unwrap();
        let vault = folder(temp.path(), "outer/vault");
        make_vault(&vault);
        let inside = folder(&vault, "wiki/people");
        assert_eq!(refuse_existing_vault_for(HOST, &inside, &[]), existing_vault_refusal());
        let around = folder(temp.path(), "outer");
        assert_eq!(refuse_existing_vault_for(HOST, &around, &[]), existing_vault_refusal());
    }

    #[test]
    fn a_host_identity_opens_plain_folders_and_its_own_vaults() {
        let temp = tempfile::tempdir().unwrap();
        let plain = folder(temp.path(), "plain");
        std::fs::write(plain.join("note.md"), "# A note\n").unwrap();
        folder(&plain, "sub");
        assert_eq!(refuse_existing_vault_for(HOST, &plain, &[]), Ok(()));
        let own = folder(temp.path(), "own");
        make_vault(&own);
        assert_eq!(refuse_existing_vault_for(HOST, &own, std::slice::from_ref(&own)), Ok(()));
        let inside_own = folder(&own, "projects");
        assert_eq!(refuse_existing_vault_for(HOST, &inside_own, std::slice::from_ref(&own)), Ok(()));
        // its own vault never excuses another one beside it
        let other = folder(&own, "projects/other");
        make_vault(&other);
        assert_eq!(refuse_existing_vault_for(HOST, &own, std::slice::from_ref(&own)), existing_vault_refusal());
    }

    #[test]
    fn this_build_refuses_exactly_as_its_identity_says() {
        let temp = tempfile::tempdir().unwrap();
        let vault = folder(temp.path(), "vault");
        make_vault(&vault);
        let mut asked = false;
        let verdict = refuse_existing_vault(&vault, || {
            asked = true;
            Ok(Vec::new())
        });
        if owns_shared_state() {
            assert_eq!(verdict, Ok(()));
            assert!(!asked, "the standalone build never reads a registry for this");
        } else {
            assert_eq!(verdict, Err(words().existing_vault.clone()));
            assert!(asked);
        }
        if !owns_shared_state() {
            // an unreadable registry refuses rather than opening
            let plain = folder(temp.path(), "plain");
            assert!(refuse_existing_vault(&plain, || Err("registry unreadable".into())).is_err());
        }
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
}
