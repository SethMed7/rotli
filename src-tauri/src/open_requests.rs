//! Opening things from outside the window: a `rotli://` link, `rotli open`,
//! and a file macOS hands Rotli from Finder (docs/design/open-in-rotli.md).
//! Each ends in the one-shot open mailbox the main webview consumes through
//! `rotli:open-request`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

use crate::{corpus, deep_link, fsutil, workspace::WorkspaceOpenRequest, SummonIntent};

const TEMP_PREFIX: &str = ".rotli-open-";

/// The one-shot open mailbox under a default root.
pub(crate) fn mailbox(root: &Path) -> PathBuf {
    root.join(corpus::DOT_DIR).join("workspace-open.json")
}

/// The mailbox ready to be written: its path, the folder made, and the body.
fn prepare(root: &Path, request: &WorkspaceOpenRequest) -> Result<(PathBuf, String), String> {
    let path = mailbox(root);
    let parent = path.parent().ok_or("open request has no parent")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let body = serde_json::to_string(request).map_err(|error| error.to_string())?;
    Ok((path, body))
}

/// Queue `request`. The mailbox holds one, and the newest wins.
pub(crate) fn write_mailbox(root: &Path, request: &WorkspaceOpenRequest) -> Result<(), String> {
    let (path, body) = prepare(root, request)?;
    fsutil::atomic_write(&path, &body, TEMP_PREFIX)
}

/// One accepted deep link → write the one-shot mailbox at the default root,
/// surface the window, and let the webview consume it (the exact flow of
/// `rotli open`, minus the redundant `open -a rotli` — we ARE the app).
pub(crate) fn handle_deep_link(app: &AppHandle, url: &tauri::Url) {
    let (id, kind) = match deep_link::parse(url) {
        Some(deep_link::DeepLink::Open { id, kind }) => (id, kind),
        Some(deep_link::DeepLink::Reveal { rel, vault }) => {
            reveal_deep_link(app, &rel, vault.as_deref());
            return;
        }
        Some(deep_link::DeepLink::OpenPath { path }) => {
            open_from_finder(app, &path);
            return;
        }
        None => return,
    };
    queue_open_request(app, &id, &kind);
}

/// A file macOS handed Rotli opens in a tab without joining a vault (the
/// raw mount, corpus_raw.rs; docs/design/open-in-rotli.md stage 1). The root
/// id is the grant: only this OS event mounts a path. A folder opens in its
/// own window (stage 2, folder_window.rs). Standalone Rotli gets these from
/// its deep-link plugin, a host build from its run loop (host.rs); a host
/// build opens neither inside a vault it doesn't own (host-seams.md).
fn open_from_finder(app: &AppHandle, path: &std::path::Path) {
    if path.is_dir() {
        // off the run loop: a host build's vault refusal walks the folder
        let (app, dir) = (app.clone(), path.to_path_buf());
        std::thread::spawn(move || {
            if let Err(message) = crate::reject_privileged_root(&app, &dir) {
                return crate::folder_window::refused(&app, &message);
            }
            crate::folder_window::open(&app, &dir); // vault bind (refused): reject_privileged_root above; mount_and_show refuses again before it binds
        });
        return;
    }
    let Ok(cache) = app.path().app_cache_dir() else { return };
    let Ok(file) = std::fs::canonicalize(path) else { return };
    if let Err(message) = crate::app_identity::refuse_existing_vault(&file) {
        let _ = app.emit_to("main", "rotli:open-notice", format!("Couldn’t open that file — {message}"));
        SummonIntent::ShowMain.perform(app);
        return;
    }
    let root_id = corpus::raw::raw_root_id(&file);
    let state = app.state::<corpus::CorpusState>();
    let (id, kind) = {
        let Ok(mut registry) = state.0.lock() else { return };
        if !registry.contains(&root_id) {
            let Ok(store) = corpus::CorpusStore::open_raw_file(&file, &cache.join("opened-files")) else { // vault bind (refused): refuse_existing_vault above
                return;
            };
            if registry.insert(root_id.clone(), store).is_err() {
                return;
            }
            // an image or video previews over asset://: this one file, never its folder
            let _ = app.asset_protocol_scope().allow_file(&file); // vault bind (refused): refuse_existing_vault above
        }
        let Some(item) = registry.raw_item(&root_id) else { return };
        item
    };
    queue_open_request(app, &format!("{root_id}:{id}"), kind);
}

/// The one-shot open mailbox `rotli open` and rotli:// links share.
fn queue_open_request(app: &AppHandle, id: &str, kind: &str) {
    let Ok(root) = app.state::<corpus::CorpusState>().default_root_path() else {
        return;
    };
    let request = WorkspaceOpenRequest { id: id.into(), kind: kind.into() };
    if write_mailbox(&root, &request).is_err() {
        return;
    }
    SummonIntent::ShowMain.perform(app);
    let _ = app.emit_to("main", "rotli:open-request", ());
}

/// `rotli://reveal`: Finder at a vault file, for Rotli Web (2026-09-17). Only
/// the default vault answers, and only when the link names it (or names none):
/// the page is connected to ONE folder by name, and a copy of some other vault
/// must not reveal this one's files. Same guard as "Show in Finder".
fn reveal_deep_link(app: &AppHandle, rel: &str, vault: Option<&str>) {
    let state = app.state::<corpus::CorpusState>();
    if let Some(name) = vault {
        let Ok(root) = state.default_root_path() else { return };
        if root.file_name().and_then(|n| n.to_str()) != Some(name) {
            return;
        }
    }
    let _ = corpus::corpus_reveal_file(state, rel.to_string());
}

/// The webview took a request before a setup vault switch that didn't happen
/// (src/state/openRequestGate.ts): queue it again, so a quit keeps it. No
/// summon and no event, because setup is still holding the mailbox.
#[tauri::command]
pub(crate) fn workspace_return_open_request(
    state: tauri::State<'_, corpus::CorpusState>,
    request: WorkspaceOpenRequest,
) -> Result<(), String> {
    return_to_mailbox(&state.default_root_path()?, &request)
}

/// Checked as a rotli:// link is. A request already waiting is newer and stays.
fn return_to_mailbox(root: &Path, request: &WorkspaceOpenRequest) -> Result<(), String> {
    if !deep_link::valid_open(&request.id, &request.kind) {
        return Err("not an open request".into());
    }
    let (path, body) = prepare(root, request)?;
    fsutil::atomic_write_new(&path, &body, TEMP_PREFIX)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str, kind: &str) -> WorkspaceOpenRequest {
        WorkspaceOpenRequest { id: id.into(), kind: kind.into() }
    }

    fn mailed(root: &Path) -> Option<String> {
        std::fs::read_to_string(mailbox(root)).ok()
    }

    #[test]
    fn a_returned_request_is_queued_again_even_before_the_sidecar_folder_exists() {
        let root = tempfile::tempdir().unwrap();
        return_to_mailbox(root.path(), &request("wiki/plan.md", "note")).unwrap();
        assert_eq!(mailed(root.path()).as_deref(), Some(r#"{"id":"wiki/plan.md","kind":"note"}"#));
    }

    #[test]
    fn a_returned_request_never_replaces_a_newer_one() {
        let root = tempfile::tempdir().unwrap();
        return_to_mailbox(root.path(), &request("newer", "note")).unwrap();
        return_to_mailbox(root.path(), &request("older", "board")).unwrap();
        assert!(mailed(root.path()).unwrap_or_default().contains("newer"));
    }

    #[test]
    fn only_a_well_formed_request_is_written() {
        let root = tempfile::tempdir().unwrap();
        for (id, kind) in [("", "note"), ("../outside.md", "note"), ("/etc/hosts", "file"), ("a.md", "chat")] {
            assert!(return_to_mailbox(root.path(), &request(id, kind)).is_err(), "{id} {kind}");
        }
        assert_eq!(mailed(root.path()), None);
    }
}
