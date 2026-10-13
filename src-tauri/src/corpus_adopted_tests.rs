// A folder opened in place (Obsidian, ZenNotes, plain Markdown) is never
// rearranged: secure flags stay in place and the detector writes nothing.

use super::*;
use tempfile::TempDir;

/// A folder opened in place is never rearranged (owner rule 2026-10-13:
/// Rotli is never the cause of note loss). The detector still marks a
/// secret-looking note secure for every reader, but writes nothing to it.
#[test]
fn adopted_folder_detector_flags_a_secret_note_without_touching_it() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Projects")).unwrap();
    let original = "---\nid: 01JADOPTEDSECRETNOTE00000\n---\n# Keys\n\nSSN: 078-05-1120\n";
    fs::write(root.join("Projects/keys.md"), original).unwrap();

    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
    let view = store.read_frontmatter("Projects/keys.md").unwrap();
    assert!(view.secure, "the detector still reports the note as secure");
    assert_eq!(fs::read_to_string(root.join("Projects/keys.md")).unwrap(), original);
    assert!(!root.join(SECURE_NOTES_FOLDER).exists(), "nothing moved into a secure folder");
    assert!(!root.join(".gitignore").exists(), "no file added to the person's folder");
    assert!(store.read_for_ai("Projects/keys.md", false).is_err(), "still never sent remote");
}

#[test]
fn adopted_folder_explicit_secure_stays_in_place_and_fails_closed() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Journal")).unwrap();
    // an Obsidian note: no Rotli id, so nothing to key a move by
    fs::write(root.join("Journal/private.md"), "# Private\n\nPlans.\n").unwrap();

    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
    store.set_secure("Journal/private.md", true).unwrap();
    let text = fs::read_to_string(root.join("Journal/private.md")).unwrap();
    assert!(text.contains("secure: true"), "{text}");
    assert!(!text.contains("secure_origin"), "{text}");
    assert!(!root.join(SECURE_NOTES_FOLDER).exists());
    let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(ignore.lines().any(|l| l.trim() == "Journal/private.md"), "{ignore}");
    assert!(store.read_for_ai("Journal/private.md", false).is_err());

    assert!(!text.contains("id:") && !text.contains("created:"), "no Rotli fields minted: {text}");
    store.set_secure("Journal/private.md", false).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Journal/private.md")).unwrap(),
        "# Private\n\nPlans.\n",
        "unsecuring restores the note byte-for-byte, in place"
    );
    let ignore = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(!ignore.lines().any(|l| l.trim() == "Journal/private.md"), "{ignore}");
    assert!(store.secure_repair_note("Journal/private.md").is_err());

    // Obsidian's own frontmatter survives untouched around the one line
    let obsidian = "---\ntags: [journal]\naliases: [Plans]\n---\n# Plans\n";
    fs::write(root.join("Journal/plans.md"), obsidian).unwrap();
    store.set_secure("Journal/plans.md", true).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Journal/plans.md")).unwrap(),
        "---\ntags: [journal]\naliases: [Plans]\nsecure: true\n---\n# Plans\n"
    );
    store.set_secure("Journal/plans.md", false).unwrap();
    assert_eq!(fs::read_to_string(root.join("Journal/plans.md")).unwrap(), obsidian);
}

#[test]
fn a_rotli_plain_folder_still_moves_a_secure_note_into_its_secure_folder() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("rotli-notes");
    let mut store = CorpusStore::open(root.clone()).unwrap();
    assert!(!store.is_memex());
    let note = store.create("Inbox", "# Card\n\nPlans.\n").unwrap();
    store.set_secure(&note.id, true).unwrap();
    let rel = store.resolve_note_rel(&note.id).unwrap();
    assert!(rel.starts_with(&format!("{SECURE_NOTES_FOLDER}/")), "{rel}");
}
