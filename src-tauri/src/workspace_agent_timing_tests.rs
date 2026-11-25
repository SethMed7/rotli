//! The differential harness's third half: time. The first two compare what an
//! agent is told (`workspace_agent_differential_tests.rs`); this one compares
//! how long it waits. A hidden note's id and a missing id answer with the
//! same words, but on a 5,000-note vault the hidden one came back in 6-70 ms
//! and the missing one in 2.4-3.2 s (audit of 2026-11-24, threat model row
//! 16k). An agent that can guess ids can read that gap as "this one exists".
//!
//! The test states the bar the fix must meet and fails today, so it is
//! ignored until the fix lands (1.10: a fast negative lookup, audit item 9).

use super::path_protection_tests::put;
use super::*;
use std::time::Instant;

/// Filler notes on top of the seeded vault. The gap grows with the vault
/// (a missing id walks it), so the vault has to be big enough to show it.
const FILLER_NOTES: usize = 1500;

/// An id that names nothing, shaped like the hidden ids below.
const MISSING: &str = "01SURFNONE00000000000000000";
/// Hidden ids, as an agent could name them: a secure-home note and a note
/// hidden by its frontmatter (both by ULID), and a secure-home path.
const HIDDEN: [&str; 3] = ["01SURFBANK00000000000000000", HIDDEN_FM, "wiki/_secure/Bank plan.md"];

fn crowded() -> tempfile::TempDir {
    let temp = seeded();
    for n in 0..FILLER_NOTES {
        let id = format!("01FILL{n:021}");
        put(temp.path(), &format!("wiki/Filler/{}/n{n}.md", n % 25), &format!("---\nid: {id}\n---\n# Filler {n}\n\nplain words for note {n}\n"));
    }
    temp
}

/// The quickest of seven waits, in microseconds, for `rotli_read_note` on
/// `id`, and the words it answered with. A walk costs about the same every
/// time while a busy machine only ever adds, so the quickest run is the one
/// least moved by load. Each call opens a fresh store, as a real one does.
fn wait(temp: &tempfile::TempDir, id: &str) -> (u128, String) {
    let mut waits = Vec::new();
    let mut words = String::new();
    for _ in 0..7 {
        let started = Instant::now();
        words = pinned(temp, || call(&WORKSPACE_SERVER, "rotli_read_note", json!({"id": id})));
        waits.push(started.elapsed().as_micros());
    }
    (waits.into_iter().min().unwrap_or_default(), words)
}

/// What a missing id may cost beyond a hidden one before the gap shows:
/// twice as long plus 25 ms of scheduler noise.
fn tolerated(hidden: u128) -> u128 {
    hidden * 2 + 25_000
}

#[test]
#[ignore = "known gap, threat model row 16k (timing): a missing id walks the vault and a hidden one doesn't; the fast negative lookup lands in 1.10 (audit item 9). Run it with: cargo test --lib workspace::agent_differential_tests::timing::a_missing_id_waits_as_long_as_a_hidden_one -- --ignored --nocapture"]
fn a_missing_id_waits_as_long_as_a_hidden_one() {
    let temp = crowded();
    // a first call builds the search index and the walk's caches, which
    // belong to the vault, not to either answer
    wait(&temp, MISSING);
    let (missing, said) = wait(&temp, MISSING);
    assert!(said.contains(&format!("note not found: {MISSING}")), "the missing id must be answered as missing: {said}");
    let mut slow = Vec::new();
    for id in HIDDEN {
        let (hidden, said) = wait(&temp, id);
        assert!(said.contains(&format!("note not found: {id}")), "{id} must be answered as missing: {said}");
        eprintln!("hidden {id}: {hidden} us; missing: {missing} us");
        if missing > tolerated(hidden) {
            slow.push(format!("{id} answers in {hidden} us, a missing id in {missing} us (more than {} us)", tolerated(hidden)));
        }
    }
    assert!(slow.is_empty(), "a missing id waits longer than a hidden one, so the wait tells them apart:\n{}", slow.join("\n"));
}

#[test]
fn the_timing_bar_names_a_gap_it_can_tell() {
    // the check's own arithmetic: a hidden answer in 6 ms tolerates 37 ms,
    // so the audit's 2.4 s is caught and a 20 ms jitter is not
    assert!(tolerated(6_000) < 2_400_000);
    assert!(tolerated(6_000) > 20_000);
}
