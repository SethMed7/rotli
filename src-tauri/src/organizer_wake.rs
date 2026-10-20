//! The Librarian worker's wake signals as types: the Settings "Run now"
//! request, what woke one iteration, and the timed retries (model backoff,
//! closed-gate leash) the wait planner sleeps out. A child of `organizer`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// The user's "Run now" click (#29, audit 2026-07). Queued, not consumed by
/// planning: it stays pending through a gate-blocked attempt and clears only
/// when its cycle `start`s or something `cancel`s it (Off, Stop, a raw vault,
/// a vault switch).
#[derive(Default)]
pub(crate) struct RunNow(AtomicBool);

impl RunNow {
    pub(crate) fn request(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub(crate) fn pending(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// The gates passed and the requested cycle is starting.
    pub(crate) fn start(&self) {
        self.0.store(false, Ordering::SeqCst);
    }

    pub(crate) fn cancel(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// What one worker iteration is serving, sampled once at its start.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Wake {
    /// The explicit Run-now: bypasses the startup sweep hold, the model
    /// backoff, and the idle/AC/thermal gates (never a chat), and audits
    /// covered notes for missing metadata.
    Nudge,
    /// Queue work, an owed sweep, or an owed post-sweep cycle.
    Scheduled,
}

impl Wake {
    pub(crate) fn sample(run_now: &RunNow) -> Wake {
        if run_now.pending() {
            Wake::Nudge
        } else {
            Wake::Scheduled
        }
    }

    pub(crate) fn is_nudge(self) -> bool {
        self == Wake::Nudge
    }
}

/// A retry owed at a fixed instant. The planner reads its remainder, which
/// decays to zero, so a later re-plan returns Run and the blocked attempt is
/// really retried instead of re-waiting the full leash forever.
#[derive(Clone, Copy, Default)]
pub(crate) struct RetryAt(Option<Instant>);

impl RetryAt {
    pub(crate) fn after(d: Duration) -> RetryAt {
        RetryAt(Some(Instant::now() + d))
    }

    pub(crate) fn clear(&mut self) {
        self.0 = None;
    }

    /// Time left before the retry; `Some(ZERO)` once it is due.
    pub(crate) fn left(self) -> Option<Duration> {
        self.0.map(|t| t.saturating_duration_since(Instant::now()))
    }

    pub(crate) fn waiting(self) -> bool {
        self.0.is_some_and(|t| Instant::now() < t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_now_stays_pending_until_started_or_cancelled() {
        let r = RunNow::default();
        assert_eq!(Wake::sample(&r), Wake::Scheduled);
        r.request();
        assert!(Wake::sample(&r).is_nudge());
        assert!(r.pending(), "sampling never consumes the request");
        r.start();
        assert!(!r.pending());
        r.request();
        r.cancel();
        assert!(!r.pending());
    }

    #[test]
    fn retry_remainder_decays_to_zero() {
        let mut gate = RetryAt::default();
        assert_eq!(gate.left(), None);
        assert!(!gate.waiting());
        gate = RetryAt::after(Duration::from_secs(60));
        assert!(gate.waiting());
        assert!(gate.left().is_some_and(|d| d > Duration::from_secs(59)));
        gate = RetryAt::after(Duration::ZERO);
        assert_eq!(gate.left(), Some(Duration::ZERO), "due: the planner runs");
        assert!(!gate.waiting());
        gate.clear();
        assert_eq!(gate.left(), None);
    }
}
