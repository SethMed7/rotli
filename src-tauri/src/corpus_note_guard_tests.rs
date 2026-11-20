//! Review 2026-11-20: writers that replaced a note's text and dropped its
//! protection. Each test sets up a protected note and expects the write to
//! keep the protection or be refused with the note untouched.

use super::tests::{bare, seed_memex};
use super::*;
use tempfile::TempDir;

const LOCKED_SECURE: &str = "---\nid: 01JGUARD\nlocked: true\nsecure: true\n---\n\n# Plan\n\nprivate words\n";

#[test]
fn the_byte_save_lane_refuses_a_markdown_note() {
    let (_dir, mut store) = bare();
    for rel in ["plan.md", "Shouty.MD"] {
        let path = store.root().join(rel);
        fs::write(&path, LOCKED_SECURE).unwrap();
        let revision = crate::fsutil::revision(LOCKED_SECURE.as_bytes());

        let err = store
            .write_file_bytes_if_revision(rel, b"# Plan\n\nreplaced\n", false, &revision)
            .unwrap_err();
        assert!(err.contains("not for notes"), "{rel}: {err}");
        assert!(store.write_file_bytes(rel, b"replaced", false).is_err(), "{rel}");
        assert_eq!(fs::read_to_string(&path).unwrap(), LOCKED_SECURE, "{rel}");
    }
}

#[test]
fn the_byte_save_lane_refuses_a_board() {
    let (_dir, mut store) = bare();
    let path = store.root().join("sketch.excalidraw");
    let scene = r#"{"type":"excalidraw","elements":[]}"#;
    fs::write(&path, scene).unwrap();
    assert!(store.write_file_bytes("sketch.excalidraw", b"{}", false).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), scene);
}

#[test]
fn the_byte_save_lane_still_saves_a_sheet() {
    let (_dir, mut store) = bare();
    fs::write(store.root().join("book.csv"), "a,b\n").unwrap();
    store.write_file_bytes("book.csv", b"a,b\n1,2\n", false).unwrap();
    assert_eq!(fs::read_to_string(store.root().join("book.csv")).unwrap(), "a,b\n1,2\n");
}

fn brain() -> (TempDir, CorpusStore) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    seed_memex(&root);
    fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
    let mut store = CorpusStore::open(root).unwrap();
    store.os_trash = false;
    (dir, store)
}

#[test]
fn an_index_rewrite_keeps_the_persons_local_ai_denial() {
    let (_dir, mut store) = brain();
    let denied = "---\nlocal_ai_allowed: false\n---\n# Projects\n";
    fs::create_dir_all(store.abs("wiki/Projects")).unwrap();
    fs::write(store.abs("wiki/Projects/_index.md"), denied).unwrap();

    let err = store.write_index("Projects", "# Projects\n\n- regenerated\n").unwrap_err();
    assert!(err.contains("local_ai_allowed"), "{err}");
    assert_eq!(fs::read_to_string(store.abs("wiki/Projects/_index.md")).unwrap(), denied);
}

#[test]
fn an_index_cannot_grant_itself_ai_edits() {
    let (_dir, mut store) = brain();
    fs::create_dir_all(store.abs("wiki/Projects")).unwrap();
    let err = store
        .write_index("Projects", "---\ncreated_by: librarian\n---\n# Projects\n")
        .unwrap_err();
    assert!(err.contains("ai_edit"), "{err}");
    assert!(!store.abs("wiki/Projects/_index.md").exists());
}

#[test]
fn an_index_undo_restores_frontmatter_it_already_had() {
    let (_dir, mut store) = brain();
    let before = "---\nlocal_ai_allowed: false\ntags: [x]\n---\n# Projects\n";
    fs::create_dir_all(store.abs("wiki/Projects")).unwrap();
    fs::write(store.abs("wiki/Projects/_index.md"), before).unwrap();
    store.write_index("Projects", before).unwrap();
    assert_eq!(fs::read_to_string(store.abs("wiki/Projects/_index.md")).unwrap(), before);
    store.write_index("Projects", "").unwrap();
    store.write_index("Projects", "# Projects\n\n- regenerated\n").unwrap();
}
