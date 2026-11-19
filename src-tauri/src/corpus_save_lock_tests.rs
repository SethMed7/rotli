//! System audit 2026-09-02 §6 #4: board and office-file saves checked the
//! revision and wrote without the file lock, so a save from another process
//! landing in between was overwritten. Each test holds the lock, lets the
//! "other writer" change the file, and expects the waiting save to refuse.

use super::tests::bare;
use super::*;
use std::time::Duration;

const BLOCKED_FOR: Duration = Duration::from_millis(400);

fn scene(label: &str) -> String {
    format!(r#"{{"type":"excalidraw","version":2,"elements":[],"appState":{{}},"files":{{}},"label":"{label}"}}"#)
}

#[test]
fn a_board_save_waits_and_then_refuses_over_an_agents_newer_board() {
    let (_dir, mut store) = bare();
    let board = store.create_named_board("Inbox", "Plan", Some(&scene("opened"))).unwrap();
    let id = board.id.clone();
    let path = store.abs(&id);
    let opened = crate::fsutil::revision(&fs::read(&path).unwrap());

    let held = crate::fsutil::lock_file(&path).unwrap();
    let saving = {
        let id = id.clone();
        std::thread::spawn(move || {
            let result = store.write_board_if_revision(&id, &scene("app autosave"), &opened);
            (store, result)
        })
    };
    std::thread::sleep(BLOCKED_FOR);
    // the agent, holding the board, writes its edit and lets go
    fs::write(&path, scene("agent edit")).unwrap();
    drop(held);
    let (_store, result) = saving.join().unwrap();
    assert!(result.is_err(), "the stale autosave must conflict, not overwrite");
    assert!(fs::read_to_string(&path).unwrap().contains("agent edit"));
}

#[test]
fn an_office_save_waits_and_then_refuses_over_a_newer_file() {
    let (_dir, mut store) = bare();
    let path = store.root().join("Storage/book.xlsx");
    fs::write(&path, b"opened").unwrap();
    let opened = crate::fsutil::revision(b"opened");

    let held = crate::fsutil::lock_file(&path).unwrap();
    let saving = std::thread::spawn(move || {
        let result = store.write_file_bytes_if_revision("Storage/book.xlsx", b"stale save", false, &opened);
        (store, result)
    });
    std::thread::sleep(BLOCKED_FOR);
    fs::write(&path, b"other save").unwrap();
    drop(held);
    let (_store, result) = saving.join().unwrap();
    assert!(result.is_err(), "the stale save must conflict, not overwrite");
    assert_eq!(fs::read(&path).unwrap(), b"other save");
}
