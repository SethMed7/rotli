// rotli — the shell. The window is a visitor, not a resident: it lives in the
// menu bar (no dock icon, no Cmd-Tab), is summoned by a global shortcut, and
// hides on blur or Esc. Summon shows a LIVING window — never recreates it —
// so it appears in well under 80ms.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Default summon chord — mirrors `app.toggleWindow` in src/keys/registry.ts.
const DEFAULT_SUMMON: &str = "Alt+Space";

/// Clicking the tray icon steals focus from the window, so blur fires (and
/// hides it) *before* the tray click arrives. Within this grace window the
/// tray toggle treats "just hidden by blur" as the intended hide and does not
/// immediately re-show.
const BLUR_TOGGLE_GRACE: Duration = Duration::from_millis(300);

/// The currently registered summon accelerator (rebindable from the registry
/// via the `set_summon_shortcut` command).
struct SummonShortcut(Mutex<String>);

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

/// Re-register the global summon shortcut (the keys registry calls this when
/// the user rebinds `app.toggleWindow`). Keeps the old chord if the new one
/// fails to register, so summon is never lost.
#[tauri::command]
fn set_summon_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("invalid accelerator {accelerator:?}: {e}"))?;

    let shortcuts = app.global_shortcut();
    let state = app.state::<SummonShortcut>();
    let mut current = state.0.lock().unwrap();

    let _ = shortcuts.unregister(current.as_str());
    if let Err(e) = shortcuts.register(accelerator.as_str()) {
        let _ = shortcuts.register(current.as_str());
        return Err(format!("could not register {accelerator:?}: {e}"));
    }
    *current = accelerator;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // Only the summon chord is ever registered OS-wide.
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main(app, false);
                    }
                })
                .build(),
        )
        .manage(SummonShortcut(Mutex::new(DEFAULT_SUMMON.to_string())))
        .manage(LastBlurHide(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            toggle_main_window,
            hide_main_window,
            set_summon_shortcut
        ])
        .setup(|app| {
            // The visitor law: never in the dock, never in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ⌥Space summons from anywhere.
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
                        toggle_main(tray.app_handle(), true);
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Click-away hide (the visitor law): losing focus dismisses the window.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::Focused(false) = event {
                let _ = window.hide();
                let state = window.app_handle().state::<LastBlurHide>();
                *state.0.lock().unwrap() = Some(Instant::now());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
