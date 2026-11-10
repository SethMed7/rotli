//! Third review of pull request 267, #4 (2026-11-09): every AI listing
//! rebuilt that week, run over a vault that mixes a Markdown note, a board
//! and a file. A board or a file keeps its own lane and kind; none of them
//! comes back as a note.

use super::tests::test_workspace;
use super::*;
use tempfile::TempDir;

fn mixed(temp: &TempDir) -> (Workspace, String) {
    let mut ws = test_workspace(temp);
    // the file first: written behind the store's back, before any walk
    fs::create_dir_all(ws.store.root().join("Storage")).unwrap();
    fs::write(ws.store.root().join("Storage/ferry.csv"), "pier,hour\n2,ten\n").unwrap();
    let note = ws.create_note("Ferry plan", "ferry leaves at ten", MAIN_ROOT).unwrap();
    ws.create_board("Ferry sketch", "", "", MAIN_ROOT).unwrap();
    let local = ws.local_id(&note.id).unwrap();
    (ws, local)
}

#[test]
fn the_workspace_listing_keeps_boards_and_files_in_their_lanes() {
    let temp = TempDir::new().unwrap();
    let (mut ws, note) = mixed(&temp);
    let listed = ws.list_remote(100).unwrap();
    let kind_of = |title: &str| listed.notes.iter().find(|n| n.title == title).map(|n| n.kind);
    assert_eq!(kind_of("Ferry plan"), Some(NoteKind::Note), "{:?}", listed.notes);
    assert_eq!(kind_of("Ferry sketch"), Some(NoteKind::Board), "{:?}", listed.notes);
    assert_eq!(kind_of("ferry.csv"), Some(NoteKind::File), "{:?}", listed.notes);
    assert!(listed.notes.iter().any(|n| ws.local_id(&n.id).ok().as_deref() == Some(note.as_str())));
}

#[test]
fn workspace_search_and_query_return_only_notes() {
    let temp = TempDir::new().unwrap();
    let (mut ws, note) = mixed(&temp);
    let hits = ws.search_remote("ferry", 10).unwrap();
    assert!(!hits.is_empty());
    assert!(hits.iter().all(|hit| hit.kind == NoteKind::Note), "{hits:?}");
    let found = ws.query_remote(r#"title:~"Ferry""#, 10).unwrap();
    let ids: Vec<String> = found.notes.iter().map(|row| ws.local_id(&row.id).unwrap()).collect();
    assert_eq!(ids, vec![note]);
}
