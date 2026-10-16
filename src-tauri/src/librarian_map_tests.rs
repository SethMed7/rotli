use super::*;
use std::fs;
use tempfile::TempDir;

fn write(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

/// A copy of an Obsidian vault the way people keep one: loose notes at the
/// root, an inbox, nested folders, daily notes, and Obsidian's own templates
/// and attachments folders.
fn obsidian_copy() -> TempDir {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    write(root, "Loose idea.md", "# Loose idea\n");
    write(root, "Inbox/Call back.md", "# Call back\n");
    write(root, "Work/Plan.md", "# Plan\n");
    write(root, "Work/Clients/Acme.md", "# Acme\n");
    write(root, "Daily/2026-10-16.md", "# Today\n");
    write(root, "Archive/2019 trip.md", "# 2019 trip\n");
    write(root, "Meta/Templates/Meeting.md", "# Meeting\n");
    write(root, "Meta/About.md", "# About\n");
    write(root, "Attachments/notes-on-a-photo.md", "# Not knowledge\n");
    write(root, "Pictures/photo.png", "png");
    write(root, "Work/_index.md", "# Work\n");
    write(root, ".obsidian/templates.json", r#"{"folder":"Meta/Templates"}"#);
    write(root, ".obsidian/app.json", r#"{"attachmentFolderPath":"Attachments"}"#);
    crate::vault_roles::mark_imported(root).unwrap();
    let roles = crate::vault_roles::read(root).unwrap();
    write(root, &format!("{}/Gone.md", roles.trash), "# Gone\n");
    write(root, &format!("{}/Chat.md", roles.chats), "# Chat\n");
    dir
}

#[test]
fn a_rotli_vault_keeps_every_place_under_wiki() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    write(root, "wiki/_inbox/a.md", "# A\n");
    write(root, "wiki/Projects/b.md", "# B\n");
    write(root, "wiki/Templates/t.md", "# T\n");
    write(root, "wiki/_secure/s.md", "# S\n");
    write(root, "chats/c.md", "# C\n");
    let map = LibrarianMap::at(root);

    assert_eq!(map, LibrarianMap::RotliVault);
    assert_eq!(map.areas(root), vec!["Projects"]);
    assert_eq!(map.area_dir("Projects"), "wiki/Projects");
    assert_eq!(map.index_rel("Projects"), "wiki/Projects/_index.md");
    assert!(map.is_unfiled("wiki/_inbox/a.md"));
    assert!(!map.is_unfiled("wiki/Projects/b.md"));
    let mut candidates = map.candidates(root);
    candidates.sort();
    assert_eq!(
        candidates,
        vec!["wiki/Projects/b.md", "wiki/_inbox/a.md", "wiki/_secure/s.md"]
    );
}

#[test]
fn a_copy_reads_the_persons_own_tree() {
    let dir = obsidian_copy();
    let root = dir.path();
    let map = LibrarianMap::at(root);
    assert!(matches!(map, LibrarianMap::Copy { .. }));

    // the person's top-level folders holding a note; the daily folder and a
    // person's own Archive are ordinary areas
    assert_eq!(map.areas(root), vec!["Archive", "Daily", "Meta", "Work"]);
    assert_eq!(map.area_dir("Work"), "Work");
    assert_eq!(map.index_rel("Work"), "Work/_index.md");

    let mut candidates = map.candidates(root);
    candidates.sort();
    assert_eq!(
        candidates,
        vec![
            "Archive/2019 trip.md",
            "Daily/2026-10-16.md",
            "Inbox/Call back.md",
            "Loose idea.md",
            "Meta/About.md",
            "Work/Clients/Acme.md",
            "Work/Plan.md",
        ]
    );
    assert_eq!(map.area_candidates(root, "Work").len(), 2);

    assert!(map.is_unfiled("Loose idea.md"));
    assert!(map.is_unfiled("Inbox/Call back.md"));
    assert!(!map.is_unfiled("Work/Plan.md"));
}

#[test]
fn an_attachment_path_relative_to_each_note_sets_nothing_aside() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    write(root, "Work/Plan.md", "# Plan\n");
    write(root, "Work/assets/pic.md", "# Pic\n");
    write(root, ".obsidian/app.json", r#"{"attachmentFolderPath":"./assets"}"#);
    write(root, ".obsidian/templates.json", r#"{"folder":"../outside"}"#);
    crate::vault_roles::mark_imported(root).unwrap();

    let LibrarianMap::Copy { set_aside, .. } = LibrarianMap::at(root) else {
        panic!("a marked copy reads as a copy");
    };
    assert!(set_aside.is_empty());
}
