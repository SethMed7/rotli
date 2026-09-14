//! A narrow, session-scoped directory navigator for vault selection.
//!
//! The webview never receives arbitrary filesystem access. Rust owns a single
//! session rooted at Home, returns visible direct-child directories only, and
//! validates every navigation step again. Hidden names, symlinks, files, and
//! ancestors of Home never cross this boundary.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone)]
struct VaultBrowserSession {
    home: PathBuf,
    current: PathBuf,
    require_empty: bool,
}

#[derive(Default)]
pub(crate) struct VaultBrowserState(Mutex<Option<VaultBrowserSession>>);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultBrowserEntry {
    name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultBrowserView {
    absolute_path: String,
    display_path: String,
    home_path: String,
    directories: Vec<VaultBrowserEntry>,
    can_go_back: bool,
    can_select: bool,
    select_disabled_reason: Option<String>,
}

fn safe_child_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.starts_with('.') {
        return Err("Hidden folders cannot be opened here.".into());
    }
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err("Choose a direct child folder.".into());
    }
    Ok(name)
}

fn list_directories_at(path: &Path) -> Result<Vec<VaultBrowserEntry>, String> {
    let entries =
        fs::read_dir(path).map_err(|error| format!("Read {}: {error}", path.display()))?;
    let mut directories = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        // `DirEntry::file_type` does not follow symlinks. A symlinked directory
        // could otherwise escape the Home containment after canonicalization.
        if file_type.is_dir() && !file_type.is_symlink() {
            directories.push(VaultBrowserEntry { name });
        }
    }
    directories.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(directories)
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    Ok(fs::read_dir(path)
        .map_err(|error| format!("Read {}: {error}", path.display()))?
        .next()
        .is_none())
}

fn display_path(home: &Path, current: &Path) -> String {
    let Ok(relative) = current.strip_prefix(home) else {
        return current.to_string_lossy().to_string();
    };
    if relative.as_os_str().is_empty() {
        "~".into()
    } else {
        format!("~/{}", relative.to_string_lossy())
    }
}

fn selection_disabled_reason(
    app: &tauri::AppHandle,
    session: &VaultBrowserSession,
) -> Result<Option<String>, String> {
    if session.current == session.home {
        return Ok(Some(
            "Choose or create a folder inside Home. Home itself includes private app and credential data."
                .into(),
        ));
    }
    if let Err(error) = crate::reject_privileged_root(app, &session.current) {
        return Ok(Some(error));
    }
    if session.require_empty && !directory_is_empty(&session.current)? {
        return Ok(Some("Choose an empty folder for a new vault.".into()));
    }
    Ok(None)
}

fn session_view(
    app: &tauri::AppHandle,
    session: &VaultBrowserSession,
) -> Result<VaultBrowserView, String> {
    let directories = list_directories_at(&session.current)?;
    let select_disabled_reason = selection_disabled_reason(app, session)?;
    Ok(VaultBrowserView {
        absolute_path: session.current.to_string_lossy().to_string(),
        display_path: display_path(&session.home, &session.current),
        home_path: session.home.to_string_lossy().to_string(),
        directories,
        can_go_back: session.current != session.home,
        can_select: select_disabled_reason.is_none(),
        select_disabled_reason,
    })
}

fn canonical_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    fs::canonicalize(&home).map_err(|error| format!("Open Home {}: {error}", home.display()))
}

fn with_session<T>(
    state: &VaultBrowserState,
    operation: impl FnOnce(&mut VaultBrowserSession) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault browser lock poisoned.".to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "The vault browser is not open.".to_string())?;
    operation(session)
}

fn direct_child(session: &VaultBrowserSession, name: &str) -> Result<PathBuf, String> {
    safe_child_name(name)?;
    let child = session.current.join(name);
    let metadata =
        fs::symlink_metadata(&child).map_err(|error| format!("Open folder {name}: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("That item is not a directly accessible folder.".into());
    }
    let child = fs::canonicalize(&child).map_err(|error| format!("Open folder {name}: {error}"))?;
    if !child.starts_with(&session.home) || child == session.home {
        return Err("That folder is outside this Home browser session.".into());
    }
    Ok(child)
}

#[tauri::command]
pub(crate) fn vault_browser_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
    require_empty: bool,
) -> Result<VaultBrowserView, String> {
    let home = canonical_home(&app)?;
    let session = VaultBrowserSession {
        home: home.clone(),
        current: home,
        require_empty,
    };
    let view = session_view(&app, &session)?;
    *state
        .0
        .lock()
        .map_err(|_| "Vault browser lock poisoned.".to_string())? = Some(session);
    Ok(view)
}

#[tauri::command]
pub(crate) fn vault_browser_open_child(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
    name: String,
) -> Result<VaultBrowserView, String> {
    with_session(&state, |session| {
        session.current = direct_child(session, &name)?;
        session_view(&app, session)
    })
}

#[tauri::command]
pub(crate) fn vault_browser_go_back(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
) -> Result<VaultBrowserView, String> {
    with_session(&state, |session| {
        if session.current != session.home {
            let parent = session
                .current
                .parent()
                .filter(|parent| parent.starts_with(&session.home))
                .unwrap_or(&session.home)
                .to_path_buf();
            session.current = parent;
        }
        session_view(&app, session)
    })
}

#[tauri::command]
pub(crate) fn vault_browser_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
) -> Result<VaultBrowserView, String> {
    with_session(&state, |session| session_view(&app, session))
}

/// Create `name` under `parent`, or, when a folder of that name is already
/// there, hand back that folder: the picker's job is to land somewhere, so an
/// existing folder is the destination, not an error. Returns the canonical path.
fn create_or_enter_dir(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let child = parent.join(name);
    match fs::create_dir(&child) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if !child.is_dir() {
                return Err(format!(
                    "A file named \"{name}\" is already here. Choose another folder name."
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err("Rotli can't create a folder here. Choose a folder you can write to.".into());
        }
        Err(_) => {
            return Err(format!(
                "Rotli couldn't create \"{name}\". Try another name or location."
            ));
        }
    }
    fs::canonicalize(&child).map_err(|_| format!("Rotli couldn't open \"{name}\"."))
}

#[tauri::command]
pub(crate) fn vault_browser_create_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
    name: String,
) -> Result<VaultBrowserView, String> {
    safe_child_name(name.trim())?;
    with_session(&state, |session| {
        let child = create_or_enter_dir(&session.current, name.trim())?;
        if !child.starts_with(&session.home) || child == session.home {
            return Err("That folder is outside this Home browser session.".into());
        }
        session.current = child;
        session_view(&app, session)
    })
}

#[tauri::command]
pub(crate) fn vault_browser_select(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
) -> Result<String, String> {
    let selected = with_session(&state, |session| {
        if let Some(reason) = selection_disabled_reason(&app, session)? {
            return Err(reason);
        }
        app.state::<crate::memex::FolderAuthorizations>()
            .authorize(&session.current)
    })?;
    *state
        .0
        .lock()
        .map_err(|_| "Vault browser lock poisoned.".to_string())? = None;
    Ok(selected.to_string_lossy().to_string())
}

/// Select a visible child directly without navigating into it first. This is
/// the row-selection path used by the browser's primary Connect action; the
/// same containment, symlink, privileged-root, and empty-folder gates apply.
#[tauri::command]
pub(crate) fn vault_browser_select_child(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultBrowserState>,
    name: String,
) -> Result<String, String> {
    let selected = with_session(&state, |session| {
        let child = direct_child(session, &name)?;
        let candidate = VaultBrowserSession {
            home: session.home.clone(),
            current: child,
            require_empty: session.require_empty,
        };
        if let Some(reason) = selection_disabled_reason(&app, &candidate)? {
            return Err(reason);
        }
        app.state::<crate::memex::FolderAuthorizations>()
            .authorize(&candidate.current)
    })?;
    *state
        .0
        .lock()
        .map_err(|_| "Vault browser lock poisoned.".to_string())? = None;
    Ok(selected.to_string_lossy().to_string())
}

#[tauri::command]
pub(crate) fn vault_browser_cancel(
    state: tauri::State<'_, VaultBrowserState>,
) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "Vault browser lock poisoned.".to_string())? = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn vault_browser_reveal(
    state: tauri::State<'_, VaultBrowserState>,
) -> Result<(), String> {
    let current = with_session(&state, |session| Ok(session.current.clone()))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&current)
        .spawn()
        .map_err(|error| format!("Open Finder: {error}"))?;
    #[cfg(not(target_os = "macos"))]
    let _ = current;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{create_or_enter_dir, display_path, list_directories_at, safe_child_name};
    use std::fs;
    use std::path::Path;

    #[test]
    fn navigation_accepts_only_visible_direct_children() {
        assert_eq!(safe_child_name("Desktop").unwrap(), "Desktop");
        for unsafe_name in ["", ".ssh", ".", "..", "../outside", "nested/child"] {
            assert!(
                safe_child_name(unsafe_name).is_err(),
                "accepted {unsafe_name:?}"
            );
        }
    }

    #[test]
    fn directory_listing_never_exposes_files_hidden_names_or_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir(temp.path().join("Bravo")).unwrap();
        fs::create_dir(temp.path().join("alpha")).unwrap();
        fs::create_dir(temp.path().join(".private")).unwrap();
        fs::write(temp.path().join("note.md"), "private note title").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(temp.path().join("Bravo"), temp.path().join("linked")).unwrap();

        let names: Vec<_> = list_directories_at(temp.path())
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, ["alpha", "Bravo"]);
    }

    #[test]
    fn new_folder_creates_a_fresh_folder_and_enters_an_existing_one() {
        let temp = tempfile::tempdir().unwrap();
        let fresh = create_or_enter_dir(temp.path(), "Notes").unwrap();
        assert!(fresh.is_dir());
        fs::write(fresh.join("keep.md"), "kept").unwrap();

        // a folder that already exists is where the person wanted to go
        let again = create_or_enter_dir(temp.path(), "Notes").unwrap();
        assert_eq!(again, fresh);
        assert_eq!(fs::read_to_string(again.join("keep.md")).unwrap(), "kept");
    }

    #[test]
    fn new_folder_refuses_a_file_of_the_same_name_in_product_voice() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("Notes"), "a file").unwrap();
        let error = create_or_enter_dir(temp.path(), "Notes").unwrap_err();
        assert!(error.contains("A file named \"Notes\" is already here"), "{error}");
        assert!(!error.contains("os error"), "{error}");
    }

    #[test]
    fn home_path_is_presented_as_tilde_without_changing_its_real_identity() {
        let home = Path::new("/Users/example");
        assert_eq!(display_path(home, home), "~");
        assert_eq!(
            display_path(home, &home.join("Desktop/memex")),
            "~/Desktop/memex"
        );
    }
}
