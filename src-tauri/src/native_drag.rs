//! Native drags over a Rotli window. Tauri owns the OS drag session (the
//! webview never sees DataTransfer paths), so the host relays two things:
//! the live pointer while a drag hovers — the editor draws where the image
//! will land — and the authorized drop itself. Drop paths are visible to the
//! webview only after `ImportAuthorizations` issued their one-shot grants.
//!
//! wry reads `NSFilenamesPboardType` and nothing else, so a Finder drag
//! arrives here with real paths and a pathless drag (the macOS screenshot
//! thumbnail, an image dragged out of a browser) arrives with none. Paths win
//! when they exist; otherwise `native_drag_promise` reads the drag pasteboard
//! and materialises a file. Every lane ends at `deliver`, so there is exactly
//! one place that grants an import and one place that names the drop events.

use std::path::PathBuf;

use tauri::{DragDropEvent, Emitter, Manager, Window};

use crate::corpus::ImportAuthorizations;

/// The webview event a hovering drag rides on (docs/architecture/window-events.md).
pub(crate) const DRAG_EVENT: &str = "rotli:native-drag";
/// The webview event a granted drop rides on.
pub(crate) const DROP_EVENT: &str = "rotli:native-drop-authorized";
/// The webview event a drop rides on when no dropped item could be granted.
pub(crate) const DROP_REFUSED_EVENT: &str = "rotli:native-drop-refused";

#[derive(Clone, serde::Serialize)]
struct RefusedNativeDrop {
    /// How many items the OS delivered (all refused).
    count: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeDrag {
    /// "over" while files hover the window, "leave" when they left or dropped.
    phase: &'static str,
    /// Physical pixels, as Tauri reports them; the webview converts.
    x: f64,
    y: f64,
    /// How many files ride the drag (0 on leave).
    count: usize,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizedNativeDrop {
    paths: Vec<String>,
    position: DropPosition,
}

/// Where the drop happened, in the physical pixels Tauri reports. `Copy` so a
/// promise that completes later can carry the ORIGINAL drop point.
#[derive(Clone, Copy, serde::Serialize)]
pub(crate) struct DropPosition {
    x: f64,
    y: f64,
}

/// Whether to narrate every drop to the `tauri dev` log — the one way to see
/// what a native drag actually put on the pasteboard.
pub(crate) fn debug_drops() -> bool {
    std::env::var_os("ROTLI_DEBUG_DROPS").is_some_and(|value| value == "1")
}

/// Narrate to stderr AND to `$TMPDIR/rotli-drops-debug.log`: `tauri dev` pipes
/// the app's stderr through its own reader, so a file is the one sure trace.
pub(crate) fn debug_log(line: &str) {
    eprintln!("rotli: {line}");
    let path = std::env::temp_dir().join("rotli-drops-debug.log");
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write;
        let _ = writeln!(file, "{} rotli: {line}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    }
}

/// Grant one-shot imports for `paths` and tell the webview — or say the drop
/// delivered nothing. Every lane (Finder paths, file promises, image bytes)
/// ends here, so authorization and the drop events have exactly one home.
/// `offered` is how many items the drop meant to deliver, so a refusal can say
/// "none of 3" rather than "none of 0".
pub(crate) fn deliver(window: &Window, offered: usize, paths: &[PathBuf], position: DropPosition) {
    let granted =
        window.app_handle().state::<ImportAuthorizations>().authorize_native_drop(paths);
    if granted.is_empty() {
        // folders, vanished files, a poisoned grant lock: say so instead
        // of dropping the gesture on the floor
        eprintln!("rotli: native drop granted none of {offered} dropped item(s)");
        let _ = window.emit(DROP_REFUSED_EVENT, RefusedNativeDrop { count: offered });
    } else {
        let _ = window.emit(DROP_EVENT, AuthorizedNativeDrop { paths: granted, position });
    }
}

/// How many items a hovering drag offers. Finder paths count themselves; a
/// drag with none may still promise a file or carry image bytes, and the page
/// draws no drop line for a count of zero.
#[cfg(target_os = "macos")]
fn hovering_count(paths: &[PathBuf]) -> usize {
    if paths.is_empty() {
        usize::from(crate::native_drag_promise::drag_offers_content())
    } else {
        paths.len()
    }
}

#[cfg(not(target_os = "macos"))]
fn hovering_count(paths: &[PathBuf]) -> usize {
    paths.len()
}

/// Serve a drop the OS gave no paths for. True when the drag pasteboard had
/// something to take — delivered already, or promised and on its way.
#[cfg(target_os = "macos")]
fn claim_pathless(window: &Window, position: DropPosition) -> bool {
    crate::native_drag_promise::claim(window, position)
}

#[cfg(not(target_os = "macos"))]
fn claim_pathless(_window: &Window, _position: DropPosition) -> bool {
    false
}

/// Relay one native drag-drop event to the window's webview.
pub(crate) fn handle(window: &Window, event: &DragDropEvent) {
    if debug_drops() {
        match event {
            DragDropEvent::Enter { paths, .. } => debug_log(&format!("drag enter, {} path(s)", paths.len())),
            DragDropEvent::Leave => debug_log("drag leave"),
            DragDropEvent::Drop { paths, .. } => debug_log(&format!("drop event, {} path(s)", paths.len())),
            DragDropEvent::Over { .. } => {}
            _ => debug_log("drag event of another kind"),
        }
    }
    match event {
        DragDropEvent::Enter { paths, position } => {
            let _ = window.emit(
                DRAG_EVENT,
                NativeDrag {
                    phase: "over",
                    x: position.x,
                    y: position.y,
                    count: hovering_count(paths),
                },
            );
        }
        DragDropEvent::Over { position } => {
            let _ = window.emit(
                DRAG_EVENT,
                NativeDrag { phase: "over", x: position.x, y: position.y, count: 1 },
            );
        }
        DragDropEvent::Leave => {
            let _ = window.emit(DRAG_EVENT, NativeDrag { phase: "leave", x: 0.0, y: 0.0, count: 0 });
        }
        DragDropEvent::Drop { paths, position } => {
            let _ = window.emit(DRAG_EVENT, NativeDrag { phase: "leave", x: 0.0, y: 0.0, count: 0 });
            let position = DropPosition { x: position.x, y: position.y };
            if debug_drops() {
                eprintln!("rotli: drop with {} Finder path(s)", paths.len());
            }
            if !paths.is_empty() {
                deliver(window, paths.len(), paths, position);
            } else if !claim_pathless(window, position) {
                deliver(window, 0, &[], position);
            }
        }
        _ => {}
    }
}
