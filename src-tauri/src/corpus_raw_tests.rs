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
    // a board or image opened from Finder is never moved either
    fs::write(folder.join("plan.excalidraw"), "{\"type\":\"excalidraw\",\"elements\":[]}").unwrap();
    let before = snapshot(&folder);
    let mut board = CorpusStore::open_raw_file(&folder.join("plan.excalidraw"), &cache).unwrap();
    for refused in [
        board.move_note("plan.excalidraw", "Trash").map(|_| ()).unwrap_err(),
        board.rename_board("plan.excalidraw", "Map").map(|_| ()).unwrap_err(),
    ] {
        assert!(refused.contains("Finder"), "{refused}");
    }
    assert_eq!(snapshot(&folder), before);
    assert!(CorpusStore::open_raw_file(&folder.join("photos"), &cache).is_err(), "a folder is not a file mount");
    let mut photo = CorpusStore::open_raw_file(&folder.join("photos/beach.png"), &cache).unwrap();
    assert_eq!(photo.raw_item().unwrap(), ("beach.png".to_string(), "file"));
    assert_eq!(snapshot(&folder), before, "previewing an image writes nothing either");
}

/// Stage 2: a folder opened from Finder gets its whole tree in its own window,
/// under the same rules — its listing routes back to it alone, edits land in
/// place, and nothing is added, moved, or sent to a cloud model.
#[test]
fn a_folder_opened_from_finder_lists_its_tree_and_changes_only_by_the_edit() {
    let (temp, folder, cache) = downloads();
    fs::create_dir_all(folder.join(".rotli")).unwrap();
    fs::write(folder.join(".rotli/settings.json"), "{\"theirs\":true}").unwrap();
    fs::write(folder.join("photos/caption.md"), "# Caption\n\nSunset at the pier.\n").unwrap();
    let before = snapshot(&folder);

    let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.into());
    registry.insert(DEFAULT_ROOT_ID.into(), CorpusStore::open(temp.path().join("vault")).unwrap()).unwrap();
    let state = CorpusState(std::sync::Mutex::new(registry));
    let root = raw_root_id(&fs::canonicalize(&folder).unwrap());
    state.insert_root(root.clone(), CorpusStore::open_raw_folder(&folder, &cache).unwrap()).unwrap();

    let list = list_raw_folder(&state, &root).unwrap();
    assert!(list.folders.iter().any(|f| f.id == format!("{root}:photos")), "{:?}", list.folders);
    let titles: Vec<&str> = list.notes.iter().map(|n| n.title.as_str()).collect();
    assert!(titles.contains(&"Caption") && titles.contains(&"Trip notes"), "{titles:?}");
    for note in &list.notes {
        assert!(note.id.starts_with(&format!("{root}:")), "{} routes back to the mount", note.id);
    }
    let caption = list.notes.iter().find(|n| n.title == "Caption").unwrap();
    let (at, rel) = split_root_id(&caption.id);
    assert_eq!(state.route(&at, |s| s.read(&rel)).unwrap().body, "# Caption\n\nSunset at the pier.\n");
    assert!(state.route(&at, |s| s.read_for_ai(&rel, false)).is_err(), "never sent to a cloud model");
    state.route(&at, |s| s.write(&rel, "# Caption\n\nSunset at the pier, 7pm.\n").map(|_| ())).unwrap();

    let mut after = snapshot(&folder);
    assert_eq!(
        after.remove("photos/caption.md").as_deref(),
        Some(&b"# Caption\n\nSunset at the pier, 7pm.\n"[..])
    );
    let mut was = before.clone();
    was.remove("photos/caption.md");
    assert_eq!(after, was, "nothing else changed, the folder's own .rotli/ included");

    assert!(list_raw_folder(&state, DEFAULT_ROOT_ID).is_err(), "never a way to list a vault");
    assert_eq!(state.root_id_for_path(&folder).unwrap(), None, "never a vault route");
    state.unmount_raw(&root).unwrap();
    state.unmount_raw(DEFAULT_ROOT_ID).unwrap();
    assert!(!state.contains_root(&root).unwrap());
    assert!(state.contains_root(DEFAULT_ROOT_ID).unwrap(), "unmounting never drops a vault");
}

#[test]
fn a_folder_opened_from_finder_is_never_added_to() {
    let (temp, folder, cache) = downloads();
    let before = snapshot(&folder);
    let mut store = CorpusStore::open_raw_folder(&folder, &cache).unwrap();
    let outside = temp.path().join("elsewhere.png");
    fs::write(&outside, b"png").unwrap();
    for refused in [
        store.create("photos", "# New\n").map(|_| ()).unwrap_err(),
        store.create_folder("New folder", None).map(|_| ()).unwrap_err(),
        store.create_canvas("photos", "Plan").map(|_| ()).unwrap_err(),
        store.create_image_asset("shot.png", b"png").map(|_| ()).unwrap_err(),
        store.import_file(&outside).map(|_| ()).unwrap_err(),
        store.move_note("photos/beach.png", "Archive").map(|_| ()).unwrap_err(),
        store.move_file_to_sink("photos/beach.png", "Trash").map(|_| ()).unwrap_err(),
        store.rename_managed_file("photos/beach.png", "shore.png").map(|_| ()).unwrap_err(),
    ] {
        assert!(refused.contains("A folder opened from Finder"), "{refused}");
    }
    assert_eq!(snapshot(&folder), before);
    assert!(CorpusStore::open_raw_folder(&folder.join("Trip notes.md"), &cache).is_err(), "a file is not a folder mount");
    assert!(CorpusStore::open_raw_folder(Path::new("/"), &cache).is_err(), "never the whole disk");
}
