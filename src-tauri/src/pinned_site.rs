//! Pinned sites (docs/decisions/2026-10-01-pinned-sites.md): up to three
//! https sites the person stays signed in to, each in its own child webview of
//! the main window with its OWN persistent WebKit store. Everything else
//! matches the private browser: no Tauri capability names the guest, the
//! address passes `blocked_for_remote`, downloads are refused, and a page
//! asking for a new window is navigated in place. Stricter than the private
//! browser: a signed-in pin only ever navigates over https.
//!
//! A pin's page label carries its store (`pinned-site-<slot>-<store>`), so a
//! page can only ever show the pin whose store it was built on: a new pin in
//! the same slot never reuses an older pin's live, signed-in page.

use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

use crate::private_browser::{private_url, safe_bounds, set_bounds, PrivateBrowserBounds};

/// How many sites can be pinned (the owner: "up to 3").
pub(crate) const MAX_PINS: u8 = 3;

fn slot_prefix(slot: u8) -> Result<String, String> {
    if slot >= MAX_PINS {
        return Err("invalid pinned-site slot".into());
    }
    Ok(format!("pinned-site-{slot}-"))
}

/// The one label a pin's page has: its slot and its store.
fn pin_label(slot: u8, store: &str) -> Result<String, String> {
    store_id(store)?;
    Ok(format!("{}{store}", slot_prefix(slot)?))
}

/// Every page in a slot (normally one; an older pin's while it closes).
fn slot_pages(app: &AppHandle, slot: u8) -> Result<Vec<tauri::Webview>, String> {
    let prefix = slot_prefix(slot)?;
    Ok(app
        .webviews()
        .into_iter()
        .filter(|(label, _)| label.starts_with(&prefix))
        .map(|(_, page)| page)
        .collect())
}

/// A signed-in pin navigates over https only (and the blank page WebKit
/// starts on); the private browser's http allowance stays there.
fn pin_navigation_allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https" || url.as_str() == "about:blank"
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
    let label = pin_label(slot, &store)?;
    let url = pinned_url(&url)?;
    let store = store_id(&store)?;
    let bounds = safe_bounds(bounds)?;
    for page in slot_pages(&app, slot)? {
        if page.label() == label {
            set_bounds(&page, bounds)?;
            return page.show().map_err(|error| error.to_string());
        }
        // an older pin's page in this slot: never shown for this one
        page.close().map_err(|error| error.to_string())?;
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
        .on_navigation(pin_navigation_allowed)
        .on_download(|_, _| false)
        .on_new_window(move |target, _| {
            // stay inside the pin: a new window becomes this page's next page
            // (off WebKit's callback, which must return first)
            if pin_navigation_allowed(&target) {
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

#[tauri::command]
pub fn pinned_site_set_bounds(
    app: AppHandle,
    slot: u8,
    store: String,
    bounds: PrivateBrowserBounds,
) -> Result<(), String> {
    let page = app
        .get_webview(&pin_label(slot, &store)?)
        .ok_or_else(|| "that pinned site isn't open".to_string())?;
    set_bounds(&page, bounds)
}

/// Put the slot's page away but keep it alive (the panel closed).
#[tauri::command]
pub fn pinned_site_hide(app: AppHandle, slot: u8) -> Result<(), String> {
    for page in slot_pages(&app, slot)? {
        page.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Close the slot's page (long hidden, or the pin removed). The session stays
/// in its store until `pinned_site_forget`.
#[tauri::command]
pub fn pinned_site_close(app: AppHandle, slot: u8) -> Result<(), String> {
    for page in slot_pages(&app, slot)? {
        page.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Sign a removed pin out: delete its WebKit store (cookies, storage, cache).
/// The page must be closed first (`pinned_site_close`).
#[tauri::command]
pub async fn pinned_site_forget(app: AppHandle, store: String) -> Result<(), String> {
    let store = store_id(&store)?;
    if !per_site_stores() {
        return Ok(());
    }
    forget_store(&app, store).await
}

/// WebKit's per-identifier stores are Apple-only (wry's `remove_data_store`).
#[cfg(target_os = "macos")]
async fn forget_store(app: &AppHandle, store: [u8; 16]) -> Result<(), String> {
    app.remove_data_store(store)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
async fn forget_store(_app: &AppHandle, _store: [u8; 16]) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_label_is_its_slot_and_its_store_so_pins_never_share_a_page() {
        let store = "00112233445566778899aabbccddeeff";
        let other = "ffeeddccbbaa99887766554433221100";
        assert_eq!(pin_label(0, store).unwrap(), format!("pinned-site-0-{store}"));
        assert_ne!(pin_label(0, store).unwrap(), pin_label(0, other).unwrap());
        assert!(pin_label(0, other).unwrap().starts_with(&slot_prefix(0).unwrap()));
        assert!(!pin_label(1, store).unwrap().starts_with(&slot_prefix(0).unwrap()));
        assert!(pin_label(3, store).is_err());
        assert!(pin_label(0, "not-a-store").is_err());
    }

    #[test]
    fn a_signed_in_pin_never_navigates_over_plain_http() {
        let url = |text: &str| tauri::Url::parse(text).unwrap();
        assert!(pin_navigation_allowed(&url("https://x.com/home")));
        assert!(pin_navigation_allowed(&url("about:blank")));
        assert!(!pin_navigation_allowed(&url("http://x.com/")));
        assert!(!pin_navigation_allowed(&url("file:///etc/passwd")));
        assert!(!pin_navigation_allowed(&url("javascript:alert(1)")));
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
