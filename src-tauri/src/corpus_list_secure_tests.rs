//! The sidebar's quiet "Secure note" mark reads one flag from the list the app
//! already fetches (no per-row read). The person's own walk sets it by the one
//! rule the Graph uses (`corpus_links.rs`); no row an agent lane builds ever
//! carries it, so the list wire tells an agent nothing it was not shown.

use super::tests::bare;
use super::*;

fn listed(store: &mut CorpusStore, id: &str) -> NoteMeta {
    store.list().unwrap().notes.into_iter().find(|n| n.id == id).expect("note is listed")
}

#[test]
fn the_list_marks_a_flagged_note_and_not_a_plain_one() {
    let (_dir, mut store) = bare();
    let plain = store.create("Inbox", "# Grocery run\n\nmilk\n").unwrap();
    let flagged = store.create_with_policy("Inbox", "# Passport scan\n\nnotes\n", true).unwrap();
    assert!(!listed(&mut store, &plain.id).secure);
    assert!(listed(&mut store, &flagged.id).secure);
}

#[test]
fn the_list_follows_the_flag_on_and_off() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Trip plan\n\nday one\n").unwrap();
    store.set_secure(&note.id, true).unwrap();
    assert!(listed(&mut store, &note.id).secure);
    store.set_secure(&note.id, false).unwrap();
    assert!(!listed(&mut store, &note.id).secure);
}

#[test]
fn a_note_in_a_secure_folder_is_marked_whatever_its_frontmatter_says() {
    let (_dir, mut store) = bare();
    let note = store.create("Secure notes", "# Door code\n\n0000\n").unwrap();
    assert!(listed(&mut store, &note.id).secure);
}

#[test]
fn an_agent_row_never_carries_the_mark() {
    let (_dir, mut store) = bare();
    let note = store.create_with_policy("Inbox", "# Passport scan\n\nnotes\n", true).unwrap();
    // an on-device reader may be shown the row; the mark is still not on it
    let row = store.note_row_for_ai(&note.id, true).expect("an on-device reader sees it");
    assert!(!row.secure);
    assert!(!serde_json::to_string(&row).unwrap().contains("secure"));
}

#[test]
fn a_plain_row_leaves_the_key_off_the_wire() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Grocery run\n\nmilk\n").unwrap();
    assert!(!serde_json::to_string(&listed(&mut store, &note.id)).unwrap().contains("\"secure\""));
}

#[test]
fn a_note_the_secret_detector_flags_is_marked_in_the_list_without_a_flag() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Notes\n\nkey: sk-ant-api03-EXAMPLE0EXAMPLE0EXAM\n").unwrap();
    assert!(listed(&mut store, &note.id).secure);
}

/// Review of pull request 315: an agent's create, write and move answers come
/// from builders the person's lane shares, so each must leave the mark off.
#[test]
fn an_agent_lanes_create_write_and_move_never_say_a_note_is_protected() {
    let (_dir, mut store) = bare();
    store.set_agent_lane();
    let made = store.create_with_policy("Inbox", "# Passport scan\n\nnotes\n", true).unwrap();
    let written = store.write(&made.id, "# Passport scan\n\nmore notes\n").unwrap();
    let moved = store.move_note(&made.id, "Projects").unwrap();
    for answer in [&made, &written, &moved] {
        assert!(!answer.secure);
        assert!(!serde_json::to_string(answer).unwrap().contains("secure"));
    }
}

#[test]
fn the_persons_create_write_and_move_still_carry_the_mark() {
    let (_dir, mut store) = bare();
    let made = store.create_with_policy("Inbox", "# Passport scan\n\nnotes\n", true).unwrap();
    let written = store.write(&made.id, "# Passport scan\n\nmore notes\n").unwrap();
    let moved = store.move_note(&made.id, "Projects").unwrap();
    for answer in [&made, &written, &moved] {
        assert!(answer.secure);
    }
}
