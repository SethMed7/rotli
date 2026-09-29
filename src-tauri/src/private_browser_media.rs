//! Media in a private browser tab (2026-09-28, the owner: "if I put a video in
//! a tab … an audio indicator … and a little music player: prev, pause, stop,
//! next, open tab").
//!
//! The page itself gets no channel to Rotli (the tab has no capability), so
//! the app asks. `private_browser_media_state` reads WebKit's own playback
//! state for the tab's WKWebView (macOS 12+; older systems and other platforms
//! answer "none"), and `private_browser_media` runs one of five fixed actions.
//! Every script evaluated in the page is a literal in this file, chosen by a
//! Rust enum: nothing the frontend sends ever reaches `eval`. The state never
//! leaves memory.

use std::time::Duration;

use tauri::AppHandle;

use crate::private_browser::browser_webview;

/// How long the state question may take before the tab counts as silent.
const STATE_TIMEOUT: Duration = Duration::from_millis(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaAction {
    Play,
    Pause,
    Stop,
    Next,
    Previous,
}

/// WebKit's `WKMediaPlaybackState`, by name.
pub(crate) fn state_name(raw: isize) -> &'static str {
    match raw {
        1 => "playing",
        2 => "paused",
        3 => "suspended",
        _ => "none",
    }
}

const PLAY: &str = "(()=>{const m=[...document.querySelectorAll('video,audio')];const t=m.find(e=>e.paused&&e.currentTime>0)||m[0];if(t)t.play().catch(()=>{});})()";
const STOP: &str = "document.querySelectorAll('video,audio').forEach(e=>{e.pause();try{e.currentTime=0}catch(_){}})";
const RESTART: &str =
    "document.querySelectorAll('video,audio').forEach(e=>{try{e.currentTime=0}catch(_){}})";
const YOUTUBE_NEXT: &str = "document.querySelector('.ytp-next-button')?.click()";
const YOUTUBE_PREVIOUS: &str = "(()=>{const b=document.querySelector('.ytp-prev-button');if(b&&b.offsetParent){b.click();return}document.querySelectorAll('video,audio').forEach(e=>{try{e.currentTime=0}catch(_){}})})()";

/// The script an action runs in the page, if any. Next has no general
/// meaning, so only YouTube (its own next button) gets one; Previous restarts
/// what is playing elsewhere.
pub(crate) fn action_script(action: MediaAction, youtube: bool) -> Option<&'static str> {
    match action {
        MediaAction::Play => Some(PLAY),
        MediaAction::Pause => None,
        MediaAction::Stop => Some(STOP),
        MediaAction::Next => youtube.then_some(YOUTUBE_NEXT),
        MediaAction::Previous => Some(if youtube { YOUTUBE_PREVIOUS } else { RESTART }),
    }
}

pub(crate) fn is_youtube(url: &tauri::Url) -> bool {
    url.host_str()
        .is_some_and(|host| host == "youtube.com" || host.ends_with(".youtube.com"))
}

/// "none", "playing", "paused" or "suspended".
#[tauri::command]
pub async fn private_browser_media_state(app: AppHandle, tab_id: String) -> Result<String, String> {
    let webview = browser_webview(&app, &tab_id)?;
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<isize>();
        webview
            .with_webview(move |platform| macos::request_state(platform.inner(), tx))
            .map_err(|error| error.to_string())?;
        let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(STATE_TIMEOUT).ok())
            .await
            .ok()
            .flatten()
            .unwrap_or(0);
        Ok(state_name(raw).to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, STATE_TIMEOUT);
        Ok(state_name(0).to_string())
    }
}

#[tauri::command]
pub fn private_browser_media(
    app: AppHandle,
    tab_id: String,
    action: MediaAction,
) -> Result<(), String> {
    let webview = browser_webview(&app, &tab_id)?;
    #[cfg(target_os = "macos")]
    if matches!(action, MediaAction::Pause | MediaAction::Stop) {
        webview
            .with_webview(move |platform| {
                macos::pause(platform.inner(), action == MediaAction::Stop)
            })
            .map_err(|error| error.to_string())?;
    }
    let youtube = webview.url().is_ok_and(|url| is_youtube(&url));
    #[cfg(not(target_os = "macos"))]
    let action = if action == MediaAction::Pause {
        MediaAction::Stop
    } else {
        action
    };
    match action_script(action, youtube) {
        Some(script) => webview.eval(script).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    use std::sync::{mpsc::Sender, Mutex};

    use block2::RcBlock;
    use objc2::runtime::NSObjectProtocol;
    use objc2::sel;
    use objc2_web_kit::{WKMediaPlaybackState, WKWebView};

    fn web_view<'a>(pointer: *mut c_void) -> Option<&'a WKWebView> {
        // SAFETY: Tauri hands over its own live WKWebView on the main thread.
        unsafe { (pointer as *const WKWebView).as_ref() }
    }

    /// Ask WebKit for the playback state; the answer (or nothing, on a
    /// system without the API) goes down `tx`.
    pub(super) fn request_state(pointer: *mut c_void, tx: Sender<isize>) {
        let Some(view) = web_view(pointer) else {
            return;
        };
        let tx = Mutex::new(Some(tx));
        let block = RcBlock::new(move |state: WKMediaPlaybackState| {
            if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = tx.send(state.0);
            }
        });
        // SAFETY: each selector is checked before it is sent (macOS 12+ API;
        // the app still runs on 11).
        unsafe {
            if view.respondsToSelector(sel!(requestMediaPlaybackStateWithCompletionHandler:)) {
                view.requestMediaPlaybackStateWithCompletionHandler(&block);
            } else if view.respondsToSelector(sel!(requestMediaPlaybackState:)) {
                #[allow(deprecated)]
                view.requestMediaPlaybackState(&block);
            }
        }
    }

    /// Pause everything in the page, iframes included; `close` also leaves
    /// picture-in-picture and full screen.
    pub(super) fn pause(pointer: *mut c_void, close: bool) {
        let Some(view) = web_view(pointer) else {
            return;
        };
        // SAFETY: as above.
        unsafe {
            if view.respondsToSelector(sel!(pauseAllMediaPlaybackWithCompletionHandler:)) {
                view.pauseAllMediaPlaybackWithCompletionHandler(None);
            } else if view.respondsToSelector(sel!(pauseAllMediaPlayback:)) {
                #[allow(deprecated)]
                view.pauseAllMediaPlayback(None);
            }
            if close
                && view.respondsToSelector(sel!(closeAllMediaPresentationsWithCompletionHandler:))
            {
                view.closeAllMediaPresentationsWithCompletionHandler(None);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webkit_states_have_names_and_anything_else_is_silence() {
        assert_eq!(state_name(0), "none");
        assert_eq!(state_name(1), "playing");
        assert_eq!(state_name(2), "paused");
        assert_eq!(state_name(3), "suspended");
        assert_eq!(state_name(-1), "none");
        assert_eq!(state_name(42), "none");
    }

    #[test]
    fn every_action_runs_a_fixed_script_or_none() {
        assert_eq!(action_script(MediaAction::Pause, false), None);
        assert_eq!(action_script(MediaAction::Play, false), Some(PLAY));
        assert_eq!(action_script(MediaAction::Stop, true), Some(STOP));
        // next means something only where the page has a next button
        assert_eq!(action_script(MediaAction::Next, false), None);
        assert_eq!(action_script(MediaAction::Next, true), Some(YOUTUBE_NEXT));
        assert_eq!(action_script(MediaAction::Previous, false), Some(RESTART));
        assert_eq!(
            action_script(MediaAction::Previous, true),
            Some(YOUTUBE_PREVIOUS)
        );
    }

    #[test]
    fn only_youtube_hosts_get_youtube_buttons() {
        let yes = [
            "https://www.youtube.com/watch?v=x",
            "https://music.youtube.com/",
            "https://youtube.com/",
        ];
        let no = [
            "https://notyoutube.com/",
            "https://youtube.com.evil.test/",
            "https://example.com/?youtube.com",
        ];
        for url in yes {
            assert!(is_youtube(&tauri::Url::parse(url).unwrap()), "{url}");
        }
        for url in no {
            assert!(!is_youtube(&tauri::Url::parse(url).unwrap()), "{url}");
        }
    }

    #[test]
    fn actions_arrive_as_lowercase_names_only() {
        let parse = |name: &str| serde_json::from_str::<MediaAction>(&format!("\"{name}\""));
        assert_eq!(parse("previous").unwrap(), MediaAction::Previous);
        assert!(parse("Previous").is_err());
        assert!(parse("alert(1)").is_err());
    }
}
