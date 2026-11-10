//! The save attempt before a quit, restart, vault switch or folder-window close
//! (lib.rs and folder_window.rs drive it through `QuitFlush::attempt`).
//!
//! Two phases, and nothing is ever made read-only (ninth review of pull
//! request 267: a lock on the editors could strand a window for good):
//! 1. Every window is asked to flush ("rotli:flush-before-quit") and answers
//!    flushed or refused, with its reasons (`quit_flush_done`), within
//!    `flush_max`.
//! 2. Only when every window flushed, every window that exists now (one opened
//!    during the attempt too, for a quit or switch) is asked one immediate
//!    question ("rotli:quit-check"): is anything unsaved or outstanding right
//!    now? It answers synchronously from its buffers, with no flushing
//!    (`quit_check_done`), within `check_max`. Any yes, or no answer, refuses
//!    the attempt, naming what is outstanding.
//!
//! When every answer is no, `attempt` returns and its caller exits (or
//! switches, or closes) at once: nothing is awaited between the last answer
//! and that. What remains: words typed in a window after its own phase-2
//! answer and before the last window's answer arrives (bounded by
//! `check_max`, milliseconds when no window is hung) and the exit itself.
//!
//! One attempt at a time. A request with the same intent as the live attempt
//! (a second Cmd-Q during a quit, a second close of the same folder window)
//! joins it, waits for it to end, and does nothing of its own (`JOINED`). A
//! request with another intent, or none, waits for the live attempt to end and
//! then runs as its own attempt: a folder window closing must never swallow a
//! quit (tenth review of pull request 267). Every attempt ends with one
//! "rotli:save-attempt-ended" event to every window it asked anything, and its
//! live mark is cleared on the way out even if something panics.

use std::collections::{BTreeSet, HashSet};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::json;

/// Phase 1's request, phase 2's question, and the end of an attempt.
pub(crate) const FLUSH_EVENT: &str = "rotli:flush-before-quit";
pub(crate) const CHECK_EVENT: &str = "rotli:quit-check";
pub(crate) const ENDED_EVENT: &str = "rotli:save-attempt-ended";

/// What a request that joined a live attempt answers: that attempt decides.
pub(crate) const JOINED: &str = "Rotli is already finishing saves for another quit, restart or switch";

/// The windows the attempt talks to (Tauri in the app, a fake in tests).
pub(crate) trait Windows {
    /// Send `event` to one window; false when it can't be delivered.
    fn emit(&self, label: &str, event: &str, payload: serde_json::Value) -> bool;
    /// Every window that exists now.
    fn live(&self) -> Vec<String>;
}

/// Which windows an attempt asks.
pub(crate) enum Scope<'a> {
    /// Every window that exists when the attempt starts, and every one that
    /// exists by phase 2 (quit, restart, vault switch).
    All,
    /// Just these (a folder window closing).
    Only(&'a [String]),
}

pub(crate) struct QuitFlush {
    pub(crate) status: Mutex<QuitFlushStatus>,
    pub(crate) cv: Condvar,
    /// How long phase 1 waits for every window's flush (a big workbook's
    /// serialize, a hung webview).
    pub(crate) flush_max: Duration,
    /// How long phase 2 waits for the immediate answers.
    pub(crate) check_max: Duration,
}

#[derive(Default)]
pub(crate) struct QuitFlushStatus {
    pub(crate) attempt_id: u64,
    /// 1 while windows flush, 2 while they answer the immediate question.
    pub(crate) phase: u8,
    pub(crate) live: bool,
    /// What the live attempt is for; a request with the same intent joins it.
    pub(crate) intent: Option<String>,
    /// Requests waiting for the live attempt to end (joined or queued).
    pub(crate) waiting: usize,
    /// The windows that still owe this phase an answer, BY LABEL: every
    /// window hears every event, so a count let an idle panel's repeat acks
    /// release a window still serializing a workbook (audit 2026-10-12).
    pub(crate) pending: HashSet<String>,
    pub(crate) failed: bool,
    pub(crate) errors: Vec<String>,
}

impl QuitFlushStatus {
    /// Record one window's answer. False when it is stale (another attempt or
    /// phase) or that window already answered.
    pub(crate) fn ack(&mut self, attempt_id: u64, phase: u8, label: &str, ok: bool, error: Option<String>) -> bool {
        if self.attempt_id != attempt_id || self.phase != phase || !self.pending.remove(label) {
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

impl QuitFlush {
    pub(crate) fn new(flush_max: Duration, check_max: Duration) -> Self {
        Self { status: Mutex::new(QuitFlushStatus::default()), cv: Condvar::new(), flush_max, check_max }
    }

    /// The status, even after a panic elsewhere poisoned it: the attempt's
    /// state stays meaningful (every write to it is a whole field).
    fn lock(&self) -> MutexGuard<'_, QuitFlushStatus> {
        self.status.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// One window's answer to a phase.
    pub(crate) fn answer(&self, attempt_id: u64, phase: u8, label: &str, ok: bool, error: Option<String>) {
        let mut status = self.lock();
        if status.ack(attempt_id, phase, label, ok, error) {
            self.cv.notify_all();
        }
    }

    /// The two-phase attempt over `scope`. Ok: nothing is unsaved anywhere it
    /// asked, and the caller acts at once. Err: the reason, or `JOINED` when a
    /// live attempt had the same `intent` (`None` never joins).
    pub(crate) fn attempt(&self, windows: &dyn Windows, scope: Scope, intent: Option<&str>) -> Result<(), String> {
        let attempt_id = {
            let mut status = self.lock();
            while status.live {
                status.waiting += 1;
                self.cv.notify_all();
                if intent.is_some() && status.intent.as_deref() == intent {
                    let joined = status.attempt_id;
                    while status.live && status.attempt_id == joined {
                        status = self.cv.wait(status).unwrap_or_else(|poisoned| poisoned.into_inner());
                    }
                    status.waiting -= 1;
                    return Err(JOINED.into());
                }
                while status.live {
                    status = self.cv.wait(status).unwrap_or_else(|poisoned| poisoned.into_inner());
                }
                status.waiting -= 1;
            }
            status.attempt_id = status.attempt_id.wrapping_add(1).max(1);
            status.live = true;
            status.intent = intent.map(str::to_string);
            status.attempt_id
        };
        let _live = EndOnDrop(self);
        let mut participants: BTreeSet<String> = match scope {
            Scope::All => windows.live().into_iter().collect(),
            Scope::Only(labels) => labels.iter().cloned().collect(),
        };
        let mut result = self.phase(windows, attempt_id, 1, &participants.iter().cloned().collect::<Vec<_>>());
        if result.is_ok() {
            if matches!(scope, Scope::All) {
                participants.extend(windows.live());
            }
            result = self.phase(windows, attempt_id, 2, &participants.iter().cloned().collect::<Vec<_>>());
        }
        for label in &participants {
            windows.emit(
                label,
                ENDED_EVENT,
                json!({ "attemptId": attempt_id, "finished": result.is_ok(), "detail": result.as_ref().err() }),
            );
        }
        result
    }

    fn phase(&self, windows: &dyn Windows, attempt_id: u64, phase: u8, labels: &[String]) -> Result<(), String> {
        if labels.is_empty() {
            return Ok(());
        }
        {
            let mut status = self.lock();
            status.phase = phase;
            status.pending = labels.iter().cloned().collect();
            status.failed = false;
            status.errors.clear();
        }
        let event = if phase == 1 { FLUSH_EVENT } else { CHECK_EVENT };
        for label in labels {
            if !windows.emit(label, event, json!({ "attemptId": attempt_id })) {
                self.answer(attempt_id, phase, label, false, Some(format!("{label} did not receive the request")));
            }
        }
        let bound = if phase == 1 { self.flush_max } else { self.check_max };
        let deadline = Instant::now() + bound;
        let mut status = self.lock();
        while !status.pending.is_empty() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            status = self.cv.wait_timeout(status, deadline - now).unwrap_or_else(|poisoned| poisoned.into_inner()).0;
        }
        if !status.pending.is_empty() {
            let mut silent: Vec<&String> = status.pending.iter().collect();
            silent.sort();
            let names = silent.iter().map(|label| label.as_str()).collect::<Vec<_>>().join(", ");
            return Err(if phase == 1 {
                format!("Rotli did not quit because a window ({names}) did not finish saving. Your files remain open.")
            } else {
                format!("Rotli did not quit because a window ({names}) did not say whether everything was saved. Your files remain open.")
            });
        }
        if status.failed {
            let reasons = if status.errors.is_empty() { "a save failed".to_string() } else { status.errors.join("; ") };
            return Err(format!("Rotli did not quit: {reasons}. Your files remain open."));
        }
        Ok(())
    }
}

/// Ends the live attempt however `attempt` leaves (a panic in a window's
/// emit included), so no later request waits for ever.
struct EndOnDrop<'a>(&'a QuitFlush);

impl Drop for EndOnDrop<'_> {
    fn drop(&mut self) {
        let mut status = self.0.lock();
        status.live = false;
        status.intent = None;
        status.phase = 0;
        status.pending.clear();
        self.0.cv.notify_all();
    }
}

#[cfg(test)]
#[path = "quit_flush_tests.rs"]
mod quit_flush_tests;
