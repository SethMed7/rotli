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

fn adopted_id(store: &mut CorpusStore, rel: &str) -> String {
    let list = store.list().unwrap();
    list.notes
        .iter()
        .find(|n| store.path_of(&n.id).ok().as_deref() == Some(rel))
        .map(|n| n.id.clone())
        .unwrap_or_else(|| panic!("no note at {rel}"))
}

/// Decision B (owner, 2026-10-13): editing a note in a folder opened in place
/// changes only the words the person changed. No rename to a title slug (it
/// would break Obsidian's `[[My Note]]` links) and no Rotli frontmatter.
#[test]
fn adopted_folder_save_keeps_the_file_name_and_adds_no_frontmatter() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Projects")).unwrap();
    fs::write(root.join("Projects/My Note.md"), "# My Note\n\nOld body.\n").unwrap();
    fs::write(root.join("Projects/Trip.md"), "---\ntags: [travel]\n---\n# Trip\n\nOld.\n").unwrap();

    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
    let plain = adopted_id(&mut store, "Projects/My Note.md");
    store.write(&plain, "# My Note\n\nNew body.\n").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Projects/My Note.md")).unwrap(),
        "# My Note\n\nNew body.\n"
    );
    assert!(!root.join("Projects/my-note.md").exists(), "never renamed to a slug");

    // a changed title still keeps the person's file name in place
    store.write(&plain, "# Renamed\n\nNew body.\n").unwrap();
    assert!(root.join("Projects/My Note.md").is_file());
    assert_eq!(store.path_of(&plain).unwrap(), "Projects/My Note.md");

    let fenced = adopted_id(&mut store, "Projects/Trip.md");
    store.write(&fenced, "# Trip\n\nNew.\n").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Projects/Trip.md")).unwrap(),
        "---\ntags: [travel]\n---\n# Trip\n\nNew.\n"
    );
}

/// Decision B for every metadata control: lock, pin, a custom field, and the AI
/// edit grant each add or change one line and undo back to the exact bytes.
#[test]
fn adopted_folder_metadata_controls_change_one_line_and_undo_exactly() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Reading")).unwrap();
    let fenced = "---\ntags: [books]\nrating: 4\n---\n# Dune\n\nSand.\n";
    let bare = "# Notes\n\nPlain.\n";
    fs::write(root.join("Reading/Dune.md"), fenced).unwrap();
    fs::write(root.join("Reading/Notes.md"), bare).unwrap();
    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();

    for (rel, original) in [("Reading/Dune.md", fenced), ("Reading/Notes.md", bare)] {
        let id = adopted_id(&mut store, rel);
        let read = || fs::read_to_string(root.join(rel)).unwrap();

        store.set_locked(&id, true).unwrap();
        assert!(read().contains("locked: true") && !read().contains("id:"), "{}", read());
        store.set_locked(&id, false).unwrap();
        assert_eq!(read(), original);

        store.set_pinned(&id, true).unwrap();
        assert!(read().contains("pinned: true") && !read().contains("created:"), "{}", read());
        store.set_pinned(&id, false).unwrap();
        assert_eq!(read(), original);

        store.set_field(&id, "topic", "sci-fi").unwrap();
        assert!(read().contains("topic: sci-fi"), "{}", read());
        store.set_field(&id, "topic", "").unwrap();
        assert_eq!(read(), original);

        store.set_ai_edit(&id, false).unwrap();
        assert!(read().contains("ai_edit: false") && !read().contains("updated:"), "{}", read());
    }
    // an existing key keeps its place when its value changes
    let id = adopted_id(&mut store, "Reading/Dune.md");
    store.set_field(&id, "rating", "5").unwrap();
    assert!(fs::read_to_string(root.join("Reading/Dune.md"))
        .unwrap()
        .starts_with("---\ntags: [books]\nrating: 5\n"));
}

/// A move keeps the person's file name and bytes; Trash and Restore add and
/// remove only the `origin` breadcrumb, so the note comes back exactly.
#[test]
fn adopted_folder_move_trash_and_restore_keep_name_and_bytes() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Inbox Notes")).unwrap();
    fs::create_dir_all(root.join("Projects")).unwrap();
    let original = "# My Plan\n\nSteps.\n";
    fs::write(root.join("Inbox Notes/My Plan.md"), original).unwrap();
    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
    let id = adopted_id(&mut store, "Inbox Notes/My Plan.md");

    store.move_note(&id, "Projects").unwrap();
    assert_eq!(fs::read_to_string(root.join("Projects/My Plan.md")).unwrap(), original);

    store.delete(&id).unwrap();
    let trashed = fs::read_to_string(root.join("Trash/My Plan.md")).unwrap();
    assert_eq!(trashed, "---\norigin: Projects\n---\n# My Plan\n\nSteps.\n");

    store.move_note(&id, "Projects").unwrap();
    assert_eq!(fs::read_to_string(root.join("Projects/My Plan.md")).unwrap(), original);
}

/// A note Rotli itself makes in a folder opened in place is Rotli's: its file
/// follows its title, as everywhere else. Only the person's notes stay put.
#[test]
fn a_note_rotli_makes_in_an_adopted_folder_still_follows_its_title() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("obsidian-vault");
    fs::create_dir_all(root.join("Projects")).unwrap();
    // an Obsidian zettel id is not a ULID: still the person's note
    fs::write(root.join("Projects/Idea.md"), "---\nid: 202310131200\n---\n# Idea\n").unwrap();
    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();

    let made = store.create("Projects", "# Untitled\n").unwrap();
    store.write(&made.id, "# Launch plan\n\nSteps.\n").unwrap();
    assert_eq!(store.path_of(&made.id).unwrap(), "Projects/launch-plan.md");

    let idea = adopted_id(&mut store, "Projects/Idea.md");
    store.write(&idea, "# Bigger idea\n").unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Projects/Idea.md")).unwrap(),
        "---\nid: 202310131200\n---\n# Bigger idea\n"
    );
}
