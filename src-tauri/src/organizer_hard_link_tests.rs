//! Second review of PR #267 (#3): the organizer read vault files by path, so
//! a hard link to a file outside the vault reached its classification prompt.

use super::*;
use crate::fsutil::hard_link_outside;

const OUTSIDE: &[u8] = b"# Ledger\n\nwords from beyond the vault\n";

#[test]
fn a_hard_linked_note_never_reaches_the_organizers_snapshot() {
    let root = tempfile::TempDir::new().unwrap();
    let _outside = hard_link_outside(&root.path().join("wiki/Projects/linked.md"), OUTSIDE);
    assert!(snapshot_note(root.path(), "wiki/Projects/linked.md").is_err());
}

#[test]
fn a_hard_linked_area_index_never_becomes_an_area_description() {
    let root = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("wiki/Projects")).unwrap();
    let index = LibrarianMap::at(root.path()).index_rel("Projects");
    let _outside = hard_link_outside(&root.path().join(index), OUTSIDE);
    let vocab = format!("{:?}", area_vocab(root.path(), false));
    assert!(!vocab.contains("beyond the vault"), "{vocab}");
}

/// Third review (Part 1, Rust): an area index note the policy refuses (secure
/// here) gives no description, so its words never reach a classify prompt.
#[test]
fn a_secure_area_index_never_becomes_an_area_description() {
    let root = tempfile::TempDir::new().unwrap();
    std::fs::create_dir_all(root.path().join("wiki/Projects")).unwrap();
    let index = LibrarianMap::at(root.path()).index_rel("Projects");
    std::fs::write(root.path().join(&index), "---\nsecure: true\n---\n\n# Projects\n\nthe harbor deal closes friday\n").unwrap();
    let vocab = format!("{:?}", area_vocab(root.path(), false));
    assert!(vocab.contains("Projects") && !vocab.contains("harbor deal"), "{vocab}");
    std::fs::write(root.path().join(&index), "# Projects\n\nwhat we are building\n").unwrap();
    assert!(format!("{:?}", area_vocab(root.path(), false)).contains("what we are building"));
}

/// The organizer's `ModelPrompt` is made only from a `Cleared` note, and a
/// `Cleared` note only from a snapshot: a tripwire that fails when a
/// `NoteSnapshot` is built anywhere but the checked read.
#[test]
fn a_note_snapshot_is_built_only_by_the_checked_read() {
    let source = include_str!("organizer.rs");
    let built: Vec<usize> = source.match_indices("NoteSnapshot {").map(|(at, _)| at).collect();
    let declared = source.find("struct NoteSnapshot {").unwrap() + "struct ".len();
    let reader = source.find("fn snapshot_note(").unwrap();
    let after_reader = reader + source[reader..].find("\n}\n").unwrap();
    for at in built {
        assert!(at == declared || (reader..after_reader).contains(&at), "a NoteSnapshot built outside snapshot_note at byte {at}");
    }
    let prompt = include_str!("organizer_prompt.rs");
    assert_eq!(prompt.matches("ModelPrompt(p)").count(), 2, "only classify and enrich make a ModelPrompt");
    assert_eq!(prompt.matches("Cleared(snapshot)").count(), 1, "only clear makes a Cleared note");
}
