// Decision I (owner, 2026-10-15): a folder connected in place gets the same
// layout as a copy — the imported marker and role map, plus `"inPlace": true`.
// Everything works as in a copy except the Librarian (never) and stamps on the
// person's notes (never, decision B). The marker is what every open path reads.

use super::*;
use tempfile::TempDir;

/// An Obsidian-shaped folder connected in place: its own Archive/Trash/chats.
fn connected_in_place(dir: &TempDir) -> PathBuf {
    let root = dir.path().join("obsidian-vault");
    for folder in ["Projects", "Archive", "Trash", "chats", ".obsidian"] {
        fs::create_dir_all(root.join(folder)).unwrap();
    }
    fs::write(root.join("Projects/My Plan.md"), "# My Plan\n\nSteps.\n").unwrap();
    fs::write(root.join("Archive/Old.md"), "# Old\n").unwrap();
    // the person's own settings asked for the Librarian; in place it stays off
    fs::create_dir_all(root.join(".rotli")).unwrap();
    fs::write(root.join(".rotli/settings.json"), "{\"brainEnabled\":true}").unwrap();
    assert_eq!(
        crate::vault_roles::mark_in_place(&root).unwrap(),
        crate::vault_roles::Marked::Imported
    );
    fs::canonicalize(root).unwrap()
}

use super::adopted_tests::adopted_id as id_at;

#[test]
fn every_open_path_reads_in_place_from_the_marker() {
    let dir = TempDir::new().unwrap();
    let root = connected_in_place(&dir);
    assert!(crate::vault_roles::in_place(&root));
    // startup / a linked vault / refresh open with `open`; the registry's
    // adopted root opens with `open_adopted`: both land in the same place
    for store in [
        CorpusStore::open(root.clone()).unwrap(),
        CorpusStore::open_adopted(root.clone()).unwrap(),
    ] {
        assert!(store.adopted, "the marker says in place");
        assert!(store.layout.is_imported(), "the same layout as a copy");
        assert!(!store.brain_enabled(), "the Librarian never runs in place");
        assert!(!store.is_memex());
        assert!(store.filer_writable("wiki/x.md").is_err());
        assert!(!store.band_read_only);
    }
}

#[test]
fn switching_to_a_folder_connected_in_place_remembers_it_as_adopted() {
    let dir = TempDir::new().unwrap();
    let root = connected_in_place(&dir);
    let cfg = CorpusConfig {
        version: 1,
        corpus: CorpusRef { abs_path: dir.path().join("elsewhere"), adopted: false },
        brains: Vec::new(),
        folders: Vec::new(),
        active_brain_id: None,
    };
    // corpus_switch_vault and the "memex" arm pass false: the marker decides
    let switched = switch_corpus_config(cfg, root, false).unwrap();
    assert!(switched.corpus.adopted);
}

#[test]
fn in_place_saves_and_metadata_stamp_nothing() {
    let dir = TempDir::new().unwrap();
    let root = connected_in_place(&dir);
    let mut store = CorpusStore::open(root.clone()).unwrap();
    let id = id_at(&mut store, "Projects/My Plan.md");
    store.write(&id, "# Renamed\n\nNew.\n").unwrap();
    assert_eq!(fs::read_to_string(root.join("Projects/My Plan.md")).unwrap(), "# Renamed\n\nNew.\n");
    // only the asked-for line: no Rotli id or dates minted into it
    store.set_pinned(&id, true).unwrap();
    assert_eq!(
        fs::read_to_string(root.join("Projects/My Plan.md")).unwrap(),
        "---\npinned: true\n---\n# Renamed\n\nNew.\n"
    );
    // a secret-looking note is refused remotely but never rewritten
    let secret = "# Keys\n\nSSN: 078-05-1120\n";
    fs::write(root.join("Projects/keys.md"), secret).unwrap();
    assert!(store.read_frontmatter("Projects/keys.md").unwrap().secure);
    assert_eq!(fs::read_to_string(root.join("Projects/keys.md")).unwrap(), secret);
    assert!(store.convert_links(false).is_err(), "links stay as the person wrote them");
}

#[test]
fn in_place_trash_and_archive_use_rotlis_own_sinks() {
    let dir = TempDir::new().unwrap();
    let root = connected_in_place(&dir);
    fs::create_dir_all(root.join("storage (Rotli)")).unwrap();
    fs::write(root.join("storage (Rotli)/rose.png"), b"png").unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    let id = id_at(&mut store, "Projects/My Plan.md");

    store.delete(&id).unwrap();
    assert!(root.join("Trash (Rotli)/My Plan.md").is_file(), "Rotli's trash, never the person's");
    assert_eq!(fs::read_dir(root.join("Trash")).unwrap().count(), 0);
    store.move_note(&id, "Projects").unwrap();
    assert_eq!(fs::read_to_string(root.join("Projects/My Plan.md")).unwrap(), "# My Plan\n\nSteps.\n");

    // a file moves too, now that the folder has Rotli's own sinks
    let moved = store.move_file_to_sink("storage (Rotli)/rose.png", "Archive").unwrap();
    assert!(moved.starts_with("Archive (Rotli)/"), "{moved}");
    assert!(root.join("Archive/Old.md").is_file(), "the person's Archive is untouched");
}

#[test]
fn a_folder_opened_in_place_before_the_marker_keeps_its_files_where_they_are() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("legacy");
    fs::create_dir_all(root.join("storage")).unwrap();
    fs::write(root.join("storage/rose.png"), b"png").unwrap();
    let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
    assert!(!store.layout.is_imported());
    assert!(store.move_file_to_sink("storage/rose.png", "Trash").is_err());
}
