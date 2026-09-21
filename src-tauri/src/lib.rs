// off macOS, code behind macOS-gated entry points is unwired, not dead (Linux cargo-check lane)
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
// rotli — the shell. The window is a visitor, not a resident: it lives in the
// menu bar (no dock icon, no Cmd-Tab), is summoned by a global shortcut, and
// hides on blur or Esc. Summon reveals existing windows without recreating them.
//
// THE SUMMON LAW (revised by the maintainer, 2026-06-12): ⌥Space toggles the MAIN
// window — "Option+Space is the way we open the app." The quick-capture card
// has its own chord (default ⌥C), and ⌥A ("ask") summons the main window
// straight into a chat. ⌘⏎ in the card (save & open) reveals the main window.
// Tray left-click toggles the MAIN window. All chords are rebindable through
// set_summon_shortcut, and click-away hiding is a setting (set_hide_on_blur)
// so heavy use can keep the window resident.

mod app_settings;
mod board;
mod breve;
mod chat;
mod chat_window;
mod clipboard_assets;
mod compute;
mod containment;
mod corpus;
mod deep_link;
mod document_conversion;
mod feature_policy;
mod fsutil;
/// The `rotli-helper` loopback bridge (a second binary, not the app).
pub mod helper;
mod helper_args;
mod helper_token;
mod keychain;
mod loopback_http;
mod localmodel;
mod memex;
mod memex_query; mod native_drag; mod pasteboard; mod remote_agent_url; mod welcome_lessons; mod acp_images;
/// Pathless drops (screenshot thumbnail, browser images) — AppKit only.
#[cfg(target_os = "macos")]
mod native_drag_promise;
mod organizer;
mod organizer_knobs;
#[cfg(test)]
mod parity_tests;
mod private_browser;
mod provider;
mod provider_lane;
mod remote_agent;
mod routines;
mod search_index; mod search_match;
mod secret;
mod spellcheck;
mod usage;
mod vault_browser;
mod vault_location;
mod web;
mod web_search;
mod workspace;
mod workspace_help;

use std::sync::{atomic::{AtomicUsize, Ordering}, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default chords — mirror `app.toggleWindow` / `capture.summon` /
/// `quick.summon` / `chat.summon` in src/keys/actions.ts.
const DEFAULT_MAIN_TOGGLE: &str = "Alt+Space";
const DEFAULT_CAPTURE: &str = "Alt+C";
const DEFAULT_QUICK: &str = "Alt+Q";
const DEFAULT_CHAT_SUMMON: &str = "Alt+A";
const DEFAULT_SEARCH_SUMMON: &str = "Alt+F"; // "find" — summon the window with ⌘K open

#[derive(Debug, PartialEq, Eq)]
enum NativeCloseAction {
    CloseMainTab,
    HideWindow,
}

fn native_close_action(window_label: &str) -> NativeCloseAction {
    // the two shell windows own tabs; every other window is a visitor
    if chat_window::SHELL_LABELS.contains(&window_label) {
        NativeCloseAction::CloseMainTab
    } else {
        NativeCloseAction::HideWindow
    }
}

fn focused_webview_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

fn close_tab_from_native_menu(app: &AppHandle) {
    let Some(window) = focused_webview_window(app) else {
        return;
    };
    match native_close_action(window.label()) {
        NativeCloseAction::CloseMainTab => {
            let _ = window.emit("rotli:close-tab", ());
        }
        NativeCloseAction::HideWindow => {
            let _ = window.hide();
        }
    }
}

fn hide_focused_window(app: &AppHandle) {
    if let Some(window) = focused_webview_window(app) {
        let _ = window.hide();
    }
}

#[cfg(test)]
mod native_close_tests {
    use super::{native_close_action, NativeCloseAction};

    #[test]
    fn command_w_closes_a_main_tab_but_hides_visitor_windows() {
        assert_eq!(native_close_action("main"), NativeCloseAction::CloseMainTab);
        assert_eq!(native_close_action("chat"), NativeCloseAction::CloseMainTab);
        assert_eq!(native_close_action("quick"), NativeCloseAction::HideWindow);
        assert_eq!(
            native_close_action("capture"),
            NativeCloseAction::HideWindow
        );
    }
}

fn development_read_only_for(debug: bool, has_development_vault: bool) -> bool {
    debug && !has_development_vault
}

/// A native debug build may borrow the production-selected vault only as a
/// read-only boot fallback. The first folder explicitly selected by onboarding
/// is recorded in the isolated `corpus.dev.json`; from then on development has
/// an ordinary writable vault of its own and may exercise location workflows.
pub(crate) fn development_read_only(app: &AppHandle) -> bool {
    development_read_only_for(cfg!(debug_assertions), corpus::is_configured(app))
}

#[cfg(all(target_os = "macos", any(not(debug_assertions), test)))]
#[derive(Debug, PartialEq, Eq)]
enum MacosRelaunchTarget {
    Bundle(std::path::PathBuf),
    Executable(std::path::PathBuf),
}

#[cfg(all(target_os = "macos", any(not(debug_assertions), test)))]
fn macos_relaunch_target(current_binary: &std::path::Path) -> MacosRelaunchTarget {
    let bundle = current_binary
        .parent()
        .filter(|parent| parent.file_name() == Some(std::ffi::OsStr::new("MacOS")))
        .and_then(std::path::Path::parent)
        .filter(|parent| parent.file_name() == Some(std::ffi::OsStr::new("Contents")))
        .and_then(std::path::Path::parent)
        .filter(|parent| parent.extension() == Some(std::ffi::OsStr::new("app")));
    match bundle {
        Some(bundle) => MacosRelaunchTarget::Bundle(bundle.to_path_buf()),
        None => MacosRelaunchTarget::Executable(current_binary.to_path_buf()),
    }
}

#[cfg(debug_assertions)]
const DEV_RESTART_MARKER_ENV: &str = "ROTLI_DEV_RESTART_MARKER";

#[cfg(debug_assertions)]
fn valid_dev_restart_marker(path: &std::path::Path) -> bool {
    path.is_absolute()
        && path.parent() == Some(std::env::temp_dir().as_path())
        && path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.starts_with("rotli-dev-restart-"))
}

/// Development is owned by `bun run dev:app`: Tauri owns Vite and the compiled
/// child, so the child must never detach and re-execute itself. Mark the
/// requested restart for the terminal supervisor, then let Tauri tear its
/// generation down cleanly. The supervisor launches the next generation.
#[cfg(debug_assertions)]
fn relaunch_app(app: &AppHandle) -> Result<(), String> {
    let marker = std::env::var_os(DEV_RESTART_MARKER_ENV)
        .map(std::path::PathBuf::from)
        .ok_or_else(|| {
            "The development vault changed. Restart with `bun run dev:app` to open it safely."
                .to_string()
        })?;
    if !valid_dev_restart_marker(&marker) {
        return Err("The development restart marker is invalid; restart `bun run dev:app`.".into());
    }
    std::fs::write(&marker, format!("{}\n", std::process::id()))
        .map_err(|error| format!("request development restart: {error}"))?;
    app.exit(0);
    Ok(())
}

/// Packaged macOS builds relaunch through LaunchServices so the app returns as
/// an ordinary bundle and cleanup finishes before the next process starts.
#[cfg(all(not(debug_assertions), target_os = "macos"))]
fn relaunch_app(app: &AppHandle) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};

    let current = tauri::process::current_binary(&app.env())
        .map_err(|error| format!("locate Rotli for relaunch: {error}"))?;
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    let mut launch: Vec<std::ffi::OsString> = match macos_relaunch_target(&current) {
        MacosRelaunchTarget::Bundle(bundle) => {
            let mut launch = vec!["/usr/bin/open".into(), "-n".into(), bundle.into_os_string()];
            if !args.is_empty() {
                launch.push("--args".into());
                launch.extend(args.iter().cloned());
            }
            launch
        }
        MacosRelaunchTarget::Executable(executable) => {
            let mut launch = vec![executable.into_os_string()];
            launch.extend(args);
            launch
        }
    };
    let mut command = Command::new("/bin/sh");
    command
        // Wait until Tauri cleanup has released global shortcuts, the tray,
        // and WebKit resources. Every value after the script is a positional
        // argument, so paths and launch args never enter shell source.
        .arg("-c")
        .arg("old_pid=$1; shift; while kill -0 \"$old_pid\" 2>/dev/null; do sleep 0.05; done; exec \"$@\"")
        .arg("rotli-relaunch")
        .arg(std::process::id().to_string())
        .args(launch.drain(..))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|error| format!("relaunch Rotli: {error}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(all(not(debug_assertions), not(target_os = "macos")))]
fn relaunch_app(app: &AppHandle) -> Result<(), String> {
    app.restart()
}

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// Summoning a floating panel (Quick Note / capture card) calls set_focus, which
/// activates the app and makes macOS fire a Reopen. Within this grace after a
/// summon, that Reopen is the spurious one — never reopen main (the maintainer, 2026-06-30).
/// Generous on purpose (2s, was 700ms): under startup load (corpus watchers,
/// organizer, Breve supervisor) the Reopen can arrive late and used to escape
/// the old time-box, surfacing main alongside the panel. Safe to be generous
/// because the latch is CONSUMED by the first Reopen (`reopen_should_show_main`)
/// — a stale latch can never eat a later genuine Dock-click Reopen.
const PANEL_SUMMON_GRACE: Duration = Duration::from_secs(2);

/// Decide whether a macOS Reopen should surface the main window. `summoned` is
/// the panel-summon latch, already `take()`n by the caller: a recent summon
/// means THIS Reopen is the panel's own app-activation echo — swallow it.
/// Pure so the suppression law is unit-tested (the race here shipped twice).
fn reopen_should_show_main(
    has_visible_windows: bool,
    ours_up: bool,
    summoned: Option<Instant>,
) -> bool {
    let just_summoned = summoned.is_some_and(|t| t.elapsed() < PANEL_SUMMON_GRACE);
    !has_visible_windows && !ours_up && !just_summoned
}

#[cfg(test)]
mod reopen_tests {
    use super::*;

    #[test]
    fn development_uses_a_read_only_fallback_until_its_own_vault_is_selected() {
        assert!(development_read_only_for(true, false));
        assert!(!development_read_only_for(true, true));
        assert!(!development_read_only_for(false, false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_relaunch_resolves_bundles_and_unbundled_executables() {
        assert_eq!(
            macos_relaunch_target(std::path::Path::new(
                "/Applications/rotli.app/Contents/MacOS/rotli"
            )),
            MacosRelaunchTarget::Bundle(std::path::PathBuf::from("/Applications/rotli.app"))
        );
        assert_eq!(
            macos_relaunch_target(std::path::Path::new(
                "/Users/example/rotli/src-tauri/target/debug/rotli"
            )),
            MacosRelaunchTarget::Executable(std::path::PathBuf::from(
                "/Users/example/rotli/src-tauri/target/debug/rotli"
            ))
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_restart_marker_is_exact_and_temp_scoped() {
        let valid = std::env::temp_dir().join("rotli-dev-restart-42");
        assert!(valid_dev_restart_marker(&valid));
        assert!(!valid_dev_restart_marker(std::path::Path::new(
            "/tmp/not-rotli-restart"
        )));
        assert!(!valid_dev_restart_marker(std::path::Path::new(
            "rotli-dev-restart-42"
        )));
    }

    #[test]
    fn a_recent_panel_summon_swallows_the_reopen() {
        assert!(!reopen_should_show_main(false, false, Some(Instant::now())));
    }

    #[test]
    fn a_stale_latch_never_blocks_a_genuine_reopen() {
        let stale = Instant::now().checked_sub(PANEL_SUMMON_GRACE * 2).unwrap();
        assert!(reopen_should_show_main(false, false, Some(stale)));
    }

    #[test]
    fn nothing_visible_and_no_latch_opens_main() {
        assert!(reopen_should_show_main(false, false, None));
    }

    #[test]
    fn any_visible_window_suppresses() {
        assert!(!reopen_should_show_main(true, false, None));
        assert!(!reopen_should_show_main(false, true, None));
    }
}

/// One accepted deep link → write the one-shot mailbox at the default root,
/// surface the window, and let the webview consume it (the exact flow of
/// `rotli open`, minus the redundant `open -a rotli` — we ARE the app).
fn handle_deep_link(app: &AppHandle, url: &tauri::Url) {
    let (id, kind) = match deep_link::parse(url) {
        Some(deep_link::DeepLink::Open { id, kind }) => (id, kind),
        Some(deep_link::DeepLink::Reveal { rel, vault }) => {
            reveal_deep_link(app, &rel, vault.as_deref());
            return;
        }
        None => return,
    };
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
    show_main(app);
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


/// The OS-registered accelerators, per global registry action (rebindable
/// from the frontend via the `set_summon_shortcut` command).
struct GlobalChords {
    /// `capture.summon` — the quick-capture card.
    capture: Mutex<Option<String>>,
    /// `app.toggleWindow` — main-window toggle (the way the app opens).
    main_toggle: Mutex<Option<String>>,
    /// `quick.summon` — the floating Quick Note window.
    quick: Mutex<Option<String>>,
    /// `chat.summon` — surface the main window and land in a chat ("ask").
    chat: Mutex<Option<String>>,
    /// `palette.summon` — surface the main window with ⌘K search open ("find").
    search: Mutex<Option<String>>,
}

/// When the main window was last hidden because it lost focus.
struct LastBlurHide(Mutex<Option<Instant>>);

/// App-owned native panels temporarily take focus from the webview. That is not
/// click-away intent, so the visitor-law blur handler must leave the parent
/// window visible until the panel settles.
#[derive(Default)]
pub(crate) struct NativeDialogOpen(AtomicUsize);

pub(crate) struct NativeDialogGuard<'a>(&'a NativeDialogOpen);

impl NativeDialogOpen {
    pub(crate) fn begin(&self) -> NativeDialogGuard<'_> {
        self.0.fetch_add(1, Ordering::AcqRel);
        NativeDialogGuard(self)
    }

    fn is_open(&self) -> bool {
        self.0.load(Ordering::Acquire) > 0
    }

    fn end(&self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl Drop for NativeDialogGuard<'_> {
    fn drop(&mut self) {
        self.0.end();
    }
}

/// When a floating panel (Quick Note / capture) was last summoned — stamped BEFORE
/// the panel steals focus, so the spurious Reopen its app-activation triggers is
/// suppressed even if the window's visibility hasn't registered yet.
struct LastPanelSummon(Mutex<Option<Instant>>);

/// The visitor-vs-resident setting: when false, clicking away no longer hides
/// the main window (Settings → General → "Stay open"). Capture always hides.
struct HideOnBlur(Mutex<bool>);

/// Whether the MAIN window was visible when the capture card was last summoned.
/// Finishing a capture uses it to return focus correctly: back to rotli's main
/// window if you were already in the app, or to the app you came from otherwise
/// — so a quick capture from another app never "opens" rotli (the maintainer, 2026-06-19).
struct CaptureReturn(Mutex<CaptureReturnPlan>);

/// What a capture summon must do about the main window and where a finished
/// capture returns. Pure so the policy is testable without a window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CaptureReturnPlan {
    /// main was visible AND focused at summon: finishing just hides the card.
    was_in_main: bool,
    /// main was visible but NOT focused (rotli behind another app): hide it for
    /// the capture and restore it after the app steps out of the way.
    tuck_main: bool,
}

fn capture_return_plan(main_visible: bool, main_focused: bool) -> CaptureReturnPlan {
    let was_in_main = main_visible && main_focused;
    CaptureReturnPlan {
        was_in_main,
        tuck_main: main_visible && !was_in_main,
    }
}

#[cfg(test)]
mod capture_return_tests {
    use super::*;

    #[test]
    fn working_in_main_returns_there_without_touching_it() {
        assert_eq!(
            capture_return_plan(true, true),
            CaptureReturnPlan { was_in_main: true, tuck_main: false }
        );
    }

    #[test]
    fn rotli_open_behind_another_app_is_away_and_main_is_tucked() {
        // the reported bug: ⌥C from another app with main open underneath
        // activated rotli and raised main over the app you were in
        assert_eq!(
            capture_return_plan(true, false),
            CaptureReturnPlan { was_in_main: false, tuck_main: true }
        );
    }

    #[test]
    fn main_hidden_means_away_with_nothing_to_tuck() {
        assert_eq!(
            capture_return_plan(false, false),
            CaptureReturnPlan { was_in_main: false, tuck_main: false }
        );
        // focused-but-hidden cannot happen; treat it as away
        assert!(!capture_return_plan(false, true).was_in_main);
    }
}

/// Whether the Quick Note window has been positioned this session. We center it
/// on the FIRST summon (on the active display); after that we leave it where the
/// user dragged it — re-centering on every summon meant it felt "stuck in the
/// middle, can't move it" (the maintainer, 2026-06-22).
struct QuickPlaced(Mutex<bool>);

/// Where closing the Quick Note returns focus: true = back to the main window
/// (you were working in it), false = out of rotli entirely (you came from
/// another app, or main was tucked away). Captured at summon time so the ⌥Q
/// chord controls ONLY the quick note — closing it never surfaces the main app
/// (the maintainer, 2026-06-24). Mirrors CaptureReturn.
struct QuickReturn(Mutex<bool>);

/// The quit-flush handshake (#4 follow-up, review 2026-07). Dirty spreadsheet
/// sessions flush on window-hide/pagehide, but BOTH real quit paths could fire
/// with the window still up and no hide ever seen ("Stay open" mode): tray-Quit
/// ran `app.exit(0)` directly, and ⌘Q rides the default menu's predefined Quit —
/// native `terminate:`, which tao surfaces only as `applicationWillTerminate`,
/// far too late for the webview's ASYNC serialize (exceljs) to finish. So both
/// paths now route through `graceful_quit`: emit "rotli:flush-before-quit" to
/// every webview, hold the exit until `quit_flush_done` acks (this condvar),
/// and ABORT quit on a failed or timed-out save. A forced OS termination may
/// still kill any process, but Rotli never translates "probably saved" into a
/// normal successful quit.
struct QuitFlush {
    /// Webviews still owing a `quit_flush_done` ack. Every live webview (main,
    /// quick, capture) gets the flush event — the quick window keeps its OWN
    /// editor buffer in its own module instance, so main's ack alone never
    /// proved the quick note's last keystrokes were on disk.
    status: Mutex<QuitFlushStatus>,
    cv: Condvar,
}

#[derive(Default)]
struct QuitFlushStatus {
    attempt_id: u64,
    pending: usize,
    failed: bool,
    errors: Vec<String>,
}

/// The longest a quit will wait for the webview's flush ack. The idle ack is
/// milliseconds (the listener lives in the always-loaded persist chunk); this
/// bound only matters when a big workbook is mid-serialize or the webview hung.
const QUIT_FLUSH_MAX: Duration = Duration::from_secs(15);

/// One webview finished its pre-quit flush — release `graceful_quit`'s wait
/// once EVERY emitted webview has acked (saturating: a double ack never wraps).
#[tauri::command]
fn quit_flush_done(app: AppHandle, attempt_id: u64, ok: bool, error: Option<String>) {
    let state = app.state::<QuitFlush>();
    let mut status = state.status.lock().unwrap();
    if status.attempt_id != attempt_id || status.pending == 0 {
        return;
    }
    status.pending = status.pending.saturating_sub(1);
    if !ok {
        status.failed = true;
        if let Some(error) = error.filter(|value| !value.trim().is_empty()) {
            status.errors.push(error);
        }
    }
    state.cv.notify_all();
}

/// Quit, but let every live webview flush dirty state first (see QuitFlush).
/// Called by the tray's Quit item and the app menu's ⌘Q replacement. Hidden
/// panels ack in milliseconds (nothing dirty), so this adds no quit latency.
fn flush_webviews_before_shutdown(app: &AppHandle) -> Result<(), String> {
    let labels: Vec<&str> = ["main", "quick", "capture", chat_window::LABEL]
        .into_iter()
        .filter(|label| app.get_webview_window(label).is_some())
        .collect();
    let expected = labels.len();
    if expected == 0 {
        return Ok(());
    }
    let state = app.state::<QuitFlush>();
    let attempt_id = {
        let mut status = state.status.lock().unwrap();
        if status.pending > 0 {
            return Err("another quit or restart is already waiting for saves".into());
        }
        status.attempt_id = status.attempt_id.wrapping_add(1).max(1);
        status.pending = expected;
        status.failed = false;
        status.errors.clear();
        status.attempt_id
    };
    for label in labels {
        if app
            .emit_to(
                label,
                "rotli:flush-before-quit",
                serde_json::json!({ "attemptId": attempt_id }),
            )
            .is_err()
        {
            quit_flush_done(
                app.clone(),
                attempt_id,
                false,
                Some(format!("{label} did not receive the save request")),
            );
        }
    }
    let deadline = Instant::now() + QUIT_FLUSH_MAX;
    let mut status = state.status.lock().unwrap();
    while status.attempt_id == attempt_id && status.pending > 0 {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let (guard, _timeout) = state.cv.wait_timeout(status, deadline - now).unwrap();
        status = guard;
    }
    if status.attempt_id != attempt_id {
        return Err("save handshake was superseded".into());
    }
    let timed_out = status.pending > 0;
    let failed = status.failed;
    let detail = if timed_out {
        "Rotli did not quit because one or more windows did not finish saving. Your files remain open; try Save again or resolve the shown error."
            .to_string()
    } else if failed {
        let suffix = status
            .errors
            .first()
            .map(|error| format!(" ({error})"))
            .unwrap_or_default();
        format!("Rotli did not quit because some changes could not be saved{suffix}. Your files remain open.")
    } else {
        String::new()
    };
    status.pending = 0;
    drop(status);
    if timed_out || failed {
        show_main(app);
        let _ = app.emit_to("main", "rotli:quit-flush-failed", &detail);
        Err(detail)
    } else {
        Ok(())
    }
}

fn graceful_shutdown(app: &AppHandle, restart: bool) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if flush_webviews_before_shutdown(&handle).is_ok() {
            if restart {
                if let Err(error) = relaunch_app(&handle) {
                    show_main(&handle);
                    let _ = handle.emit_to("main", "rotli:quit-flush-failed", error);
                }
            } else {
                handle.exit(0);
            }
        }
    });
}

fn graceful_quit(app: &AppHandle) {
    graceful_shutdown(app, false);
}

fn graceful_restart(app: &AppHandle) {
    graceful_shutdown(app, true);
}

#[tauri::command]
fn restart_after_flush(app: AppHandle) {
    graceful_restart(&app);
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn hide_capture(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("capture") {
        let _ = window.hide();
    }
}

/// Center a window on the ACTIVE display (the one holding the cursor), falling
/// back to the primary-display center.
fn center_on_cursor_display(app: &AppHandle, window: &tauri::WebviewWindow) {
    let placed = (|| -> tauri::Result<()> {
        // ONE coordinate space throughout: cursor_position() is PHYSICAL, so
        // the monitor is found by its physical rect (monitor_from_point tests
        // against LOGICAL display bounds — wrong on every Retina screen).
        let cursor = app.cursor_position()?;
        let monitor = app
            .available_monitors()?
            .into_iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                cursor.x >= pos.x as f64
                    && cursor.x < (pos.x + size.width as i32) as f64
                    && cursor.y >= pos.y as f64
                    && cursor.y < (pos.y + size.height as i32) as f64
            })
            .ok_or(tauri::Error::WindowNotFound)?;
        let win = window.outer_size()?;
        let pos = monitor.position();
        let size = monitor.size();
        let x = pos.x + (size.width as i32 - win.width as i32) / 2;
        let y = pos.y + (size.height as i32 - win.height as i32) / 2;
        window.set_position(PhysicalPosition::new(x, y))?;
        Ok(())
    })();
    if placed.is_err() {
        let _ = window.center();
    }
}

/// Show the capture card centered on the active display, then tell its webview
/// to refocus the field.
fn show_capture(app: &AppHandle) {
    let Some(window) = app.get_webview_window("capture") else {
        return;
    };
    // Remember where you came from — the SAME rule the Quick Note uses
    // (remember_quick_return): "in rotli" means main was visible AND focused.
    // Visible-but-behind (rotli open under another app) counts as away, and
    // main is tucked out of sight for the capture so activating the app cannot
    // raise it over the app you were in (2026-09-01: "⌥C opens the app").
    let (main_visible, main_focused) = app
        .get_webview_window("main")
        .map(|w| (w.is_visible().unwrap_or(false), w.is_focused().unwrap_or(false)))
        .unwrap_or((false, false));
    let plan = capture_return_plan(main_visible, main_focused);
    if plan.tuck_main {
        hide_main(app);
    }
    *app.state::<CaptureReturn>().0.lock().unwrap() = plan;
    center_on_cursor_display(app, &window);
    *app.state::<LastPanelSummon>().0.lock().unwrap() = Some(Instant::now());
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to("capture", "rotli:capture-show", ());
}

/// Finish a capture (Enter-save or Esc-dismiss): hide the card, then return focus
/// where it belongs — back to the main window if you were already in rotli, or to
/// the app you came from (NSApp hide) otherwise, so capturing from another app
/// never surfaces rotli (#5). The card is always hidden either way.
fn finish_capture(app: &AppHandle) {
    hide_capture(app);
    let plan = *app.state::<CaptureReturn>().0.lock().unwrap();
    if plan.was_in_main {
        // main is already underneath and regains focus naturally — never a
        // forced raise (the Quick Note law, hide_quick_return)
        return;
    }
    // came from another app — step out of rotli so focus returns there
    #[cfg(target_os = "macos")]
    let _ = app.hide();
    if plan.tuck_main {
        // put main back for the next time rotli is activated; the app is
        // hidden, so ordering the window front cannot surface anything now
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
        }
    }
}

/// Record where closing the Quick Note should return focus, BEFORE the quick
/// window steals it: back to the main window only if you were actively in it,
/// otherwise out of rotli. Mirrors how `show_capture` snapshots CaptureReturn.
fn remember_quick_return(app: &AppHandle) {
    let in_main = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    *app.state::<QuickReturn>().0.lock().unwrap() = in_main;
}

/// Close the Quick Note via its own chord / Esc. The quick chord controls ONLY
/// the quick note — closing it NEVER surfaces the main window (the maintainer, 2026-06-26).
/// If you came from OUTSIDE rotli (main wasn't the focused window), step out of
/// rotli (NSApp hide) so focus returns to whatever you were in — and so the chord
/// can never raise main. If you WERE working in main, just hide the quick note and
/// let main regain focus naturally (it's already underneath) — no forced raise.
/// The blur-hide path (clicking elsewhere) stays a plain `hide_quick`.
fn hide_quick_return(app: &AppHandle) {
    hide_quick(app);
    let was_in_main = *app.state::<QuickReturn>().0.lock().unwrap();
    if !was_in_main {
        // came from another app — step out of rotli rather than surface main
        #[cfg(target_os = "macos")]
        let _ = app.hide();
    }
}

fn show_quick(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick") else {
        return;
    };
    // snapshot the return target before we steal focus (so a later ⌥Q-close
    // knows whether you were in main or came from somewhere else)
    remember_quick_return(app);
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
    let _ = app.emit_to("quick", "rotli:quick-show", ());
}

fn hide_quick(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick") {
        let _ = window.hide();
    }
}

/// The quick chord toggles the floating note: visible + focused → hide; visible
/// but behind → bring it forward; hidden → show on the active display.
fn toggle_quick(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        if window.is_focused().unwrap_or(true) {
            // the ⌥Q chord controls ONLY the quick note — closing it returns
            // focus to where you came from, never surfaces the main window
            hide_quick_return(app);
        } else {
            // visible but behind: bring it forward, and refresh the return
            // target (you may have moved to another app since the last summon)
            remember_quick_return(app);
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    show_quick(app);
}

fn is_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// The capture chord: toggle the one-breath card.
fn do_summon(app: &AppHandle) {
    if is_visible(app, "capture") {
        hide_capture(app);
        return;
    }
    show_capture(app);
}

fn toggle_main(app: &AppHandle, respect_blur_grace: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        // visible AND focused → hide. Visible but BEHIND other apps (the
        // Stay-open setting) → the summon chord brings it forward instead
        // of hiding a window the user can't even see properly.
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

#[tauri::command]
fn toggle_main_window(app: AppHandle) {
    toggle_main(&app, false);
}

#[tauri::command]
fn hide_main_window(app: AppHandle) {
    hide_main(&app);
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn hide_capture_window(app: AppHandle) {
    hide_capture(&app);
}

#[tauri::command]
fn finish_capture_window(app: AppHandle) {
    finish_capture(&app);
}

#[tauri::command]
fn show_chat_window(app: AppHandle) {
    chat_window::show(&app);
}

#[tauri::command]
fn hide_chat_window(app: AppHandle) {
    chat_window::hide(&app);
}

#[tauri::command]
fn toggle_quick_window(app: AppHandle) {
    toggle_quick(&app);
}

#[tauri::command]
fn hide_quick_window(app: AppHandle) {
    // Esc-dismiss from the quick webview — same intent as the ⌥Q chord close,
    // so return focus the same way (never surface main).
    hide_quick_return(&app);
}

// `show_quick_window` was UNREGISTERED and removed in the 2026-07 audit (#68):
// zero frontend callers — the quick window is summoned by its global chord /
// `toggle_quick_window` only.

/// Settings → Storage → "Reveal in Finder": open the corpus folder.
#[tauri::command]
fn corpus_reveal(app: AppHandle) {
    let root = corpus::resolve_corpus(&app);
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&root).spawn();
    #[cfg(not(target_os = "macos"))]
    let _ = root;
}

/// Add an ARBITRARY folder as a browsable + editable corpus root — the "just add a
/// folder" feature (the maintainer, 2026-06-27). It is NOT moved into the memex; it opens as a
/// plain LegacyRotli root (everything writable) so you can use rotli over, say, a
/// work folder without it living in your brain. Picks natively when no path is given;
/// generates a unique slug id from the folder name. Relaunches so it surfaces.
/// Returns false when the picker is cancelled.
/// One-at-a-time lane for vault/registry mutations. The async conversion
/// (2026-07-31) moved the vault commands off the main thread — which had been
/// their implicit serialization. Every corpus.json change is an unguarded
/// read→modify→write span, so two concurrent commands could silently drop each
/// other's writes (picker open in one worker, Settings "Add a folder…" in
/// another). Every command that mutates the registry or the corpus path holds
/// this for its whole span — the still-sync ones too, or they race the workers.
static VAULT_LANE: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn vault_lane() -> std::sync::MutexGuard<'static, ()> {
    // a poisoned lane (a panicked worker) must not brick every later vault
    // action — the span it guarded is over either way
    VAULT_LANE.lock().unwrap_or_else(|e| e.into_inner())
}

/// A user-visible notes root must never overlap the private runtime/config trees
/// that decide what code and providers Rotli's agent subprocesses trust. If one
/// of these directories became a writable corpus root, the ordinary file APIs
/// could rewrite credentials, CLI configuration, or the local-model registry.
pub(crate) fn reject_privileged_root(
    app: &AppHandle,
    candidate: &std::path::Path,
) -> Result<(), String> {
    use tauri::Manager;
    let candidate = std::fs::canonicalize(candidate)
        .map_err(|error| format!("canonicalize selected folder: {error}"))?;
    let mut protected = Vec::new();
    let mut forbidden_home_or_ancestor = false;
    if let Ok(home) = std::env::var("HOME") {
        let home =
            std::fs::canonicalize(home).map_err(|error| format!("canonicalize home: {error}"))?;
        protected.extend(
            [
                ".memex",
                ".codex",
                ".claude",
                ".ssh",
                ".gnupg",
                ".aws",
                ".config",
                ".breve-secrets",
                "Library/Keychains",
            ]
            .into_iter()
            .map(|relative| home.join(relative)),
        );
        // Selecting HOME (or one of its ancestors) intersects every protected
        // child even when the child has not been created yet. Ordinary folders
        // below HOME remain valid unless they overlap a named private subtree.
        forbidden_home_or_ancestor = candidate == home || home.starts_with(&candidate);
    }
    if let Ok(path) = app.path().app_config_dir() {
        protected.push(path);
    }
    if let Ok(path) = app.path().app_data_dir() {
        protected.push(path);
    }
    if forbidden_home_or_ancestor || overlaps_any_private_path(&candidate, &protected) {
        Err("That folder overlaps private application, credential, or agent-runtime state and cannot be used as a notes root.".into())
    } else {
        Ok(())
    }
}

fn overlaps_any_private_path(
    candidate: &std::path::Path,
    protected: &[std::path::PathBuf],
) -> bool {
    protected
        .iter()
        .any(|path| candidate.starts_with(path) || path.starts_with(candidate))
}

#[cfg(test)]
mod privileged_root_tests {
    use super::{overlaps_any_private_path, write_new_vault_settings, NativeDialogOpen};
    use std::path::{Path, PathBuf};

    #[test]
    fn corpus_roots_cannot_contain_or_live_inside_agent_trust_state() {
        let protected = vec![PathBuf::from("/Users/example/.memex")];
        assert!(overlaps_any_private_path(
            Path::new("/Users/example"),
            &protected
        ));
        assert!(overlaps_any_private_path(
            Path::new("/Users/example/.memex/ai"),
            &protected
        ));
        assert!(!overlaps_any_private_path(
            Path::new("/Users/example/Notes"),
            &protected
        ));
    }

    #[test]
    fn new_vault_reopens_home_navigation_without_virtual_welcome_state() {
        let root = tempfile::tempdir().unwrap();
        let dot = root.path().join(".rotli");
        std::fs::create_dir_all(&dot).unwrap();
        std::fs::write(
            dot.join("settings.json"),
            r#"{
  "theme": "dark",
  "futureSetting": 7,
  "brainEnabled": true,
  "vaultWelcomeSeen": true,
  "sidebarCollapsed": true,
  "sidebarMode": "breve",
  "sidebarView": "chat"
}"#,
        )
        .unwrap();

        write_new_vault_settings(root.path(), Some(false)).unwrap();
        let settings: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dot.join("settings.json")).unwrap())
                .unwrap();

        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["futureSetting"], 7);
        assert_eq!(settings["brainEnabled"], false);
        assert!(settings.get("vaultWelcomeSeen").is_none());
        assert_eq!(settings["sidebarCollapsed"], false);
        assert_eq!(settings["sidebarMode"], "notes");
        assert_eq!(settings["sidebarView"], "home");
    }

    #[test]
    fn app_owned_native_dialog_suppresses_blur_only_for_its_lifetime() {
        let state = NativeDialogOpen::default();
        assert!(!state.is_open());
        {
            let _first = state.begin();
            let _second = state.begin();
            assert!(state.is_open());
        }
        assert!(!state.is_open());
    }
}

/// ASYNC command (vault-lane pass, 2026-07-31): the blocking picker + registry
/// rewrite ran on the main thread and beachballed the window — worker now.
#[tauri::command]
async fn corpus_add_folder(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || corpus_add_folder_blocking(app, path))
        .await
        .map_err(|e| format!("vault worker failed ({e})"))?
}

/// Native image picker for Markdown's `/attatch` command. The picker runs on a
/// worker (blocking it on the main thread would beachball the app) and grants
/// the returned paths to the same single-use import capability used by Finder
/// drag-and-drop. Picking is authority to copy these exact files once; it is
/// not general filesystem access for the webview.
#[tauri::command]
async fn corpus_pick_images(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let dialog_state = app.state::<NativeDialogOpen>();
        let _native_dialog = dialog_state.begin();
        let mut picker = app
            .dialog()
            .file()
            .set_title("Attach images or videos")
            .add_filter("Images", corpus::NATIVE_IMAGE_PICKER_EXTS)
            // the embed lane's video containers (parity.json videoExts)
            .add_filter("Videos", corpus::VIDEO_EXTS);
        if let Some(parent) = app.get_webview_window("main") {
            picker = picker.set_parent(&parent);
        }
        let paths = picker
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|picked| picked.into_path().map_err(|error| error.to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(app
            .state::<corpus::ImportAuthorizations>()
            .authorize_native_drop(&paths))
    })
    .await
    .map_err(|error| format!("image picker worker failed ({error})"))?
}

fn corpus_add_folder_blocking(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err("Choose or create a development vault before adding connected folders.".into());
    }
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => app
            .state::<memex::FolderAuthorizations>()
            .require(std::path::Path::new(&p))?,
        None => {
            let dialog_state = app.state::<NativeDialogOpen>();
            let _native_dialog = dialog_state.begin();
            let mut picker = app
                .dialog()
                .file()
                .set_title("Add a folder to rotli")
                .set_directory(vault_location::picker_start(&app));
            if let Some(parent) = app.get_webview_window("main") {
                picker = picker.set_parent(&parent);
            }
            let Some(picked) = picker.blocking_pick_folder() else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    if !abs.is_dir() {
        return Err("That isn't a folder.".into());
    }
    reject_privileged_root(&app, &abs)?;
    flush_webviews_before_shutdown(&app)?;
    if !corpus::add_folder(&app, abs)? {
        return Ok(true); // already the corpus / a brain / a folder — no-op, no restart
    }
    relaunch_app(&app)?;
    Ok(true)
}

/// Forget an added folder root (refuses the built-in `default` + `vault`). The files
/// on disk are NEVER touched — only the binding is dropped. Relaunches.
#[tauri::command]
fn corpus_forget_folder(app: AppHandle, id: String) -> Result<(), String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err(
            "Choose or create a development vault before changing connected folders.".into(),
        );
    }
    if id == corpus::DEFAULT_ROOT_ID {
        return Err("That's your notes folder — it can't be removed.".into());
    }
    flush_webviews_before_shutdown(&app)?;
    corpus::forget_root(&app, &id)?;
    relaunch_app(&app)
}

// ─── the unified Location surface (corpus.json) ─────────────────────────────

/// The corpus, enriched with whether it IS a memex (derived, never stored) + its
/// write perms — so the UI/service can treat a memex corpus as the active write
/// target.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CorpusView {
    abs_path: std::path::PathBuf,
    is_memex: bool,
    memex_id: Option<String>,
    /// when is_memex: the brain's write perms; else null
    perms: Option<memex::MemexPerms>,
    /// The vault's Librarian switch (display fact for the switcher/Location —
    /// read from the root's own settings sidecar, never stored in corpus.json).
    brain_enabled: bool,
}

/// A connected brain + per-root display facts the config file never stores.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BrainRootView {
    #[serde(flatten)]
    brain: corpus::ConnectedBrain,
    brain_enabled: bool,
}

/// A root's Librarian switch, straight off its settings sidecar. Same rules as
/// `CorpusStore::brain_enabled`: missing file/field ⇒ on; a real IO error ⇒
/// off (fail closed on the consent boundary).
fn root_brain_enabled(root: &std::path::Path) -> bool {
    match std::fs::read_to_string(root.join(".rotli").join("settings.json")) {
        Ok(s) => serde_json::from_str::<serde_json::Value>(&s)
            .ok()
            .and_then(|v| v.get("brainEnabled").and_then(serde_json::Value::as_bool))
            .unwrap_or(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    }
}

/// The whole Location config — the one folder (+ whether it's a brain) + connected
/// brains + active brain. Replaces corpus_list_roots + memex_list_instances.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CorpusConfigView {
    corpus: CorpusView,
    brains: Vec<BrainRootView>,
    folders: Vec<corpus::CorpusRoot>,
    active_brain_id: Option<String>,
    /// True only while a debug build is borrowing the production-selected
    /// vault as a boot fallback. An explicit `corpus.dev.json` selection turns
    /// this off without changing production's binding.
    development_read_only: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultInspection {
    path: String,
    label: String,
    kind: String,
    source: String,
    markdown_files: usize,
    other_files: usize,
    folders: usize,
    warnings: Vec<String>,
}

fn inspect_vault_path(path: &std::path::Path) -> Result<VaultInspection, String> {
    if !path.is_dir() {
        return Err("Choose an existing folder.".into());
    }
    let root = std::fs::canonicalize(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let empty = std::fs::read_dir(&root)
        .map_err(|e| format!("read {}: {e}", root.display()))?
        .filter_map(Result::ok)
        .all(|entry| entry.file_name().to_str() == Some(".DS_Store"));
    let mut markdown_files = 0usize;
    let mut other_files = 0usize;
    let mut folders = 0usize;
    let mut symlinks = 0usize;
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let entries =
            std::fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))?;
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".rotli" || name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_symlink() {
                symlinks += 1;
            } else if kind.is_dir() {
                folders += 1;
                stack.push(entry.path());
            } else if kind.is_file() {
                if entry.path().extension().and_then(|value| value.to_str()) == Some("md") {
                    markdown_files += 1;
                } else {
                    other_files += 1;
                }
            }
        }
    }
    let source = if root.join(".obsidian").is_dir() {
        "Obsidian vault"
    } else if root.join(".zennotes").is_dir() || root.join(".zen").is_dir() {
        "ZenNotes vault"
    } else if corpus::is_memex_root(&root) {
        "Rotli vault"
    } else {
        "Markdown folder"
    };
    let kind = if corpus::is_memex_root(&root) {
        "memex"
    } else if empty {
        "empty"
    } else {
        "markdown"
    };
    let mut warnings = Vec::new();
    if empty {
        warnings
            .push("This folder is empty. Go back and choose Create a new vault instead.".into());
    } else if markdown_files == 0 {
        warnings
            .push("No Markdown files were found; other supported files will still appear.".into());
    }
    if symlinks > 0 {
        warnings.push(format!(
            "{symlinks} symbolic link{} will not be followed.",
            if symlinks == 1 { "" } else { "s" }
        ));
    }
    Ok(VaultInspection {
        path: root.to_string_lossy().into_owned(),
        label: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Notes")
            .to_string(),
        kind: kind.into(),
        source: source.into(),
        markdown_files,
        other_files,
        folders,
        warnings,
    })
}

#[tauri::command]
async fn corpus_inspect_folder(app: AppHandle, path: String) -> Result<VaultInspection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = app
            .state::<memex::FolderAuthorizations>()
            .require(std::path::Path::new(&path))?;
        inspect_vault_path(&path)
    })
    .await
    .map_err(|e| format!("vault inspection worker failed ({e})"))?
}

fn copy_vault_tree(source: &std::path::Path, destination: &std::path::Path) -> Result<(), String> {
    let source = std::fs::canonicalize(source).map_err(|e| format!("open source: {e}"))?;
    let destination =
        std::fs::canonicalize(destination).map_err(|e| format!("open destination: {e}"))?;
    if source == destination || destination.starts_with(&source) || source.starts_with(&destination)
    {
        return Err("Choose a separate destination outside the source vault.".into());
    }
    let has_entries = std::fs::read_dir(&destination)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|entry| entry.file_name().to_str() != Some(".DS_Store"));
    if has_entries {
        return Err("Import a copy into an empty folder.".into());
    }
    let mut stack = vec![(source.clone(), destination.clone())];
    while let Some((from, to)) = stack.pop() {
        std::fs::create_dir_all(&to).map_err(|e| format!("create {}: {e}", to.display()))?;
        for entry in
            std::fs::read_dir(&from).map_err(|e| format!("read {}: {e}", from.display()))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            if name.to_str() == Some(".rotli") {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let target = to.join(&name);
            if kind.is_dir() {
                stack.push((entry.path(), target));
            } else if kind.is_file() {
                std::fs::copy(entry.path(), &target)
                    .map_err(|e| format!("copy {}: {e}", entry.path().display()))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod vault_activation_tests {
    use super::{copy_vault_tree, inspect_vault_path};

    #[test]
    fn inspection_is_read_only_and_copy_preserves_the_foreign_tree() {
        let temp = tempfile::TempDir::new().unwrap();
        let source = temp.path().join("obsidian");
        let destination = temp.path().join("copy");
        std::fs::create_dir_all(source.join("Projects/Nested")).unwrap();
        std::fs::create_dir_all(source.join(".obsidian")).unwrap();
        std::fs::create_dir_all(source.join(".rotli")).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(source.join("Projects/Nested/plan.md"), "# Plan\n").unwrap();
        std::fs::write(source.join(".obsidian/app.json"), "{}").unwrap();
        std::fs::write(source.join(".rotli/main.json"), "old rotli state").unwrap();

        let report = inspect_vault_path(&source).unwrap();
        assert_eq!(report.source, "Obsidian vault");
        assert_eq!(report.markdown_files, 1);
        assert_eq!(report.folders, 2);
        assert_eq!(
            std::fs::read_to_string(source.join("Projects/Nested/plan.md")).unwrap(),
            "# Plan\n"
        );

        copy_vault_tree(&source, &destination).unwrap();
        assert_eq!(
            std::fs::read_to_string(destination.join("Projects/Nested/plan.md")).unwrap(),
            "# Plan\n"
        );
        assert!(destination.join(".obsidian/app.json").is_file());
        assert!(
            !destination.join(".rotli").exists(),
            "source-specific Rotli state must not copy"
        );
    }

    #[test]
    fn copy_refuses_a_nonempty_destination_before_writing() {
        let temp = tempfile::TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(source.join("note.md"), "# Note\n").unwrap();
        std::fs::write(destination.join("keep.md"), "# Keep\n").unwrap();

        assert!(copy_vault_tree(&source, &destination).is_err());
        assert_eq!(
            std::fs::read_to_string(destination.join("keep.md")).unwrap(),
            "# Keep\n"
        );
        assert!(!destination.join("note.md").exists());
    }
}

#[tauri::command]
async fn corpus_import_vault_copy(
    app: AppHandle,
    source: String,
    destination: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lane = vault_lane();
        let authorizations = app.state::<memex::FolderAuthorizations>();
        let source = authorizations.require(std::path::Path::new(&source))?;
        let destination = authorizations.require(std::path::Path::new(&destination))?;
        reject_privileged_root(&app, &source)?;
        reject_privileged_root(&app, &destination)?;
        flush_webviews_before_shutdown(&app)?;
        let inspection = inspect_vault_path(&source)?;
        copy_vault_tree(&source, &destination)?;
        activate_vault_path_live(&app, destination, inspection.kind != "memex").map(|_| ())
    })
    .await
    .map_err(|e| format!("vault import worker failed ({e})"))?
}

/// Read-only first-run gate. Unlike `corpus_list_config`, this never migrates,
/// scaffolds, or creates a default notes folder.
#[tauri::command]
fn corpus_status(app: AppHandle) -> bool {
    corpus::is_configured(&app)
}

/// The whole Location config. Migrates the four legacy files in on first read.
#[tauri::command]
fn corpus_list_config(app: AppHandle) -> CorpusConfigView {
    let cfg = corpus::ensure_corpus_config(&app);
    let development_read_only = development_read_only(&app);
    let (is_memex, memex_id, mut perms) = match memex::brain_view(&cfg.corpus.abs_path) {
        Some((id, p)) => (true, Some(id), Some(p)),
        None => (false, None, None),
    };
    if development_read_only {
        perms = Some(memex::MemexPerms::ReadOnly);
    }
    let corpus_brain_enabled = root_brain_enabled(&cfg.corpus.abs_path);
    CorpusConfigView {
        corpus: CorpusView {
            abs_path: cfg.corpus.abs_path,
            is_memex,
            memex_id,
            perms,
            brain_enabled: corpus_brain_enabled,
        },
        brains: cfg
            .brains
            .into_iter()
            .map(|b| {
                let brain_enabled = root_brain_enabled(&b.abs_path);
                BrainRootView {
                    brain: b,
                    brain_enabled,
                }
            })
            .collect(),
        folders: cfg.folders,
        active_brain_id: cfg.active_brain_id,
        development_read_only,
    }
}

/// "Choose folder…" — the ONE smart picker for your notes folder (your brain).
/// Detects what you picked: a memex → browse it as the whole corpus; an empty
/// folder → move your current notes there (only when the current corpus is a
/// PLAIN folder — a memex is never scattered by a move) else start fresh; a plain
/// folder with files → use it as-is, never merged. Rebinds the running shell to
/// the new corpus. Returns false when the picker is cancelled.
/// ASYNC command (vault-lane pass, 2026-07-31): the blocking picker plus a
/// possible whole-vault `relocate` ran on the main thread — worker now.
#[tauri::command]
async fn corpus_choose_folder(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || corpus_choose_folder_blocking(app, path))
        .await
        .map_err(|e| format!("vault worker failed ({e})"))?
}

fn corpus_choose_folder_blocking(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    let _lane = vault_lane();
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => app
            .state::<memex::FolderAuthorizations>()
            .require(std::path::Path::new(&p))?,
        None => {
            let dialog_state = app.state::<NativeDialogOpen>();
            let _native_dialog = dialog_state.begin();
            let mut picker = app
                .dialog()
                .file()
                .set_title("Choose your notes folder")
                .set_directory(vault_location::picker_start(&app));
            if let Some(parent) = app.get_webview_window("main") {
                picker = picker.set_parent(&parent);
            }
            let Some(picked) = picker.blocking_pick_folder() else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    let current = corpus::is_configured(&app).then(|| corpus::resolve_corpus(&app));
    reject_privileged_root(&app, &abs)?;
    if current.as_ref() == Some(&abs) {
        return Ok(false);
    }
    flush_webviews_before_shutdown(&app)?;
    let adopted = match memex::detect_folder(&abs).kind.as_str() {
        "memex" => {
            if let Some(current) = &current {
                corpus::carry_settings(current, &abs)?;
            }
            false
        }
        "fresh" => {
            if let Some(current) = &current {
                if !corpus::is_memex_root(current) {
                    corpus::relocate(current, &abs)?;
                }
                // relocate carries .rotli/ along; this is a no-op in that case
                corpus::carry_settings(current, &abs)?;
            }
            false
        }
        _ => {
            if let Some(current) = &current {
                corpus::carry_settings(current, &abs)?;
            }
            true
        }
    };
    activate_vault_path_live(&app, abs, adopted)
}

/// Attach one newly opened root to every long-lived runtime service. Existing
/// connected roots already own this plumbing from startup/connection and must
/// not receive a duplicate watcher.
fn recover_missing_active_vault(app: &AppHandle, missing_root: &std::path::Path) -> bool {
    if missing_root.is_dir() {
        return false;
    }
    let _lane = vault_lane();
    let state = app.state::<corpus::CorpusState>();
    let Ok(active) = state.default_root_path() else {
        return false;
    };
    if active != missing_root || active.is_dir() {
        return false;
    }

    let fallback = corpus::read_corpus_config(app).and_then(|cfg| {
        cfg.brains.into_iter().find(|candidate| {
            candidate.abs_path.is_dir()
                && state
                    .root_id_for_path(&candidate.abs_path)
                    .ok()
                    .flatten()
                    .is_some_and(|id| id == candidate.id)
        })
    });
    if let Some(fallback) = fallback {
        if let Err(error) = activate_vault_path_live(app, fallback.abs_path, false) {
            eprintln!("rotli: could not recover from a removed active vault ({error})");
        }
    } else {
        // No surviving route exists. The frontend re-checks corpus_status and
        // returns to vault activation; never recreate the missing user folder.
        let breve_supervisor = app.state::<routines::BreveSupervisor>();
        breve_supervisor.stop();
        app.state::<organizer::OrganizerState>()
            .0
            .reset_for_vault_switch();
        let _ = app.emit("rotli:vault-changed", ());
    }
    true
}

/// Reopen and rescan the active vault in place. This is the manual recovery
/// seam behind ⌘R and the vault menu; it never reloads the webview or process.
#[tauri::command]
async fn corpus_refresh_active_vault(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        refresh_vault_blocking(app, corpus::DEFAULT_ROOT_ID.to_string())
    })
    .await
    .map_err(|e| format!("vault refresh worker failed ({e})"))?
}

/// Refresh any row in the vault switcher without changing which vault is
/// active. The id is resolved only through the registered corpus config and
/// live store registry; it is never accepted as a filesystem path.
#[tauri::command]
async fn corpus_refresh_vault(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || refresh_vault_blocking(app, id))
        .await
        .map_err(|e| format!("vault refresh worker failed ({e})"))?
}

fn refresh_vault_blocking(app: AppHandle, id: String) -> Result<(), String> {
    let lane = vault_lane();
    let state = app.state::<corpus::CorpusState>();
    let active = id == corpus::DEFAULT_ROOT_ID;
    let config = corpus::ensure_corpus_config(&app);
    let (root, adopted) = if active {
        (state.default_root_path()?, config.corpus.adopted)
    } else {
        let connected = config
            .brains
            .iter()
            .find(|vault| vault.id == id)
            .ok_or_else(|| "no such connected vault".to_string())?;
        if !state.contains_root(&id)? {
            return Err("the connected vault is not open".into());
        }
        (connected.abs_path.clone(), false)
    };
    if !root.is_dir() {
        if active {
            drop(lane);
            let _ = recover_missing_active_vault(&app, &root);
            return Ok(());
        }
        return Err("the connected vault folder is unavailable".into());
    }
    flush_webviews_before_shutdown(&app)?;
    let mut store = if development_read_only(&app) {
        corpus::CorpusStore::open_read_only(root.clone())?
    } else if adopted {
        corpus::CorpusStore::open_adopted(root.clone())?
    } else {
        corpus::CorpusStore::open(root.clone())?
    };
    store.warm_secure_ledger()?;
    if adopted {
        store.seed_main_from_disk_if_missing()?;
    }
    let organizer = app.state::<organizer::OrganizerState>().0.clone();
    if active {
        organizer.with_vault_transition(|| {
            state.refresh_root(&id, store)?;
            organizer.reset_for_vault_switch();
            Ok(())
        })?;
        let _ = app.emit("rotli:vault-changed", ());
    } else {
        state.refresh_root(&id, store)?;
    }
    Ok(())
}

fn install_live_root_watcher(
    app: &AppHandle,
    root: std::path::PathBuf,
    suppress: corpus::SuppressSet,
) {
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
    let handle = app.clone();
    let organizer = app.state::<organizer::OrganizerState>().0.clone();
    let active_root = root.clone();
    if let Err(error) = corpus::spawn_watcher(root, suppress, move |paths| {
        if recover_missing_active_vault(&handle, &active_root) {
            return;
        }
        let active = handle
            .try_state::<corpus::CorpusState>()
            .and_then(|state| state.default_root_path().ok());
        if active.as_ref() == Some(&active_root) {
            organizer.enqueue(&active_root, paths);
        }
        chat_window::emit_corpus_changed(&handle);
    }) {
        eprintln!(
            "rotli: new active vault has no live watcher ({error}) — refresh remains available"
        );
    }
}

/// Make an authorized folder the active vault without rebuilding the process.
/// If startup/Connect already opened it, promote that registered store. For a
/// new/create/import path, open one store, swap it into the default route, then
/// attach the same watcher/asset/service plumbing startup would have provided.
fn activate_vault_path_live(
    app: &AppHandle,
    root: std::path::PathBuf,
    adopted: bool,
) -> Result<bool, String> {
    let state = app.state::<corpus::CorpusState>();
    let existing_id = state.root_id_for_path(&root)?;
    if existing_id.as_deref() == Some(corpus::DEFAULT_ROOT_ID) {
        return Ok(false);
    }

    let mut new_root = None;
    if existing_id.is_none() {
        let mut store = if adopted {
            corpus::CorpusStore::open_adopted(root.clone())?
        } else {
            corpus::CorpusStore::open(root.clone())?
        };
        store.warm_secure_ledger()?;
        if adopted {
            store.seed_main_from_disk_if_missing()?;
        }
        let suppress = store.suppress_set();
        new_root = Some((store, suppress));
    }

    // A remote session is authorized for the vault that was active when the
    // user connected it. Fail closed across an in-place vault switch instead
    // of leaving the cloud client attached to a now-hidden previous vault.
    remote_agent::disconnect_for_vault_change(app)?;
    let organizer = app.state::<organizer::OrganizerState>().0.clone();
    let mut watcher = None;
    organizer.with_vault_transition(|| {
        if let Some(incoming_id) = existing_id.as_deref() {
            state.activate_registered_root(incoming_id, || {
                corpus::set_corpus_path_live(app, root.clone(), adopted)
            })?;
        } else {
            let (store, suppress) = new_root
                .take()
                .ok_or_else(|| "the selected vault could not be opened".to_string())?;
            state.activate_new_root(store, || {
                corpus::set_corpus_path_live(app, root.clone(), adopted)
            })?;
            watcher = Some(suppress);
        }
        organizer.reset_for_vault_switch();

        let breve_supervisor = app.state::<routines::BreveSupervisor>();
        breve_supervisor.stop();
        let active = state.default_root_path()?;
        if feature_policy::breve_enabled() && active.join(routines::MANAGED_MARKER).is_file() {
            if let Err(error) = breve::install_rotli_login_agent() {
                eprintln!("rotli: Breve login item unavailable after vault switch ({error})");
            }
        }
        if let Err(error) = breve_supervisor.start(app, active) {
            eprintln!("rotli: Breve scheduler unavailable after vault switch ({error})");
        }
        Ok(())
    })?;
    if let Some(suppress) = watcher {
        install_live_root_watcher(app, root, suppress);
    }
    let _ = app.emit("rotli:vault-changed", ());
    Ok(true)
}

/// Switch to a vault that is already present in Rotli's connected-vault
/// registry. The frontend supplies only the stable registry id; Rust resolves
/// and revalidates the path so this route cannot become an arbitrary-folder
/// authorization bypass. The process and shell stay alive: the open stores swap
/// default routes, then the Librarian, Breve, and frontend rebind in place.
#[tauri::command]
async fn corpus_switch_vault(app: AppHandle, id: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || corpus_switch_vault_blocking(app, id))
        .await
        .map_err(|e| format!("vault worker failed ({e})"))?
}

fn corpus_switch_vault_blocking(app: AppHandle, id: String) -> Result<bool, String> {
    let _lane = vault_lane();
    let cfg = corpus::ensure_corpus_config(&app);
    let target = corpus::connected_vault_switch_target(&cfg, &id)?;
    reject_privileged_root(&app, &target.abs_path)?;
    let live = memex::brain_connect_view(&target.abs_path)?;
    if target
        .memex_id
        .as_deref()
        .is_some_and(|expected| expected != live.memex_id)
    {
        return Err(
            "This folder is a different vault than the one Rotli connected to — refusing.".into(),
        );
    }
    flush_webviews_before_shutdown(&app)?;
    let current = corpus::resolve_corpus(&app);
    corpus::carry_settings(&current, &target.abs_path)?;
    activate_vault_path_live(&app, target.abs_path, false)
}

/// Onboarding "create a new brain": scaffold a fresh memex at `path` and make it
/// your corpus — the corpus IS a memex (your folder is your brain). The live
/// shell rebinds to it. `path` is an absolute folder (the native picker
/// creates/names it).
/// ASYNC command (vault-lane pass, 2026-07-31): scaffold + settings carry +
/// config rewrite ran on the main thread right behind the picker — worker now.
#[tauri::command]
async fn corpus_init_memex(
    app: AppHandle,
    path: String,
    brain_enabled: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        corpus_init_memex_blocking(app, path, brain_enabled)
    })
    .await
    .map_err(|e| format!("vault worker failed ({e})"))?
}

fn corpus_init_memex_blocking(
    app: AppHandle,
    path: String,
    brain_enabled: bool,
) -> Result<String, String> {
    let _lane = vault_lane();
    let root = app
        .state::<memex::FolderAuthorizations>()
        .require(std::path::Path::new(&path))?;
    reject_privileged_root(&app, &root)?;
    flush_webviews_before_shutdown(&app)?;
    memex::scaffold_memex(&root)?;
    // a scaffolded memex has no .rotli — carry the onboarding flow's choices
    // (Librarian-vs-raw included) so the new vault honors what was just picked
    if corpus::is_configured(&app) {
        corpus::carry_settings(&corpus::resolve_corpus(&app), &root)?;
    }
    write_new_vault_settings(&root, Some(brain_enabled))?;
    activate_vault_path_live(&app, root, false)?;
    app.state::<corpus::CorpusState>()
        .route(corpus::DEFAULT_ROOT_ID, |store| {
            store.wire_id_of(memex::WELCOME_PRESET_FILE)
        })
}

fn write_new_vault_settings(
    root: &std::path::Path,
    brain_enabled: Option<bool>,
) -> Result<(), String> {
    let dot = root.join(".rotli");
    std::fs::create_dir_all(&dot).map_err(|e| format!("create {}: {e}", dot.display()))?;
    let path = dot.join("settings.json");
    let mut value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({ "v": 1 }));
    let object = value.as_object_mut().expect("object filtered above");
    if let Some(enabled) = brain_enabled {
        object.insert("brainEnabled".into(), serde_json::Value::Bool(enabled));
    }
    // The old virtual-welcome dismissal is obsolete: a new vault now owns a
    // real Markdown note. Drop the stale setting while preserving reusable
    // appearance/editor preferences and restoring visible Home navigation.
    object.remove("vaultWelcomeSeen");
    object.insert("sidebarCollapsed".into(), serde_json::Value::Bool(false));
    object.insert(
        "sidebarMode".into(),
        serde_json::Value::String("notes".into()),
    );
    object.insert(
        "sidebarView".into(),
        serde_json::Value::String("home".into()),
    );
    let json = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())? + "\n";
    fsutil::atomic_write(&path, &json, ".rotli-vault-settings-")
}

fn mount_connected_brain(
    app: &AppHandle,
    root_id: String,
    root: std::path::PathBuf,
    perms: memex::MemexPerms,
    mut store: corpus::CorpusStore,
) -> Result<(), String> {
    let state = app.state::<corpus::CorpusState>();
    if state.contains_root(&root_id)? {
        state.route(&root_id, |existing| {
            existing.set_perms_read_only(perms.read_only());
            Ok(())
        })?;
    } else {
        let suppress = store.suppress_set();
        store.set_perms_read_only(perms.read_only());
        state.insert_root(root_id.clone(), store)?;
        let _ = app.asset_protocol_scope().allow_directory(&root, true);
        let handle = app.clone();
        if let Err(error) = corpus::spawn_watcher(root, suppress, move |_| {
            chat_window::emit_corpus_changed(&handle);
        }) {
            eprintln!(
                "rotli: connected vault {root_id} has no live watcher ({error}) — refresh remains available"
            );
        }
    }
    chat_window::emit_corpus_changed(&app);
    Ok(())
}

/// Connect a brain (a memex) to read — and write into per its perms. Validates +
/// stamps via the memex module, registers it in corpus.json, and mounts it in the
/// live multi-root registry. Connecting is additive and must not tear down the
/// current vault or require the development restart supervisor.
/// ASYNC command (vault-lane pass, 2026-07-31): the blocking picker + memex
/// stamp + registry write ran on the main thread — worker now.
#[tauri::command]
async fn corpus_connect_brain(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || corpus_connect_brain_blocking(app, path))
        .await
        .map_err(|e| format!("vault worker failed ({e})"))?
}

fn corpus_connect_brain_blocking(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err("Choose or create a development vault before linking another vault.".into());
    }
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => app
            .state::<memex::FolderAuthorizations>()
            .require(std::path::Path::new(&p))?,
        None => {
            let dialog_state = app.state::<NativeDialogOpen>();
            let _native_dialog = dialog_state.begin();
            let mut picker = app
                .dialog()
                .file()
                .set_title("Link another Rotli vault")
                .set_directory(vault_location::picker_start(&app));
            if let Some(parent) = app.get_webview_window("main") {
                picker = picker.set_parent(&parent);
            }
            let Some(picked) = picker.blocking_pick_folder() else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    reject_privileged_root(&app, &abs)?;
    let meta = memex::prepare_brain_connect(&abs)?;
    let mut store = corpus::CorpusStore::open(abs.clone())?;
    store.set_perms_read_only(meta.perms.read_only());
    store.warm_secure_ledger()?;
    let perms = meta.perms;
    let root_id = corpus::upsert_brain(
        &app,
        corpus::ConnectedBrain {
            id: String::new(),
            label: meta.label,
            abs_path: abs.clone(),
            memex_id: Some(meta.memex_id),
            mode: meta.mode,
            perms,
        },
        true,
    )?;
    mount_connected_brain(&app, root_id, abs, perms, store)?;
    Ok(true)
}

/// Remove a connected vault from Rotli. This drops only its trusted binding,
/// live route, and asset scope; its folder and every user file stay untouched.
#[tauri::command]
fn corpus_forget_brain(app: AppHandle, id: String) -> Result<(), String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err(
            "Choose or create a development vault before changing linked libraries.".into(),
        );
    }
    let state = app.state::<corpus::CorpusState>();
    let root = state.remove_registered_root(&id, || corpus::forget_root(&app, &id))?;
    if let Err(error) = app.asset_protocol_scope().forbid_directory(&root, true) {
        eprintln!(
            "rotli: removed vault route but could not revoke its asset scope {} ({error})",
            root.display()
        );
    }
    chat_window::emit_corpus_changed(&app);
    Ok(())
}

/// Make a connected brain the active write target. No relaunch — the frontend
/// refetches the config.
#[tauri::command]
fn corpus_set_active_brain(app: AppHandle, id: String) -> Result<(), String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err(
            "Choose or create a development vault before changing linked libraries.".into(),
        );
    }
    corpus::set_active_brain(&app, &id)
}

/// Set a brain's write perms. Typed as MemexPerms so serde rejects anything but
/// the two wire values at the IPC boundary. No relaunch — the LIVE store's Rust
/// write gate is updated in the same breath (#3, audit 2026-07), so the perms
/// hold immediately, not only after the next launch. The store may be unbound
/// (its folder vanished) — that's fine, startup will re-apply the persisted
/// perms whenever it binds again.
#[tauri::command]
fn corpus_set_brain_perms(
    app: AppHandle,
    id: String,
    perms: memex::MemexPerms,
) -> Result<(), String> {
    let _lane = vault_lane();
    if development_read_only(&app) {
        return Err(
            "Choose or create a development vault before changing linked-library permissions."
                .into(),
        );
    }
    corpus::set_brain_perms(&app, &id, perms)?;
    let state = app.state::<corpus::CorpusState>();
    let _ = state.route(&id, |s| {
        s.set_perms_read_only(perms.read_only());
        Ok(())
    });
    Ok(())
}

#[tauri::command]
fn summon(app: AppHandle) {
    do_summon(&app);
}

/// Settings → General → "Stay open": disable click-away hiding for the main
/// window so rotli can sit on a screen like a resident app.
#[tauri::command]
fn set_hide_on_blur(app: AppHandle, hide: bool) {
    *app.state::<HideOnBlur>().0.lock().unwrap() = hide;
}

/// Settings → General → "Show in Dock": flips the activation policy between
/// menu-bar-only (Accessory, the default) and a normal Dock app (Regular).
#[tauri::command]
fn set_dock_visible(app: AppHandle, visible: bool) {
    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, visible);
}

#[cfg(target_os = "macos")]
fn app_icon_bytes(variant: &str) -> Option<&'static [u8]> {
    // `tauri dev` launches an unbundled executable, so clearing AppKit's icon
    // override reveals macOS's generic `exec` tile instead of the icon declared
    // in tauri.dev.conf.json. Keep every debug build visibly distinct and safe
    // to identify while release builds retain the user's icon preference.
    #[cfg(debug_assertions)]
    {
        let _ = variant;
        Some(include_bytes!("../icons-dev/runtime.png"))
    }

    #[cfg(not(debug_assertions))]
    match variant {
        "warm" => Some(include_bytes!("../icons/variants/warm.png")),
        "paper" => Some(include_bytes!("../icons/variants/paper.png")),
        "charcoal" => Some(include_bytes!("../icons/variants/charcoal.png")),
        "clay" => Some(include_bytes!("../icons/variants/clay.png")),
        _ => None, // "default" → the bundle icon (nil clears the override)
    }
}

#[cfg(all(test, target_os = "macos", debug_assertions))]
#[test]
fn development_app_icon_is_embedded_for_the_default_variant() {
    let bytes = app_icon_bytes("default").expect("debug builds must set a Dock icon");
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
}

/// Debug builds paint the blue development icon the moment the app launches,
/// before any webview asks for it, so a `tauri dev` instance is never mistaken
/// for the installed app in the Dock.
#[cfg(all(target_os = "macos", debug_assertions))]
fn apply_dev_dock_icon(app: &AppHandle) {
    set_app_icon(app.clone(), "default".into());
}

/// Swap the macOS Dock/app icon at runtime (Settings → Appearance → App icon).
/// Debug builds always use the blue development icon because `tauri dev` has no
/// app bundle to fall back to. Release builds keep the configured icon variant.
/// AppKit's setApplicationIconImage must run on the main thread.
#[tauri::command]
fn set_app_icon(app: AppHandle, variant: String) {
    #[cfg(target_os = "macos")]
    {
        let bytes = app_icon_bytes(&variant).map(<[u8]>::to_vec);
        let _ = app.run_on_main_thread(move || {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            let image = bytes.as_ref().and_then(|b| {
                let data = NSData::with_bytes(b);
                NSImage::initWithData(NSImage::alloc(), &data)
            });
            unsafe { ns_app.setApplicationIconImage(image.as_deref()) };
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, variant);
}

/// Turn demo mode on/off — swap the app to an isolated demo corpus (or back to
/// the real one), then relaunch. The user's real corpus config is never touched.
#[tauri::command]
fn set_demo_mode(app: AppHandle, on: bool) -> Result<(), String> {
    flush_webviews_before_shutdown(&app)?;
    corpus::set_demo(&app, on)?;
    relaunch_app(&app)
}

/// Is demo mode currently on?
#[tauri::command]
fn demo_mode(app: AppHandle) -> bool {
    corpus::demo_active(&app)
}

/// Re-register a global chord (the keys registry calls this when a global
/// action is rebound); `None` unbinds it OS-side. Keeps the old chord if the
/// new one fails to register — and returns Err so the frontend does NOT
/// commit a chord the OS never fires.
#[tauri::command]
fn set_summon_shortcut(
    app: AppHandle,
    action_id: String,
    accelerator: Option<String>,
) -> Result<(), String> {
    if let Some(acc) = accelerator.as_deref() {
        acc.parse::<Shortcut>()
            .map_err(|e| format!("invalid accelerator {acc:?}: {e}"))?;
    }

    let shortcuts = app.global_shortcut();
    let chords = app.state::<GlobalChords>();

    let mut current = match action_id.as_str() {
        "capture.summon" => chords.capture.lock().unwrap(),
        "app.toggleWindow" => chords.main_toggle.lock().unwrap(),
        "quick.summon" => chords.quick.lock().unwrap(),
        "chat.summon" => chords.chat.lock().unwrap(),
        "palette.summon" => chords.search.lock().unwrap(),
        other => return Err(format!("unknown global action: {other}")),
    };
    if let Some(old) = current.as_deref() {
        let _ = shortcuts.unregister(old);
    }
    match accelerator {
        Some(acc) => {
            if let Err(e) = shortcuts.register(acc.as_str()) {
                if let Some(old) = current.as_deref() {
                    let _ = shortcuts.register(old);
                }
                return Err(format!("could not register {acc:?}: {e}"));
            }
            *current = Some(acc);
        }
        None => *current = None,
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // before any window exists: the webview reads this default at creation
    spellcheck::enable_continuous_spellcheck_by_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let chords = app.state::<GlobalChords>();
                    let matches = |stored: &str| {
                        stored.parse::<Shortcut>().is_ok_and(|s| s == *shortcut)
                    };
                    let capture = chords.capture.lock().unwrap().clone();
                    if capture.as_deref().is_some_and(matches) {
                        do_summon(app);
                        return;
                    }
                    let main_toggle = chords.main_toggle.lock().unwrap().clone();
                    if main_toggle.as_deref().is_some_and(matches) {
                        toggle_main(app, false);
                        return;
                    }
                    let quick = chords.quick.lock().unwrap().clone();
                    if quick.as_deref().is_some_and(matches) {
                        toggle_quick(app);
                        return;
                    }
                    let chat = chords.chat.lock().unwrap().clone();
                    if chat.as_deref().is_some_and(matches) {
                        // ⌥A: SHOW (never toggle — "ask" must always land you in a
                        // chat, not hide the app); the webview picks/creates the chat
                        // …in whichever window Chat lives right now
                        if chat_window::is_open(app) {
                            chat_window::show(app);
                            let _ = app.emit_to(chat_window::LABEL, "rotli:summon-chat", ());
                        } else {
                            show_main(app);
                            let _ = app.emit_to("main", "rotli:summon-chat", ());
                        }
                        return;
                    }
                    let search = chords.search.lock().unwrap().clone();
                    if search.as_deref().is_some_and(matches) {
                        // ⌥F: same SHOW-never-toggle law — "find" must always land
                        // you in the palette; the webview opens ⌘K
                        show_main(app);
                        let _ = app.emit_to("main", "rotli:summon-search", ());
                    }
                })
                .build(),
        )
        .manage(GlobalChords {
            capture: Mutex::new(Some(DEFAULT_CAPTURE.to_string())),
            main_toggle: Mutex::new(Some(DEFAULT_MAIN_TOGGLE.to_string())),
            quick: Mutex::new(Some(DEFAULT_QUICK.to_string())),
            chat: Mutex::new(Some(DEFAULT_CHAT_SUMMON.to_string())),
            search: Mutex::new(Some(DEFAULT_SEARCH_SUMMON.to_string())),
        })
        .manage(LastBlurHide(Mutex::new(None)))
        .manage(NativeDialogOpen::default())
        .manage(LastPanelSummon(Mutex::new(None)))
        .manage(HideOnBlur(Mutex::new(true)))
        .manage(CaptureReturn(Mutex::new(CaptureReturnPlan::default())))
        .manage(QuickPlaced(Mutex::new(false)))
        .manage(QuickReturn(Mutex::new(false)))
        .manage(QuitFlush { status: Mutex::new(QuitFlushStatus::default()), cv: Condvar::new() })
        .manage(corpus::ImportAuthorizations::default())
        .manage(pasteboard::PasteboardGrants::default())
        .manage(memex::FolderAuthorizations::default())
        .manage(vault_browser::VaultBrowserState::default())
        .manage(provider::ProviderState::default())
        .manage(localmodel::LocalModelState::default())
        .manage(compute::ComputeState::default())
        .manage(remote_agent::RemoteAgentState::default())
        // App-menu replacements installed in setup. Tray menu events have their
        // own handler; the ids are distinct so double-dispatch cannot occur.
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "quit-app" => graceful_quit(app),
                "close-tab" => close_tab_from_native_menu(app),
                "close-window" => hide_focused_window(app),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            quit_flush_done,
            restart_after_flush,
            hide_main_window,
            show_main_window,
            hide_capture_window,
            finish_capture_window,
            toggle_quick_window,
            show_chat_window,
            hide_chat_window,
            hide_quick_window,
            corpus_reveal,
            vault_browser::vault_browser_start,
            vault_browser::vault_browser_open_child,
            vault_browser::vault_browser_go_back,
            vault_browser::vault_browser_refresh,
            vault_browser::vault_browser_create_folder,
            vault_browser::vault_browser_select,
            vault_browser::vault_browser_select_child,
            vault_browser::vault_browser_cancel,
            vault_browser::vault_browser_reveal,
            corpus_add_folder,
            corpus_forget_folder,
            corpus_list_config,
            corpus_status,
            corpus_inspect_folder,
            corpus_import_vault_copy,
            corpus_refresh_active_vault,
            corpus_refresh_vault,
            corpus_choose_folder,
            corpus_switch_vault,
            corpus_init_memex,
            welcome_lessons::corpus_seed_welcome,
            corpus_connect_brain,
            corpus_forget_brain,
            corpus_set_active_brain,
            corpus_set_brain_perms,
            summon,
            set_summon_shortcut,
            set_hide_on_blur,
            set_dock_visible,
            set_app_icon,
            set_demo_mode,
            demo_mode,
            app_settings::app_settings_read,
            app_settings::app_settings_write,
            corpus::corpus_list,
            corpus::corpus_search,
            corpus::corpus_read,
            corpus::corpus_open_file,
            corpus::corpus_file_text,
            corpus::corpus_file_bytes,
            corpus::corpus_file_stat,
            corpus::corpus_move_file_to_sink,
            corpus::corpus_restore_file,
            corpus::corpus_write_file_bytes,
            corpus::corpus_new_file_bytes,
            corpus::corpus_create_managed_file,
            corpus::corpus_export_note_pdf,
            corpus::corpus_convert_document,
            corpus::corpus_managed_file_creation_available,
            corpus::corpus_reveal_file,
            corpus::corpus_open_with_apps,
            corpus::corpus_open_file_with,
            corpus::corpus_import_file,
            corpus_pick_images,
            pasteboard::clipboard_has_files,
            pasteboard::clipboard_file_paths,
            corpus::corpus_create_image_asset,
            corpus::corpus_abs,
            clipboard_assets::corpus_image_data_url,
            corpus::corpus_frontmatter,
            corpus::corpus_raw_frontmatter,
            corpus::corpus_write_frontmatter_raw,
            corpus::corpus_set_locked,
            corpus::corpus_set_pinned,
            corpus::corpus_set_field,
            corpus::corpus_set_ai_field,
            corpus::corpus_file_note,
            corpus::corpus_filer_move,
            corpus::corpus_note_path,
            corpus::corpus_write_index,
            corpus::corpus_journal_append,
            corpus::corpus_journal_read,
            corpus::corpus_journal_prune,
            corpus::corpus_purge,
            corpus::corpus_resolve_ref,
            corpus::corpus_set_secure,
            corpus::corpus_secure_repair_scan,
            corpus::corpus_secure_repair_apply,
            corpus::corpus_tasks,
            corpus::corpus_toggle_task,
            corpus::corpus_set_local_ai_access,
            corpus::corpus_read_ai,
            corpus::corpus_readable_ids,
            corpus::corpus_search_ai,
            corpus::corpus_notes_ai,
            corpus::corpus_write_ai,
            corpus::corpus_write,
            corpus::corpus_create,
            corpus::corpus_delete,
            corpus::corpus_discard_blank,
            corpus::corpus_move,
            corpus::corpus_rename_board,
            corpus::file_rename::corpus_rename_managed_file,
            breve::breve_snapshot,
            breve::breve_import_legacy,
            breve::breve_write_config,
            breve::breve_pdf::breve_write_pdf_palette,
            breve::breve_brief_skill,
            breve::breve_write_brief_skill,
            breve::breve_write_watchlist,
            breve::breve_backfill_watchlist,
            breve::breve_delivery_settings,
            breve::breve_write_delivery_settings,
            breve::breve_store_resend_key,
            breve::breve_remove_resend_key,
            breve::breve_test_email,
            breve::breve_test_signal,
            breve::breve_takeover,
            breve::breve_retire_legacy,
            chat::chat_models,
            chat::chat_messages,
            chat::chat_messages_stream,
            provider::cli_detect,
            provider::cli_complete,
            provider::cli_cancel,
            provider::antigravity::antigravity_manage,
            provider::generate_image,
            usage::model_usage,
            localmodel::local_model_install,
            localmodel::local_model_install_progress,
            localmodel::local_model_install_cancel,
            localmodel::local_model_set_default,
            localmodel::local_model_default,
            localmodel::local_model_uninstall,
            localmodel::system_profile,
            compute::local_queue_status,
            compute::local_queue_prioritize,
            compute::local_queue_cancel,
            keychain::secret_store,
            keychain::secret_exists,
            keychain::secret_delete,
            remote_agent::remote_agent_status,
            remote_agent::remote_agent_pair,
            remote_agent::remote_agent_start,
            remote_agent::remote_agent_stop,
            remote_agent::remote_agent_unpair,
            organizer::organizer_status,
            organizer::organizer_run_once,
            organizer::organizer_stop,
            organizer::organizer_set_brain,
            organizer::organizer_set_trust,
            organizer::organizer_learn_field,
            organizer::organizer_secure_hints,
            organizer::organizer_dismiss_secure,
            web_search::web_search,
            web::web_fetch,
            web::open_url,
            private_browser::private_browser_create,
            private_browser::private_browser_set_bounds,
            private_browser::private_browser_set_visible,
            private_browser::private_browser_navigate,
            private_browser::private_browser_back,
            private_browser::private_browser_forward,
            private_browser::private_browser_reload,
            private_browser::private_browser_close,
            corpus::corpus_create_folder,
            corpus::corpus_read_board,
            corpus::corpus_write_board,
            corpus::corpus_create_board,
            corpus::corpus_overview,
            corpus::corpus_settings_read,
            corpus::corpus_settings_write,
            corpus::corpus_main_read,
            corpus::corpus_main_write,
            corpus::corpus_views_read,
            corpus::corpus_views_write,
            workspace::workspace_take_open_request,
            memex::memex_detect,
            memex::memex_read_contract,
            memex::memex_read,
            memex::memex_read_chat,
            memex::memex_list_chats,
            memex::memex_chat_folders,
            memex::memex_write_chat_folders,
            memex::memex_write_chat,
            memex::memex_rename_chat,
            memex::memex_delete_chat,
            memex::memex_archive_chat,
            memex::memex_reveal_chat,
            memex::memex_write_note,
            memex::memex_validate,
            memex::memex_pick_folder
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if native_drag::debug_drops() {
                if let Some(main) = app.get_webview_window("main") {
                    native_drag_promise::dump_drop_targets(&main.as_ref().window());
                }
            }
            // The visitor law: never in the dock, never in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            #[cfg(all(target_os = "macos", debug_assertions))]
            apply_dev_dock_icon(app.handle());

            // Resolve Finder moves and renames before any root is registered or
            // watched. A bookmark is accepted only when the live memex.json id
            // still matches the vault identity that was originally selected.
            if let Err(error) = vault_location::repair_vault_locations(app.handle()) {
                eprintln!("rotli: could not repair moved vault locations ({error})");
            }

            // Phase 2 / Track 2 — the corpus, now MULTI-ROOT. Build the root
            // registry (the DEFAULT root is always registered, pointing at
            // today's resolve_root), auto-bind the "vault" root to ~/memex-vault ONLY
            // when it is a valid memex, open a CorpusStore per registered root,
            // and watch EACH for EXTERNAL changes (one watcher per root). The
            // frontend invalidates on "rotli:corpus-changed". A disk error on any
            // single root must not kill the shell: that root is skipped and its
            // commands degrade to clean errors; the others still work.
            let breve_supervisor = routines::BreveSupervisor::default();
            app.manage(breve_supervisor.clone());
            let mut registry = corpus::CorpusRegistry::new(corpus::DEFAULT_ROOT_ID.to_string());
            // The organizer daemon (Phase 4): created BEFORE the root loop so the
            // memex root's watcher closure can feed its queue; the worker thread
            // starts only after CorpusState is managed (it writes through route()).
            let organizer_handle = organizer::OrganizerHandle::new();
            // #3 (audit 2026-07): a connected brain's USER-SET perms must reach the
            // Rust write gates, not only the TS canWrite — carry them by root id.
            let brain_perms: std::collections::HashMap<String, memex::MemexPerms> =
                if corpus::is_configured(app.handle()) {
                    corpus::ensure_corpus_config(app.handle())
                        .brains
                        .into_iter()
                        .map(|b| (b.id, b.perms))
                        .collect()
                } else {
                    std::collections::HashMap::new()
                };
            let roots = corpus::startup_roots(app.handle());
            for root in roots {
                let opened = if development_read_only(app.handle()) {
                    corpus::CorpusStore::open_read_only(root.abs_path.clone())
                } else if root.adopted {
                    corpus::CorpusStore::open_adopted(root.abs_path.clone())
                } else {
                    corpus::CorpusStore::open(root.abs_path.clone())
                };
                match opened {
                    Ok(mut store) => {
                        if development_read_only(app.handle())
                            || brain_perms.get(&root.id).is_some_and(|p| p.read_only())
                        {
                            store.set_perms_read_only(true);
                        }
                        let suppress = store.suppress_set();
                        let watch_root = store.root().to_path_buf();
                        // let the asset protocol serve this corpus's files, so
                        // storage/ images render via convertFileSrc. This runtime
                        // allow is the ONLY asset grant: the static config scope is
                        // deliberately EMPTY (security decision 2026-07-18 — the old
                        // $HOME/** exposed ~/.ssh etc. to the webview), so every
                        // servable path is a registered corpus root, nothing else.
                        let _ = app.asset_protocol_scope().allow_directory(store.root(), true);
                        let handle = app.handle().clone();
                        let org = organizer_handle.clone();
                        let org_root = store.root().to_path_buf();
                        if let Err(e) = corpus::spawn_watcher(watch_root, suppress, move |paths| {
                            if recover_missing_active_vault(&handle, &org_root) {
                                return;
                            }
                            // Only the currently active/default vault feeds the
                            // Librarian. The comparison is live so a vault switch
                            // retargets existing watchers without another process.
                            // Enqueue BEFORE the event: the frontend refetches the
                            // queue depth on corpus-changed (finding 23), and a
                            // refetch that wins the old ordering read the
                            // pre-enqueue count.
                            let active = handle
                                .try_state::<corpus::CorpusState>()
                                .and_then(|state| state.default_root_path().ok());
                            if active.as_ref() == Some(&org_root) {
                                org.enqueue(&org_root, paths);
                            }
                            chat_window::emit_corpus_changed(&handle);
                        }) {
                            eprintln!(
                                "rotli: corpus watcher unavailable for root {} ({e}) — external edits won't auto-refresh",
                                root.id
                            );
                        }
                        // FEED THE SECURE-PROSE LEDGER before this root can
                        // serve any egress command (audit follow-up 2026-08-01,
                        // finding #2). open() loads the index but does NOT walk,
                        // so without this a fresh process holds none of a
                        // never-browsed root's secure prose and the ungated file
                        // lanes could launder its stripped body out before the
                        // first list. Non-fatal: read_for_ai is still the primary
                        // gate; a warm failure only loses the backstop, and the
                        // walk also warms the list cache the perf audit wants.
                        if let Err(e) = store.warm_secure_ledger() {
                            eprintln!(
                                "rotli: could not warm the secure-note ledger for root {} ({e}) — egress backstop degraded to read_for_ai only",
                                root.id
                            );
                        }
                        if root.adopted {
                            if let Err(e) = store.seed_main_from_disk_if_missing() {
                                eprintln!(
                                    "rotli: could not mirror adopted vault {} into Main ({e})",
                                    root.id
                                );
                            }
                        }
                        if let Err(error) = registry.insert(root.id.clone(), store) {
                            eprintln!("rotli: corpus root {} disabled ({error})", root.id);
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "rotli: corpus root {} unavailable ({e}) — its file commands disabled",
                            root.id
                        );
                    }
                }
            }
            app.manage(corpus::CorpusState(Mutex::new(registry)));
            if let Ok(root) = app.state::<corpus::CorpusState>().default_root_path() {
                if feature_policy::breve_enabled() && root.join(routines::MANAGED_MARKER).is_file() {
                    if let Err(e) = breve::install_rotli_login_agent() {
                        eprintln!("rotli: Breve login item unavailable ({e})");
                    }
                }
                if let Err(e) = breve_supervisor.start(app.handle(), root) {
                    eprintln!("rotli: Breve scheduler unavailable ({e})");
                }
            }
            // The local-compute queue narrates itself: every admission, wait,
            // prioritize and cancel emits the whole snapshot, so the chat
            // surface renders a queued message's honest state instead of
            // inferring it (docs/design/local-compute-guardrails.md).
            {
                let queue_app = app.handle().clone();
                app.state::<compute::ComputeState>().0.install_sink(Box::new(
                    move |v: serde_json::Value| {
                        chat_window::emit_to_shells(&queue_app, "rotli:local-queue", v);
                    },
                ));
            }

            // One parked worker follows the live default route. Plain folders
            // produce no Library candidates; switching to a Rotli vault wakes a
            // fresh reconciliation without rebuilding the app process.
            app.manage(organizer::OrganizerState(organizer_handle.clone()));
            organizer::spawn_organizer(
                app.handle().clone(),
                organizer_handle,
                corpus::DEFAULT_ROOT_ID.to_string(),
            );

            // rotli:// deep links (2026-07-31): a clicked link rides the SAME
            // one-shot mailbox lane `rotli open` uses — the webview consumes it
            // through rotli:open-request. Ids only, validated in
            // parse_deep_link; a link can never name an arbitrary disk path,
            // and a malformed link is ignored, never an error surface.
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link(&handle, &url);
                    }
                });
                // cold start: a click LAUNCHED the app — sweep the URLs that
                // arrived before this listener existed (plugin-recommended)
                let handle = app.handle().clone();
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        handle_deep_link(&handle, &url);
                    }
                }
            }

            // ⌥Space opens the app; ⌥C is the one-breath capture (both rebindable).
            // Best-effort: another app owning a chord (launchers love ⌥Space)
            // must DEGRADE — the app still launches, the chord stays rebindable
            // in Settings → Hotkeys — never abort startup.
            {
                let chords = app.state::<GlobalChords>();
                for (chord, slot) in [
                    (DEFAULT_MAIN_TOGGLE, &chords.main_toggle),
                    (DEFAULT_CAPTURE, &chords.capture),
                    (DEFAULT_QUICK, &chords.quick),
                    (DEFAULT_CHAT_SUMMON, &chords.chat),
                    (DEFAULT_SEARCH_SUMMON, &chords.search),
                ] {
                    if let Err(e) = app.global_shortcut().register(chord) {
                        eprintln!("rotli: global shortcut {chord} unavailable ({e}) — rebind it in Settings");
                        // the OS refused it — never CLAIM a chord that won't fire,
                        // so Settings → Hotkeys shows it unbound instead of lying.
                        *slot.lock().unwrap() = None;
                    }
                }
            }

            // Menu-bar tray: the canonical quokka mark as a TEMPLATE icon (macOS tints it).
            // 44px = 22px logical @2x; tray-icon scales NSImage to the bar height.
            let open = MenuItemBuilder::with_id("open", "Open rotli").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit rotli").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;
            TrayIconBuilder::with_id("rotli")
                .icon(Image::from_bytes(include_bytes!("../icons/tray@2x.png"))?)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main(app),
                    // let the webview flush dirty sheets/settings first (#4)
                    "quit" => graceful_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        // tray left-click toggles the MAIN window
                        toggle_main(tray.app_handle(), true);
                    }
                })
                .build(app)?;

            // ⌘Q must flush before exit (#4 follow-up): the default app menu ends
            // in the PREDEFINED Quit item — native `terminate:`, which kills the
            // process with no interceptable event (tao implements only
            // applicationWillTerminate). Swap it for a look-alike custom item
            // (same title, same ⌘Q) wired to graceful_quit. Structural, not
            // id-matched: the default app submenu's LAST item is the quit slot
            // (menu.rs in tauri pins that shape). If that contract changes we
            // fail startup closed; shipping an un-interceptable ⌘Q would turn a
            // normal user action into silent loss of dirty editor buffers.
            #[cfg(target_os = "macos")]
            {
                let menu = app.menu().ok_or("macOS app menu is unavailable; safe Quit cannot be installed")?;
                let menu_items = menu.items()?;
                let app_sub = match menu_items.first() {
                    Some(tauri::menu::MenuItemKind::Submenu(app_sub)) => app_sub,
                    _ => return Err("macOS app submenu changed; refusing an unsafe unflushed Quit".into()),
                };
                let items = app_sub.items()?;
                let last = match items.last() {
                    Some(last @ tauri::menu::MenuItemKind::Predefined(_)) => last,
                    _ => return Err("macOS Quit menu changed; refusing an unsafe unflushed Quit".into()),
                };
                let quit_app = MenuItemBuilder::with_id("quit-app", "Quit rotli")
                    .accelerator("CmdOrCtrl+Q")
                    .build(app)?;
                app_sub.remove(last)?;
                app_sub.append(&quit_app)?;

                // The default File and Window menus both install native
                // CloseWindow items with ⌘W. AppKit consumes that accelerator
                // before WKWebView, so the registered `tabs.close` action never
                // sees it; CloseRequested then hides the whole app and its
                // visibility flush can surface the macOS wait cursor. Replace
                // both predefined items: the frontend owns ⌘W synchronously;
                // File → Close Tab remains a pointer-selectable command and
                // Window keeps an explicit no-shortcut hide.
                let mut file_sub = None;
                let mut window_sub = None;
                for item in &menu_items {
                    if let tauri::menu::MenuItemKind::Submenu(submenu) = item {
                        if submenu.text().ok().as_deref() == Some("File") {
                            file_sub = Some(submenu.clone());
                        }
                        if submenu.id().as_ref() == tauri::menu::WINDOW_SUBMENU_ID {
                            window_sub = Some(submenu.clone());
                        }
                    }
                }
                let file_sub = file_sub.ok_or("macOS File menu changed; Close Tab cannot be installed")?;
                let window_sub =
                    window_sub.ok_or("macOS Window menu changed; Close Window cannot be replaced")?;

                let file_items = file_sub.items()?;
                let default_file_close = match file_items.first() {
                    Some(item @ tauri::menu::MenuItemKind::Predefined(_)) => item,
                    _ => return Err("macOS File menu changed; native close cannot be replaced safely".into()),
                };
                file_sub.remove(default_file_close)?;

                let window_items = window_sub.items()?;
                let default_window_close = match window_items.last() {
                    Some(item @ tauri::menu::MenuItemKind::Predefined(_)) => item,
                    _ => return Err("macOS Window menu changed; native close cannot be replaced safely".into()),
                };
                window_sub.remove(default_window_close)?;

                // Do not attach ⌘W to the native item: AppKit consumes native
                // menu accelerators before WKWebView and adds a Rust→event→JS
                // round trip. With both predefined close accelerators removed,
                // the frontend registry receives ⌘W in the original key event
                // and closes the tab before the next paint. File → Close Tab
                // still uses this item when selected with the pointer.
                let close_tab = MenuItemBuilder::with_id("close-tab", "Close Tab").build(app)?;
                let close_window = MenuItemBuilder::with_id("close-window", "Close Window").build(app)?;
                file_sub.prepend(&close_tab)?;
                window_sub.append(&close_window)?;
            }

            Ok(())
        })
        // `unstable` makes even the main content a child webview. Its native
        // drags are WebviewEvent, not WindowEvent (tauri-runtime-wry).
        .on_webview_event(|webview, event| {
            if let Some(drag) = native_drag::workspace_drag(webview.label(), event) {
                native_drag::handle(&webview.window(), drag);
            }
        })
        // Click-away hide (the visitor law) — a setting since 2026-06-12:
        // "Stay open" turns it off for the main window. Capture always hides.
        // And closing NEVER destroys (the summon law: summon shows LIVING
        // windows): the traffic-light close — or Window → Close Window — hides
        // instead, or summon, tray click and "Open rotli" would all go dead for
        // the rest of the process. ⌘W is owned by the frontend registry above.
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    // closing the chat window hands its chats back to main
                    // first (the webview hides itself once it has)
                    if window.label() == chat_window::LABEL {
                        chat_window::request_regroup(window.app_handle());
                        return;
                    }
                    let _ = window.hide();
                    return;
                }
                WindowEvent::Focused(false) => {}
                _ => return,
            }
            match window.label() {
                "main" => {
                    let app = window.app_handle();
                    if app.state::<NativeDialogOpen>().is_open() {
                        return;
                    }
                    if !*app.state::<HideOnBlur>().0.lock().unwrap() {
                        return;
                    }
                    let _ = window.hide();
                    let state = app.state::<LastBlurHide>();
                    *state.0.lock().unwrap() = Some(Instant::now());
                }
                "capture" => {
                    let _ = window.hide();
                }
                // the floating Quick Note is a visitor by nature — always hide on
                // click-away (the close-on-blur the maintainer wanted for quick access)
                "quick" => {
                    let _ = window.hide();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                app.state::<routines::BreveSupervisor>().stop();
            }
            // Clicking the Dock icon (when "Show in Dock" is on) of a running app
            // with no visible window must reopen it — macOS sends Reopen, and
            // without handling it the Dock icon does nothing (the maintainer, 2026-06-19).
            // RunEvent::Reopen is a macOS-only variant, so cfg-gate it the same
            // way the rest of this file gates every other macOS API.
            #[cfg(target_os = "macos")]
            {
                // Only a Dock click with NOTHING of ours up reopens the main window.
                // The OS `has_visible_windows` flag ALONE is not enough: the Quick
                // Note (and capture card) are alwaysOnTop / skipTaskbar floating
                // panels that macOS does NOT count there, so summoning Quick — e.g.
                // ⌥. / ⌥Q, which activates the app — fires a spurious Reopen with
                // has_visible_windows=false and wrongly surfaces the whole main
                // window (the maintainer, 2026-06-30). show_quick() shows the panel BEFORE it
                // steals focus, so our own is_visible() check sees it and suppresses
                // the reopen. The quick chord must open ONLY the floating note.
                if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                    let ours_up = is_visible(app, "quick")
                        || is_visible(app, "capture")
                        || is_visible(app, "main")
                        || chat_window::is_open(app);
                    // backstop for the show→focus race: if a panel was just
                    // summoned, this Reopen IS its spurious app-activation event.
                    // take() consumes the latch — one summon swallows exactly one
                    // Reopen, so a later genuine Dock click always gets through.
                    let summoned = app.state::<LastPanelSummon>().0.lock().unwrap().take();
                    if reopen_should_show_main(has_visible_windows, ours_up, summoned) {
                        show_main(app);
                    }
                    // `rotli open <id>` writes its mailbox file then runs
                    // `open -a rotli` — which lands here as a Reopen. Nudge the
                    // frontend to CONSUME the mailbox now (the seventh rotli:*
                    // event, replacing the app-lifetime 750ms poll — perf audit
                    // 2026-07-30, #15). Firing with no request pending is a
                    // cheap no-op read on the other side.
                    let _ = app.emit_to("main", "rotli:open-request", ());
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

/// Entry point used by the packaged binary before Tauri starts. Recognized
/// headless commands return an exit status; ordinary launches return `None`.
pub fn run_headless_if_requested(args: &[String]) -> Option<i32> {
    workspace::run_if_requested(args)
}
