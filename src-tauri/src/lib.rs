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

mod corpus;

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default chords — mirror `app.toggleWindow` / `capture.summon` in
/// src/keys/actions.ts.
const DEFAULT_MAIN_TOGGLE: &str = "Alt+Space";
const DEFAULT_CAPTURE: &str = "Alt+C";

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
}

/// When the main window was last hidden because it lost focus.
struct LastBlurHide(Mutex<Option<Instant>>);

/// The visitor-vs-resident setting: when false, clicking away no longer hides
/// the main window (Settings → General → "Stay open"). Capture always hides.
struct HideOnBlur(Mutex<bool>);

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

/// Show the capture card centered on the ACTIVE display (the one holding the
/// cursor), then tell its webview to refocus the field.
fn show_capture(app: &AppHandle) {
    let Some(window) = app.get_webview_window("capture") else {
        return;
    };
    let centered = (|| -> tauri::Result<()> {
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
    if centered.is_err() {
        let _ = window.center();
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to("capture", "rotli:capture-show", ());
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
                    }
                })
                .build(),
        )
        .manage(GlobalChords {
            capture: Mutex::new(Some(DEFAULT_CAPTURE.to_string())),
            main_toggle: Mutex::new(Some(DEFAULT_MAIN_TOGGLE.to_string())),
        })
        .manage(LastBlurHide(Mutex::new(None)))
        .manage(HideOnBlur(Mutex::new(true)))
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            hide_main_window,
            show_main_window,
            hide_capture_window,
            summon,
            set_summon_shortcut,
            set_hide_on_blur,
            set_dock_visible,
            corpus::corpus_list,
            corpus::corpus_read,
            corpus::corpus_write,
            corpus::corpus_create,
            corpus::corpus_delete,
            corpus::corpus_create_folder,
            corpus::corpus_settings_read,
            corpus::corpus_settings_write
        ])
        .setup(|app| {
            // The visitor law: never in the dock, never in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Phase 2 — the corpus. Open (first run: create root + Inbox +
            // welcome note + .rotli/), then watch it for EXTERNAL changes; the
            // frontend invalidates on "rotli:corpus-changed". A disk error
            // must not kill the shell: commands degrade to clean errors.
            let opened = corpus::CorpusStore::open(corpus::default_corpus_root(app.handle()));
            let store = match opened {
                Ok(store) => {
                    let suppress = store.suppress_set();
                    let watch_root = store.root().to_path_buf();
                    let handle = app.handle().clone();
                    if let Err(e) = corpus::spawn_watcher(watch_root, suppress, move || {
                        let _ = handle.emit_to("main", "rotli:corpus-changed", ());
                    }) {
                        eprintln!("rotli: corpus watcher unavailable ({e}) — external edits won't auto-refresh");
                    }
                    Some(store)
                }
                Err(e) => {
                    eprintln!("rotli: corpus unavailable ({e}) — file commands disabled");
                    None
                }
            };
            app.manage(corpus::CorpusState(Mutex::new(store)));

            // ⌥Space opens the app; ⌥C is the one-breath capture (both rebindable).
            // Best-effort: another app owning a chord (launchers love ⌥Space)
            // must DEGRADE — the app still launches, the chord stays rebindable
            // in Settings → Hotkeys — never abort startup.
            for chord in [DEFAULT_MAIN_TOGGLE, DEFAULT_CAPTURE] {
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
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
