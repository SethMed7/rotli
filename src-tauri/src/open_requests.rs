//! Opening things from outside the window: a `rotli://` link, `rotli open`,
//! and a file macOS hands Rotli from Finder (docs/design/open-in-rotli.md).
//! Each ends in the one-shot open mailbox the main webview consumes through
//! `rotli:open-request`.

use tauri::{AppHandle, Emitter, Manager};

use crate::{corpus, deep_link, fsutil, SummonIntent};

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
/// own window (stage 2, folder_window.rs).
fn open_from_finder(app: &AppHandle, path: &std::path::Path) {
    if path.is_dir() {
        crate::folder_window::open(app, path);
        return;
    }
    let Ok(cache) = app.path().app_cache_dir() else { return };
    let Ok(file) = std::fs::canonicalize(path) else { return };
    let root_id = corpus::raw::raw_root_id(&file);
    let state = app.state::<corpus::CorpusState>();
    let (id, kind) = {
        let Ok(mut registry) = state.0.lock() else { return };
        if !registry.contains(&root_id) {
            let Ok(store) = corpus::CorpusStore::open_raw_file(&file, &cache.join("opened-files")) else {
                return;
            };
            if registry.insert(root_id.clone(), store).is_err() {
                return;
            }
            // an image or video previews over asset://: this one file, never its folder
            let _ = app.asset_protocol_scope().allow_file(&file);
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
    let path = root.join(".rotli").join("workspace-open.json");
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let body = serde_json::json!({ "id": id, "kind": kind }).to_string();
    if fsutil::atomic_write(&path, &body, ".rotli-open-").is_err() {
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
