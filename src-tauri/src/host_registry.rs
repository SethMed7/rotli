//! A host build's registry at launch. Anything that can write to the support
//! folder can write a registry, a backup of one, or a legacy pointer, so none
//! of them vouches for a folder. A host build binds only folders that carry
//! its own mark (`app_identity::claim`) with no vault it doesn't own around
//! or below them, and it never reads the standalone app's legacy pointers.
//! (docs/architecture/host-seams.md, "The launch bind")

use crate::app_identity::{
    claimed_by, owns_shared_state, owns_shared_state_for, refuse_existing_vault_for, scratch_vault_for,
    settle_scratch_for, APP_IDENTIFIER,
};
use crate::corpus::{CorpusConfig, CorpusRef, CorpusState};
use std::path::{Path, PathBuf};

/// Every registry file a launch reads, in a release or a debug build, with
/// the backups each falls back to.
pub(crate) const REGISTRY_FILES: [&str; 4] = ["corpus.json", "corpus.json.bak", "corpus.dev.json", "corpus.dev.json.bak"];

/// Whether `identifier` may bind `root` from its registry: the folder behind
/// it (however the registry spells it) carries the mark, and nothing around
/// or below it is a vault this build doesn't own.
fn may_bind_for(identifier: &str, root: &Path) -> bool {
    std::fs::canonicalize(root)
        .is_ok_and(|root| claimed_by(&root, identifier) && refuse_existing_vault_for(identifier, &root).is_ok())
}

/// `config` with only the roots `identifier` may bind. A refused primary
/// becomes `scratch`, or refuses when there is none. The standalone build's
/// config is returned as it is.
pub(crate) fn vet_config_for(identifier: &str, config: CorpusConfig, scratch: Option<&Path>) -> Result<CorpusConfig, String> {
    vet_with(identifier, config, || scratch.map(Path::to_path_buf), |root| may_bind_for(identifier, root))
}

fn vet_with(
    identifier: &str,
    mut config: CorpusConfig,
    scratch: impl FnOnce() -> Option<std::path::PathBuf>,
    may_bind: impl Fn(&Path) -> bool,
) -> Result<CorpusConfig, String> {
    if owns_shared_state_for(identifier) {
        return Ok(config);
    }
    config.brains.retain(|brain| may_bind(&brain.abs_path));
    config.folders.retain(|folder| may_bind(&folder.abs_path));
    if !config.brains.iter().any(|brain| config.active_brain_id.as_ref() == Some(&brain.id)) {
        config.active_brain_id = None;
    }
    if !may_bind(&config.corpus.abs_path) {
        let scratch = scratch().ok_or_else(crate::app_identity::existing_vault_refusal)?;
        config.corpus = CorpusRef { abs_path: scratch, adopted: false };
    }
    Ok(config)
}

/// The headless CLI's registry, falling back to this build's trusted scratch
/// vault. It runs on every tool call, so each call checks each root's mark
/// and the folders around it (`still_owned_for`), and the walk below a root
/// runs once per process (`walked_once`), as the app's launch walks its own.
pub(crate) fn vet_config(config: CorpusConfig) -> Result<CorpusConfig, String> {
    if owns_shared_state() {
        return Ok(config);
    }
    let owned = |root: &Path| std::fs::canonicalize(root).is_ok_and(|root| walked_once(&root));
    vet_with(APP_IDENTIFIER, config, crate::app_identity::trusted_scratch_at_home, owned)
}

/// Whether `root` (canonical) is this build's, walking below it the first
/// time this process sees it. A long-lived MCP server keeps that walk until
/// it restarts, as the app keeps its launch's.
fn walked_once(root: &Path) -> bool {
    static WALKED: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());
    if !crate::app_identity::still_owned_for(APP_IDENTIFIER, root) {
        return false;
    }
    let mut walked = WALKED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let fresh = !walked.iter().any(|seen| seen == root);
    if fresh && refuse_existing_vault_for(APP_IDENTIFIER, root).is_err() {
        return false;
    }
    if fresh {
        walked.push(root.to_path_buf());
    }
    true
}

/// Before anything reads a root at launch, every registry file in `support`
/// names only folders `identifier` may bind. A file that would change, or
/// won't parse, is set aside whole (`<name> (set aside <time>)`), and the
/// vetted config is written in its place. When a registry names the scratch
/// vault, or one was lost, the scratch vault is made again if it is gone.
/// `Err` means launch must stop.
pub(crate) fn secure_registry_for(identifier: &str, support: &Path) -> Result<(), String> {
    let Some(scratch) = scratch_vault_for(support, identifier) else {
        return Ok(());
    };
    if std::fs::symlink_metadata(support).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(format!("{} is a link, so no registry in it is this app's", support.display()));
    }
    let is_scratch = |root: &Path| root == scratch || std::fs::canonicalize(root).ok() == std::fs::canonicalize(&scratch).ok();
    for name in REGISTRY_FILES {
        let file = support.join(name);
        let Ok(meta) = std::fs::symlink_metadata(&file) else { continue };
        let Some(config) = meta.is_file().then(|| crate::corpus::read_config_path(&file)).flatten() else { // vault bind (vetted): this is the launch vetting
            crate::app_identity::set_aside(&file)?;
            settle_scratch_for(identifier, support, false)?;
            continue;
        };
        let json = |config: &CorpusConfig| serde_json::to_string_pretty(config).map(|text| text + "\n");
        let before = json(&config).map_err(|e| e.to_string())?;
        let vetted = vet_config_for(identifier, config, Some(&scratch))?;
        if is_scratch(&vetted.corpus.abs_path) {
            settle_scratch_for(identifier, support, false)?;
        }
        let after = json(&vetted).map_err(|e| e.to_string())?;
        if after != before {
            crate::app_identity::set_aside(&file)?;
            crate::fsutil::atomic_write(&file, &after, ".corpus")?;
        }
    }
    Ok(())
}

/// `secure_registry_for` this build's support folder; nothing for the
/// standalone build.
pub(crate) fn secure_registry(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if owns_shared_state() {
        return Ok(());
    }
    let support = app.path().app_config_dir().map_err(|e| e.to_string())?;
    secure_registry_for(APP_IDENTIFIER, &support)
}

/// What a vault action after launch takes as root `id` (`DEFAULT_ROOT_ID`:
/// the current vault). The standalone build takes what its registry names.
/// A host build vetted its registry at launch, but anything that writes the
/// support folder can rewrite it while the app runs, so it takes the open
/// store's own root: one its launch vetted or a refusal let in.
pub(crate) fn live_root_for(identifier: &str, state: Option<&CorpusState>, id: &str, named: Option<PathBuf>) -> Option<PathBuf> {
    if owns_shared_state_for(identifier) {
        return named;
    }
    state?.route(id, |store| Ok(store.root().to_path_buf())).ok()
}

/// `live_root_for` this build and its open stores.
pub(crate) fn live_root(app: &tauri::AppHandle, id: &str, named: Option<PathBuf>) -> Option<PathBuf> {
    use tauri::Manager;
    live_root_for(APP_IDENTIFIER, app.try_state::<CorpusState>().as_deref(), id, named)
}

/// Whether a root a command found in the registry (`memex::registered_root`)
/// may be used: in a host build, only while it is one of the open stores'
/// roots, for the same reason as `live_root_for`.
pub(crate) fn require_live_for(identifier: &str, state: Option<&CorpusState>, root: &Path) -> Result<(), String> {
    let open = || state.is_some_and(|state| matches!(state.root_id_for_path(root), Ok(Some(_))));
    if owns_shared_state_for(identifier) || open() {
        return Ok(());
    }
    Err(format!("not an open vault root: {}", root.display()))
}

/// The registry as Settings shows it after launch, which reads each root's
/// marker and settings. A host build shows its open default store as the
/// current vault and a connected vault or folder only while it is open
/// (`require_live_for`); with no open default store it keeps the registry's.
pub(crate) fn live_config_for(identifier: &str, state: Option<&CorpusState>, mut config: CorpusConfig) -> CorpusConfig {
    if owns_shared_state_for(identifier) {
        return config;
    }
    let open = |root: &Path| std::fs::canonicalize(root).is_ok_and(|root| require_live_for(identifier, state, &root).is_ok());
    config.brains.retain(|brain| open(&brain.abs_path));
    config.folders.retain(|folder| open(&folder.abs_path));
    if let Some(root) = live_root_for(identifier, state, crate::corpus::DEFAULT_ROOT_ID, None) {
        config.corpus.abs_path = root;
    }
    config
}

/// `live_config_for` this build and its open stores.
pub(crate) fn live_config(app: &tauri::AppHandle, config: CorpusConfig) -> CorpusConfig {
    use tauri::Manager;
    live_config_for(APP_IDENTIFIER, app.try_state::<CorpusState>().as_deref(), config)
}

/// `require_live_for` this build and its open stores.
pub(crate) fn require_live(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    use tauri::Manager;
    require_live_for(APP_IDENTIFIER, app.try_state::<CorpusState>().as_deref(), root)
}

/// The config a first launch writes when it has none. The standalone build
/// migrates its legacy pointers; a host build never wrote them, so it reads
/// none and starts on `default_corpus` (its scratch vault).
pub(crate) fn first_config_for(identifier: &str, config_dir: &Path, default_corpus: &Path) -> CorpusConfig {
    if owns_shared_state_for(identifier) {
        return crate::corpus::migrate_config_at(config_dir, default_corpus);
    }
    CorpusConfig {
        version: 1,
        corpus: CorpusRef { abs_path: default_corpus.to_path_buf(), adopted: false },
        brains: Vec::new(),
        folders: Vec::new(),
        active_brain_id: None,
    }
}

#[cfg(test)]
#[path = "host_registry_tests.rs"]
mod tests;
