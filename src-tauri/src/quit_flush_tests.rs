//! The two-phase save attempt (ninth and tenth reviews of pull request 267),
//! against a fake set of windows that answer as each test scripts.
//!
//! Every test orders its steps by signals, never by sleeping: a held answer is
//! released only after the test has seen what it waits for (a request sent, a
//! request waiting), so a slow or loaded runner changes how long a test takes,
//! not what it sees. The only waits on the clock are the coordinator's own
//! bounds, in the tests about what happens when a window never answers.

use std::collections::HashMap;
use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::{QuitFlush, QuitFlushStatus, Scope, Windows, CHECK_EVENT, ENDED_EVENT, FLUSH_EVENT, JOINED};

/// How long a test waits for a signal before failing instead of hanging.
const GIVE_UP: Duration = Duration::from_secs(30);

#[derive(Clone, Copy)]
enum Reply {
    /// Answer from inside the send, before the coordinator waits.
    Now(bool),
    /// Answer only when the test calls `release`.
    Held,
    /// Panic inside the send (a bug in a window's delivery).
    Panic,
}

struct Fake {
    flush: Arc<QuitFlush>,
    replies: HashMap<(String, u8), Reply>,
    live: Mutex<Vec<String>>,
    /// A window that appears when this one is asked to flush.
    opens_during: Option<(String, String)>,
    /// Every send, in order: (label, event, attempt id).
    sent: Mutex<Vec<(String, String, u64)>>,
    /// Held requests: (label, phase, attempt id).
    held: Mutex<Vec<(String, u8, u64)>>,
    held_cv: Condvar,
}

impl Fake {
    fn new(flush: Arc<QuitFlush>, live: &[&str]) -> Self {
        Self {
            flush,
            replies: HashMap::new(),
            live: Mutex::new(live.iter().map(|label| label.to_string()).collect()),
            opens_during: None,
            sent: Mutex::new(Vec::new()),
            held: Mutex::new(Vec::new()),
            held_cv: Condvar::new(),
        }
    }
    fn reply(mut self, label: &str, phase: u8, reply: Reply) -> Self {
        self.replies.insert((label.to_string(), phase), reply);
        self
    }
    fn sent(&self, event: &str) -> Vec<String> {
        self.sent.lock().unwrap().iter().filter(|(_, e, _)| e == event).map(|(label, _, _)| label.clone()).collect()
    }
    fn log(&self) -> Vec<(String, String, u64)> {
        self.sent.lock().unwrap().clone()
    }
    /// Wait until `label` holds a request for `phase`; its attempt id.
    fn wait_held(&self, label: &str, phase: u8) -> u64 {
        let deadline = Instant::now() + GIVE_UP;
        let mut held = self.held.lock().unwrap();
        loop {
            if let Some((_, _, attempt)) = held.iter().find(|(l, p, _)| l == label && *p == phase) {
                return *attempt;
            }
            let now = Instant::now();
            assert!(now < deadline, "{label} was never asked phase {phase}");
            held = self.held_cv.wait_timeout(held, deadline - now).unwrap().0;
        }
    }
    /// Wait for a request to `label` for `phase` from an attempt after
    /// `after`, and answer it yes.
    fn release_next(&self, label: &str, phase: u8, after: u64) {
        let deadline = Instant::now() + GIVE_UP;
        let mut held = self.held.lock().unwrap();
        let at = loop {
            if let Some(at) = held.iter().position(|(l, p, a)| l == label && *p == phase && *a != after) {
                break at;
            }
            let now = Instant::now();
            assert!(now < deadline, "{label} was never asked phase {phase} again");
            held = self.held_cv.wait_timeout(held, deadline - now).unwrap().0;
        };
        let attempt = held.remove(at).2;
        drop(held);
        self.flush.answer(attempt, phase, label, true, None);
    }
    /// Deliver `label`'s held answer to `phase`.
    fn release(&self, label: &str, phase: u8, ok: bool) {
        let attempt = {
            let mut held = self.held.lock().unwrap();
            let at = held.iter().position(|(l, p, _)| l == label && *p == phase).expect("nothing held");
            held.remove(at).2
        };
        self.flush.answer(attempt, phase, label, ok, (!ok).then(|| format!("“{label}” has unsaved edits")));
    }
}

impl Windows for Fake {
    fn emit(&self, label: &str, event: &str, payload: serde_json::Value) -> bool {
        let attempt = payload["attemptId"].as_u64().unwrap();
        self.sent.lock().unwrap().push((label.to_string(), event.to_string(), attempt));
        let phase = match event {
            FLUSH_EVENT => 1,
            CHECK_EVENT => 2,
            _ => return true,
        };
        if phase == 1 {
            if let Some((when, opened)) = &self.opens_during {
                if when == label {
                    self.live.lock().unwrap().push(opened.clone());
                }
            }
        }
        match self.replies.get(&(label.to_string(), phase)).copied().unwrap_or(Reply::Now(true)) {
            Reply::Now(ok) => {
                self.flush.answer(attempt, phase, label, ok, (!ok).then(|| format!("“{label}” has unsaved edits")))
            }
            Reply::Held => {
                self.held.lock().unwrap().push((label.to_string(), phase, attempt));
                self.held_cv.notify_all();
            }
            Reply::Panic => panic!("{label} could not be sent {event}"),
        }
        true
    }
    fn live(&self) -> Vec<String> {
        self.live.lock().unwrap().clone()
    }
}

/// Short bounds, for the tests about a window that never answers.
fn flush() -> Arc<QuitFlush> {
    Arc::new(QuitFlush::new(Duration::from_millis(150), Duration::from_millis(100)))
}
/// Bounds no test reaches: every answer in it is released by the test.
fn patient() -> Arc<QuitFlush> {
    Arc::new(QuitFlush::new(GIVE_UP, GIVE_UP))
}
const LABELS: [&str; 2] = ["main", "folder-a"];

/// Wait until the coordinator's status satisfies `until`.
fn wait_status(flush: &QuitFlush, until: impl Fn(&QuitFlushStatus) -> bool) {
    let deadline = Instant::now() + GIVE_UP;
    let mut status = flush.status.lock().unwrap();
    while !until(&status) {
        let now = Instant::now();
        assert!(now < deadline, "the coordinator never reached the state the test waits for");
        status = flush.cv.wait_timeout(status, deadline - now).unwrap().0;
    }
}

fn spawn_attempt(
    flush: &Arc<QuitFlush>,
    fake: &Arc<Fake>,
    only: Option<&[&str]>,
    intent: Option<&'static str>,
) -> thread::JoinHandle<Result<(), String>> {
    let (flush, fake) = (flush.clone(), fake.clone());
    let only: Option<Vec<String>> = only.map(|labels| labels.iter().map(|label| label.to_string()).collect());
    thread::spawn(move || {
        let scope = match &only {
            Some(labels) => Scope::Only(labels),
            None => Scope::All,
        };
        flush.attempt(fake.as_ref(), scope, intent)
    })
}

#[test]
fn every_window_flushed_and_clean_finishes_and_each_hears_the_end_once() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS);
    assert_eq!(flush.attempt(&fake, Scope::All, Some("quit")), Ok(()));
    assert_eq!(fake.sent(CHECK_EVENT), vec!["folder-a", "main"]);
    assert_eq!(fake.sent(ENDED_EVENT), vec!["folder-a", "main"]);
}

#[test]
fn a_window_dirty_at_the_immediate_question_refuses_naming_it() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS).reply("main", 2, Reply::Now(false));
    let refused = flush.attempt(&fake, Scope::All, Some("quit")).unwrap_err();
    assert!(refused.contains("“main” has unsaved edits"), "{refused}");
    assert_eq!(fake.sent(ENDED_EVENT).len(), 2);
}

/// (a) A window whose flusher never settles: refused at the bound, and every
/// window, the hung one included, hears that the attempt ended. Nothing in
/// the frontend waits on a timer to recover; nothing was ever locked. (The
/// bound is what is under test, so this waits on the clock; a slow runner
/// only makes the refusal later.)
#[test]
fn a_flusher_that_never_settles_is_refused_and_every_window_hears_the_end() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::Held);
    let refused = flush.attempt(&fake, Scope::All, Some("quit")).unwrap_err();
    assert!(refused.contains("folder-a"), "{refused}");
    assert!(fake.sent(CHECK_EVENT).is_empty(), "no immediate question after a refused flush");
    assert_eq!(fake.sent(ENDED_EVENT), vec!["folder-a", "main"]);
    // a later attempt starts afresh
    let fake = Fake::new(flush.clone(), &LABELS);
    assert_eq!(flush.attempt(&fake, Scope::All, Some("quit")), Ok(()));
}

/// An answer that arrives after its attempt ended never counts for a later
/// one: the first attempt is refused at its bound with main's answer still
/// held; the second is held at main's immediate question while the first
/// attempt's answers arrive, and they change nothing.
#[test]
fn a_late_answer_from_an_earlier_attempt_never_counts() {
    let flush = Arc::new(QuitFlush::new(Duration::from_millis(150), GIVE_UP));
    let first = Fake::new(flush.clone(), &LABELS).reply("main", 1, Reply::Held);
    assert!(flush.attempt(&first, Scope::All, Some("quit")).is_err());
    let first_id = first.wait_held("main", 1);

    let second = Arc::new(Fake::new(flush.clone(), &LABELS).reply("main", 2, Reply::Held));
    let running = spawn_attempt(&flush, &second, None, Some("quit"));
    let second_id = second.wait_held("main", 2);
    assert_ne!(first_id, second_id);
    first.release("main", 1, true);
    flush.answer(first_id, 2, "main", true, None);
    {
        let status = flush.status.lock().unwrap();
        assert_eq!((status.attempt_id, status.phase), (second_id, 2));
        assert!(status.pending.contains("main"), "the first attempt's late answers must not stand in");
    }
    second.release("main", 2, false);
    let refused = running.join().unwrap().unwrap_err();
    assert!(refused.contains("“main” has unsaved edits"), "{refused}");
}

/// (b) A second request with the same intent (a second Cmd-Q) joins the live
/// attempt: one set of requests goes out, and the second request waits for
/// the first to end and acts on nothing.
#[test]
fn a_second_request_with_the_same_intent_joins_the_live_attempt() {
    let flush = patient();
    let fake = Arc::new(Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::Held));
    let first = spawn_attempt(&flush, &fake, None, Some("quit"));
    fake.wait_held("folder-a", 1);
    let second = spawn_attempt(&flush, &fake, None, Some("quit"));
    wait_status(&flush, |status| status.waiting == 1);
    fake.release("folder-a", 1, true);
    assert_eq!(first.join().unwrap(), Ok(()));
    assert_eq!(second.join().unwrap(), Err(JOINED.to_string()));
    assert_eq!(fake.sent(FLUSH_EVENT).len(), 2, "one attempt's requests, not two");
    assert_eq!(fake.sent(ENDED_EVENT).len(), 2);
}

/// A request with another intent waits for the live attempt and then runs as
/// its own: a quit during a folder window's close is not swallowed by it, and
/// none of its requests go out before the close has ended.
#[test]
fn a_quit_during_a_folder_close_waits_for_it_and_then_runs() {
    let flush = patient();
    let fake = Arc::new(Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::Held));
    let close = spawn_attempt(&flush, &fake, Some(&["folder-a"]), Some("close folder-a"));
    let close_id = fake.wait_held("folder-a", 1);
    let quit = spawn_attempt(&flush, &fake, None, Some("quit"));
    wait_status(&flush, |status| status.waiting == 1);
    assert!(fake.log().iter().all(|(_, _, attempt)| *attempt == close_id), "the quit sent nothing yet");
    fake.release("folder-a", 1, true);
    assert_eq!(close.join().unwrap(), Ok(()));
    // the quit's own request to folder-a (still open until its caller closes it)
    fake.release_next("folder-a", 1, close_id);
    assert_eq!(quit.join().unwrap(), Ok(()), "the quit runs, it is not swallowed");
    let log = fake.log();
    let close_ended = log.iter().rposition(|(_, _, attempt)| *attempt == close_id).unwrap();
    let quit_started = log.iter().position(|(_, _, attempt)| *attempt != close_id).unwrap();
    assert!(close_ended < quit_started, "the quit began after the close ended: {log:?}");
    assert_eq!(log[close_ended].1, ENDED_EVENT);
    assert!(log.iter().any(|(label, event, attempt)| label == "main" && event == FLUSH_EVENT && *attempt != close_id));
}

/// Closing folder B while folder A is closing: B's close waits, then runs.
#[test]
fn closing_a_second_folder_window_during_the_first_close_still_closes_it() {
    let flush = patient();
    let fake =
        Arc::new(Fake::new(flush.clone(), &["main", "folder-a", "folder-b"]).reply("folder-a", 1, Reply::Held));
    let close_a = spawn_attempt(&flush, &fake, Some(&["folder-a"]), Some("close folder-a"));
    fake.wait_held("folder-a", 1);
    let close_b = spawn_attempt(&flush, &fake, Some(&["folder-b"]), Some("close folder-b"));
    wait_status(&flush, |status| status.waiting == 1);
    fake.release("folder-a", 1, true);
    assert_eq!(close_a.join().unwrap(), Ok(()));
    assert_eq!(close_b.join().unwrap(), Ok(()));
    assert_eq!(fake.sent(CHECK_EVENT), vec!["folder-a", "folder-b"]);
}

/// A request with no intent (a vault switch) never joins, even another one.
#[test]
fn a_request_without_an_intent_never_joins() {
    let flush = patient();
    let fake = Arc::new(Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::Held));
    let first = spawn_attempt(&flush, &fake, None, None);
    fake.wait_held("folder-a", 1);
    let second = spawn_attempt(&flush, &Arc::new(Fake::new(flush.clone(), &LABELS)), None, None);
    wait_status(&flush, |status| status.waiting == 1);
    fake.release("folder-a", 1, true);
    assert_eq!(first.join().unwrap(), Ok(()));
    assert_eq!(second.join().unwrap(), Ok(()));
}

/// A panic inside an attempt (here, delivering a request) still ends it: the
/// next request runs instead of waiting for ever.
#[test]
fn a_panic_during_an_attempt_never_leaves_later_requests_waiting() {
    let flush = patient();
    let broken = Fake::new(flush.clone(), &LABELS).reply("main", 1, Reply::Panic);
    let outcome = panic::catch_unwind(AssertUnwindSafe(|| flush.attempt(&broken, Scope::All, Some("quit"))));
    assert!(outcome.is_err(), "the fake panicked");
    {
        let status = flush.status.lock().unwrap();
        assert!(!status.live && status.intent.is_none() && status.pending.is_empty());
    }
    let fake = Fake::new(flush.clone(), &LABELS);
    assert_eq!(flush.attempt(&fake, Scope::All, Some("quit")), Ok(()));
}

/// (e) A window opened during the attempt is asked the immediate question; if
/// it has unsaved words, the quit is refused.
#[test]
fn a_window_opened_during_the_attempt_is_asked_too() {
    let flush = flush();
    let mut fake = Fake::new(flush.clone(), &LABELS).reply("quick", 2, Reply::Now(false));
    fake.opens_during = Some(("main".into(), "quick".into()));
    let refused = flush.attempt(&fake, Scope::All, Some("quit")).unwrap_err();
    assert!(refused.contains("“quick”"), "{refused}");
    assert!(fake.sent(ENDED_EVENT).contains(&"quick".to_string()));
}

/// (d, f) A folder-window close uses the same attempt: a window that can't
/// answer is refused at the bound and still hears the end, so it stays usable.
#[test]
fn a_close_that_times_out_ends_with_an_event_to_the_closing_window() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &["folder-a"]).reply("folder-a", 2, Reply::Held);
    let only = ["folder-a".to_string()];
    assert!(flush.attempt(&fake, Scope::Only(&only), Some("close folder-a")).is_err());
    assert_eq!(fake.sent(ENDED_EVENT), vec!["folder-a"]);
}

#[test]
fn repeat_answers_from_one_window_never_release_another() {
    let flush = flush();
    {
        let mut status = flush.status.lock().unwrap();
        status.attempt_id = 7;
        status.phase = 1;
        status.pending = ["main", "capture"].map(String::from).into_iter().collect();
    }
    for _ in 0..4 {
        flush.answer(7, 1, "capture", true, None);
    }
    flush.answer(7, 2, "main", true, None); // another phase never counts
    flush.answer(6, 1, "main", true, None); // nor another attempt
    let status = flush.status.lock().unwrap();
    assert!(status.pending.contains("main"));
}
