// rotli — the shell. The window is a visitor, not a resident: it lives in the
// menu bar (no dock icon, no Cmd-Tab), is summoned by a global shortcut, and
// hides on blur or Esc. Summon shows LIVING windows — never recreates them —
// so they appear in well under 80ms.
//
// THE SUMMON LAW (revised by Seth, 2026-06-12): ⌥Space toggles the MAIN
// window — "Option+Space is the way we open the app." The quick-capture card
// has its own chord (default ⌥C), and ⌥A ("ask") summons the main window
// straight into a chat. ⌘⏎ in the card (save & open) reveals the main window.
// Tray left-click toggles the MAIN window. All chords are rebindable through
// set_summon_shortcut, and click-away hiding is a setting (set_hide_on_blur)
// so heavy use can keep the window resident.

mod chat;
mod breve;
mod corpus;
mod fsutil;
mod keychain;
mod localmodel;
mod memex;
mod organizer;
mod provider;
mod routines;
mod secret;
mod web;

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default chords — mirror `app.toggleWindow` / `capture.summon` /
/// `quick.summon` / `chat.summon` in src/keys/actions.ts.
const DEFAULT_MAIN_TOGGLE: &str = "Alt+Space";
const DEFAULT_CAPTURE: &str = "Alt+C";
const DEFAULT_QUICK: &str = "Alt+Q";
const DEFAULT_CHAT_SUMMON: &str = "Alt+A";

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// Summoning a floating panel (Quick Note / capture card) calls set_focus, which
/// activates the app and makes macOS fire a Reopen. Within this grace after a
/// summon, that Reopen is the spurious one — never reopen main (Seth, 2026-06-30).
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
}

/// When the main window was last hidden because it lost focus.
struct LastBlurHide(Mutex<Option<Instant>>);

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
/// — so a quick capture from another app never "opens" rotli (Seth, 2026-06-19).
struct CaptureReturn(Mutex<bool>);

/// Whether the Quick Note window has been positioned this session. We center it
/// on the FIRST summon (on the active display); after that we leave it where the
/// user dragged it — re-centering on every summon meant it felt "stuck in the
/// middle, can't move it" (Seth, 2026-06-22).
struct QuickPlaced(Mutex<bool>);

/// Where closing the Quick Note returns focus: true = back to the main window
/// (you were working in it), false = out of rotli entirely (you came from
/// another app, or main was tucked away). Captured at summon time so the ⌥Q
/// chord controls ONLY the quick note — closing it never surfaces the main app
/// (Seth, 2026-06-24). Mirrors CaptureReturn.
struct QuickReturn(Mutex<bool>);

/// The quit-flush handshake (#4 follow-up, review 2026-07). Dirty spreadsheet
/// sessions flush on window-hide/pagehide, but BOTH real quit paths could fire
/// with the window still up and no hide ever seen ("Stay open" mode): tray-Quit
/// ran `app.exit(0)` directly, and ⌘Q rides the default menu's predefined Quit —
/// native `terminate:`, which tao surfaces only as `applicationWillTerminate`,
/// far too late for the webview's ASYNC serialize (exceljs) to finish. So both
/// paths now route through `graceful_quit`: emit "rotli:flush-before-quit" to
/// the main webview, hold the exit until `quit_flush_done` acks (this condvar),
/// and exit anyway after `QUIT_FLUSH_MAX` — quit can never hang on a wedged
/// webview.
struct QuitFlush {
    /// Webviews still owing a `quit_flush_done` ack. Every live webview (main,
    /// quick, capture) gets the flush event — the quick window keeps its OWN
    /// editor buffer in its own module instance, so main's ack alone never
    /// proved the quick note's last keystrokes were on disk.
    pending: Mutex<usize>,
    cv: Condvar,
}

/// The longest a quit will wait for the webview's flush ack. The idle ack is
/// milliseconds (the listener lives in the always-loaded persist chunk); this
/// bound only matters when a big workbook is mid-serialize or the webview hung.
const QUIT_FLUSH_MAX: Duration = Duration::from_secs(2);

/// One webview finished its pre-quit flush — release `graceful_quit`'s wait
/// once EVERY emitted webview has acked (saturating: a double ack never wraps).
#[tauri::command]
fn quit_flush_done(app: AppHandle) {
    let state = app.state::<QuitFlush>();
    let mut pending = state.pending.lock().unwrap();
    *pending = pending.saturating_sub(1);
    state.cv.notify_all();
}

/// Quit, but let every live webview flush dirty state first (see QuitFlush).
/// Called by the tray's Quit item and the app menu's ⌘Q replacement. Hidden
/// panels ack in milliseconds (nothing dirty), so this adds no quit latency.
fn graceful_quit(app: &AppHandle) {
    let mut expected = 0usize;
    for label in ["main", "quick", "capture"] {
        if app.get_webview_window(label).is_some()
            && app.emit_to(label, "rotli:flush-before-quit", ()).is_ok()
        {
            expected += 1;
        }
    }
    if expected == 0 {
        app.exit(0); // nothing to flush / nothing reachable — just go
        return;
    }
    *app.state::<QuitFlush>().pending.lock().unwrap() = expected;
    let handle = app.clone();
    std::thread::spawn(move || {
        let state = handle.state::<QuitFlush>();
        let deadline = Instant::now() + QUIT_FLUSH_MAX;
        let mut pending = state.pending.lock().unwrap();
        while *pending > 0 {
            let now = Instant::now();
            if now >= deadline {
                break; // wedged webview — quit anyway, bounded
            }
            let (guard, _timeout) = state.cv.wait_timeout(pending, deadline - now).unwrap();
            pending = guard;
        }
        drop(pending);
        handle.exit(0);
    });
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
    // remember whether main was up — finish_capture returns focus accordingly
    let main_visible = app
        .get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    *app.state::<CaptureReturn>().0.lock().unwrap() = main_visible;
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
    let was_in_rotli = *app.state::<CaptureReturn>().0.lock().unwrap();
    if was_in_rotli {
        show_main(app);
    } else {
        #[cfg(target_os = "macos")]
        let _ = app.hide();
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
/// the quick note — closing it NEVER surfaces the main window (Seth, 2026-06-26).
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
    // ⌥Q / a rebound ⌥. open main too) (Seth, 2026-06-30).
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
/// folder" feature (Seth, 2026-06-27). It is NOT moved into the memex; it opens as a
/// plain LegacyRotli root (everything writable) so you can use rotli over, say, a
/// work folder without it living in your brain. Picks natively when no path is given;
/// generates a unique slug id from the folder name. Relaunches so it surfaces.
/// Returns false when the picker is cancelled.
#[tauri::command]
fn corpus_add_folder(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Err("Location changes are disabled while the production memex is mounted read-only in development.".into());
    }
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Add a folder to rotli")
                .blocking_pick_folder()
            else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    if !abs.is_dir() {
        return Err("That isn't a folder.".into());
    }
    if !corpus::add_folder(&app, abs)? {
        return Ok(true); // already the corpus / a brain / a folder — no-op, no restart
    }
    app.restart();
}

/// Forget an added folder root (refuses the built-in `default` + `vault`). The files
/// on disk are NEVER touched — only the binding is dropped. Relaunches.
#[tauri::command]
fn corpus_forget_folder(app: AppHandle, id: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Location changes are disabled while the production memex is mounted read-only in development.".into());
    }
    if id == corpus::DEFAULT_ROOT_ID {
        return Err("That's your notes folder — it can't be removed.".into());
    }
    corpus::forget_root(&app, &id)?;
    app.restart();
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
    /// when is_memex: "chats+inbox" | "read-only"; else null
    perms: Option<String>,
}

/// The whole Location config — the one folder (+ whether it's a brain) + connected
/// brains + active brain. Replaces corpus_list_roots + memex_list_instances.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CorpusConfigView {
    corpus: CorpusView,
    brains: Vec<corpus::ConnectedBrain>,
    folders: Vec<corpus::CorpusRoot>,
    active_brain_id: Option<String>,
}

/// The whole Location config. Migrates the four legacy files in on first read.
#[tauri::command]
fn corpus_list_config(app: AppHandle) -> CorpusConfigView {
    let cfg = corpus::ensure_corpus_config(&app);
    let (is_memex, memex_id, mut perms) = match memex::brain_view(&cfg.corpus.abs_path) {
        Some((id, p)) => (true, Some(id), Some(p)),
        None => (false, None, None),
    };
    if cfg!(debug_assertions) {
        perms = Some("read-only".to_string());
    }
    CorpusConfigView {
        corpus: CorpusView {
            abs_path: cfg.corpus.abs_path,
            is_memex,
            memex_id,
            perms,
        },
        brains: cfg.brains,
        folders: cfg.folders,
        active_brain_id: cfg.active_brain_id,
    }
}

/// "Choose folder…" — the ONE smart picker for your notes folder (your brain).
/// Detects what you picked: a memex → browse it as the whole corpus; an empty
/// folder → move your current notes there (only when the current corpus is a
/// PLAIN folder — a memex is never scattered by a move) else start fresh; a plain
/// folder with files → use it as-is, never merged. Relaunches into the new
/// corpus. Returns false when the picker is cancelled.
#[tauri::command]
fn corpus_choose_folder(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Err("The production memex is the fixed read-only source in development.".into());
    }
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Choose your notes folder")
                .blocking_pick_folder()
            else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    let current = corpus::resolve_corpus(&app);
    if abs == current {
        return Ok(false);
    }
    match memex::detect_folder(&abs).kind.as_str() {
        "memex" => corpus::set_corpus_path(&app, abs)?,
        "fresh" => {
            if !corpus::is_memex_root(&current) {
                corpus::relocate(&current, &abs)?;
            }
            corpus::set_corpus_path(&app, abs)?;
        }
        _ => corpus::set_corpus_path(&app, abs)?,
    }
    app.restart();
}

/// Onboarding "create a new brain": scaffold a fresh memex at `path` and make it
/// your corpus — the corpus IS a memex (your folder is your brain). Relaunches
/// into it. `path` is an absolute folder (the native picker creates/names it).
#[tauri::command]
fn corpus_init_memex(app: AppHandle, path: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Creating or replacing the primary memex is disabled in development.".into());
    }
    let root = std::path::PathBuf::from(&path);
    memex::scaffold_memex(&root)?;
    corpus::set_corpus_path(&app, root)?;
    app.restart();
}

/// Connect a brain (a memex) to read — and write into per its perms. Validates +
/// stamps via the memex module, registers it in corpus.json, makes it active, and
/// relaunches so its sidebar row appears. False when the picker is cancelled.
#[tauri::command]
fn corpus_connect_brain(app: AppHandle, path: Option<String>) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Err("The production memex is already mounted as the single read-only source in development.".into());
    }
    use tauri_plugin_dialog::DialogExt;
    let abs = match path {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Connect a brain (a memex folder)")
                .blocking_pick_folder()
            else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    let meta = memex::prepare_brain_connect(&abs)?;
    corpus::upsert_brain(
        &app,
        corpus::ConnectedBrain {
            id: String::new(),
            label: meta.label,
            abs_path: abs,
            memex_id: Some(meta.memex_id),
            mode: meta.mode,
            perms: meta.perms,
        },
        true,
    )?;
    app.restart();
}

/// Forget a connected brain (the binding only — its files are never touched).
/// Relaunches so its sidebar row disappears.
#[tauri::command]
fn corpus_forget_brain(app: AppHandle, id: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("The production memex binding cannot be changed in development.".into());
    }
    // forget_root is a superset of the old forget_brain (it also drops a folder by
    // id, a no-op for a brain id) — one path now handles brains + folders.
    corpus::forget_root(&app, &id)?;
    app.restart();
}

/// Make a connected brain the active write target. No relaunch — the frontend
/// refetches the config.
#[tauri::command]
fn corpus_set_active_brain(app: AppHandle, id: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("The production memex is the fixed read-only source in development.".into());
    }
    corpus::set_active_brain(&app, &id)
}

/// Set a brain's write perms ("chats+inbox" | "read-only"). No relaunch — the
/// LIVE store's Rust write gate is updated in the same breath (#3, audit
/// 2026-07), so the perms hold immediately, not only after the next launch.
/// The store may be unbound (its folder vanished) — that's fine, startup will
/// re-apply the persisted perms whenever it binds again.
#[tauri::command]
fn corpus_set_brain_perms(app: AppHandle, id: String, perms: String) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("Production memex permissions cannot be changed in development.".into());
    }
    corpus::set_brain_perms(&app, &id, &perms)?;
    let state = app.state::<corpus::CorpusState>();
    let _ = state.route(&id, |s| {
        s.set_perms_read_only(perms == "read-only");
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

/// Swap the macOS Dock/app icon at runtime (Settings → Appearance → App icon).
/// The variant PNGs are compiled in; "default" (or any unknown value) resets to
/// the bundle icon. AppKit's setApplicationIconImage must run on the main thread.
#[tauri::command]
fn set_app_icon(app: AppHandle, variant: String) {
    #[cfg(target_os = "macos")]
    {
        let bytes: Option<Vec<u8>> = match variant.as_str() {
            "warm" => Some(include_bytes!("../icons/variants/warm.png").to_vec()),
            "paper" => Some(include_bytes!("../icons/variants/paper.png").to_vec()),
            "charcoal" => Some(include_bytes!("../icons/variants/charcoal.png").to_vec()),
            "clay" => Some(include_bytes!("../icons/variants/clay.png").to_vec()),
            _ => None, // "default" → the bundle icon (nil clears the override)
        };
        let _ = app.run_on_main_thread(move || {
            use objc2::{AllocAnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;
            let Some(mtm) = MainThreadMarker::new() else { return };
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
    corpus::set_demo(&app, on)?;
    app.restart();
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
                        show_main(app);
                        let _ = app.emit_to("main", "rotli:summon-chat", ());
                    }
                })
                .build(),
        )
        .manage(GlobalChords {
            capture: Mutex::new(Some(DEFAULT_CAPTURE.to_string())),
            main_toggle: Mutex::new(Some(DEFAULT_MAIN_TOGGLE.to_string())),
            quick: Mutex::new(Some(DEFAULT_QUICK.to_string())),
            chat: Mutex::new(Some(DEFAULT_CHAT_SUMMON.to_string())),
        })
        .manage(LastBlurHide(Mutex::new(None)))
        .manage(LastPanelSummon(Mutex::new(None)))
        .manage(HideOnBlur(Mutex::new(true)))
        .manage(CaptureReturn(Mutex::new(false)))
        .manage(QuickPlaced(Mutex::new(false)))
        .manage(QuickReturn(Mutex::new(false)))
        .manage(QuitFlush { pending: Mutex::new(0), cv: Condvar::new() })
        .manage(provider::ProviderState::default())
        .manage(localmodel::LocalModelState::default())
        // the app-menu ⌘Q replacement (see setup) — tray menu events have their
        // own handler; the ids are distinct so double-dispatch can't double-quit
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit-app" {
                graceful_quit(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            quit_flush_done,
            hide_main_window,
            show_main_window,
            hide_capture_window,
            finish_capture_window,
            toggle_quick_window,
            hide_quick_window,
            corpus_reveal,
            corpus_add_folder,
            corpus_forget_folder,
            corpus_list_config,
            corpus_choose_folder,
            corpus_init_memex,
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
            corpus::corpus_convert_document,
            corpus::corpus_managed_file_creation_available,
            corpus::corpus_reveal_file,
            corpus::corpus_open_with_apps,
            corpus::corpus_open_file_with,
            corpus::corpus_import_file,
            corpus::corpus_abs,
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
            corpus::corpus_set_secure,
            corpus::corpus_set_local_ai_access,
            corpus::corpus_read_ai,
            corpus::corpus_write,
            corpus::corpus_create,
            corpus::corpus_delete,
            corpus::corpus_discard_blank,
            corpus::corpus_move,
            corpus::corpus_rename_board,
            breve::breve_snapshot,
            breve::breve_import_legacy,
            breve::breve_write_config,
            breve::breve_write_watchlist,
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
            provider::cli_detect,
            provider::cli_complete,
            provider::cli_cancel,
            provider::generate_image,
            localmodel::local_model_install,
            localmodel::local_model_install_progress,
            localmodel::local_model_install_cancel,
            localmodel::local_model_set_default,
            localmodel::local_model_default,
            localmodel::local_model_uninstall,
            localmodel::system_profile,
            keychain::secret_store,
            keychain::secret_exists,
            keychain::secret_delete,
            organizer::organizer_status,
            organizer::organizer_run_once,
            organizer::organizer_set_trust,
            organizer::organizer_learn_field,
            web::web_search,
            web::web_fetch,
            web::open_url,
            corpus::corpus_create_folder,
            corpus::corpus_read_board,
            corpus::corpus_write_board,
            corpus::corpus_create_board,
            corpus::corpus_overview,
            corpus::corpus_settings_read,
            corpus::corpus_settings_write,
            corpus::corpus_main_write,
            memex::memex_detect,
            memex::memex_read_contract,
            memex::memex_read,
            memex::memex_list_chats,
            memex::memex_write_chat,
            memex::memex_rename_chat,
            memex::memex_delete_chat,
            memex::memex_archive_chat,
            memex::memex_write_note,
            memex::memex_validate,
            memex::memex_pick_folder
        ])
        .setup(|app| {
            // The visitor law: never in the dock, never in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            let mut daemon_target: Option<(String, std::path::PathBuf)> = None;
            // #3 (audit 2026-07): a connected brain's USER-SET perms must reach the
            // Rust write gates, not only the TS canWrite — carry them by root id.
            let brain_perms: std::collections::HashMap<String, String> =
                corpus::ensure_corpus_config(app.handle())
                    .brains
                    .into_iter()
                    .map(|b| (b.id, b.perms))
                    .collect();
            let roots = corpus::startup_roots(app.handle());
            for root in roots {
                let opened = if cfg!(debug_assertions) {
                    corpus::CorpusStore::open_read_only(root.abs_path.clone())
                } else {
                    corpus::CorpusStore::open(root.abs_path.clone())
                };
                match opened {
                    Ok(mut store) => {
                        if cfg!(debug_assertions)
                            || brain_perms.get(&root.id).map(String::as_str) == Some("read-only")
                        {
                            store.set_perms_read_only(true);
                        }
                        let suppress = store.suppress_set();
                        let watch_root = store.root().to_path_buf();
                        // let the asset protocol serve this corpus's files, so
                        // storage/ images render via convertFileSrc — robust even if
                        // the config scope glob doesn't cover the corpus location.
                        let _ = app.asset_protocol_scope().allow_directory(store.root(), true);
                        let handle = app.handle().clone();
                        // The daemon runs over the DEFAULT root, and only when it is
                        // a memex (the Filer lane only exists there). Never a connected
                        // brain: the frontend's journal/approve/undo commands all route
                        // to the default root, so binding the daemon anywhere else
                        // would split the §4.5 review loop across two corpora —
                        // proposals journaled where the UI never reads, approvals
                        // refused where the daemon never wrote.
                        let is_target = !cfg!(debug_assertions)
                            && root.id == corpus::DEFAULT_ROOT_ID
                            && store.is_memex()
                            && daemon_target.is_none();
                        if is_target {
                            daemon_target = Some((root.id.clone(), store.root().to_path_buf()));
                        }
                        let org = is_target
                            .then(|| (organizer_handle.clone(), store.root().to_path_buf()));
                        if let Err(e) = corpus::spawn_watcher(watch_root, suppress, move |paths| {
                            let _ = handle.emit_to("main", "rotli:corpus-changed", ());
                            // the memex root also feeds the daemon's queue — the
                            // watcher already dropped .rotli/, dot-files and our
                            // own suppressed writes, so no echo can land here
                            if let Some((org, org_root)) = &org {
                                org.enqueue(org_root, paths);
                            }
                        }) {
                            eprintln!(
                                "rotli: corpus watcher unavailable for root {} ({e}) — external edits won't auto-refresh",
                                root.id
                            );
                        }
                        registry.insert(root.id, store);
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
                if root.join(routines::MANAGED_MARKER).is_file() {
                    if let Err(e) = breve::install_rotli_login_agent() {
                        eprintln!("rotli: Breve login item unavailable ({e})");
                    }
                }
                if let Err(e) = breve_supervisor.start(app.handle(), root) {
                    eprintln!("rotli: Breve scheduler unavailable ({e})");
                }
            }
            // Manage the handle either way (the commands must answer), but only
            // spawn the worker when a memex root exists — organizer_status then
            // reports running:false on a plain corpus.
            app.manage(organizer::OrganizerState(organizer_handle.clone()));
            if let Some((mx_id, mx_root)) = daemon_target {
                organizer::spawn_organizer(app.handle().clone(), organizer_handle, mx_id, mx_root);
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
                ] {
                    if let Err(e) = app.global_shortcut().register(chord) {
                        eprintln!("rotli: global shortcut {chord} unavailable ({e}) — rebind it in Settings");
                        // the OS refused it — never CLAIM a chord that won't fire,
                        // so Settings → Hotkeys shows it unbound instead of lying.
                        *slot.lock().unwrap() = None;
                    }
                }
            }

            // Menu-bar tray: the kit r-mark as a TEMPLATE icon (macOS tints it).
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
            // (menu.rs in tauri pins that shape); if the shape ever changes the
            // swap degrades to a no-op and ⌘Q just quits un-flushed — never a
            // startup failure.
            #[cfg(target_os = "macos")]
            if let Some(menu) = app.menu() {
                if let Some(tauri::menu::MenuItemKind::Submenu(app_sub)) =
                    menu.items().unwrap_or_default().into_iter().next()
                {
                    let items = app_sub.items().unwrap_or_default();
                    if let Some(last @ tauri::menu::MenuItemKind::Predefined(_)) = items.last() {
                        let quit_app = MenuItemBuilder::with_id("quit-app", "Quit rotli")
                            .accelerator("CmdOrCtrl+Q")
                            .build(app)?;
                        app_sub.remove(last)?;
                        app_sub.append(&quit_app)?;
                    }
                }
            }

            Ok(())
        })
        // Click-away hide (the visitor law) — a setting since 2026-06-12:
        // "Stay open" turns it off for the main window. Capture always hides.
        // And closing NEVER destroys (the summon law: summon shows LIVING
        // windows): the traffic-light close — or Cmd+W reaching the default
        // macOS menu's Close Window — hides instead, or summon, tray click and
        // "Open rotli" would all go dead for the rest of the process.
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                WindowEvent::Focused(false) => {}
                _ => return,
            }
            match window.label() {
                "main" => {
                    let app = window.app_handle();
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
                // click-away (the close-on-blur Seth wanted for quick access)
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
            // without handling it the Dock icon does nothing (Seth, 2026-06-19).
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
                // window (Seth, 2026-06-30). show_quick() shows the panel BEFORE it
                // steals focus, so our own is_visible() check sees it and suppresses
                // the reopen. The quick chord must open ONLY the floating note.
                if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                    let ours_up = is_visible(app, "quick")
                        || is_visible(app, "capture")
                        || is_visible(app, "main");
                    // backstop for the show→focus race: if a panel was just
                    // summoned, this Reopen IS its spurious app-activation event.
                    // take() consumes the latch — one summon swallows exactly one
                    // Reopen, so a later genuine Dock click always gets through.
                    let summoned = app.state::<LastPanelSummon>().0.lock().unwrap().take();
                    if reopen_should_show_main(has_visible_windows, ours_up, summoned) {
                        show_main(app);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
