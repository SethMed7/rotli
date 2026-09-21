//! The Chat window (1.3.0): Chat pulled out of the main window's Home | Chat
//! switch into a window of its own. It is a PRE-DECLARED, initially hidden
//! window (`tauri.conf.json`, label "chat", `index.html?window=chat`) that is
//! only ever shown and hidden — never created or destroyed, the same summon
//! law every Rotli window follows. It runs the same bundle as main and shows
//! only chats.
//!
//! Main stays the ONE writer of viewstate, settings and `.rotli/main.json`; the
//! chat webview reports what it needs recorded over frontend events (the Quick
//! window's protocol). What this module owns is the native half: show/hide, and
//! making sure a second shell window hears the events that used to be addressed
//! to "main" by name — a window that never hears `rotli:corpus-changed` shows a
//! stale chat and then fails its next write on the revision gate.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const LABEL: &str = "chat";

/// The shell windows: the ones that show vault content and must hear about a
/// change to it. (Quick and Capture re-read on show instead.)
pub(crate) const SHELL_LABELS: [&str; 2] = ["main", LABEL];

pub(crate) fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .map(|window| window.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Emit to main and — when it exists — the chat window. Tauri drops an emit to
/// a label with no listener, so a hidden chat window costs nothing here.
pub(crate) fn emit_to_shells<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for label in SHELL_LABELS {
        if app.get_webview_window(label).is_some() {
            let _ = app.emit_to(label, event, payload.clone());
        }
    }
}

/// The vault changed on disk: every shell window re-reads.
pub(crate) fn emit_corpus_changed(app: &AppHandle) {
    emit_to_shells(app, "rotli:corpus-changed", ());
}

pub(crate) fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = app.emit_to(LABEL, "rotli:chat-window-show", ());
}

pub(crate) fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

/// The red close button (or Window → Close Window) on the chat window. The
/// window only hides — but its chats must not be stranded in a window nobody
/// can see, so the webview is asked to hand them back to main ("regroup").
pub(crate) fn request_regroup(app: &AppHandle) {
    let _ = app.emit_to(LABEL, "rotli:chat-window-regroup", ());
}

#[cfg(test)]
mod tests {
    use super::{LABEL, SHELL_LABELS};

    #[test]
    fn the_chat_window_is_a_shell_and_main_comes_first() {
        assert_eq!(LABEL, "chat");
        assert_eq!(SHELL_LABELS, ["main", "chat"]);
    }
}
