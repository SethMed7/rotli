//! Session-only in-app browser adapter.
//!
//! Remote pages live in their own child WKWebView. The builder uses WebKit's
//! non-persistent data store, accepts only http(s), and receives no Rotli
//! capability. URLs are never written to the vault or frontend viewstate.

use serde::Serialize;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, WebviewUrl,
};

const STATE_EVENT: &str = "private-browser-state";
const NEW_WINDOW_EVENT: &str = "private-browser-new-window";

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateBrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateBrowserStateEvent {
    tab_id: String,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivateBrowserNewWindowEvent {
    tab_id: String,
    url: String,
}

fn webview_label(tab_id: &str) -> Result<String, String> {
    if tab_id.is_empty()
        || tab_id.len() > 64
        || !tab_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("invalid private-browser tab id".into());
    }
    Ok(format!("private-browser-{tab_id}"))
}

fn private_url(value: &str) -> Result<Url, String> {
    let value = value.trim();
    if crate::secret::blocked_for_remote(value) {
        return Err("blocked: that address carries private content — it won't be opened.".into());
    }
    let url = Url::parse(value).map_err(|_| "enter a valid http(s) address".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http(s) pages open in the private browser".into());
    }
    Ok(url)
}

fn page_navigation_allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank"
}

fn safe_bounds(bounds: PrivateBrowserBounds) -> Result<PrivateBrowserBounds, String> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
        || bounds.x < 0.0
        || bounds.y < 0.0
        || bounds.width < 1.0
        || bounds.height < 1.0
        || bounds.width > 20_000.0
        || bounds.height > 20_000.0
    {
        return Err("invalid private-browser bounds".into());
    }
    Ok(bounds)
}

fn set_bounds(webview: &tauri::Webview, bounds: PrivateBrowserBounds) -> Result<(), String> {
    let bounds = safe_bounds(bounds)?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| error.to_string())?;
    webview
        .set_size(LogicalSize::new(bounds.width, bounds.height))
        .map_err(|error| error.to_string())
}

fn browser_webview(app: &AppHandle, tab_id: &str) -> Result<tauri::Webview, String> {
    let label = webview_label(tab_id)?;
    app.get_webview(&label)
        .ok_or_else(|| "private browser is not available".to_string())
}

#[tauri::command]
pub fn private_browser_create(
    app: AppHandle,
    tab_id: String,
    url: String,
    bounds: PrivateBrowserBounds,
) -> Result<(), String> {
    let label = webview_label(&tab_id)?;
    let url = private_url(&url)?;
    let bounds = safe_bounds(bounds)?;

    if let Some(existing) = app.get_webview(&label) {
        set_bounds(&existing, bounds)?;
        existing.show().map_err(|error| error.to_string())?;
        return existing.navigate(url).map_err(|error| error.to_string());
    }

    let parent = app
        .get_window("main")
        .ok_or_else(|| "main window is not available".to_string())?;
    let state_tab_id = tab_id.clone();
    let title_tab_id = tab_id.clone();
    let popup_tab_id = tab_id;
    let popup_app = app.clone();
    let builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .incognito(true)
        .focused(false)
        .on_navigation(page_navigation_allowed)
        .on_download(|_, _| false)
        .on_page_load(move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            let _ = webview.app_handle().emit_to(
                "main",
                STATE_EVENT,
                PrivateBrowserStateEvent {
                    tab_id: state_tab_id.clone(),
                    url: payload.url().to_string(),
                    title: None,
                    loading: Some(loading),
                },
            );
        })
        .on_document_title_changed(move |webview, title| {
            let url = webview
                .url()
                .map(|value| value.to_string())
                .unwrap_or_default();
            let _ = webview.app_handle().emit_to(
                "main",
                STATE_EVENT,
                PrivateBrowserStateEvent {
                    tab_id: title_tab_id.clone(),
                    url,
                    title: Some(title),
                    loading: None,
                },
            );
        })
        .on_new_window(move |url, _| {
            if page_navigation_allowed(&url) {
                let _ = popup_app.emit_to(
                    "main",
                    NEW_WINDOW_EVENT,
                    PrivateBrowserNewWindowEvent {
                        tab_id: popup_tab_id.clone(),
                        url: url.to_string(),
                    },
                );
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
pub fn private_browser_set_bounds(
    app: AppHandle,
    tab_id: String,
    bounds: PrivateBrowserBounds,
) -> Result<(), String> {
    set_bounds(&browser_webview(&app, &tab_id)?, bounds)
}

#[tauri::command]
pub fn private_browser_set_visible(
    app: AppHandle,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let webview = browser_webview(&app, &tab_id)?;
    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn private_browser_navigate(app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    browser_webview(&app, &tab_id)?
        .navigate(private_url(&url)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn private_browser_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    browser_webview(&app, &tab_id)?
        .eval("history.back()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn private_browser_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    browser_webview(&app, &tab_id)?
        .eval("history.forward()")
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn private_browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    browser_webview(&app, &tab_id)?
        .reload()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn private_browser_close(app: AppHandle, tab_id: String) -> Result<(), String> {
    let label = webview_label(&tab_id)?;
    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_labels_are_narrow_and_unambiguous() {
        assert_eq!(
            webview_label("01ABC_xyz-9").unwrap(),
            "private-browser-01ABC_xyz-9"
        );
        assert!(webview_label("").is_err());
        assert!(webview_label("../main").is_err());
        assert!(webview_label(&"x".repeat(65)).is_err());
    }

    #[test]
    fn only_http_pages_cross_the_native_browser_boundary() {
        assert!(private_url("https://example.com/docs").is_ok());
        assert!(private_url("http://localhost:1420").is_ok());
        assert!(private_url("file:///etc/passwd").is_err());
        assert!(private_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn bounds_are_finite_and_bounded() {
        assert!(safe_bounds(PrivateBrowserBounds {
            x: 0.0,
            y: 42.0,
            width: 900.0,
            height: 600.0,
        })
        .is_ok());
        assert!(safe_bounds(PrivateBrowserBounds {
            x: 0.0,
            y: 0.0,
            width: f64::NAN,
            height: 10.0,
        })
        .is_err());
    }
}
