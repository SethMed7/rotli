//! A folder macOS hands Rotli from Finder opens raw in its own window
//! (docs/design/open-in-rotli.md, stage 2): a single-folder mount
//! (`CorpusStore::open_raw_folder`) whose window label IS its root id, so the
//! window can only ever reach its own folder. The window persists nothing;
//! closing it saves what's typing, then unmounts the folder. "Add as vault"
//! hands the folder to the main window's ordinary connect flow.

use std::path::Path;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::corpus::{self, raw::RAW_ROOT_PREFIX};

/// Whether a window label is a folder window (its label is its mount's root id).
pub(crate) fn is_folder_window(label: &str) -> bool {
    label.starts_with(RAW_ROOT_PREFIX)
}

/// Mount the folder and open (or bring forward) its window. The first walk
/// runs here, off the main thread, so a large folder never stalls the app.
pub(crate) fn open(app: &AppHandle, path: &Path) {
    let app = app.clone();
    let path = path.to_path_buf();
    std::thread::spawn(move || {
        if let Err(message) = mount_and_show(&app, &path) {
            let _ = app.emit_to("main", "rotli:open-notice", format!("Couldn’t open that folder — {message}"));
            crate::show_main(&app);
        }
    });
}

fn mount_and_show(app: &AppHandle, path: &Path) -> Result<(), String> {
    // never a home folder, an ancestor of one, or a private dot-folder
    crate::reject_privileged_root(app, path)?;
    let dir = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    let root_id = corpus::raw::raw_root_id(&dir);
    let state = app.state::<corpus::CorpusState>();
    if !state.contains_root(&root_id)? {
        let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let store = corpus::CorpusStore::open_raw_folder(&dir, &cache.join("opened-files"))?;
        state.insert_root(root_id.clone(), store)?;
        state.walk_unlocked(&root_id)?;
        // the folder's images and video preview over asset:// while Rotli runs
        let _ = app.asset_protocol_scope().allow_directory(&dir, true);
    }
    if let Some(window) = app.get_webview_window(&root_id) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    let title = dir.file_name().and_then(|name| name.to_str()).unwrap_or("Folder").to_string();
    let name = percent_encoding::utf8_percent_encode(&title, percent_encoding::NON_ALPHANUMERIC);
    let url = WebviewUrl::App(format!("index.html?window=folder&root={root_id}&name={name}").into());
    let builder = WebviewWindowBuilder::new(app, &root_id, url)
        .title(title)
        .inner_size(1100.0, 760.0)
        .min_inner_size(560.0, 420.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(19.0, 24.0));
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// The close button: save what's typing first, then close. A failed save
/// keeps the window open and says why in it.
pub(crate) fn close(app: &AppHandle, label: &str) {
    close_then(app, label, |_| {});
}

/// Save the window's typing, close it, then run `after` — off the main thread,
/// and one save handshake at a time (main's own switch flushes next).
fn close_then(app: &AppHandle, label: &str, after: impl FnOnce(&AppHandle) + Send + 'static) {
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        if let Err(detail) = crate::flush_windows(&app, std::slice::from_ref(&label)) {
            let _ = app.emit_to(label.as_str(), "rotli:open-notice", detail);
            return;
        }
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        after(&app);
    });
}

/// The window is gone: forget its mount (the folder itself is untouched).
pub(crate) fn unmount(app: &AppHandle, label: &str) {
    let _ = app.state::<corpus::CorpusState>().unmount_raw(label);
}

/// "Add as vault": the window's own label names the folder, so the webview
/// never names a path. The folder is authorized like a picked one; once this
/// window has saved and closed, main runs the ordinary connect flow with it.
#[tauri::command]
pub(crate) fn folder_window_add_as_vault(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let label = window.label().to_string();
    let dir = app.state::<corpus::CorpusState>().route(&label, |store| {
        if store.is_raw_folder() {
            Ok(store.root().to_path_buf())
        } else {
            Err("This window isn’t a folder opened from Finder.".into())
        }
    })?;
    let path = app.state::<crate::memex::FolderAuthorizations>().authorize(&dir)?;
    // this window saves and closes FIRST; only then does main start its switch
    // (which runs its own save handshake), so the two never overlap
    close_then(app, &label, move |app| {
        let _ = app.emit_to("main", "rotli:add-vault", path.to_string_lossy().into_owned());
        crate::show_main(app);
    });
    Ok(())
}
