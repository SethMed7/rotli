//! The two-phase save attempt (ninth review of pull request 267), against a
//! fake set of windows that answer as each test scripts.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use super::{QuitFlush, Windows, CHECK_EVENT, ENDED_EVENT, FLUSH_EVENT, JOINED};

#[derive(Clone, Copy)]
enum Reply {
    Now(bool),
    After(u64, bool),
    Never,
}

struct Fake {
    flush: Arc<QuitFlush>,
    replies: HashMap<(String, u8), Reply>,
    live: Mutex<Vec<String>>,
    /// A window that appears when this one is asked to flush.
    opens_during: Option<(String, String)>,
    sent: Mutex<Vec<(String, String)>>,
}

impl Fake {
    fn new(flush: Arc<QuitFlush>, live: &[&str]) -> Self {
        Self {
            flush,
            replies: HashMap::new(),
            live: Mutex::new(live.iter().map(|label| label.to_string()).collect()),
            opens_during: None,
            sent: Mutex::new(Vec::new()),
        }
    }
    fn reply(mut self, label: &str, phase: u8, reply: Reply) -> Self {
        self.replies.insert((label.to_string(), phase), reply);
        self
    }
    fn sent(&self, event: &str) -> Vec<String> {
        self.sent.lock().unwrap().iter().filter(|(_, e)| e == event).map(|(label, _)| label.clone()).collect()
    }
}

impl Windows for Fake {
    fn emit(&self, label: &str, event: &str, payload: serde_json::Value) -> bool {
        self.sent.lock().unwrap().push((label.to_string(), event.to_string()));
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
        let attempt = payload["attemptId"].as_u64().unwrap();
        let reply = self.replies.get(&(label.to_string(), phase)).copied().unwrap_or(Reply::Now(true));
        let flush = self.flush.clone();
        let label = label.to_string();
        let error = Some(format!("“{label}” has unsaved edits"));
        match reply {
            Reply::Now(ok) => flush.answer(attempt, phase, &label, ok, (!ok).then_some(error).flatten()),
            Reply::After(ms, ok) => {
                thread::spawn(move || {
                    thread::sleep(Duration::from_millis(ms));
                    flush.answer(attempt, phase, &label, ok, (!ok).then_some(error).flatten());
                });
            }
            Reply::Never => {}
        }
        true
    }
    fn live(&self) -> Vec<String> {
        self.live.lock().unwrap().clone()
    }
}

fn flush() -> Arc<QuitFlush> {
    Arc::new(QuitFlush::new(Duration::from_millis(150), Duration::from_millis(100)))
}
const LABELS: [&str; 2] = ["main", "folder-a"];
fn labels() -> Vec<String> {
    LABELS.iter().map(|label| label.to_string()).collect()
}

#[test]
fn every_window_flushed_and_clean_finishes_and_each_hears_the_end_once() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS);
    assert_eq!(flush.attempt(&fake, &labels(), true), Ok(()));
    assert_eq!(fake.sent(CHECK_EVENT), vec!["folder-a", "main"]);
    assert_eq!(fake.sent(ENDED_EVENT), vec!["folder-a", "main"]);
}

#[test]
fn a_window_dirty_at_the_immediate_question_refuses_naming_it() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS).reply("main", 2, Reply::Now(false));
    let refused = flush.attempt(&fake, &labels(), true).unwrap_err();
    assert!(refused.contains("“main” has unsaved edits"), "{refused}");
    assert_eq!(fake.sent(ENDED_EVENT).len(), 2);
}

/// (a) A window whose flusher never settles: refused at the bound, and every
/// window, the hung one included, hears that the attempt ended. Nothing in
/// the frontend waits on a timer to recover; nothing was ever locked.
#[test]
fn a_flusher_that_never_settles_is_refused_and_every_window_hears_the_end() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::Never);
    let refused = flush.attempt(&fake, &labels(), true).unwrap_err();
    assert!(refused.contains("folder-a"), "{refused}");
    assert!(fake.sent(CHECK_EVENT).is_empty(), "no immediate question after a refused flush");
    assert_eq!(fake.sent(ENDED_EVENT), vec!["folder-a", "main"]);
    // a later attempt starts afresh
    let fake = Fake::new(flush.clone(), &LABELS);
    assert_eq!(flush.attempt(&fake, &labels(), true), Ok(()));
}

/// A late acknowledgement (after the bound) never counts for a later attempt.
#[test]
fn a_late_answer_from_an_earlier_attempt_never_counts() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &LABELS).reply("main", 1, Reply::After(400, true));
    assert!(flush.attempt(&fake, &labels(), true).is_err());
    let fake = Fake::new(flush.clone(), &LABELS).reply("main", 2, Reply::Never);
    let refused = flush.attempt(&fake, &labels(), true).unwrap_err();
    assert!(refused.contains("main"), "the first attempt's late answer must not stand in: {refused}");
    thread::sleep(Duration::from_millis(400));
}

/// (b) A second request while one is live joins it: one set of requests goes
/// out, the second request waits for the first to end and acts on nothing.
#[test]
fn a_second_request_joins_the_live_attempt() {
    let flush = flush();
    let fake = Arc::new(Fake::new(flush.clone(), &LABELS).reply("folder-a", 1, Reply::After(60, true)));
    let first = {
        let (flush, fake) = (flush.clone(), fake.clone());
        thread::spawn(move || flush.attempt(fake.as_ref(), &labels(), true))
    };
    thread::sleep(Duration::from_millis(15));
    assert_eq!(flush.attempt(fake.as_ref(), &labels(), true), Err(JOINED.to_string()));
    assert_eq!(first.join().unwrap(), Ok(()));
    assert_eq!(fake.sent(FLUSH_EVENT).len(), 2, "one attempt's requests, not two");
    assert_eq!(fake.sent(ENDED_EVENT).len(), 2);
}

/// (e) A window opened during the attempt is asked the immediate question; if
/// it has unsaved words, the quit is refused.
#[test]
fn a_window_opened_during_the_attempt_is_asked_too() {
    let flush = flush();
    let mut fake = Fake::new(flush.clone(), &LABELS).reply("quick", 2, Reply::Now(false));
    fake.opens_during = Some(("main".into(), "quick".into()));
    let refused = flush.attempt(&fake, &labels(), true).unwrap_err();
    assert!(refused.contains("“quick”"), "{refused}");
    assert!(fake.sent(ENDED_EVENT).contains(&"quick".to_string()));
}

/// (d, f) A switch or a folder-window close uses the same attempt: a window
/// that can't answer is refused and still hears the end, so it stays usable.
#[test]
fn a_close_that_times_out_ends_with_an_event_to_the_closing_window() {
    let flush = flush();
    let fake = Fake::new(flush.clone(), &["folder-a"]).reply("folder-a", 2, Reply::Never);
    assert!(flush.attempt(&fake, &["folder-a".to_string()], false).is_err());
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
