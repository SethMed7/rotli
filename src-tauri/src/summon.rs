//! How a window comes forward. Every path that brings Rotli up — a global
//! chord, the tray, the Dock, a deep link, a webview command — names a
//! [`SummonIntent`] and calls [`SummonIntent::perform`], so the rules live here
//! once instead of beside each call site.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::{chat_window, quick_window};

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// When the main window was last hidden because it lost focus.
pub(crate) struct LastBlurHide(pub(crate) Mutex<Option<Instant>>);

/// What the person (or the system) asked for when a window is brought up.
///
/// The window is a visitor, not a resident: it lives in the menu bar, is
/// summoned, and hides on blur or Esc (click-away hiding is the
/// `set_hide_on_blur` setting, so heavy use can keep it resident). A summon
/// reveals the LIVING window — it never recreates one, which is why closing
/// only ever hides.
///
/// THE SUMMON LAW (revised by the maintainer, 2026-06-12): ⌥Space toggles the
/// MAIN window — "Option+Space is the way we open the app." The capture card
/// has its own chord (default ⌥C), ⌥A ("ask") lands in a chat, and ⌥F
/// ("find") opens ⌘K. Tray left-click toggles main too. Every chord is
/// rebindable through `set_summon_shortcut`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SummonIntent {
    /// ⌥Space and the webview's `toggle_main_window`. Visible AND focused →
    /// hide. Visible but BEHIND other apps (the Stay-open setting) → bring it
    /// forward instead of hiding a window the person can't properly see.
    /// Hidden → show.
    ToggleMain,
    /// Tray left-click: [`ToggleMain`](Self::ToggleMain), except that a main
    /// window hidden by blur within `BLUR_TOGGLE_GRACE` stays hidden — that
    /// blur was this very click taking focus, and the click meant "hide".
    ToggleMainFromTray,
    /// Show and focus main; never hides. Tray "Open rotli", a genuine Dock
    /// Reopen, `rotli open` / rotli:// requests, folder windows handing off to
    /// main, a failed quit flush, and the webview's `show_main_window`.
    ShowMain,
    /// ⌥A: SHOW, never toggle — "ask" must always land you in a chat, not
    /// hide the app. Surfaces whichever window Chat lives in right now; that
    /// webview picks or creates the chat.
    Chat,
    /// ⌥F: the same show-never-toggle law — "find" must always land you in
    /// the palette; main's webview opens ⌘K.
    Search,
    /// ⌥C and the webview's `summon`: toggle the one-breath capture card.
    ToggleCapture,
    /// ⌥Q: toggle the floating Quick Note (its return-focus rules live in
    /// `quick_window`).
    ToggleQuick,
}

impl SummonIntent {
    pub(crate) fn perform(self, app: &AppHandle) {
        match self {
            Self::ToggleMain => toggle_main(app, false),
            Self::ToggleMainFromTray => toggle_main(app, true),
            Self::ShowMain => show_main(app),
            Self::Chat => {
                if chat_window::is_open(app) {
                    chat_window::show(app);
                    let _ = app.emit_to(chat_window::LABEL, "rotli:summon-chat", ());
                } else {
                    show_main(app);
                    let _ = app.emit_to("main", "rotli:summon-chat", ());
                }
            }
            Self::Search => {
                show_main(app);
                let _ = app.emit_to("main", "rotli:summon-search", ());
            }
            Self::ToggleCapture => {
                if crate::is_visible(app, "capture") {
                    crate::hide_capture(app);
                    return;
                }
                crate::show_capture(app);
            }
            Self::ToggleQuick => quick_window::toggle(app),
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_main(app: &AppHandle, respect_blur_grace: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        if window.is_focused().unwrap_or(true) {
            let _ = window.hide();
            return;
        }
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    if respect_blur_grace {
        let recently_hidden = app
            .state::<LastBlurHide>()
            .0
            .lock()
            .unwrap()
            .is_some_and(|at| at.elapsed() < BLUR_TOGGLE_GRACE);
        if recently_hidden {
            return;
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
}
