//! The macOS share sheet (2026-10-15, the owner: "a proper Share that opens the
//! native share sheet"). The thank-you card's Share button hands a short line
//! and Rotli's site to `NSSharingServicePicker`, shown against the clicked
//! button, and macOS offers Messages, Mail, AirDrop, Notes and the rest.
//!
//! An OS hand-off, not a network lane: Rotli sends nothing anywhere. The sheet
//! opens only from a click, and nothing leaves until the person picks a
//! service there. Because the webview names the words, the lane is still
//! bounded like `open_url`: a short line, one https link, and the same
//! `blocked_for_remote` content gate every outbound seam asks.

use serde::Deserialize;

/// The longest line the sheet will carry — a sentence, never a note.
const SHARE_TEXT_MAX: usize = 280;
const SHARE_URL_MAX: usize = 512;

/// The clicked button, in the webview's CSS pixels (top-left origin).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct ShareAnchor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What the sheet accepts: a short line and one https link.
fn shareable(text: &str, url: &str) -> Result<(), String> {
    if text.is_empty() || text.chars().count() > SHARE_TEXT_MAX {
        return Err("only a short line can be shared from here.".into());
    }
    let link_ok = url.len() <= SHARE_URL_MAX
        && url.strip_prefix("https://").is_some_and(|rest| !rest.is_empty())
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if !link_ok {
        return Err("only an https link can be shared from here.".into());
    }
    Ok(())
}

/// Open the share sheet beside `anchor` with `text` and `url`.
#[tauri::command]
pub fn share_text(
    webview: tauri::Webview,
    text: String,
    url: String,
    anchor: ShareAnchor,
) -> Result<(), String> {
    let text = text.trim().to_string();
    let url = url.trim().to_string();
    shareable(&text, &url)?;
    if crate::secret::blocked_for_remote(&text) || crate::secret::blocked_for_remote(&url) {
        return Err("blocked: that carries private content — it won't be shared.".into());
    }
    #[cfg(target_os = "macos")]
    {
        webview
            .with_webview(move |platform| macos::show(platform.inner(), &text, &url, anchor))
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, anchor);
        Err("the share sheet is a macOS feature.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::RefCell;
    use std::ffi::c_void;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    use super::ShareAnchor;

    thread_local! {
        /// The picker on screen, held until the next one replaces it: AppKit
        /// does not promise to keep a picker alive while its menu is up.
        static SHOWN: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
    }

    pub(super) fn show(webview: *mut c_void, text: &str, url: &str, anchor: ShareAnchor) {
        if webview.is_null() || MainThreadMarker::new().is_none() {
            return;
        }
        // SAFETY: Tauri hands over its own live WKWebView (an NSView) on the
        // main thread, checked just above.
        let view: &NSView = unsafe { &*(webview as *const NSView) };
        let Some(link) = NSURL::URLWithString(&NSString::from_str(url)) else {
            return;
        };
        let message: Retained<AnyObject> = Retained::into_super(Retained::into_super(NSString::from_str(text)));
        let link: Retained<AnyObject> = Retained::into_super(Retained::into_super(link));
        let items = NSArray::from_retained_slice(&[message, link]);
        // SAFETY: both items are NSPasteboardWriting objects (NSString, NSURL).
        let picker = unsafe { NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items) };
        let height = view.bounds().size.height;
        let flipped = view.isFlipped();
        let y = if flipped { anchor.y } else { height - anchor.y - anchor.height };
        let rect = NSRect::new(NSPoint::new(anchor.x, y), NSSize::new(anchor.width, anchor.height));
        // above the button: the card's actions sit at its bottom edge
        let edge = if flipped { NSRectEdge::MinY } else { NSRectEdge::MaxY };
        picker.showRelativeToRect_ofView_preferredEdge(rect, view, edge);
        SHOWN.with(|shown| *shown.borrow_mut() = Some(picker));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sheet_carries_a_short_line_and_one_https_link() {
        assert!(shareable("I just set up Rotli.", "https://rotli.co").is_ok());
        assert!(shareable("", "https://rotli.co").is_err());
        assert!(shareable(&"a".repeat(SHARE_TEXT_MAX + 1), "https://rotli.co").is_err());
        assert!(shareable("hi", "http://rotli.co").is_err());
        assert!(shareable("hi", "https://").is_err());
        assert!(shareable("hi", "file:///etc/hosts").is_err());
        assert!(shareable("hi", "https://rotli.co/ x").is_err());
        assert!(shareable("hi", &format!("https://{}", "a".repeat(SHARE_URL_MAX))).is_err());
    }
}
