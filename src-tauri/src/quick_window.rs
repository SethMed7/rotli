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

use crate::chat_window::{self, SHELL_LABELS};
use crate::{capture_return_plan, center_on_cursor_display, focused_webview_window, CaptureReturnPlan, LastPanelSummon};

const LABEL: &str = "quick";

/// How long a click-away waits before deciding where focus went: the next
/// window's focus event lands after the panel's blur.
const BLUR_SETTLE: Duration = Duration::from_millis(150);

/// Whether the Quick Note window has been positioned this session. We center it
/// on the FIRST summon (on the active display); after that we leave it where the
/// user dragged it — re-centering on every summon meant it felt "stuck in the
/// middle, can't move it" (the maintainer, 2026-06-22).
pub(crate) struct QuickPlaced(pub(crate) Mutex<bool>);

/// Where closing the Quick Note returns focus, and which shell windows it hid
/// for the summon. Activation raises every window the app has ordered in, so
/// the pulled-out Chat window is tucked exactly like main.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct QuickPlan {
    /// `was_in_main` = you were working in a shell window (main or Chat): just
    /// hide the note. `tuck_main` = main was hidden for the summon.
    ret: CaptureReturnPlan,
    /// The Chat window was hidden for the summon and is owed a restore.
    tuck_chat: bool,
    /// The shell window that held focus at summon — it gets focus back after
    /// any restore, so a restored window never lands on top of it.
    return_to: Option<&'static str>,
}

impl QuickPlan {
    fn owes_restore(self) -> bool {
        self.ret.tuck_main || self.tuck_chat
    }

    /// Fold restores still owed from an earlier summon into this one.
    fn merge_owed(self, owed: QuickPlan) -> QuickPlan {
        let mut plan = self;
        plan.ret.tuck_main |= owed.ret.tuck_main;
        plan.tuck_chat |= owed.tuck_chat;
        plan
    }
}

/// What the shell windows looked like at summon time.
#[derive(Clone, Copy, Debug, Default)]
struct ShellState {
    main_visible: bool,
    main_focused: bool,
    chat_visible: bool,
    /// The shell window (main or Chat) that held focus: you were in rotli.
    focused_shell: Option<&'static str>,
}

/// The summon plan. Working in a shell window counts as being in rotli; from
/// anywhere else every visible shell window is tucked. A re-summon keeps
/// restores still owed (a window reads as hidden only because we hid it) until
/// that window is visible again some other way. Pure for tests.
fn quick_return_plan(previous: QuickPlan, shell: ShellState) -> QuickPlan {
    let in_shell = shell.focused_shell.is_some();
    let mut ret = capture_return_plan(shell.main_visible || in_shell, shell.main_focused || in_shell);
    ret.tuck_main |= previous.ret.tuck_main && !shell.main_visible;
    let away = !ret.was_in_main;
    let tuck_chat = away && (shell.chat_visible || previous.tuck_chat);
    QuickPlan { ret, tuck_chat, return_to: shell.focused_shell }
}

/// What a close does: step out of rotli (you came from another app), then
/// order back in whatever is still owed — even when you were in a shell
/// window, since a restore folded in from an earlier click-away can still be
/// pending. Pure for tests.
fn close_steps(plan: QuickPlan) -> (bool, bool) {
    (!plan.ret.was_in_main, plan.owes_restore())
}

/// The plan and a generation that every summon and close bumps, under ONE
/// lock. Each step below is one lock hold, so a click-away's take and its
/// delayed restore can tell when a summon or close has overtaken them.
#[derive(Default)]
pub(crate) struct QuickReturn(Mutex<(QuickPlan, u64)>);

impl QuickReturn {
    /// A summon: bump the generation and record the new plan.
    fn summon(&self, shell: ShellState) -> QuickPlan {
        let mut current = self.0.lock().unwrap();
        current.1 += 1;
        current.0 = quick_return_plan(current.0, shell);
        current.0
    }

    /// A close takes the plan over (bumping, so a pending click-away yields).
    fn take_for_close(&self) -> QuickPlan {
        let mut current = self.0.lock().unwrap();
        current.1 += 1;
        std::mem::take(&mut current.0)
    }

    /// A click-away takes the plan and notes its generation together.
    fn take_for_blur(&self) -> (QuickPlan, u64) {
        let mut current = self.0.lock().unwrap();
        (std::mem::take(&mut current.0), current.1)
    }

    /// The click-away settled: still current → the caller restores (true);
    /// overtaken → its owed restores fold into the live plan (false).
    fn settle(&self, generation: u64, owed: QuickPlan) -> bool {
        let mut current = self.0.lock().unwrap();
        if current.1 == generation {
            return true;
        }
        current.0 = current.0.merge_owed(owed);
        false
    }
}

fn state(app: &AppHandle) -> tauri::State<'_, QuickReturn> {
    app.state::<QuickReturn>()
}

fn shell_state(app: &AppHandle) -> ShellState {
    let (main_visible, main_focused) = app
        .get_webview_window("main")
        .map(|w| (w.is_visible().unwrap_or(false), w.is_focused().unwrap_or(false)))
        .unwrap_or((false, false));
    let focused = focused_webview_window(app);
    ShellState {
        main_visible,
        main_focused,
        chat_visible: chat_window::is_open(app),
        focused_shell: focused.and_then(|w| SHELL_LABELS.into_iter().find(|label| *label == w.label())),
    }
}

/// Snapshot the return target BEFORE the panel steals focus, tucking the shell
/// windows that sit visible behind another app.
fn remember_return(app: &AppHandle) {
    let shell = shell_state(app);
    let plan = state(app).summon(shell);
    for (tucked, visible, label) in [
        (plan.ret.tuck_main, shell.main_visible, "main"),
        (plan.tuck_chat, shell.chat_visible, chat_window::LABEL),
    ] {
        if tucked && visible {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.hide();
            }
        }
    }
}

/// Order the tucked windows back in. Callers make sure this cannot surface
/// anything over another app (rotli hidden) or steal focus (refocus after).
fn restore(app: &AppHandle, plan: QuickPlan) {
    for (tucked, label) in [(plan.ret.tuck_main, "main"), (plan.tuck_chat, chat_window::LABEL)] {
        if tucked {
            if let Some(window) = app.get_webview_window(label) {
                let _ = window.show();
            }
        }
    }
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
/// (NSApp hide) so focus returns there, then put tucked windows back while the
/// app is hidden, where ordering them in cannot surface anything. Working in a
/// shell window → just hide; it is underneath and regains focus with no raise.
pub(crate) fn close(app: &AppHandle) {
    let plan = state(app).take_for_close();
    if let Some(panel) = app.get_webview_window(LABEL) {
        let _ = panel.hide();
    }
    let (step_out, owed) = close_steps(plan);
    #[cfg(target_os = "macos")]
    if step_out {
        let _ = app.hide();
    }
    #[cfg(not(target_os = "macos"))]
    let _ = step_out;
    if owed {
        restore(app, plan);
        // in rotli: the window you summoned from keeps the top and focus
        if !step_out {
            if let Some(window) = plan.return_to.and_then(|label| app.get_webview_window(label)) {
                let _ = window.set_focus();
            }
        }
    }
}

/// Click-away: the panel is a visitor and always hides. Tucked windows come
/// back once focus settles. Focus left rotli → step out of rotli first, as
/// `close` does, so nothing pops over the app you clicked. Focus moved to
/// another rotli window → order them back in behind it and hand focus back to
/// it. A summon or close in the meantime owns the windows now: the owed
/// restores fold into its plan instead.
pub(crate) fn on_blur(panel: &tauri::Window) {
    // a summon already took the panel back: this blur is stale, the plan is its
    if panel.is_focused().unwrap_or(false) {
        return;
    }
    let _ = panel.hide();
    let app = panel.app_handle().clone();
    let (plan, generation) = state(&app).take_for_blur();
    if !plan.owes_restore() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(BLUR_SETTLE);
        if !state(&app).settle(generation, plan) {
            return;
        }
        match focused_webview_window(&app) {
            Some(focused) => {
                restore(&app, plan);
                let _ = focused.set_focus();
            }
            None => {
                #[cfg(target_os = "macos")]
                let _ = app.hide();
                restore(&app, plan);
            }
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

    fn plan(ret: CaptureReturnPlan, tuck_chat: bool, return_to: Option<&'static str>) -> QuickPlan {
        QuickPlan { ret, tuck_chat, return_to }
    }

    fn shell(main_visible: bool, main_focused: bool, chat_visible: bool, focused_shell: Option<&'static str>) -> ShellState {
        ShellState { main_visible, main_focused, chat_visible, focused_shell }
    }

    const FROM_SAFARI_MAIN_BEHIND: ShellState =
        ShellState { main_visible: true, main_focused: false, chat_visible: false, focused_shell: None };
    const NOTHING_UP: ShellState =
        ShellState { main_visible: false, main_focused: false, chat_visible: false, focused_shell: None };

    #[test]
    fn main_left_open_behind_another_app_is_tucked_for_the_note() {
        // the reported bug: ⌥Q from another app with Stay-open main behind it
        // raised main along with the note
        assert_eq!(quick_return_plan(QuickPlan::default(), FROM_SAFARI_MAIN_BEHIND), plan(TUCKED, false, None));
    }

    #[test]
    fn a_chat_window_left_open_behind_another_app_is_tucked_too() {
        assert_eq!(quick_return_plan(QuickPlan::default(), shell(false, false, true, None)), plan(AWAY, true, None));
        assert_eq!(quick_return_plan(QuickPlan::default(), shell(true, false, true, None)), plan(TUCKED, true, None));
    }

    #[test]
    fn working_in_main_or_the_chat_window_returns_there_and_tucks_nothing() {
        let in_main = quick_return_plan(QuickPlan::default(), shell(true, true, true, Some("main")));
        assert_eq!(in_main, plan(IN_MAIN, false, Some("main")));
        // summoned from the Chat window with main behind it: still in rotli
        let in_chat = quick_return_plan(QuickPlan::default(), shell(true, false, true, Some(chat_window::LABEL)));
        assert_eq!(in_chat, plan(IN_MAIN, false, Some(chat_window::LABEL)));
    }

    #[test]
    fn a_resummon_while_windows_are_tucked_keeps_the_owed_restores() {
        let owed = plan(TUCKED, true, None);
        assert_eq!(quick_return_plan(owed, NOTHING_UP), owed);
    }

    #[test]
    fn a_visible_main_resets_any_stale_tuck() {
        // main came back some other way (⌥Space): it is focused now, nothing owed
        let back = quick_return_plan(plan(TUCKED, true, None), shell(true, true, false, Some("main")));
        assert_eq!(back, plan(IN_MAIN, false, Some("main")));
    }

    #[test]
    fn nothing_visible_and_nothing_owed_stays_away() {
        let away = quick_return_plan(QuickPlan::default(), NOTHING_UP);
        assert_eq!(away, plan(AWAY, false, None));
        assert!(!away.owes_restore());
    }

    #[test]
    fn a_close_from_a_shell_window_restores_what_is_owed_and_hands_focus_back() {
        // click-away owed main a restore, then ⌥Q from the Chat window folded
        // it into an in-shell plan: closing must not step out, must restore,
        // and the Chat window you were in gets focus back
        let hybrid = plan(IN_MAIN, false, Some(chat_window::LABEL)).merge_owed(plan(TUCKED, true, None));
        assert_eq!(close_steps(hybrid), (false, true));
        assert_eq!(hybrid.return_to, Some(chat_window::LABEL));
        assert_eq!(close_steps(plan(IN_MAIN, false, Some("main"))), (false, false));
        assert_eq!(close_steps(plan(TUCKED, false, None)), (true, true));
        assert_eq!(close_steps(plan(AWAY, false, None)), (true, false));
    }

    #[test]
    fn a_settled_click_away_nobody_overtook_restores() {
        let quick = QuickReturn::default();
        quick.summon(FROM_SAFARI_MAIN_BEHIND);
        let (owed, generation) = quick.take_for_blur();
        assert_eq!(owed, plan(TUCKED, false, None));
        assert!(quick.settle(generation, owed));
    }

    #[test]
    fn a_summon_before_the_click_away_settles_keeps_the_owed_restore() {
        let quick = QuickReturn::default();
        quick.summon(FROM_SAFARI_MAIN_BEHIND); // main tucked
        let (owed, generation) = quick.take_for_blur();
        // ⌥Q again before the blur settled: main reads hidden, so the fresh plan owes nothing
        assert!(!quick.summon(NOTHING_UP).owes_restore());
        assert!(!quick.settle(generation, owed)); // overtaken → no restore while the note is up
        assert_eq!(quick.take_for_close(), plan(TUCKED, false, None)); // …and the close restores it
    }

    #[test]
    fn a_close_before_the_click_away_settles_owns_the_windows() {
        let quick = QuickReturn::default();
        quick.summon(FROM_SAFARI_MAIN_BEHIND);
        let (owed, generation) = quick.take_for_blur();
        quick.take_for_close();
        assert!(!quick.settle(generation, owed));
    }
}
