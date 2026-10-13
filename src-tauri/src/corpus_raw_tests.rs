use std::collections::BTreeMap;

use super::*;
use tempfile::TempDir;

/// Every file under `dir` with its bytes — the folder's whole visible state.
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(at) = stack.pop() {
        for entry in fs::read_dir(&at).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                let rel = path.strip_prefix(dir).unwrap().to_string_lossy().into_owned();
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    out
}

fn downloads() -> (TempDir, PathBuf, PathBuf) {
    let temp = TempDir::new().unwrap();
    let folder = temp.path().join("Downloads");
    fs::create_dir_all(folder.join("photos")).unwrap();
    fs::write(folder.join("Trip notes.md"), "---\ntags: [travel]\n---\n# Trip notes\n\nPack light.\n").unwrap();
    fs::write(folder.join("passwords.md"), "# Passwords\n\nSSN: 078-05-1120\n").unwrap();
    fs::write(folder.join("photos/beach.png"), b"png").unwrap();
    let cache = temp.path().join("rotli-cache");
    (temp, folder, cache)
}

/// Owner decision 2026-10-13: a file opened from Finder is edited in place
/// and nothing else in its folder changes — no `.rotli/`, no stamps, no
/// renames, and its siblings are never seen.
#[test]
fn a_file_opened_from_finder_changes_only_by_the_edit_and_sees_no_siblings() {
    let (_temp, folder, cache) = downloads();
    let before = snapshot(&folder);
    let mut store = CorpusStore::open_raw_file(&folder.join("Trip notes.md"), &cache).unwrap();
    assert_eq!(store.raw_file(), Some("Trip notes.md"));

    let list = store.list().unwrap();
    assert_eq!(list.notes.len(), 1, "only the opened file is seen");
    assert!(list.folders.is_empty(), "no sibling folders are walked");
    let id = list.notes[0].id.clone();
    assert_eq!(store.path_of(&id).unwrap(), "Trip notes.md");
    assert_eq!(store.raw_item().unwrap(), (id.clone(), "note"), "the tab opens the note by its id");
    assert!(store.search("Pack", 10, true).unwrap().iter().all(|hit| hit.id == id));
    assert!(store.search("078-05-1120", 10, true).unwrap().is_empty(), "a sibling's text is never searched");
    store.read_for_ai(&id, true).unwrap();
    assert!(store.read_for_ai(&id, false).is_err(), "no cloud model reads a file opened from Finder");
    for sibling in ["passwords.md", "photos/beach.png", "photos", ""] {
        assert!(store.guard_rel(sibling).is_err(), "{sibling:?} is never reachable");
        assert!(store.read(sibling).is_err(), "{sibling:?} is never read");
        assert!(store.file_stat(sibling).is_err(), "{sibling:?} is never stat'd");
    }
    assert!(store.write("passwords.md", "# Gone\n").is_err(), "a sibling is never written");
    assert!(store.read_for_ai("passwords.md", true).is_err());
    assert_eq!(snapshot(&folder), before, "reading changes nothing");

    store.write(&id, "# Trip notes\n\nPack light. Bring a hat.\n").unwrap();
    store.set_locked(&id, true).unwrap();
    store.set_locked(&id, false).unwrap();
    let after = snapshot(&folder);
    assert_eq!(
        after.get("Trip notes.md").map(Vec::as_slice),
        Some(&b"---\ntags: [travel]\n---\n# Trip notes\n\nPack light. Bring a hat.\n"[..]),
        "the edit lands in place, frontmatter bytes kept, no Rotli fields"
    );
    let mut rest = after.clone();
    rest.remove("Trip notes.md");
    let mut was = before.clone();
    was.remove("Trip notes.md");
    assert_eq!(rest, was, "nothing else in the folder changed");
    assert!(!folder.join(DOT_DIR).exists(), "no .rotli/ in the person's folder");
    assert!(raw_root_id(&folder).starts_with("finder_") && !raw_root_id(&folder).contains(':'));
    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.into());
    registry.insert(DEFAULT_ROOT_ID.into(), CorpusStore::open(folder.with_file_name("vault")).unwrap()).unwrap();
    let state = CorpusState(std::sync::Mutex::new(registry));
    state.insert_root(raw_root_id(&folder), store).unwrap();
    assert_eq!(state.root_id_for_path(&folder).unwrap(), None, "the file's folder is never a vault route");
    assert!(state.suppress_set_for_root(&folder).is_err());
    assert!(cache.join(raw_root_id(&fs::canonicalize(folder.join("Trip notes.md")).unwrap())).exists());
}

#[test]
fn a_file_opened_from_finder_is_never_moved_secured_or_given_neighbours() {
    let (_temp, folder, cache) = downloads();
    let before = snapshot(&folder);
    let mut store = CorpusStore::open_raw_file(&folder.join("Trip notes.md"), &cache).unwrap();
    let id = store.list().unwrap().notes[0].id.clone();
    for refused in [
        store.delete(&id).unwrap_err(),
        store.move_note(&id, "Archive").map(|_| ()).unwrap_err(),
        store.set_secure(&id, true).unwrap_err(),
        store.create("", "# Beside it\n").map(|_| ()).unwrap_err(),
    ] {
        assert!(refused.contains("Finder"), "{refused}");
    }
    assert_eq!(snapshot(&folder), before);
    assert!(CorpusStore::open_raw_file(&folder.join("photos"), &cache).is_err(), "a folder is not a file mount");
    let mut photo = CorpusStore::open_raw_file(&folder.join("photos/beach.png"), &cache).unwrap();
    assert_eq!(photo.raw_item().unwrap(), ("beach.png".to_string(), "file"));
    assert_eq!(snapshot(&folder), before, "previewing an image writes nothing either");
}
