use super::*;
use crate::corpus::CorpusStore;
use tempfile::TempDir;

/// A copy with the person's own Archive (nested, with an image beside its
/// note) and Trash, plus a linked item that never moves.
fn copy_with_person_sinks(dir: &TempDir, in_place: bool) -> std::path::PathBuf {
    let root = dir.path().join("Notes (Rotli)");
    fs::create_dir_all(root.join("Archive/2024")).unwrap();
    fs::create_dir_all(root.join("Trash")).unwrap();
    fs::create_dir_all(root.join("Projects")).unwrap();
    fs::write(root.join("Archive/2024/Old Plan.md"), "# Old Plan\n\n![](kiln.png)\n").unwrap();
    fs::write(root.join("Archive/2024/kiln.png"), b"png").unwrap();
    fs::write(root.join("Archive/.DS_Store"), b"finder").unwrap();
    fs::write(root.join("Trash/Gone.md"), "# Gone\n").unwrap();
    fs::write(root.join("Projects/Live.md"), "# Live\n").unwrap();
    if in_place {
        crate::vault_roles::mark_in_place(&root).unwrap();
    } else {
        crate::vault_roles::mark_imported(&root).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

#[test]
fn a_copy_with_its_own_archive_and_trash_is_asked() {
    let dir = TempDir::new().unwrap();
    let root = copy_with_person_sinks(&dir, false);
    let store = CorpusStore::open(root).unwrap();
    assert_eq!(store.person_sinks().unwrap(), Some(PersonSinks { archive: 2, trash: 1 }));
}

#[test]
fn yes_moves_every_file_keeps_names_and_structure_and_stamps_origin() {
    let dir = TempDir::new().unwrap();
    let root = copy_with_person_sinks(&dir, false);
    let mut store = CorpusStore::open(root.clone()).unwrap();
    let moved = store.adopt_person_sinks().unwrap();
    assert_eq!(moved, PersonSinks { archive: 2, trash: 1 });

    let note = fs::read_to_string(root.join("Archive (Rotli)/2024/Old Plan.md")).unwrap();
    assert!(note.contains("origin: Archive/2024"), "{note}");
    assert!(note.ends_with("# Old Plan\n\n![](kiln.png)\n"), "the body is untouched: {note}");
    assert!(root.join("Archive (Rotli)/2024/kiln.png").is_file(), "the image stays beside its note");
    let gone = fs::read_to_string(root.join("Trash (Rotli)/Gone.md")).unwrap();
    assert!(gone.contains("origin: Trash"), "{gone}");
    // the emptied person folders go (a .DS_Store doesn't count as content)
    assert!(!root.join("Archive").exists());
    assert!(!root.join("Trash").exists());
    assert!(root.join("Projects/Live.md").is_file(), "nothing else moves");
    // asked once: nothing is left to ask about
    assert_eq!(store.person_sinks().unwrap(), None);
}

#[test]
fn a_folder_that_still_holds_something_is_kept() {
    let dir = TempDir::new().unwrap();
    let root = copy_with_person_sinks(&dir, false);
    #[cfg(unix)]
    std::os::unix::fs::symlink(root.join("Projects/Live.md"), root.join("Trash/link.md")).unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    store.adopt_person_sinks().unwrap();
    #[cfg(unix)]
    assert!(root.join("Trash").is_dir(), "a linked item never moves, so its folder stays");
    assert!(!root.join("Archive").exists());
}

#[test]
fn never_offered_in_place_or_in_a_rotli_vault() {
    let dir = TempDir::new().unwrap();
    let root = copy_with_person_sinks(&dir, true);
    let mut store = CorpusStore::open(root.clone()).unwrap();
    assert_eq!(store.person_sinks().unwrap(), None);
    assert!(store.adopt_person_sinks().is_err());
    assert!(root.join("Archive/2024/Old Plan.md").is_file(), "nothing moved in place");

    let plain = TempDir::new().unwrap();
    fs::create_dir_all(plain.path().join("Archive")).unwrap();
    fs::write(plain.path().join("Archive/a.md"), "# A\n").unwrap();
    let store = CorpusStore::open(plain.path().to_path_buf()).unwrap();
    assert_eq!(store.person_sinks().unwrap(), None);
}
