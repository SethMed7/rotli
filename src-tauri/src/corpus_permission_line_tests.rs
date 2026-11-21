// The permission line rules at store level (frontmatter_lines.rs): a lock or
// secure flag in any spelling holds for the AI lanes, a lone CR can't hide
// one behind a typed key, and the person's off-switches either turn the flag
// off or refuse, never report success while the note stays protected.

use super::*;
use tempfile::TempDir;

fn folder_with(notes: &[(&str, &str)]) -> (TempDir, PathBuf, CorpusStore) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Notes")).unwrap();
    for (rel, text) in notes {
        fs::write(root.join(rel), text).unwrap();
    }
    let store = CorpusStore::open_adopted(root.clone()).unwrap();
    (dir, root, store)
}

#[test]
fn a_flag_in_any_spelling_holds_for_the_ai_lanes() {
    let notes = [
        ("Notes/quoted.md", "---\n\"secure\": true\n---\n# Quoted\n\nPlans.\n"),
        ("Notes/yes.md", "---\nsecure: yes\n---\n# Yes\n\nPlans.\n"),
        ("Notes/flow.md", "---\nmeta: {secure: true}\n---\n# Flow\n\nPlans.\n"),
        ("Notes/cr.md", "---\nx: 1\rsecure: true\n---\n# Lone CR\n\nPlans.\n"),
        ("Notes/typed.md", "---\npinned: false\rsecure: true\n---\n# Typed\n\nPlans.\n"),
    ];
    let (_dir, _root, mut store) = folder_with(&notes);
    for (rel, _) in notes {
        assert!(store.read_frontmatter(rel).unwrap().secure, "{rel} reads secure");
        assert!(store.read_for_ai(rel, false).is_err(), "{rel} never goes to a remote model");
    }
}

#[test]
fn a_typed_key_on_a_broken_line_stays_foreign() {
    let (fm, _) = parse_document("---\npinned: false\rsecure: true\nid: 01J\u{2028}locked: true\n---\nbody\n");
    let fm = fm.unwrap();
    assert_eq!((fm.pinned, fm.id.as_deref()), (None, None));
    assert!(fm.foreign.iter().any(|line| secure_field(line) == Some(true)));
    assert!(fm.foreign.iter().any(|line| locked_field(line) == Some(true)));
}

#[test]
fn unlock_clears_every_block_spelling_in_a_rotli_vault() {
    let dir = TempDir::new().unwrap();
    let mut store = CorpusStore::open(dir.path().join("rotli-notes")).unwrap();
    let note = store.create("Inbox", "# Card\n\nPlans.\n").unwrap();
    let rel = store.resolve_note_rel(&note.id).unwrap();
    let path = store.abs(&rel);
    let text = fs::read_to_string(&path).unwrap().replacen("---\n", "---\n\"locked\": true\n- locked: yes\n  locked: on\n", 1);
    fs::write(&path, text).unwrap();
    assert!(store.read_frontmatter(&note.id).unwrap().locked);
    store.set_locked(&note.id, false).unwrap();
    assert!(!store.read_frontmatter(&note.id).unwrap().locked, "{}", fs::read_to_string(&path).unwrap());
}

/// In a folder opened in place Rotli changes only lines in its own spelling,
/// so Unlock refuses a lock typed any other way instead of claiming success.
#[test]
fn unlock_refuses_a_spelling_it_cannot_reach() {
    let (_dir, root, mut store) = folder_with(&[
        ("Notes/quoted.md", "---\n\"locked\": true\n---\n# Quoted\n"),
        ("Notes/flow.md", "---\nmeta: {locked: true, mood: calm}\n---\n# Flow\n"),
    ]);
    for rel in ["Notes/quoted.md", "Notes/flow.md"] {
        let id = crate::corpus::adopted_tests::adopted_id(&mut store, rel);
        let before = fs::read_to_string(root.join(rel)).unwrap();
        let refused = store.set_locked(&id, false).unwrap_err();
        assert!(refused.contains("still turns locked on"), "{refused}");
        assert_eq!(fs::read_to_string(root.join(rel)).unwrap(), before, "nothing written to {rel}");
        assert!(store.read_frontmatter(rel).unwrap().locked);
    }
}

#[test]
fn removing_secure_refuses_a_spelling_it_cannot_reach_before_anything_moves() {
    let dir = TempDir::new().unwrap();
    let mut store = CorpusStore::open(dir.path().join("rotli-notes")).unwrap();
    let note = store.create("Inbox", "# Card\n\nPlans.\n").unwrap();
    store.set_secure(&note.id, true).unwrap();
    let rel = store.resolve_note_rel(&note.id).unwrap();
    let path = store.abs(&rel);
    let text = fs::read_to_string(&path).unwrap().replacen("---\n", "---\ntags: [a, {secure: true}]\n", 1);
    fs::write(&path, &text).unwrap();

    let refused = store.set_secure(&note.id, false).unwrap_err();
    assert!(refused.contains("still turns secure on"), "{refused}");
    assert_eq!(store.resolve_note_rel(&note.id).unwrap(), rel, "the note stayed in its secure folder");
    assert_eq!(fs::read_to_string(&path).unwrap(), text);

    let (_adopted, root, mut adopted) = folder_with(&[("Notes/quoted.md", "---\n\"secure\": true\n---\n# Quoted\n")]);
    let refused = adopted.set_secure("Notes/quoted.md", false).unwrap_err();
    assert!(refused.contains("still turns secure on"), "{refused}");
    assert!(adopted.read_frontmatter("Notes/quoted.md").unwrap().secure);
    assert!(fs::read_to_string(root.join("Notes/quoted.md")).unwrap().contains("\"secure\": true"));
}
