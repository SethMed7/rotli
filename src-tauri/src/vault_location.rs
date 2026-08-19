//! Machine-local vault location references.
//!
//! `corpus.json` keeps human-readable absolute paths, while this private app-
//! config sidecar keeps macOS URL bookmarks keyed by the portable `mx_…`
//! identity. Foundation can resolve a bookmark after Finder moves or renames
//! the same directory. The stable id is checked again before any config path is
//! repaired, so a stale bookmark can never attach an unrelated folder.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::corpus::CorpusConfig;

const LOCATION_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct VaultLocationRef {
    memex_id: String,
    last_path: PathBuf,
    bookmark: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VaultLocationRegistry {
    version: u32,
    #[serde(default)]
    locations: Vec<VaultLocationRef>,
}

impl Default for VaultLocationRegistry {
    fn default() -> Self {
        Self {
            version: LOCATION_VERSION,
            locations: Vec::new(),
        }
    }
}

fn registry_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| {
        dir.join(if cfg!(debug_assertions) {
            "vault-locations.dev.json"
        } else {
            "vault-locations.json"
        })
    })
}

fn read_registry(app: &tauri::AppHandle) -> VaultLocationRegistry {
    registry_file(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|body| serde_json::from_str::<VaultLocationRegistry>(&body).ok())
        .filter(|registry| registry.version == LOCATION_VERSION)
        .unwrap_or_default()
}

fn write_registry(app: &tauri::AppHandle, registry: &VaultLocationRegistry) -> Result<(), String> {
    let path = registry_file(app).ok_or("no app config directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::to_string_pretty(registry).map_err(|error| error.to_string())? + "\n";
    crate::fsutil::atomic_write(&path, &body, ".rotli-vault-locations-")
}

fn memex_id_at(path: &Path) -> Option<String> {
    fs::read_to_string(path.join("memex.json"))
        .ok()
        .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
        .and_then(|value| {
            value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .filter(|id| id.starts_with("mx_"))
                .map(str::to_string)
        })
}

/// The native panel should never inherit macOS's last unrelated location.
/// Before a vault exists it opens at Home; afterwards it opens beside the
/// current vault so moving, replacing, or creating a sibling stays one step.
fn picker_start_directory(configured_root: Option<&Path>, home: &Path) -> PathBuf {
    configured_root
        .and_then(Path::parent)
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(home)
        .to_path_buf()
}

pub(crate) fn picker_start(app: &tauri::AppHandle) -> PathBuf {
    let home = app
        .path()
        .home_dir()
        .ok()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("/"));
    let configured = crate::corpus::is_configured(app)
        .then(|| crate::corpus::read_corpus_config(app))
        .flatten()
        .map(|config| config.corpus.abs_path);
    picker_start_directory(configured.as_deref(), &home)
}

#[cfg(target_os = "macos")]
fn create_bookmark(path: &Path) -> Result<String, String> {
    use base64::Engine as _;
    use objc2_foundation::{NSURLBookmarkCreationOptions, NSURL};

    let url = NSURL::from_directory_path(path)
        .ok_or_else(|| format!("create a file URL for {}", path.display()))?;
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::empty(),
            None,
            None,
        )
        .map_err(|error| format!("create a vault bookmark: {error:?}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(data.to_vec()))
}

#[cfg(target_os = "macos")]
fn resolve_bookmark(bookmark: &str) -> Result<(PathBuf, bool), String> {
    use base64::Engine as _;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSURLBookmarkResolutionOptions, NSURL};

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bookmark)
        .map_err(|error| format!("decode a vault bookmark: {error}"))?;
    let data = NSData::with_bytes(&bytes);
    let mut stale = Bool::NO;
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithoutUI,
            None,
            &mut stale,
        )
    }
    .map_err(|error| format!("resolve a vault bookmark: {error:?}"))?;
    let path = url
        .to_file_path()
        .ok_or("the resolved vault bookmark was not a file URL")?;
    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("open resolved vault {}: {error}", path.display()))?;
    Ok((canonical, stale.as_bool()))
}

/// Repoint every role that names this exact portable vault. The active corpus
/// predates stored memex ids, so its old canonical path is the pin; connected
/// libraries additionally carry the id in `corpus.json`. The resolved folder's
/// live `memex.json` id must agree before either route changes.
fn repoint_config_for_resolved_vault(
    config: &mut CorpusConfig,
    location: &VaultLocationRef,
    resolved: &Path,
    resolved_memex_id: Option<&str>,
) -> bool {
    if resolved_memex_id != Some(location.memex_id.as_str()) {
        return false;
    }
    let mut changed = false;
    if config.corpus.abs_path == location.last_path && config.corpus.abs_path != resolved {
        config.corpus.abs_path = resolved.to_path_buf();
        changed = true;
    }
    for brain in &mut config.brains {
        let same_vault = brain.memex_id.as_deref() == Some(location.memex_id.as_str())
            || brain.abs_path == location.last_path;
        if same_vault && brain.abs_path != resolved {
            brain.abs_path = resolved.to_path_buf();
            changed = true;
        }
    }
    if !changed {
        return false;
    }

    // One physical folder has one role. If the active corpus moved onto a path
    // that was also linked, the active role wins; duplicate linked identities
    // collapse deterministically without touching files.
    let active = config.corpus.abs_path.clone();
    let removed_active_id = config
        .active_brain_id
        .as_deref()
        .and_then(|id| config.brains.iter().find(|brain| brain.id == id))
        .is_some_and(|brain| brain.abs_path == active);
    config.brains.retain(|brain| brain.abs_path != active);
    let mut seen_ids = HashSet::new();
    let mut seen_paths = HashSet::new();
    config.brains.retain(|brain| {
        let id = brain.memex_id.clone().unwrap_or_else(|| brain.id.clone());
        seen_ids.insert(id) && seen_paths.insert(brain.abs_path.clone())
    });
    if removed_active_id
        || config
            .active_brain_id
            .as_deref()
            .is_some_and(|id| !config.brains.iter().any(|brain| brain.id == id))
    {
        config.active_brain_id = config.brains.first().map(|brain| brain.id.clone());
    }
    true
}

#[cfg(target_os = "macos")]
fn remember_in_registry(registry: &mut VaultLocationRegistry, path: &Path) -> Result<bool, String> {
    let Some(memex_id) = memex_id_at(path) else {
        return Ok(false);
    };
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("open vault {}: {error}", path.display()))?;
    if registry.locations.iter().any(|location| {
        location.memex_id == memex_id
            && location.last_path == canonical
            && !location.bookmark.is_empty()
    }) {
        return Ok(false);
    }
    let bookmark = create_bookmark(&canonical)?;
    registry
        .locations
        .retain(|location| location.memex_id != memex_id);
    registry.locations.push(VaultLocationRef {
        memex_id,
        last_path: canonical,
        bookmark,
    });
    registry
        .locations
        .sort_by(|left, right| left.memex_id.cmp(&right.memex_id));
    Ok(true)
}

/// Record a compatible selected vault without making bookmark support a gate
/// on the user's explicit selection. Any Foundation or app-config failure is a
/// recoverability warning; `corpus.json` remains the normal readable pointer.
#[cfg(target_os = "macos")]
pub(crate) fn remember_vault(app: &tauri::AppHandle, path: &Path) {
    let mut registry = read_registry(app);
    match remember_in_registry(&mut registry, path) {
        Ok(true) => {
            if let Err(error) = write_registry(app, &registry) {
                eprintln!("rotli: could not remember the vault location ({error})");
            }
        }
        Ok(false) => {}
        Err(error) => eprintln!("rotli: could not bookmark the vault location ({error})"),
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn remember_vault(_app: &tauri::AppHandle, _path: &Path) {}

#[cfg(target_os = "macos")]
pub(crate) fn forget_vault(app: &tauri::AppHandle, memex_id: &str) {
    let mut registry = read_registry(app);
    let before = registry.locations.len();
    registry
        .locations
        .retain(|location| location.memex_id != memex_id);
    if registry.locations.len() != before {
        if let Err(error) = write_registry(app, &registry) {
            eprintln!("rotli: could not forget the vault location ({error})");
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn forget_vault(_app: &tauri::AppHandle, _memex_id: &str) {}

/// Resolve moved/renamed compatible vaults before the startup registry opens
/// paths and watchers. Existing configurations are upgraded lazily by seeding
/// bookmarks for every currently reachable Rotli vault. Plain adopted folders
/// have no portable vault id, so they deliberately remain path-based.
#[cfg(target_os = "macos")]
pub(crate) fn repair_vault_locations(app: &tauri::AppHandle) -> Result<bool, String> {
    let Some(mut config) = crate::corpus::read_corpus_config(app) else {
        return Ok(false);
    };
    let mut registry = read_registry(app);
    let mut config_changed = false;
    let mut registry_changed = false;

    for location in &mut registry.locations {
        let Ok((resolved, stale)) = resolve_bookmark(&location.bookmark) else {
            continue;
        };
        let resolved_id = memex_id_at(&resolved);
        config_changed |= repoint_config_for_resolved_vault(
            &mut config,
            location,
            &resolved,
            resolved_id.as_deref(),
        );
        if resolved_id.as_deref() != Some(location.memex_id.as_str()) {
            continue;
        }
        if location.last_path != resolved {
            location.last_path = resolved.clone();
            registry_changed = true;
        }
        if stale {
            if let Ok(bookmark) = create_bookmark(&resolved) {
                location.bookmark = bookmark;
                registry_changed = true;
            }
        }
    }

    let mut current_paths = vec![config.corpus.abs_path.clone()];
    current_paths.extend(config.brains.iter().map(|brain| brain.abs_path.clone()));
    for path in current_paths {
        match remember_in_registry(&mut registry, &path) {
            Ok(changed) => registry_changed |= changed,
            Err(error) => {
                eprintln!("rotli: could not seed the vault location bookmark ({error})")
            }
        }
    }

    if config_changed {
        crate::corpus::write_corpus_config(app, &config)?;
    }
    if registry_changed {
        write_registry(app, &registry)?;
    }
    Ok(config_changed)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn repair_vault_locations(_app: &tauri::AppHandle) -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use crate::corpus::{ConnectedBrain, CorpusConfig, CorpusRef};
    use crate::memex::MemexPerms;

    use super::{picker_start_directory, repoint_config_for_resolved_vault, VaultLocationRef};

    fn config_at(path: PathBuf) -> CorpusConfig {
        CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: path,
                adopted: false,
            },
            brains: Vec::new(),
            folders: Vec::new(),
            active_brain_id: None,
        }
    }

    #[test]
    fn folder_picker_starts_at_home_then_beside_the_current_vault() {
        let home = Path::new("/Users/example");
        assert_eq!(picker_start_directory(None, home), home);
        assert_eq!(
            picker_start_directory(Some(Path::new("/Users/example/Notes/rotli")), home),
            Path::new("/Users/example/Notes")
        );
        assert_eq!(
            picker_start_directory(Some(Path::new("/Volumes/Work/brain")), home),
            Path::new("/Volumes/Work")
        );
    }

    #[test]
    fn moved_vault_repoints_only_when_its_stable_identity_matches() {
        let old = PathBuf::from("/Users/example/old/vault");
        let moved = PathBuf::from("/Users/example/Desktop/vault");
        let location = VaultLocationRef {
            memex_id: "mx_expected".into(),
            last_path: old.clone(),
            bookmark: "opaque".into(),
        };
        let mut cfg = config_at(old.clone());
        cfg.brains.push(ConnectedBrain {
            id: "other".into(),
            label: "Other".into(),
            abs_path: PathBuf::from("/Users/example/other"),
            memex_id: Some("mx_other".into()),
            mode: None,
            perms: MemexPerms::ReadOnly,
        });

        assert!(!repoint_config_for_resolved_vault(
            &mut cfg,
            &location,
            &moved,
            Some("mx_wrong")
        ));
        assert_eq!(cfg.corpus.abs_path, old);

        assert!(repoint_config_for_resolved_vault(
            &mut cfg,
            &location,
            &moved,
            Some("mx_expected")
        ));
        assert_eq!(cfg.corpus.abs_path, moved);
        assert_eq!(cfg.brains.len(), 1, "an unrelated linked vault survives");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_bookmark_resolves_the_same_directory_after_a_finder_style_move() {
        use super::{create_bookmark, resolve_bookmark};

        let temp = tempfile::TempDir::new().unwrap();
        let original = temp.path().join("original-vault");
        let moved = temp.path().join("moved-vault");
        std::fs::create_dir_all(&original).unwrap();
        let bookmark = create_bookmark(&original).unwrap();
        std::fs::rename(&original, &moved).unwrap();

        let (resolved, _) = resolve_bookmark(&bookmark).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(moved).unwrap());
    }
}
