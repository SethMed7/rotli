// rotli — the shell. The window is a visitor, not a resident: it lives in the
// menu bar (no dock icon, no Cmd-Tab), is summoned by a global shortcut, and
// hides on blur or Esc. Summon shows LIVING windows — never recreates them —
// so they appear in well under 80ms.
//
// THE SUMMON LAW (1c): when rotli is hidden, ⌥Space opens the quick-capture
// card; when the main window is visible, ⌥Space hides the app. ⌘⏎ in the card
// (save & open) reveals the main window. Tray left-click toggles the MAIN
// window. Both summon surfaces are separate registry actions, so either chord
// is rebindable through set_summon_shortcut.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default summon chord — mirrors `capture.summon` in src/keys/actions.ts.
const DEFAULT_SUMMON: &str = "Alt+Space";

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// The OS-registered accelerators, per global registry action (rebindable
/// from the frontend via the `set_summon_shortcut` command).
struct GlobalChords {
    /// `capture.summon` — the summon law (always bound).
    capture: Mutex<String>,
    /// `app.toggleWindow` — main-window toggle (unbound until Seth binds it).
    main_toggle: Mutex<Option<String>>,
}

/// When the main window was last hidden because it lost focus.
struct LastBlurHide(Mutex<Option<Instant>>);

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
        let cursor = app.cursor_position()?;
        let Some(monitor) = app.monitor_from_point(cursor.x, cursor.y)? else {
            return Err(tauri::Error::WindowNotFound);
        };
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

/// The summon law: main visible → hide the app; capture visible → dismiss it;
/// otherwise → the quick-capture card.
fn do_summon(app: &AppHandle) {
    if is_visible(app, "main") {
        hide_main(app);
        hide_capture(app);
        return;
    }
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
        let _ = window.hide();
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

/// Re-register a global chord (the keys registry calls this when a global
/// action is rebound). Keeps the old chord if the new one fails to register,
/// so summon is never lost.
#[tauri::command]
fn set_summon_shortcut(app: AppHandle, action_id: String, accelerator: String) -> Result<(), String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("invalid accelerator {accelerator:?}: {e}"))?;

    let shortcuts = app.global_shortcut();
    let chords = app.state::<GlobalChords>();

    match action_id.as_str() {
        "capture.summon" => {
            let mut current = chords.capture.lock().unwrap();
            let _ = shortcuts.unregister(current.as_str());
            if let Err(e) = shortcuts.register(accelerator.as_str()) {
                let _ = shortcuts.register(current.as_str());
                return Err(format!("could not register {accelerator:?}: {e}"));
            }
            *current = accelerator;
        }
        "app.toggleWindow" => {
            let mut current = chords.main_toggle.lock().unwrap();
            if let Some(old) = current.as_deref() {
                let _ = shortcuts.unregister(old);
            }
            if let Err(e) = shortcuts.register(accelerator.as_str()) {
                if let Some(old) = current.as_deref() {
                    let _ = shortcuts.register(old);
                }
                return Err(format!("could not register {accelerator:?}: {e}"));
            }
            *current = Some(accelerator);
        }
        other => return Err(format!("unknown global action: {other}")),
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
                    if matches(&capture) {
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
            capture: Mutex::new(DEFAULT_SUMMON.to_string()),
            main_toggle: Mutex::new(None),
        })
        .manage(LastBlurHide(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            hide_main_window,
            show_main_window,
            hide_capture_window,
            summon,
            set_summon_shortcut
        ])
        .setup(|app| {
            // The visitor law: never in the dock, never in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ⌥Space summons from anywhere (the summon law).
            app.global_shortcut().register(DEFAULT_SUMMON)?;

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
        // Click-away hide (the visitor law): losing focus dismisses the window.
        .on_window_event(|window, event| {
            let WindowEvent::Focused(false) = event else {
                return;
            };
            match window.label() {
                "main" => {
                    let _ = window.hide();
                    let state = window.app_handle().state::<LastBlurHide>();
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
