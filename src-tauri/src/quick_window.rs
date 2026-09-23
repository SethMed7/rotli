//! The floating Quick Note window (label "quick", `index.html?window=quick`):
//! summon, toggle, close, and click-away. Its law: the quick chord controls
//! ONLY the quick note (the maintainer, 2026-06-24/30, 2026-09-23). Summoning
//! it must never surface the main window, and closing it returns focus to
//! where you came from.
//!
//! Focusing the panel activates the app, and macOS activation raises EVERY
//! window the app has ordered in — so with "Stay open" on and main left behind
//! another app, ⌥Q used to bring main up with the note ("it opens the main app
//! too"). The capture card fixed the same bug by tucking main for the duration
//! (`capture_return_plan`); the Quick Note now follows that plan too.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::chat_window::SHELL_LABELS;
use crate::{
    capture_return_plan, center_on_cursor_display, focused_webview_window, hide_main, CaptureReturnPlan,
    LastPanelSummon,
};

const LABEL: &str = "quick";

/// How long a click-away waits before deciding where focus went: the next
/// window's focus event lands after the panel's blur.
const BLUR_SETTLE: Duration = Duration::from_millis(150);

/// Whether the Quick Note window has been positioned this session. We center it
/// on the FIRST summon (on the active display); after that we leave it where the
/// user dragged it — re-centering on every summon meant it felt "stuck in the
/// middle, can't move it" (the maintainer, 2026-06-22).
pub(crate) struct QuickPlaced(pub(crate) Mutex<bool>);

/// Where closing the Quick Note returns focus, captured at summon time:
/// `was_in_main` = back to the main window (you were working in it); otherwise
/// out of rotli. `tuck_main` = main was hidden for the summon and is owed a
/// restore. Mirrors CaptureReturn.
pub(crate) struct QuickReturn(pub(crate) Mutex<CaptureReturnPlan>);

/// A re-summon while main is still tucked keeps the owed restore: main reads
/// as hidden now only because an earlier summon hid it. Pure for tests.
fn quick_return_plan(previous: CaptureReturnPlan, main_visible: bool, main_focused: bool) -> CaptureReturnPlan {
    let mut plan = capture_return_plan(main_visible, main_focused);
    plan.tuck_main |= previous.tuck_main && !main_visible;
    plan
}

/// Snapshot the return target BEFORE the panel steals focus, tucking main when
/// it sits visible behind another app. Working in either shell window (main or
/// the pulled-out Chat window) counts as being in rotli.
fn remember_return(app: &AppHandle) {
    let (main_visible, main_focused) = app
        .get_webview_window("main")
        .map(|w| (w.is_visible().unwrap_or(false), w.is_focused().unwrap_or(false)))
        .unwrap_or((false, false));
    let in_shell = focused_webview_window(app).is_some_and(|w| SHELL_LABELS.contains(&w.label()));
    let (main_visible, main_focused) = (main_visible || in_shell, main_focused || in_shell);
    let state = app.state::<QuickReturn>();
    let mut current = state.0.lock().unwrap();
    let plan = quick_return_plan(*current, main_visible, main_focused);
    if plan.tuck_main && main_visible {
        hide_main(app);
    }
    *current = plan;
}

fn take_return(app: &AppHandle) -> CaptureReturnPlan {
    std::mem::take(&mut *app.state::<QuickReturn>().0.lock().unwrap())
}

fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    remember_return(app);
    // center only the first time this session — afterwards keep the user's
    // dragged position (the window keeps it across hide/show on its own)
    {
        let placed = app.state::<QuickPlaced>();
        let mut done = placed.0.lock().unwrap();
        if !*done {
            center_on_cursor_display(app, &window);
            *done = true;
        }
    }
    // stamp BEFORE we show/focus — focusing activates the app and can fire the
    // spurious Reopen before the window registers as visible (the race that made
    // ⌥Q / a rebound ⌥. open main too) (the maintainer, 2026-06-30).
    *app.state::<LastPanelSummon>().0.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(LABEL, "rotli:quick-show", ());
}

/// Close via the chord or Esc. Came from another app → step out of rotli
/// (NSApp hide) so focus returns there, then put a tucked main back while the
/// app is hidden, where ordering it in cannot surface anything. Working in
/// main → just hide; main is underneath and regains focus with no forced raise.
pub(crate) fn close(app: &AppHandle) {
    let plan = take_return(app);
    if let Some(panel) = app.get_webview_window(LABEL) {
        let _ = panel.hide();
    }
    if plan.was_in_main {
        return;
    }
    #[cfg(target_os = "macos")]
    let _ = app.hide();
    if plan.tuck_main {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
}

/// Click-away: the panel is a visitor and always hides. A tucked main comes
/// back only when focus left rotli, and the same way `close` restores it: step
/// out of rotli first, then order main in while the app is hidden, so it can
/// never pop over the app you clicked. When focus moved to another rotli
/// window, main stays tucked (restoring it would take focus from that window)
/// and the owed restore waits for the next Quick Note close.
pub(crate) fn on_blur(panel: &tauri::Window) {
    let _ = panel.hide();
    let app = panel.app_handle();
    let plan = take_return(app);
    if !plan.tuck_main {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(BLUR_SETTLE);
        if focused_webview_window(&app).is_some() {
            *app.state::<QuickReturn>().0.lock().unwrap() = plan;
            return;
        }
        #[cfg(target_os = "macos")]
        let _ = app.hide();
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    });
}

/// The quick chord: visible + focused → close; visible but behind → bring it
/// forward (refreshing the return target); hidden → show on the active display.
pub(crate) fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    if !window.is_visible().unwrap_or(false) {
        show(app);
        return;
    }
    if window.is_focused().unwrap_or(true) {
        close(app);
        return;
    }
    remember_return(app);
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    const AWAY: CaptureReturnPlan = CaptureReturnPlan { was_in_main: false, tuck_main: false };
    const TUCKED: CaptureReturnPlan = CaptureReturnPlan { was_in_main: false, tuck_main: true };
    const IN_MAIN: CaptureReturnPlan = CaptureReturnPlan { was_in_main: true, tuck_main: false };

    #[test]
    fn main_left_open_behind_another_app_is_tucked_for_the_note() {
        // the reported bug: ⌥Q from another app with Stay-open main behind it
        // raised main along with the note
        assert_eq!(quick_return_plan(AWAY, true, false), TUCKED);
    }

    #[test]
    fn working_in_main_returns_there_and_leaves_main_alone() {
        assert_eq!(quick_return_plan(AWAY, true, true), IN_MAIN);
    }

    #[test]
    fn a_resummon_while_main_is_tucked_keeps_the_owed_restore() {
        assert_eq!(quick_return_plan(TUCKED, false, false), TUCKED);
    }

    #[test]
    fn a_visible_main_resets_any_stale_tuck() {
        // main came back some other way (⌥Space): it is focused now, nothing owed
        assert_eq!(quick_return_plan(TUCKED, true, true), IN_MAIN);
    }

    #[test]
    fn main_hidden_with_nothing_owed_stays_away() {
        assert_eq!(quick_return_plan(AWAY, false, false), AWAY);
    }
}
