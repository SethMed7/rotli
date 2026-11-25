//! `rename_no_replace` and its copy fallback, the path a filesystem without a
//! refusing rename (exFAT, FAT) takes; APFS and ext4 never reach it, so it is
//! called directly here (review of PR #317, items 2 and 3).

use super::{copy_no_replace, has_one_name, rename_no_replace};
use std::fs;
use std::io::ErrorKind;

type Move = fn(&std::path::Path, &std::path::Path) -> std::io::Result<()>;
const MOVES: [(&str, Move); 2] = [("rename", rename_no_replace), ("copy", copy_no_replace)];

#[test]
fn a_move_lands_with_one_name_and_the_original_gone() {
    for (name, move_file) in MOVES {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&from, "kept words").unwrap();
        move_file(&from, &to).unwrap();
        assert!(!from.exists(), "{name}: the original is gone");
        assert_eq!(fs::read_to_string(&to).unwrap(), "kept words", "{name}");
        assert!(has_one_name(&fs::metadata(&to).unwrap()), "{name}: no second name is left behind");
    }
}

#[test]
fn a_taken_destination_is_refused_and_both_files_stay() {
    for (name, move_file) in MOVES {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
        fs::write(&from, "new").unwrap();
        fs::write(&to, "older chat").unwrap();
        let error = move_file(&from, &to).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::AlreadyExists, "{name}");
        assert_eq!(fs::read_to_string(&from).unwrap(), "new", "{name}");
        assert_eq!(fs::read_to_string(&to).unwrap(), "older chat", "{name}");
    }
}

#[test]
fn a_missing_original_is_not_found_and_writes_nothing() {
    for (name, move_file) in MOVES {
        let dir = tempfile::tempdir().unwrap();
        let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
        assert_eq!(move_file(&from, &to).unwrap_err().kind(), ErrorKind::NotFound, "{name}");
        assert!(!to.exists(), "{name}");
    }
}

#[test]
fn the_copy_keeps_the_last_change_time() {
    let dir = tempfile::tempdir().unwrap();
    let (from, to) = (dir.path().join("a.md"), dir.path().join("b.md"));
    fs::write(&from, "x").unwrap();
    let then = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    fs::File::options().write(true).open(&from).unwrap().set_modified(then).unwrap();
    copy_no_replace(&from, &to).unwrap();
    assert_eq!(fs::metadata(&to).unwrap().modified().unwrap(), then);
}
