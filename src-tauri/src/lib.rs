// rotli — the shell. The window is a visitor, not a resident: it lives in the
// menu bar (no dock icon, no Cmd-Tab), is summoned by a global shortcut, and
// hides on blur or Esc. Summon shows LIVING windows — never recreates them —
// so they appear in well under 80ms.
//
// THE SUMMON LAW (revised by Seth, 2026-06-12): ⌥Space toggles the MAIN
// window — "Option+Space is the way we open the app." The quick-capture card
// has its own chord (default ⌥C). ⌘⏎ in the card (save & open) reveals the
// main window. Tray left-click toggles the MAIN window. Both chords are
// rebindable through set_summon_shortcut, and click-away hiding is a setting
// (set_hide_on_blur) so heavy use can keep the window resident.

mod chat;
mod corpus;
mod memex;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default chords — mirror `app.toggleWindow` / `capture.summon` /
/// `quick.summon` in src/keys/actions.ts.
const DEFAULT_MAIN_TOGGLE: &str = "Alt+Space";
const DEFAULT_CAPTURE: &str = "Alt+C";
const DEFAULT_QUICK: &str = "Alt+Q";

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// The OS-registered accelerators, per global registry action (rebindable
/// from the frontend via the `set_summon_shortcut` command).
struct GlobalChords {
    /// `capture.summon` — the quick-capture card.
    capture: Mutex<Option<String>>,
    /// `app.toggleWindow` — main-window toggle (the way the app opens).
    main_toggle: Mutex<Option<String>>,
    /// `quick.summon` — the floating Quick Note window.
    quick: Mutex<Option<String>>,
}

/// When the main window was last hidden because it lost focus.
struct LastBlurHide(Mutex<Option<Instant>>);

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

#[tauri::command]
fn show_quick_window(app: AppHandle) {
    show_quick(&app);
}

/// Settings → Storage → "Reveal in Finder": open the corpus folder.
#[tauri::command]
fn corpus_reveal(app: AppHandle) {
    let root = corpus::resolve_root(&app);
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&root).spawn();
    #[cfg(not(target_os = "macos"))]
    let _ = root;
}

/// Settings → Storage → "Move folder…": pick an empty destination, move the
/// whole corpus there, remember it as the new root, and relaunch into it (a
/// clean re-open beats live-swapping the open store + watcher). Returns false
/// when the picker is cancelled; Err carries a human message for the UI.
#[tauri::command]
fn corpus_relocate(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // "Move folder…" moves your LEGACY notes folder. If rotli is currently
    // browsing a memex (the corpus IS someone's memex-vault), refuse — relocating
    // would physically scatter the brain out of its home. Switch back first.
    if corpus::read_saved_memex_root(&app)
        .filter(|p| corpus::is_memex_root(p))
        .is_some()
    {
        return Err(
            "rotli is browsing a memex right now — in Settings → Memory choose \"Use ~/Documents/rotli\" before moving your notes folder."
                .into(),
        );
    }
    let old_root = corpus::resolve_root(&app);
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Choose an empty folder for your notes")
        .blocking_pick_folder()
    else {
        return Ok(false);
    };
    let new_root = picked.into_path().map_err(|e| e.to_string())?;
    if new_root == old_root {
        return Ok(false);
    }
    corpus::relocate(&old_root, &new_root)?;
    corpus::write_saved_root(&app, &new_root).map_err(|e| e.to_string())?;
    app.restart();
}

/// Settings → Memory → "Browse in Notes": point rotli's Notes tree at a memex
/// instance (Increment 3). Validates that `path` really is a memex (a valid
/// `mx_` memex.json), remembers it as the corpus-memex pointer, and relaunches
/// into it — a clean re-open beats live-swapping the store + watcher (mirrors
/// corpus_relocate's restart). The legacy `~/Documents/rotli` corpus is left
/// untouched on disk; this is a reversible pointer swap, not a move.
#[tauri::command]
fn corpus_use_memex(app: AppHandle, path: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&path);
    if !corpus::is_memex_root(&root) {
        return Err("That folder isn't a memex (no valid memex.json with an mx_ id).".into());
    }
    corpus::write_saved_memex_root(&app, &root).map_err(|e| e.to_string())?;
    app.restart();
}

/// Settings → Memory → "Use ~/Documents/rotli instead": forget the memex
/// pointer and relaunch into the legacy corpus. Reversible counterpart to
/// corpus_use_memex; the memex itself is never modified.
#[tauri::command]
fn corpus_use_legacy(app: AppHandle) -> Result<(), String> {
    corpus::clear_saved_memex_root(&app).map_err(|e| e.to_string())?;
    app.restart();
}

/// Settings → Storage → "Connect a folder…": REGISTER a picked directory as a
/// root's abs_path in `corpus-roots.json` (Track 2). This is a REGISTER, never a
/// move/relocate — the directory's contents are never touched. For the reserved
/// "vault" dest the dir MUST be a valid memex (we never bind the vault to a
/// non-memex automatically OR via the picker); other dests accept any dir.
/// Relaunches so the new root opens (mirrors corpus_relocate/corpus_use_memex).
/// Returns false when the picker is cancelled.
#[tauri::command]
fn corpus_set_root(app: AppHandle, dest_id: String, path: Option<String>) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    // only the Vault is a connectable external root this iteration — refuse any
    // other dest_id so a future/stray caller can't register an arbitrary writable
    // root that bypasses the memex gate (the picker only ever passes "vault").
    if dest_id != corpus::VAULT_ROOT_ID {
        return Err(format!("not a connectable destination: {dest_id}"));
    }
    // resolve the absolute dir: an explicit path (tests / programmatic) or the
    // native folder picker (the user's frontend control).
    let abs = match path {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let Some(picked) = app
                .dialog()
                .file()
                .set_title("Choose a folder to connect")
                .blocking_pick_folder()
            else {
                return Ok(false);
            };
            picked.into_path().map_err(|e| e.to_string())?
        }
    };
    if dest_id == corpus::VAULT_ROOT_ID && !corpus::is_memex_root(&abs) {
        return Err("The Vault must point at a memex (a folder with a valid memex.json).".into());
    }
    let label = if dest_id == corpus::VAULT_ROOT_ID {
        "Vault".to_string()
    } else {
        abs.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&dest_id)
            .to_string()
    };
    let mut reg = corpus::read_root_registry(&app);
    reg.upsert(corpus::CorpusRoot { id: dest_id, label, abs_path: abs });
    corpus::write_root_registry(&app, &reg)?;
    app.restart();
}

/// Add an ARBITRARY folder as a browsable + editable corpus root — the "just add a
/// folder" feature (Seth, 2026-06-27). It is NOT moved into the memex; it opens as a
/// plain LegacyRotli root (everything writable) so you can use rotli over, say, a
/// work folder without it living in your brain. Picks natively when no path is given;
/// generates a unique slug id from the folder name. Relaunches so it surfaces.
/// Returns false when the picker is cancelled.
#[tauri::command]
fn corpus_add_folder(app: AppHandle, path: Option<String>) -> Result<bool, String> {
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
    let mut reg = corpus::read_root_registry(&app);
    if reg.roots.iter().any(|r| r.abs_path == abs) {
        return Ok(true); // already added — no-op, no restart needed
    }
    let label = abs
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("folder")
        .to_string();
    let id = corpus::unique_root_id(&reg, &label);
    reg.upsert(corpus::CorpusRoot { id, label, abs_path: abs });
    corpus::write_root_registry(&app, &reg)?;
    app.restart();
}

/// Forget an added folder root (refuses the built-in `default` + `vault`). The files
/// on disk are NEVER touched — only the binding is dropped. Relaunches.
#[tauri::command]
fn corpus_forget_folder(app: AppHandle, id: String) -> Result<(), String> {
    if id == corpus::DEFAULT_ROOT_ID || id == corpus::VAULT_ROOT_ID {
        return Err("That's a built-in root — it can't be removed.".into());
    }
    let mut reg = corpus::read_root_registry(&app);
    reg.roots.retain(|r| r.id != id);
    corpus::write_root_registry(&app, &reg)?;
    app.restart();
}

/// Every registered root (default + vault + added folders), for the sidebar to render
/// the added ones as top-level browsable rows.
#[tauri::command]
fn corpus_list_roots(app: AppHandle) -> Vec<corpus::CorpusRoot> {
    corpus::resolve_registry(&app).roots
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
                    }
                })
                .build(),
        )
        .manage(GlobalChords {
            capture: Mutex::new(Some(DEFAULT_CAPTURE.to_string())),
            main_toggle: Mutex::new(Some(DEFAULT_MAIN_TOGGLE.to_string())),
            quick: Mutex::new(Some(DEFAULT_QUICK.to_string())),
        })
        .manage(LastBlurHide(Mutex::new(None)))
        .manage(HideOnBlur(Mutex::new(true)))
        .manage(CaptureReturn(Mutex::new(false)))
        .manage(QuickPlaced(Mutex::new(false)))
        .manage(QuickReturn(Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            hide_main_window,
            show_main_window,
            hide_capture_window,
            finish_capture_window,
            toggle_quick_window,
            hide_quick_window,
            show_quick_window,
            corpus_reveal,
            corpus_relocate,
            corpus_use_memex,
            corpus_use_legacy,
            corpus_set_root,
            corpus_add_folder,
            corpus_forget_folder,
            corpus_list_roots,
            summon,
            set_summon_shortcut,
            set_hide_on_blur,
            set_dock_visible,
            corpus::corpus_list,
            corpus::corpus_read,
            corpus::corpus_write,
            corpus::corpus_create,
            corpus::corpus_delete,
            corpus::corpus_move,
            corpus::corpus_rename_board,
            chat::chat_complete,
            chat::chat_models,
            corpus::corpus_purge,
            corpus::corpus_create_folder,
            corpus::corpus_read_board,
            corpus::corpus_write_board,
            corpus::corpus_create_board,
            corpus::corpus_overview,
            corpus::corpus_settings_read,
            corpus::corpus_settings_write,
            memex::memex_detect,
            memex::memex_inspect,
            memex::memex_read_contract,
            memex::memex_read,
            memex::memex_list_chats,
            memex::memex_list_dir,
            memex::memex_init,
            memex::memex_connect,
            memex::memex_write_chat,
            memex::memex_write_note,
            memex::memex_append_inbox,
            memex::memex_validate,
            memex::memex_list_instances,
            memex::memex_set_active,
            memex::memex_set_perms,
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
            let mut registry = corpus::CorpusRegistry::new(corpus::DEFAULT_ROOT_ID.to_string());
            let roots = corpus::startup_roots(app.handle());
            for root in roots {
                match corpus::CorpusStore::open(root.abs_path.clone()) {
                    Ok(store) => {
                        let suppress = store.suppress_set();
                        let watch_root = store.root().to_path_buf();
                        let handle = app.handle().clone();
                        if let Err(e) = corpus::spawn_watcher(watch_root, suppress, move || {
                            let _ = handle.emit_to("main", "rotli:corpus-changed", ());
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

            // ⌥Space opens the app; ⌥C is the one-breath capture (both rebindable).
            // Best-effort: another app owning a chord (launchers love ⌥Space)
            // must DEGRADE — the app still launches, the chord stays rebindable
            // in Settings → Hotkeys — never abort startup.
            for chord in [DEFAULT_MAIN_TOGGLE, DEFAULT_CAPTURE, DEFAULT_QUICK] {
                if let Err(e) = app.global_shortcut().register(chord) {
                    eprintln!("rotli: global shortcut {chord} unavailable ({e}) — rebind it in Settings");
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
                    "quit" => app.exit(0),
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
            // Clicking the Dock icon (when "Show in Dock" is on) of a running app
            // with no visible window must reopen it — macOS sends Reopen, and
            // without handling it the Dock icon does nothing (Seth, 2026-06-19).
            // RunEvent::Reopen is a macOS-only variant, so cfg-gate it the same
            // way the rest of this file gates every other macOS API.
            #[cfg(target_os = "macos")]
            {
                // Only a Dock click with NOTHING visible reopens the main window.
                // Without the has_visible_windows guard, summoning the Quick Note
                // (⌥Q) — which activates the app — can fire a spurious Reopen while
                // Quick is up and wrongly surface the whole main window (Seth,
                // 2026-06-22). When any window (quick/capture/main) is visible, the
                // Dock click is a no-op here.
                if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                    if !has_visible_windows {
                        show_main(app);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
