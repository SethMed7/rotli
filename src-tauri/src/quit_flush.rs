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
//! One attempt at a time: a request while one is live joins it, waits for it
//! to end, and does nothing of its own (`JOINED`). Every attempt ends with one
//! "rotli:save-attempt-ended" event to every window it asked anything.

use std::collections::{BTreeSet, HashSet};
use std::sync::{Condvar, Mutex};
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

    /// One window's answer to a phase.
    pub(crate) fn answer(&self, attempt_id: u64, phase: u8, label: &str, ok: bool, error: Option<String>) {
        let mut status = self.status.lock().unwrap();
        if status.ack(attempt_id, phase, label, ok, error) {
            self.cv.notify_all();
        }
    }

    /// The two-phase attempt over `labels` (and, with `ask_new`, every window
    /// that exists by phase 2). Ok: nothing is unsaved anywhere it asked, and
    /// the caller acts at once. Err: the reason, or `JOINED`.
    pub(crate) fn attempt(&self, windows: &dyn Windows, labels: &[String], ask_new: bool) -> Result<(), String> {
        let attempt_id = {
            let mut status = self.status.lock().unwrap();
            if status.live {
                let joined = status.attempt_id;
                while status.live && status.attempt_id == joined {
                    status = self.cv.wait(status).unwrap();
                }
                return Err(JOINED.into());
            }
            status.attempt_id = status.attempt_id.wrapping_add(1).max(1);
            status.live = true;
            status.attempt_id
        };
        let mut participants: BTreeSet<String> = labels.iter().cloned().collect();
        let mut result = self.phase(windows, attempt_id, 1, &participants.iter().cloned().collect::<Vec<_>>());
        if result.is_ok() {
            if ask_new {
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
        let mut status = self.status.lock().unwrap();
        status.live = false;
        status.phase = 0;
        status.pending.clear();
        self.cv.notify_all();
        result
    }

    fn phase(&self, windows: &dyn Windows, attempt_id: u64, phase: u8, labels: &[String]) -> Result<(), String> {
        if labels.is_empty() {
            return Ok(());
        }
        {
            let mut status = self.status.lock().unwrap();
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
        let mut status = self.status.lock().unwrap();
        while !status.pending.is_empty() {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            status = self.cv.wait_timeout(status, deadline - now).unwrap().0;
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

#[cfg(test)]
#[path = "quit_flush_tests.rs"]
mod quit_flush_tests;
