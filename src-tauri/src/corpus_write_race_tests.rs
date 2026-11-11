//! Write races from the 2026-09-02 system audit (§6 #1, #3, #10): each test
//! holds the lock a fixed writer must wait for, so the old code fails it
//! deterministically instead of by timing luck.

use super::tests::bare;
use super::*;
use std::time::Duration;
use tempfile::TempDir;

/// How long a blocked writer is given to (wrongly) get through.
const BLOCKED_FOR: Duration = Duration::from_millis(400);

/// #3: ticking a task read the note, then wrote it, with no lock between. A
/// CLI or MCP edit landing in that window was silently overwritten.
#[test]
fn ticking_a_task_waits_for_a_writer_holding_the_note() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Plan\n\n- [ ] call the bank\n").unwrap();
    let task = store.tasks().unwrap().into_iter().find(|t| t.note_id == note.id).unwrap();
    let rel = store.resolve_note_rel(&note.id).unwrap();
    let path = store.abs(&rel);

    // another writer (a CLI patch, an MCP apply) holds the note
    let held = crate::fsutil::lock_file(&path).unwrap();
    let id = note.id.clone();
    let line = task.line;
    let ticking = std::thread::spawn(move || {
        let result = store.toggle_task(&id, line, "call the bank");
        (store, result)
    });
    std::thread::sleep(BLOCKED_FOR);
    assert!(
        fs::read_to_string(&path).unwrap().contains("- [ ] call the bank"),
        "the tick wrote while another writer held the note"
    );
    drop(held);
    let (mut store, result) = ticking.join().unwrap();
    result.unwrap();
    assert!(store.read(&note.id).unwrap().body.contains("- [x] call the bank"));
}

/// #1: a secure note's create appended its .gitignore line under only its
/// lane's create lock, so it could race set_secure's gitignore_add (which
/// takes the .gitignore's own lock) and drop that line.
#[test]
fn a_secure_create_waits_for_whoever_holds_the_gitignore() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().to_path_buf();
    fs::write(root.join(".gitignore"), "wiki/_secure/earlier.md\n").unwrap();
    let ignore = root.join(".gitignore");

    let held = crate::fsutil::lock_file(&ignore).unwrap();
    let creating = {
        let root = root.clone();
        std::thread::spawn(move || {
            crate::memex::write_note_at(&root, "private", "---\nid: 01SECURE\nsecure: true\n---\n# Private\n")
        })
    };
    std::thread::sleep(BLOCKED_FOR);
    assert_eq!(
        fs::read_to_string(&ignore).unwrap(),
        "wiki/_secure/earlier.md\n",
        "the secure create rewrote .gitignore while another writer held it"
    );
    drop(held);
    creating.join().unwrap().unwrap();
    let lines: Vec<String> = fs::read_to_string(&ignore).unwrap().lines().map(str::to_string).collect();
    assert_eq!(lines, ["wiki/_secure/earlier.md", "wiki/_secure/private.md"]);
}

/// #10: pinning and locking are Rotli's own writes, so the watcher must not
/// echo them back as an external change (a full-vault refresh each time).
#[test]
fn pin_lock_and_ai_edit_writes_are_marked_as_rotlis_own() {
    let (_dir, mut store) = bare();
    let note = store.create("Inbox", "# Plan\n\nbody\n").unwrap();
    let rel = store.resolve_note_rel(&note.id).unwrap();
    let path = store.abs(&rel);
    let fresh = |store: &mut CorpusStore| store.suppress = SuppressSet::default();

    fresh(&mut store);
    store.set_pinned(&note.id, true).unwrap();
    assert!(store.suppress.contains(&path), "set_pinned");

    fresh(&mut store);
    store.set_locked(&note.id, true).unwrap();
    assert!(store.suppress.contains(&path), "set_locked");

    fresh(&mut store);
    store.set_ai_edit(&note.id, true).unwrap();
    assert!(store.suppress.contains(&path), "set_ai_edit");
}
