//! The quit-flush handshake's bookkeeping (lib.rs drives it: emit
//! "rotli:flush-before-quit" to every window, wait on `cv` for the acks).

use std::collections::HashSet;
use std::sync::{Condvar, Mutex};

/// The quit-flush handshake (#4 follow-up, review 2026-07). Dirty spreadsheet
/// sessions flush on window-hide/pagehide, but BOTH real quit paths could fire
/// with the window still up and no hide ever seen ("Stay open" mode): tray-Quit
/// ran `app.exit(0)` directly, and ⌘Q rides the default menu's predefined Quit —
/// native `terminate:`, which tao surfaces only as `applicationWillTerminate`,
/// far too late for the webview's ASYNC serialize (exceljs) to finish. So both
/// paths now route through `graceful_quit`: emit "rotli:flush-before-quit" to
/// every webview, hold the exit until `quit_flush_done` acks (this condvar),
/// and ABORT quit on a failed or timed-out save. A forced OS termination may
/// still kill any process, but Rotli never translates "probably saved" into a
/// normal successful quit.
pub(crate) struct QuitFlush {
    /// Webviews still owing a `quit_flush_done` ack. Every live webview (main,
    /// quick, capture) gets the flush event — the quick window keeps its OWN
    /// editor buffer in its own module instance, so main's ack alone never
    /// proved the quick note's last keystrokes were on disk.
    pub(crate) status: Mutex<QuitFlushStatus>,
    pub(crate) cv: Condvar,
}

#[derive(Default)]
pub(crate) struct QuitFlushStatus {
    pub(crate) attempt_id: u64,
    /// The windows that still owe an ack, BY LABEL. A count was not enough:
    /// every frontend `listen` hears an event emitted to ANY window, so each
    /// webview received all four flush requests and acked four times — an idle
    /// panel could zero the count while main was still serializing a workbook
    /// (audit 2026-10-12). A window's repeat acks now settle only itself.
    pub(crate) pending: HashSet<String>,
    pub(crate) failed: bool,
    pub(crate) errors: Vec<String>,
}

impl QuitFlushStatus {
    /// Record one window's ack. False when it is stale (another attempt) or
    /// that window already acked.
    pub(crate) fn ack(&mut self, attempt_id: u64, label: &str, ok: bool, error: Option<String>) -> bool {
        if self.attempt_id != attempt_id || !self.pending.remove(label) {
            return false;
        }
        if !ok {
            self.failed = true;
            if let Some(error) = error.filter(|value| !value.trim().is_empty()) {
                self.errors.push(error);
            }
        }
        true
    }
}

#[cfg(test)]
mod quit_flush_tests {
    use super::QuitFlushStatus;

    #[test]
    fn repeat_acks_from_one_window_never_release_another_windows_save() {
        let mut status = QuitFlushStatus {
            attempt_id: 7,
            pending: ["main", "capture"].map(String::from).into_iter().collect(),
            ..Default::default()
        };
        for _ in 0..4 {
            status.ack(7, "capture", true, None);
        }
        assert!(status.pending.contains("main"), "main is still saving");
        assert!(!status.ack(6, "main", true, None), "a stale attempt never counts");
        assert!(status.ack(7, "main", false, Some("disk full".into())));
        assert!(status.pending.is_empty());
        assert!(status.failed);
        assert_eq!(status.errors, vec!["disk full".to_string()]);
    }
}
