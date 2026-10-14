// Layout guards for slice 4 (docs/design/vault-copy-and-obsidian-compatibility.md).

use super::*;
use crate::vault_roles::FolderRoles;

/// Guard 1: the imported layout must not move a single byte of a Rotli vault's
/// behaviour (the maintainer's ~/memex-vault is a Rotli vault). This table was
/// captured from `surfaced`, `lifecycle_disk_folder`, `project_lifecycle_folder`,
/// and `is_hidden_root` BEFORE `Layout::Imported` existed; it must never change.
#[test]
fn a_rotli_vault_reads_every_reserved_name_exactly_as_before() {
    #[rustfmt::skip]
    let pinned: &[(&str, Surface, &str, &str, bool)] = &[
        ("", Surface::Hidden, "", "", false),
        ("/", Surface::Hidden, "/", "/", false),
        ("chats", Surface::NoteRW, "chats", "chats", false),
        ("chats/a.md", Surface::NoteRW, "chats/a.md", "chats/a.md", false),
        ("chats/x/y.md", Surface::NoteRW, "chats/x/y.md", "chats/x/y.md", false),
        ("chatsy", Surface::Hidden, "chatsy", "chatsy", false),
        ("wiki", Surface::NoteRW, "wiki", "wiki", false),
        ("wiki/_inbox", Surface::NoteRW, "wiki/_inbox", "wiki/_inbox", false),
        ("wiki/_inbox/a.md", Surface::NoteRW, "wiki/_inbox/a.md", "wiki/_inbox/a.md", false),
        ("wiki/_secure/a.md", Surface::NoteRW, "wiki/_secure/a.md", "wiki/_secure/a.md", false),
        ("wiki/area/a.md", Surface::NoteRW, "wiki/area/a.md", "wiki/area/a.md", false),
        ("Archive", Surface::NoteRW, "archive", "Archive", true),
        ("Archive/a.md", Surface::NoteRW, "archive/a.md", "Archive/a.md", true),
        ("archive", Surface::NoteRW, "archive", "Archive", true),
        ("archive/x/a.md", Surface::NoteRW, "archive/x/a.md", "Archive/x/a.md", true),
        ("Trash", Surface::NoteRW, "trash", "Trash", true),
        ("Trash/a.md", Surface::NoteRW, "trash/a.md", "Trash/a.md", true),
        ("trash", Surface::NoteRW, "trash", "Trash", true),
        ("trash/a.md", Surface::NoteRW, "trash/a.md", "Trash/a.md", true),
        ("storage", Surface::NoteRO, "storage", "storage", false),
        ("storage/a.png", Surface::NoteRO, "storage/a.png", "storage/a.png", false),
        ("storage/excalidraw", Surface::NoteRW, "storage/excalidraw", "storage/excalidraw", false),
        ("storage/excalidraw/b.excalidraw", Surface::NoteRW, "storage/excalidraw/b.excalidraw", "storage/excalidraw/b.excalidraw", false),
        ("storage/images/a.png", Surface::NoteRO, "storage/images/a.png", "storage/images/a.png", false),
        ("storage/rotli/x.pdf", Surface::NoteRO, "storage/rotli/x.pdf", "storage/rotli/x.pdf", false),
        ("identity", Surface::Reference, "identity", "identity", false),
        ("identity/a.md", Surface::Reference, "identity/a.md", "identity/a.md", false),
        ("identity-notes/a.md", Surface::Hidden, "identity-notes/a.md", "identity-notes/a.md", false),
        ("personality/a.md", Surface::Reference, "personality/a.md", "personality/a.md", false),
        ("history/2026.md", Surface::Reference, "history/2026.md", "history/2026.md", false),
        ("MAP.md", Surface::Reference, "MAP.md", "MAP.md", false),
        ("inbox.md", Surface::Reference, "inbox.md", "inbox.md", false),
        ("memex.json", Surface::Hidden, "memex.json", "memex.json", false),
        ("users.json", Surface::Hidden, "users.json", "users.json", false),
        ("STRUCTURE.md", Surface::Hidden, "STRUCTURE.md", "STRUCTURE.md", false),
        ("README.md", Surface::Hidden, "README.md", "README.md", false),
        ("scripts/x.ts", Surface::Hidden, "scripts/x.ts", "scripts/x.ts", false),
        ("clients/x.md", Surface::Hidden, "clients/x.md", "clients/x.md", false),
        ("Welcome to Rotli.md", Surface::NoteRW, "Welcome to Rotli.md", "Welcome to Rotli.md", false),
        ("Inbox", Surface::Hidden, "Inbox", "Inbox", false),
        ("Inbox/a.md", Surface::Hidden, "Inbox/a.md", "Inbox/a.md", false),
        ("Board", Surface::Hidden, "Board", "Board", false),
        ("Storage", Surface::Hidden, "Storage", "Storage", false),
        ("Storage/a.png", Surface::Hidden, "Storage/a.png", "Storage/a.png", false),
        ("Secure notes", Surface::Hidden, "Secure notes", "Secure notes", false),
        ("Secure notes/a.md", Surface::Hidden, "Secure notes/a.md", "Secure notes/a.md", false),
        ("Projects", Surface::Hidden, "Projects", "Projects", false),
        ("Projects/a.md", Surface::Hidden, "Projects/a.md", "Projects/a.md", false),
        ("Archive (Rotli)", Surface::Hidden, "Archive (Rotli)", "Archive (Rotli)", false),
        ("Archive (Rotli)/a.md", Surface::Hidden, "Archive (Rotli)/a.md", "Archive (Rotli)/a.md", false),
        ("Trash (Rotli)/a.md", Surface::Hidden, "Trash (Rotli)/a.md", "Trash (Rotli)/a.md", false),
        ("chats (Rotli)/a.md", Surface::Hidden, "chats (Rotli)/a.md", "chats (Rotli)/a.md", false),
        ("storage (Rotli)/a.png", Surface::Hidden, "storage (Rotli)/a.png", "storage (Rotli)/a.png", false),
        ("Notes.md", Surface::Hidden, "Notes.md", "Notes.md", false),
        (".obsidian/app.json", Surface::Hidden, ".obsidian/app.json", ".obsidian/app.json", false),
    ];
    for (rel, surface, disk, projected, hidden) in pinned {
        assert_eq!(surfaced(Layout::Memex, rel), *surface, "surfaced({rel:?})");
        assert_eq!(lifecycle_disk_folder(Layout::Memex, rel), *disk, "lifecycle_disk_folder({rel:?})");
        assert_eq!(project_lifecycle_folder(Layout::Memex, rel), *projected, "project_lifecycle_folder({rel:?})");
        assert_eq!(is_hidden_root(Layout::Memex, rel), *hidden, "is_hidden_root({rel:?})");
        // a legacy root keeps its fixed names too
        assert_eq!(surfaced(Layout::LegacyRotli, rel), Surface::NoteRW);
        assert_eq!(lifecycle_disk_folder(Layout::LegacyRotli, rel), *rel);
        assert_eq!(is_hidden_root(Layout::LegacyRotli, rel), *hidden);
    }
    for layout in [Layout::Memex, Layout::LegacyRotli] {
        assert_eq!(layout.archive_id(), "Archive");
        assert_eq!(layout.trash_id(), "Trash");
        assert!(is_trash_folder(layout, "Trash/x"));
        assert!(!is_trash_folder(layout, "Trash (Rotli)"));
        assert!(is_archive_folder(layout, "Archive"));
    }
    assert_eq!(Layout::Memex.storage_dir(), "storage");
    assert_eq!(Layout::Memex.intake_dir(), "wiki/_inbox");
    assert_eq!(Layout::Memex.board_lane(), BOARD_LANE);
    assert_eq!(Layout::LegacyRotli.storage_dir(), "Storage");
    assert_eq!(Layout::LegacyRotli.intake_dir(), "Inbox");
    assert_eq!(Layout::LegacyRotli.board_lane(), "Board");
    assert!(is_chats_lane(Layout::Memex, "chats/a"));
    assert!(!is_chats_lane(Layout::LegacyRotli, "chats/a"));
}

fn imported() -> Layout {
    Layout::Imported(crate::vault_roles::intern(FolderRoles::imported()))
}

#[test]
fn an_imported_vault_surfaces_the_persons_whole_tree() {
    let layout = imported();
    for rel in ["Projects", "Projects/a.md", "Archive/a.md", "Trash/a.md", "chats/a.md", "storage/a.png", "wiki/a.md",
        "identity/a.md", "README.md", "MAP.md", "Inbox/a.md", "Archive (Rotli)/a.md", "Trash (Rotli)/x/a.md", "chats (Rotli)/a.md"]
    {
        assert_eq!(surfaced(layout, rel), Surface::NoteRW, "{rel}");
    }
    assert_eq!(surfaced(layout, "storage (Rotli)/a.png"), Surface::NoteRO);
    assert_eq!(surfaced(layout, "storage (Rotli)/excalidraw/b.excalidraw"), Surface::NoteRW);
    for control in ["memex.json", "users.json", "memex.local.json", "identities.local.json"] {
        assert_eq!(surfaced(layout, control), Surface::Hidden, "{control}");
    }
}

#[test]
fn an_imported_vaults_own_folders_are_rotlis_and_the_persons_are_plain() {
    let layout = imported();
    assert!(!is_hidden_root(layout, "Archive"));
    assert!(!is_hidden_root(layout, "Trash/a"));
    assert!(!is_hidden_root(layout, "archive"));
    assert!(is_hidden_root(layout, "Archive (Rotli)"));
    assert!(is_hidden_root(layout, "Trash (Rotli)/Projects"));
    assert!(!is_hidden_root(layout, "Trash (Rotli) old"));
    assert!(!is_trash_folder(layout, "Trash"));
    assert!(is_trash_folder(layout, "Trash (Rotli)/x"));
    assert!(!is_archive_folder(layout, "Archive"));
    assert!(is_archive_folder(layout, "Archive (Rotli)"));
    assert!(!is_chats_lane(layout, "chats/a"));
    assert!(is_chats_lane(layout, "chats (Rotli)/a"));
    // ids are disk paths: nothing is renamed on the way to the webview
    for rel in ["Archive", "Trash/x", "archive", "Archive (Rotli)/x"] {
        assert_eq!(lifecycle_disk_folder(layout, rel), rel);
        assert_eq!(project_lifecycle_folder(layout, rel), rel);
    }
    assert_eq!(layout.archive_id(), "Archive (Rotli)");
    assert_eq!(layout.trash_id(), "Trash (Rotli)");
    assert_eq!(layout.storage_dir(), "storage (Rotli)");
    assert_eq!(layout.intake_dir(), "Inbox");
    assert_eq!(layout.board_lane(), "storage (Rotli)/excalidraw");
}

#[test]
fn an_imported_capture_reads_as_a_capture_and_the_persons_inbox_notes_do_not() {
    let layout = imported();
    let capture = Frontmatter { foreign: vec!["shelf: [Inbox]".into()], ..Default::default() };
    assert_eq!(project_folder(layout, "Inbox", &capture), "Board");
    assert_eq!(project_folder(layout, "Inbox", &Frontmatter::default()), "Inbox");
    assert_eq!(project_folder(layout, "Projects", &capture), "Projects");
    assert_eq!(project_folder(layout, "storage (Rotli)", &capture), "storage (Rotli)");
    assert_eq!(project_folder(layout, "wiki/_inbox", &capture), "wiki/_inbox");
}

/// Guard 2: an Obsidian-shaped folder with its own Archive/, Trash/, and Inbox/
/// is copied, marked, and opened. Every folder is the person's and visible,
/// Rotli's trash is its own, the Librarian's first setting is Suggest, and the
/// person's Librarian switch came with them.
#[test]
fn a_marked_copy_opens_as_an_imported_vault_with_every_folder_the_persons() {
    let temp = tempfile::TempDir::new().unwrap();
    let source = temp.path().join("Garden");
    for folder in ["Projects", "Archive", "Trash", "Inbox", ".obsidian"] {
        fs::create_dir_all(source.join(folder)).unwrap();
    }
    fs::write(source.join("Projects/Roadmap draft.md"), "# Roadmap\n\nSee [[Old plan]].\n").unwrap();
    fs::write(source.join("Archive/Old plan.md"), "# Old plan\n").unwrap();
    fs::write(source.join("Trash/Leftovers.md"), "# Leftovers\n").unwrap();
    fs::write(source.join("Inbox/Loose thought.md"), "# Loose thought\n").unwrap();
    let previous = temp.path().join("previous");
    fs::create_dir_all(previous.join(".rotli")).unwrap();
    fs::write(previous.join(".rotli/settings.json"), "{\"brainEnabled\":false,\"organizerTrust\":\"organize\"}").unwrap();

    let source = fs::canonicalize(&source).unwrap();
    let copy = temp.path().join("Garden (Rotli)");
    fs::create_dir_all(&copy).unwrap();
    let copy = fs::canonicalize(&copy).unwrap();
    let plan = crate::vault_import::plan(&source).unwrap();
    crate::vault_import::copy(&source, &copy, &plan, &std::sync::atomic::AtomicBool::new(false), |_, _| {}).unwrap();
    crate::vault_import::record(&source, &copy, &plan).unwrap();
    let marked = crate::vault_import::make_vault(&copy, Some(&previous)).unwrap();
    assert_eq!(marked, crate::vault_roles::Marked::Imported);
    assert!(is_memex_root(&copy));

    let mut store = CorpusStore::open(copy.clone()).unwrap();
    assert!(!store.adopted, "a copy is Rotli's to keep, not a folder opened in place");
    assert!(store.layout.is_imported());
    assert!(!store.is_memex(), "the Librarian stands down until it learns this layout (4c)");

    let list = store.list().unwrap();
    let folders: Vec<&str> = list.folders.iter().map(|f| f.id.as_str()).collect();
    for folder in ["Projects", "Archive", "Trash", "Inbox"] {
        assert!(folders.contains(&folder), "{folder} is visible: {folders:?}");
    }
    let note = |title: &str| list.notes.iter().find(|n| n.title == title).unwrap().clone();
    let archived = note("Old plan");
    assert_eq!(archived.folder_id, "Archive");
    assert_eq!(archived.origin, None, "the person's Archive/ is a plain folder, not a sink");

    // trash goes to Rotli's own trash, stamped with where it came from
    let roadmap = note("Roadmap");
    store.delete(&roadmap.id).unwrap();
    let trashed = store.list().unwrap().notes.into_iter().find(|n| n.title == "Roadmap").unwrap();
    assert_eq!(trashed.folder_id, "Trash (Rotli)");
    assert_eq!(trashed.origin.as_deref(), Some("Projects"));
    assert!(copy.join("Trash (Rotli)/Roadmap draft.md").is_file(), "the name is kept in the trash too");
    assert!(!copy.join("Trash/Roadmap draft.md").exists());

    // a note keeps its file name through a save that changes its title
    let loose = note("Loose thought");
    store.write(&loose.id, "# A better title\n\nmore\n").unwrap();
    assert!(copy.join("Inbox/Loose thought.md").is_file());
    assert!(!copy.join("Inbox/a-better-title.md").exists());

    // Empty Trash can never reach the person's Trash/
    let leftovers = note("Leftovers");
    assert_eq!(leftovers.folder_id, "Trash");
    store.move_note(&leftovers.id, "Projects").unwrap();
    assert!(copy.join("Projects/Leftovers.md").is_file(), "moving out of a plain folder is ordinary");

    let knobs = crate::organizer_knobs::parse_knobs(&store.dot_read("settings").unwrap());
    assert_eq!(knobs.trust, Some(crate::organizer::Trust::Suggest));
    assert!(!knobs.brain_enabled, "the Librarian switch is inherited");
    // the source is untouched
    assert!(!source.join("memex.json").exists());
    assert!(source.join("Projects/Roadmap draft.md").is_file());
}
