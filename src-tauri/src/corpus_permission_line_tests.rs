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
        ("Notes/anchor.md", "---\ntitle: x\n&a secure: true\n---\n# Anchor\n\nPlans.\n"),
        ("Notes/pinned.md", "---\npinned: {secure: true}\n---\n# Pinned flow\n\nPlans.\n"),
    ];
    let (_dir, _root, mut store) = folder_with(&notes);
    for (rel, _) in notes {
        assert!(store.read_frontmatter(rel).unwrap().secure, "{rel} reads secure");
        assert!(store.read_for_ai(rel, false).is_err(), "{rel} never goes to a remote model");
    }
}

/// Block-scalar prose is text (as YAML reads it), and `false`, `no` or `off`
/// in any case, quoted or with a comment, says off.
#[test]
fn prose_and_plain_offs_leave_a_note_open() {
    let notes = [
        ("Notes/howto.md", "---\ndescription: |\n  How to lock:\n  locked: true\n  secure: yes\n---\n# How to\n\nSteps.\n"),
        ("Notes/no.md", "---\nsecure: no\nlocked: False # was on\n---\n# No\n\nSteps.\n"),
        ("Notes/quoted.md", "---\nsecure: 'false'\n---\n# Quoted\n\nSteps.\n"),
    ];
    let (_dir, _root, mut store) = folder_with(&notes);
    for (rel, _) in notes {
        let view = store.read_frontmatter(rel).unwrap();
        assert!(!view.secure && !view.locked, "{rel}");
        assert!(store.read_for_ai(rel, false).is_ok(), "{rel} is an ordinary note");
    }
}

/// The note parse keeps a typed line foreign when taking it out would glue a
/// deeper line into the block scalar above it; an ordinary one stays typed.
#[test]
fn a_typed_line_that_ends_a_block_before_a_deeper_line_stays_foreign() {
    let glued = parse_document("---\ndescription: |\n  Line one\nid: 01JABC\n  secure: yes\n---\n").0.unwrap();
    assert_eq!(glued.id, None);
    assert!(secure_on(&glued.foreign));
    let ordinary = parse_document("---\ndescription: |\n  Line one\ncreated: 2024-01-01\ntitle: x\n---\n").0.unwrap();
    assert_eq!(ordinary.created.as_deref(), Some("2024-01-01"));
}

#[test]
fn a_typed_key_on_a_broken_line_stays_foreign() {
    let (fm, _) = parse_document("---\npinned: false\rsecure: true\nid: 01J\u{2028}locked: true\ncreated: {ai_edit: false}\n---\nbody\n");
    let fm = fm.unwrap();
    assert_eq!((fm.pinned, fm.id.as_deref(), fm.created.as_deref()), (None, None, None));
    assert_eq!(crate::ai_edit_policy::body_edit(&fm.foreign), crate::ai_edit_policy::BodyEdit::Locked);
    assert!(secure_on(&fm.foreign));
    assert!(locked_on(&fm.foreign));
}

/// In a Rotli vault Unlock removes top-level single-line spellings, and
/// refuses the rest rather than leave frontmatter YAML can't read.
#[test]
fn unlock_in_a_rotli_vault_clears_top_level_lines_and_refuses_the_rest() {
    let dir = TempDir::new().unwrap();
    let mut store = CorpusStore::open(dir.path().join("rotli-notes")).unwrap();
    fn note_with(store: &mut CorpusStore, lines: &str) -> (String, PathBuf, String) {
        let note = store.create("Inbox", "# Card\n\nPlans.\n").unwrap();
        let rel = store.resolve_note_rel(&note.id).unwrap();
        let path = store.abs(&rel);
        let text = fs::read_to_string(&path).unwrap().replacen("---\n", &format!("---\n{lines}"), 1);
        fs::write(&path, &text).unwrap();
        (note.id, path, text)
    }
    let (open, path, _) = note_with(&mut store, "\"locked\": true\nlocked : on\n'locked': yes\n");
    store.set_locked(&open, false).unwrap();
    assert!(!store.read_frontmatter(&open).unwrap().locked, "{}", fs::read_to_string(&path).unwrap());

    for lines in ["? locked\n: true\n", "resources:\n  - locked: true\n    src: a.png\n  - src: b.png\n", "locked: |\n  true\n"] {
        let (id, path, text) = note_with(&mut store, lines);
        let refused = store.set_locked(&id, false).unwrap_err();
        assert!(refused.contains("still turns locked on"), "{lines:?}: {refused}");
        assert_eq!(fs::read_to_string(&path).unwrap(), text, "nothing written for {lines:?}");
    }
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
    let original = fs::read_to_string(&path).unwrap();
    for lines in ["tags: [a, {secure: true}]\n", "? secure\n: true\n"] {
        let text = original.replacen("---\n", &format!("---\n{lines}"), 1);
        fs::write(&path, &text).unwrap();
        let refused = store.set_secure(&note.id, false).unwrap_err();
        assert!(refused.contains("still turns secure on"), "{lines:?}: {refused}");
        assert_eq!(store.resolve_note_rel(&note.id).unwrap(), rel, "the note stayed in its secure folder");
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }

    let (_adopted, root, mut adopted) = folder_with(&[("Notes/quoted.md", "---\n\"secure\": true\n---\n# Quoted\n")]);
    let refused = adopted.set_secure("Notes/quoted.md", false).unwrap_err();
    assert!(refused.contains("still turns secure on"), "{refused}");
    assert!(adopted.read_frontmatter("Notes/quoted.md").unwrap().secure);
    assert!(fs::read_to_string(root.join("Notes/quoted.md")).unwrap().contains("\"secure\": true"));
}
