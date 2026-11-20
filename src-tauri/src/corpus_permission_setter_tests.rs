//! Codex review round 5 of PR #295: now that a permission key denies in any
//! spelling, the person's own setting clears every spelling of its key before
//! it writes Rotli's line. Checked on the file as written, in a Rotli vault and
//! in a folder opened in place.

use super::tests::bare;
use super::*;
use tempfile::TempDir;

/// An Obsidian-shaped folder connected in place, opened as Rotli opens it.
fn opened_in_place(dir: &TempDir) -> CorpusStore {
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Notes")).unwrap();
    fs::create_dir_all(root.join(".obsidian")).unwrap();
    crate::vault_roles::mark_in_place(&root).unwrap();
    let mut store = CorpusStore::open(fs::canonicalize(root).unwrap()).unwrap();
    store.os_trash = false;
    assert!(store.adopted);
    store
}

/// A note with the frontmatter given, written by hand, found by the walk.
fn note(store: &mut CorpusStore, frontmatter: &str) -> String {
    fs::create_dir_all(store.abs("Notes")).unwrap();
    fs::write(store.abs("Notes/plan.md"), format!("---\n{frontmatter}---\n# Plan\n\nWords.\n")).unwrap();
    store.suppress.bump();
    store.list().unwrap();
    "Notes/plan.md".to_string()
}

/// The frontmatter lines on disk that name `key`, in any spelling.
fn naming(store: &CorpusStore, rel: &str, key: &str) -> (Vec<String>, Vec<String>) {
    let text = fs::read_to_string(store.abs(rel)).unwrap();
    let foreign = parse_document(&text).0.unwrap_or_default().foreign;
    let named = foreign.iter().filter(|line| crate::frontmatter_keys::names_key(line, key)).cloned().collect();
    (named, foreign)
}

fn both_kinds() -> Vec<(TempDir, CorpusStore)> {
    let (dir, store) = bare();
    let place = TempDir::new().unwrap();
    let in_place = opened_in_place(&place);
    vec![(dir, store), (place, in_place)]
}

#[test]
fn turning_let_ai_edit_on_clears_every_spelling_of_ai_edit() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\ntags: [plan]\n  ai_edit: false\n\"ai\\u005fedit\": false\n");
        store.set_ai_edit(&rel, true).unwrap();
        let (named, foreign) = naming(&store, &rel, "ai_edit");
        assert_eq!(named, ["ai_edit: true"], "adopted={}: {foreign:?}", store.adopted);
        assert_eq!(crate::ai_edit_policy::body_edit(&foreign), crate::ai_edit_policy::BodyEdit::Allowed, "adopted={}", store.adopted);
        assert!(fs::read_to_string(store.abs(&rel)).unwrap().contains("Words."));
    }
}

#[test]
fn allowing_on_device_ai_clears_every_spelling_of_local_ai_allowed() {
    for (_dir, mut store) in both_kinds() {
        let rel = note(&mut store, "id: 01PLANNOTE\nsecure: true\n  local_ai_allowed: false\n\"local\\u005fai_allowed\": false\n");
        store.set_local_ai_access(&rel, true).unwrap();
        let (named, foreign) = naming(&store, &rel, "local_ai_allowed");
        assert_eq!(named, ["local_ai_allowed: true"], "adopted={}: {foreign:?}", store.adopted);
        assert_eq!(crate::frontmatter_keys::local_ai_allowed(&foreign), Some(true), "adopted={}", store.adopted);
    }
}


/// Claude 2's review of PR #295: in a folder opened in place, a key the
/// person spelled their own way (`locked : false`, `"locked": false`) was
/// kept beside the line Rotli wrote, so the note carried the key twice.
#[test]
fn locking_in_place_replaces_a_lock_line_spelled_another_way() {
    let place = TempDir::new().unwrap();
    let mut store = opened_in_place(&place);
    for spelled in ["locked : false", "\"locked\": false", "'locked': false"] {
        let rel = note(&mut store, &format!("id: obs-plan\ntags: [plan]\n{spelled}\n"));
        store.set_locked(&rel, true).unwrap();
        let foreign = parse_document(&fs::read_to_string(store.abs(&rel)).unwrap()).0.unwrap_or_default().foreign;
        let locks: Vec<&String> = foreign.iter().filter(|line| crate::frontmatter_keys::names_key(line, "locked")).collect();
        assert_eq!(locks, ["locked: true"], "{spelled:?}: {foreign:?}");
        assert_eq!(foreign, ["tags: [plan]", "locked: true"], "{spelled:?}: the line keeps its place");
    }
}

/// A key the line reader doesn't name (a space inside, as Obsidian's
/// `date created`) is still edited and removed in place, once.
#[test]
fn a_key_with_a_space_is_edited_and_removed_in_place() {
    let note = "---\ndate created: 2020-01-01\ntags: [plan]\n---\n# Plan\n";
    let before = parse_document(note).0.unwrap_or_default();
    let edited = Frontmatter { foreign: vec!["date created: 2021-02-02".into(), "tags: [plan]".into()], ..before.clone() };
    assert_eq!(compose_in_place(note, &edited), "---\ndate created: 2021-02-02\ntags: [plan]\n---\n# Plan\n");
    let removed = Frontmatter { foreign: vec!["tags: [plan]".into()], ..before };
    assert_eq!(compose_in_place(note, &removed), "---\ntags: [plan]\n---\n# Plan\n");
}
