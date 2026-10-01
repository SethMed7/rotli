//! Pinned sites (docs/decisions/2026-10-01-pinned-sites.md): up to three
//! https sites the person stays signed in to, each in its own child webview of
//! the main window with its OWN persistent WebKit store. Everything else
//! matches the private browser: no Tauri capability names the guest, the
//! address passes `blocked_for_remote`, navigation stays http(s), downloads
//! are refused, and a page asking for a new window is navigated in place.

use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

use crate::private_browser::{
    page_navigation_allowed, private_url, safe_bounds, set_bounds, PrivateBrowserBounds,
};

/// How many sites can be pinned (the owner: "up to 3").
pub(crate) const MAX_PINS: u8 = 3;

fn pin_label(slot: u8) -> Result<String, String> {
    if slot >= MAX_PINS {
        return Err("invalid pinned-site slot".into());
    }
    Ok(format!("pinned-site-{slot}"))
}

/// A pin's store id: 32 lowercase hex characters (16 random bytes, made by the
/// frontend when the site is pinned). Never Rotli's own store.
pub(crate) fn store_id(hex: &str) -> Result<[u8; 16], String> {
    if hex.len() != 32
        || !hex
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid pinned-site store".into());
    }
    let mut id = [0u8; 16];
    for (i, byte) in id.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|_| "invalid pinned-site store")?;
    }
    if id == [0u8; 16] {
        return Err("invalid pinned-site store".into());
    }
    Ok(id)
}

/// A pinned address: the private browser's checks, and https only (a signed-in
/// session never rides plain http).
fn pinned_url(value: &str) -> Result<tauri::Url, String> {
    let url = private_url(value)?;
    if url.scheme() != "https" {
        return Err("a pinned site must be an https address".into());
    }
    Ok(url)
}

/// WebKit keeps a store per identifier only from macOS 14; below that it
/// would quietly use the default store Rotli's own webview has.
#[cfg(target_os = "macos")]
fn per_site_stores() -> bool {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 14
}

#[cfg(not(target_os = "macos"))]
fn per_site_stores() -> bool {
    false
}

#[tauri::command]
pub fn pinned_sites_supported() -> bool {
    per_site_stores()
}

/// Show the pin's page at `bounds`: the live page when it is already open (a
/// quick return keeps where the person was), otherwise a new one on `url`.
#[tauri::command]
pub fn pinned_site_open(
    app: AppHandle,
    slot: u8,
    url: String,
    store: String,
    bounds: PrivateBrowserBounds,
) -> Result<(), String> {
    if !per_site_stores() {
        return Err("pinned sites need macOS 14 or later".into());
    }
    let label = pin_label(slot)?;
    let url = pinned_url(&url)?;
    let store = store_id(&store)?;
    let bounds = safe_bounds(bounds)?;
    if let Some(existing) = app.get_webview(&label) {
        set_bounds(&existing, bounds)?;
        return existing.show().map_err(|error| error.to_string());
    }
    let parent = app
        .get_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let popup_app = app.clone();
    let popup_label = label.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .incognito(false)
        .data_store_identifier(store)
        .focused(true)
        .on_navigation(page_navigation_allowed)
        .on_download(|_, _| false)
        .on_new_window(move |target, _| {
            // stay inside the pin: a new window becomes this page's next page
            // (off WebKit's callback, which must return first)
            if page_navigation_allowed(&target) {
                if let Some(page) = popup_app.get_webview(&popup_label) {
                    tauri::async_runtime::spawn(async move {
                        let _ = page.navigate(target);
                    });
                }
            }
            NewWindowResponse::Deny
        });
    parent
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn pin_webview(app: &AppHandle, slot: u8) -> Result<tauri::Webview, String> {
    app.get_webview(&pin_label(slot)?)
        .ok_or_else(|| "that pinned site isn't open".to_string())
}

#[tauri::command]
pub fn pinned_site_set_bounds(
    app: AppHandle,
    slot: u8,
    bounds: PrivateBrowserBounds,
) -> Result<(), String> {
    set_bounds(&pin_webview(&app, slot)?, bounds)
}

/// Put the page away but keep it alive (the panel closed).
#[tauri::command]
pub fn pinned_site_hide(app: AppHandle, slot: u8) -> Result<(), String> {
    match app.get_webview(&pin_label(slot)?) {
        Some(page) => page.hide().map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

/// Close the page (long hidden, or the pin changed). The session stays in its store.
#[tauri::command]
pub fn pinned_site_close(app: AppHandle, slot: u8) -> Result<(), String> {
    match app.get_webview(&pin_label(slot)?) {
        Some(page) => page.close().map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

/// Sign a removed pin out: delete its WebKit store (cookies, storage, cache).
/// The page must be closed first (`pinned_site_close`).
#[tauri::command]
pub async fn pinned_site_forget(app: AppHandle, store: String) -> Result<(), String> {
    let store = store_id(&store)?;
    if !per_site_stores() {
        return Ok(());
    }
    app.remove_data_store(store)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_are_the_three_pins_and_nothing_else() {
        assert_eq!(pin_label(0).unwrap(), "pinned-site-0");
        assert_eq!(pin_label(2).unwrap(), "pinned-site-2");
        assert!(pin_label(3).is_err());
    }

    #[test]
    fn a_store_is_sixteen_random_bytes_in_hex_never_the_zero_store() {
        let id = store_id("00112233445566778899aabbccddeeff").unwrap();
        assert_eq!(id[0], 0x00);
        assert_eq!(id[15], 0xff);
        assert!(store_id("00000000000000000000000000000000").is_err());
        assert!(store_id("00112233445566778899AABBCCDDEEFF").is_err(), "lowercase only");
        assert!(store_id("0011").is_err());
        assert!(store_id("zz112233445566778899aabbccddeeff").is_err());
    }

    #[test]
    fn a_pinned_address_is_https_and_passes_the_private_checks() {
        assert!(pinned_url("https://x.com/home").is_ok());
        assert!(pinned_url("http://x.com/").is_err());
        assert!(pinned_url("file:///etc/passwd").is_err());
        assert!(pinned_url("javascript:alert(1)").is_err());
    }
}
