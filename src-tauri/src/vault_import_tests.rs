use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use super::*;
use tempfile::TempDir;

/// Every file under `dir` with its bytes, `.rotli/` included.
fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(at) = stack.pop() {
        for entry in fs::read_dir(&at).unwrap().flatten() {
            let path = entry.path();
            if entry.file_type().unwrap().is_symlink() {
                out.insert(path.strip_prefix(dir).unwrap().display().to_string(), b"<link>".to_vec());
            } else if path.is_dir() {
                stack.push(path);
            } else {
                out.insert(path.strip_prefix(dir).unwrap().display().to_string(), fs::read(&path).unwrap());
            }
        }
    }
    out
}

/// An Obsidian vault with everything a person would miss, plus what the copy
/// leaves out: old Rotli state, history, dependencies, and a linked note.
fn obsidian(temp: &TempDir) -> PathBuf {
    let source = temp.path().join("Garden");
    fs::create_dir_all(source.join("Areas/Deeper")).unwrap();
    fs::create_dir_all(source.join(".obsidian")).unwrap();
    fs::create_dir_all(source.join(".trash")).unwrap();
    fs::create_dir_all(source.join(".rotli")).unwrap();
    fs::create_dir_all(source.join(".git/objects")).unwrap();
    fs::create_dir_all(source.join("Areas/node_modules/pkg")).unwrap();
    fs::write(source.join("Areas/Deeper/roadmap.md"), "# Roadmap\n\n[[Ideas]]\n").unwrap();
    fs::write(source.join("Ideas.md"), "---\ntags: [x]\n---\n# Ideas\n").unwrap();
    fs::write(source.join("map.canvas"), "{\"nodes\":[]}").unwrap();
    fs::write(source.join("sketch.excalidraw"), "{\"elements\":[]}").unwrap();
    fs::write(source.join(".obsidian/workspace.json"), "{}").unwrap();
    fs::write(source.join(".trash/old.md"), "# Old\n").unwrap();
    fs::write(source.join(".rotli/main.json"), "old rotli state").unwrap();
    fs::write(source.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(source.join("Areas/node_modules/pkg/index.md"), "# Package\n").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(temp.path().join("elsewhere.md"), source.join("Linked.md")).unwrap();
    fs::canonicalize(source).unwrap()
}

fn copy_all(source: &Path, destination: &Path) -> CopyPlan {
    let plan = plan(source).unwrap();
    check_destination(source, destination).unwrap();
    copy(source, destination, &plan, &AtomicBool::new(false), |_, _| {}).unwrap();
    plan
}

#[test]
fn the_copy_keeps_what_a_person_would_miss_verifies_and_never_touches_the_source() {
    let temp = TempDir::new().unwrap();
    let source = obsidian(&temp);
    let before = tree(&source);
    let destination = temp.path().join("Garden (Rotli)");
    fs::create_dir_all(&destination).unwrap();
    let destination = fs::canonicalize(destination).unwrap();

    let plan = copy_all(&source, &destination);
    assert!(verify(&source, &destination, &plan).is_empty());
    for kept in ["Areas/Deeper/roadmap.md", "Ideas.md", "map.canvas", "sketch.excalidraw", ".obsidian/workspace.json", ".trash/old.md"] {
        assert_eq!(fs::read(destination.join(kept)).unwrap(), fs::read(source.join(kept)).unwrap(), "{kept}");
    }
    for left in [".rotli", ".git", "Areas/node_modules", "Linked.md"] {
        assert!(!destination.join(left).exists(), "{left} is not copied");
    }
    #[cfg(unix)]
    assert_eq!(plan.skipped_links, vec!["Linked.md".to_string()], "a linked note is named, never silent");

    let record = record(&source, &destination, &plan).unwrap();
    assert_eq!((record.files, record.markdown), (6, 3));
    let json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(destination.join(".rotli/import.json")).unwrap()).unwrap();
    assert_eq!(json["source"], source.display().to_string());
    assert_eq!(json["files"], 6);
    assert!(json["copiedAt"].as_str().is_some_and(|at| at.contains('T')));

    // opening the copy (as activation does) keeps the record
    let mut store = corpus::CorpusStore::open_adopted(destination.clone()).unwrap();
    store.seed_main_from_disk_if_missing().unwrap();
    store.list().unwrap();
    assert!(destination.join(".rotli/import.json").is_file(), "import.json survives opening the copy");

    assert_eq!(tree(&source), before, "the source is byte-identical, .rotli/ and all");
}

#[test]
fn a_copy_that_differs_is_reported_and_left_as_it_is() {
    let temp = TempDir::new().unwrap();
    let source = obsidian(&temp);
    let destination = temp.path().join("copy");
    fs::create_dir_all(&destination).unwrap();
    let destination = fs::canonicalize(destination).unwrap();
    let plan = copy_all(&source, &destination);
    fs::write(destination.join("Ideas.md"), "---\ntags: [x]\n---\n# IDEAS\n").unwrap();
    fs::remove_file(destination.join("map.canvas")).unwrap();
    fs::write(destination.join("stray.md"), "# Stray\n").unwrap();
    let problems = verify(&source, &destination, &plan);
    assert!(problems.contains(&"different content: Ideas.md".to_string()), "{problems:?}");
    assert!(problems.contains(&"missing: map.canvas".to_string()), "{problems:?}");
    assert!(problems.contains(&"unexpected: stray.md".to_string()), "{problems:?}");
    assert!(destination.join("stray.md").exists(), "verification changes nothing");
}

#[test]
fn cancel_stops_between_files_and_cleans_up_only_what_the_copy_made() {
    let temp = TempDir::new().unwrap();
    let source = obsidian(&temp);
    let before = tree(&source);
    let plan = plan(&source).unwrap();

    // a folder Rotli created goes whole
    let made = temp.path().join("Garden (Rotli)");
    fs::create_dir_all(&made).unwrap();
    let cancel = AtomicBool::new(false);
    let err = copy(&source, &made, &plan, &cancel, |files, _| {
        if files == 2 {
            cancel.store(true, Ordering::SeqCst);
        }
    })
    .unwrap_err();
    assert_eq!(err, CANCELLED);
    clean_up(&made, true);
    assert!(!made.exists());

    // a folder the person picked keeps itself (and its .DS_Store)
    let picked = temp.path().join("Picked");
    fs::create_dir_all(&picked).unwrap();
    fs::write(picked.join(".DS_Store"), b"finder").unwrap();
    let cancel = AtomicBool::new(false);
    let _ = copy(&source, &picked, &plan, &cancel, |files, _| {
        if files == 3 {
            cancel.store(true, Ordering::SeqCst);
        }
    });
    clean_up(&picked, false);
    assert_eq!(tree(&picked).into_keys().collect::<Vec<_>>(), vec![".DS_Store".to_string()]);
    assert_eq!(tree(&source), before, "cancel never touches the source");
}

#[test]
fn the_destination_is_separate_empty_and_named_beside_the_vaults() {
    let temp = TempDir::new().unwrap();
    let source = obsidian(&temp);
    assert!(check_destination(&source, &source).is_err());
    let inside = source.join("Areas");
    assert!(check_destination(&source, &inside).is_err(), "never inside the source");
    assert!(check_destination(&source, temp.path()).is_err(), "never around it");
    let busy = temp.path().join("busy");
    fs::create_dir_all(&busy).unwrap();
    fs::write(busy.join("keep.md"), "# Keep\n").unwrap();
    assert!(check_destination(&source, &busy).unwrap_err().contains("empty folder"));
    assert_eq!(fs::read_to_string(busy.join("keep.md")).unwrap(), "# Keep\n");

    let parent = temp.path().join("Vaults");
    fs::create_dir_all(parent.join("Garden (Rotli)")).unwrap();
    fs::create_dir_all(parent.join("Garden (Rotli) 2")).unwrap();
    assert_eq!(default_destination(&parent, &source), parent.join("Garden (Rotli) 3"));
}

/// A copy of a folder connected in place copies its marker too: the copy gets
/// a fresh id (never the original's), loses `inPlace`, keeps the role map, and
/// has its Librarian seeded on at Suggest. A copied Rotli vault stays itself.
#[test]
fn a_copy_of_a_folder_connected_in_place_is_its_own_vault_with_the_librarian() {
    let temp = TempDir::new().unwrap();
    let source = obsidian(&temp);
    crate::vault_roles::mark_in_place(&source).unwrap();
    let read_marker = |root: &Path| -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(root.join("memex.json")).unwrap()).unwrap()
    };
    let original = read_marker(&source);
    let copy = temp.path().join("Garden (Rotli)");
    fs::create_dir_all(&copy).unwrap();
    copy_all(&source, &copy);
    assert!(crate::vault_roles::in_place(&copy), "the copied marker still says in place");

    assert_eq!(make_vault(&copy, None).unwrap(), Marked::Imported);
    let marker = read_marker(&copy);
    assert_ne!(marker["id"], original["id"], "a fresh id");
    assert!(marker.get("inPlace").is_none());
    assert_eq!(marker["folders"], original["folders"], "the same role map");
    assert!(!crate::vault_roles::in_place(&copy));
    assert_eq!(read_marker(&source), original, "the original is untouched");
    let settings = fs::read_to_string(copy.join(".rotli/settings.json")).unwrap();
    assert!(settings.contains("\"brainEnabled\": true") && settings.contains("suggest"), "{settings}");

    // a copied Rotli vault (a copy's copy) keeps its marker byte-for-byte
    let again = temp.path().join("Garden (Rotli) 2");
    fs::create_dir_all(&again).unwrap();
    fs::write(again.join("memex.json"), fs::read(copy.join("memex.json")).unwrap()).unwrap();
    assert_eq!(make_vault(&again, None).unwrap(), Marked::AlreadyRotli);
}
