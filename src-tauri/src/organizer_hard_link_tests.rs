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
