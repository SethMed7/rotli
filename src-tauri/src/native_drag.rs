//! Finder drags over a Rotli window. Tauri owns the OS drag session (the
//! webview never sees DataTransfer paths), so the host relays two things:
//! the live pointer while a drag hovers — the editor draws where the image
//! will land — and the authorized drop itself. Drop paths are visible to the
//! webview only after `ImportAuthorizations` issued their one-shot grants.

use tauri::{DragDropEvent, Emitter, Manager, Window};

use crate::corpus::ImportAuthorizations;

/// The webview event a hovering drag rides on (docs/architecture/window-events.md).
pub(crate) const DRAG_EVENT: &str = "rotli:native-drag";
/// The webview event a granted drop rides on.
pub(crate) const DROP_EVENT: &str = "rotli:native-drop-authorized";

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

#[derive(Clone, serde::Serialize)]
struct DropPosition {
    x: f64,
    y: f64,
}

/// Relay one native drag-drop event to the window's webview.
pub(crate) fn handle(window: &Window, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { paths, position } => {
            let _ = window.emit(
                DRAG_EVENT,
                NativeDrag { phase: "over", x: position.x, y: position.y, count: paths.len() },
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
            let paths = window.app_handle().state::<ImportAuthorizations>().authorize_native_drop(paths);
            if !paths.is_empty() {
                let _ = window.emit(
                    DROP_EVENT,
                    AuthorizedNativeDrop { paths, position: DropPosition { x: position.x, y: position.y } },
                );
            }
        }
        _ => {}
    }
}
