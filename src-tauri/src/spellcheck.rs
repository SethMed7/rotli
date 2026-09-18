//! Spelling underlines in the Mac app.
//!
//! A WKWebView only checks spelling as you type when its app's defaults say
//! so: `WebContinuousSpellCheckingEnabled`. Safari and Chrome opt in on their
//! own, an embedding app does not, so Rotli Web underlined misspellings while
//! the Mac app (same editor, same `spellcheck="true"`) never did (the owner,
//! 2026-09-18). The webview reads the default when it is created, so this runs
//! before the first window.
//!
//! It fills the default only when it is ABSENT. macOS writes the same key when
//! someone turns "Check Spelling While Typing" off from the context menu, and
//! that choice is theirs to keep. Rotli's own Settings → spellcheck switch is a
//! separate layer on top: it sets the editor's `spellcheck` attribute.

#[cfg(target_os = "macos")]
pub(crate) fn enable_continuous_spellcheck_by_default() {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    let key = NSString::from_str("WebContinuousSpellCheckingEnabled");
    // SAFETY: standard NSUserDefaults messages with correctly typed arguments;
    // `standardUserDefaults` never returns nil.
    unsafe {
        let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
        let existing: *mut AnyObject = msg_send![defaults, objectForKey: &*key];
        if existing.is_null() {
            let _: () = msg_send![defaults, setBool: true, forKey: &*key];
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn enable_continuous_spellcheck_by_default() {}
