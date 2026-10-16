// The Librarian never organizes a folder that is not a Rotli vault.

use super::*;
use std::fs;
use std::sync::atomic::AtomicUsize;
use tempfile::TempDir;

/// A folder opened in place is never organized, even when it happens to
/// hold a `wiki/` folder: nothing is modeled, so no note leaves for the
/// organizer's model, and nothing is written (owner rule 2026-10-13).
#[test]
fn an_adopted_folder_is_never_modeled_even_with_a_wiki_folder() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("wiki")).unwrap();
    let note = "# Trip\n\nPacking list.\n";
    fs::write(root.join("wiki/trip.md"), note).unwrap();
    let store = corpus::CorpusStore::open_adopted(root).unwrap();
    let root = store.root().to_path_buf();
    let mut reg = corpus::CorpusRegistry::new("default".to_string());
    reg.insert("default".to_string(), store).unwrap();
    let state = CorpusState(Mutex::new(reg));
    let handle = OrganizerHandle::new();

    handle.enqueue(&root, &[root.join("wiki/trip.md")]);
    let calls = AtomicUsize::new(0);
    let transport = |_: &str| {
        calls.fetch_add(1, Ordering::SeqCst);
        Ok("{\"area\":\"Projects\",\"confidence\":0.99}".to_string())
    };
    let report =
        run_cycle(&state, "default", &root, &handle.0, &|| true, &transport).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0, "an adopted folder never reaches the model");
    assert_eq!(report.proposals, 0);
    assert!(handle.0.queue.lock().unwrap().is_empty(), "the queue drains");
    assert_eq!(fs::read_to_string(root.join("wiki/trip.md")).unwrap(), note);
}
