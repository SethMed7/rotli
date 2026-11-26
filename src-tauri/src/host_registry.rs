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
use crate::corpus::{CorpusConfig, CorpusRef, CorpusState, OpenRoot};
use crate::memex::MemexPerms;
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

/// The open stores, or none when there is no state to read.
fn open_roots(state: Option<&CorpusState>) -> Vec<OpenRoot> {
    state.and_then(|state| state.open_roots().ok()).unwrap_or_default()
}

/// The open route `id`, when it is open at the folder `path` names.
fn open_at<'a>(open: &'a [OpenRoot], id: &str, path: &Path) -> Option<&'a OpenRoot> {
    let path = std::fs::canonicalize(path).ok()?;
    open.iter().find(|root| root.id == id && std::fs::canonicalize(&root.root).is_ok_and(|root| root == path))
}

/// The registry as Settings and the memex write gate read it after launch.
/// A host build takes the current vault from its open default store, keeps
/// a connected vault or folder only while its route is open at that folder,
/// and takes each one's adopted and read-only flags from its store, so a
/// registry rewritten while the app runs changes none of them. `None`: a
/// host build with no open default store, which shows no vault at all.
pub(crate) fn live_config_for(identifier: &str, state: Option<&CorpusState>, mut config: CorpusConfig) -> Option<CorpusConfig> {
    if owns_shared_state_for(identifier) {
        return Some(config);
    }
    let open = open_roots(state);
    let current = open.iter().find(|root| root.id == crate::corpus::DEFAULT_ROOT_ID)?;
    config.corpus = CorpusRef { abs_path: current.root.clone(), adopted: current.adopted };
    config.brains.retain_mut(|brain| {
        let Some(store) = open_at(&open, &brain.id, &brain.abs_path) else { return false };
        brain.abs_path = store.root.clone();
        brain.perms = if store.read_only { MemexPerms::ReadOnly } else { MemexPerms::ChatsInbox };
        true
    });
    config.folders.retain_mut(|folder| {
        let Some(store) = open_at(&open, &folder.id, &folder.abs_path) else { return false };
        (folder.abs_path, folder.adopted) = (store.root.clone(), store.adopted);
        true
    });
    config.active_brain_id = config.active_brain_id.take().filter(|id| config.brains.iter().any(|brain| &brain.id == id));
    Some(config)
}

/// `live_config_for` this build and its open stores.
pub(crate) fn live_config(app: &tauri::AppHandle, config: CorpusConfig) -> Option<CorpusConfig> {
    use tauri::Manager;
    live_config_for(APP_IDENTIFIER, app.try_state::<CorpusState>().as_deref(), config)
}

/// The roots the chat and note commands accept (`memex::registered_root`):
/// the registry's. A host build takes its open stores' roots instead, so a
/// registry rewritten after launch can neither add a root nor drop an open one.
pub(crate) fn live_roots_for(identifier: &str, state: Option<&CorpusState>, config: CorpusConfig) -> Vec<PathBuf> {
    if owns_shared_state_for(identifier) {
        return std::iter::once(config.corpus.abs_path)
            .chain(config.brains.into_iter().map(|brain| brain.abs_path))
            .chain(config.folders.into_iter().map(|folder| folder.abs_path))
            .collect();
    }
    open_roots(state).into_iter().map(|root| root.root).collect()
}

/// `live_roots_for` this build and its open stores.
pub(crate) fn live_roots(app: &tauri::AppHandle, config: CorpusConfig) -> Vec<PathBuf> {
    use tauri::Manager;
    live_roots_for(APP_IDENTIFIER, app.try_state::<CorpusState>().as_deref(), config)
}

/// Which folder a refresh reopens as route `id`, and whether it opens
/// adopted (in place). A host build takes the current vault's adopted flag
/// from its open store or the in-place marker in the folder itself, never
/// from the registry.
pub(crate) fn live_reopen_for(
    identifier: &str,
    state: &CorpusState,
    id: &str,
    config: &CorpusConfig,
) -> Result<(PathBuf, bool), String> {
    if id == crate::corpus::DEFAULT_ROOT_ID {
        let root = state.default_root_path()?;
        if owns_shared_state_for(identifier) {
            return Ok((root, config.corpus.adopted));
        }
        let adopted = open_roots(Some(state)).iter().any(|open| open.id == id && open.adopted);
        return Ok((root.clone(), adopted || crate::vault_roles::in_place(&root)));
    }
    let connected = config.brains.iter().find(|vault| vault.id == id).ok_or_else(|| "no such connected vault".to_string())?;
    if !state.contains_root(id)? {
        return Err("the connected vault is not open".into());
    }
    let root = live_root_for(identifier, Some(state), id, Some(connected.abs_path.clone()));
    Ok((root.ok_or("the connected vault is not open")?, false))
}

/// `live_reopen_for` this build and its open stores.
pub(crate) fn live_reopen(app: &tauri::AppHandle, id: &str, config: CorpusConfig) -> Result<(PathBuf, bool), String> {
    use tauri::Manager;
    live_reopen_for(APP_IDENTIFIER, &app.state::<CorpusState>(), id, &config)
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
