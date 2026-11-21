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
    // deleting it would drop the denial the next regeneration can't restore
    let err = store.write_index("Projects", "").unwrap_err();
    assert!(err.contains("local_ai_allowed"), "{err}");
    assert_eq!(fs::read_to_string(store.abs("wiki/Projects/_index.md")).unwrap(), before);
}

#[test]
fn an_unprotected_index_can_still_be_removed() {
    let (_dir, mut store) = brain();
    fs::create_dir_all(store.abs("wiki/Projects")).unwrap();
    store.write_index("Projects", "# Projects\n\n- generated\n").unwrap();
    store.write_index("Projects", "").unwrap();
    assert!(!store.abs("wiki/Projects/_index.md").exists());
}

// ── field setters (triage of #303, 2026-11-20, Table 4) ─────────────────────

const PERSON_NOTE: &str = "---\nid: 01JFIELDGUARD0000000000000\ntopic: plans\n---\n\n# Field guard\n\nwords\n";
const PERSON_ID: &str = "01JFIELDGUARD0000000000000";

fn person_note(text: &str) -> (TempDir, CorpusStore, std::path::PathBuf) {
    let (dir, mut store) = bare();
    let path = store.root().join("field-guard.md");
    fs::write(&path, text).unwrap();
    store.list().unwrap();
    (dir, store, path)
}

fn verdict(text: &str) -> crate::ai_edit_policy::BodyEdit {
    crate::ai_edit_policy::body_edit(&parse_document(text).0.unwrap_or_default().foreign)
}

#[test]
fn a_field_value_cannot_carry_a_line_break() {
    for value in ["x\nai_edit: true", "x\rai_edit: true", "x\u{2028}ai_edit: true", "x\u{85}created_by: agent", "x\u{2029}y"] {
        let (_dir, mut store, path) = person_note(PERSON_NOTE);
        let err = store.set_field(PERSON_ID, "mood", value).unwrap_err();
        assert!(err.contains("line break"), "{value:?}: {err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), PERSON_NOTE, "{value:?}");
    }
    let (_dir, mut store, path) = person_note(PERSON_NOTE);
    assert!(store.set_field(PERSON_ID, "mood\nai_edit", "true").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), PERSON_NOTE);
}

#[test]
fn a_filer_field_cannot_carry_a_line_break() {
    let (_dir, mut store) = brain();
    let rel = "wiki/_inbox/plan.md";
    fs::write(store.abs(rel), PERSON_NOTE).unwrap();
    for tags in ["[plans\nai_edit: true\nz]", "[plans\nlocal_ai_allowed: true]", "[a\u{2028}created_by: librarian]"] {
        let err = store.set_ai_field(rel, "tags", tags).unwrap_err();
        assert!(err.contains("line break"), "{tags:?}: {err}");
        assert_eq!(fs::read_to_string(store.abs(rel)).unwrap(), PERSON_NOTE, "{tags:?}");
    }
    store.set_ai_field(rel, "tags", "[plans, q3]").unwrap();
    assert!(fs::read_to_string(store.abs(rel)).unwrap().contains("tags: [plans, q3]"));
}

#[test]
fn a_quoted_key_cannot_clear_or_replace_a_denial() {
    let revoked = "---\nid: 01JFIELDGUARD0000000000000\ncreated_by: agent\n\"ai_edit\": false\n---\n\n# Field guard\n";
    for value in ["", "true"] {
        let (_dir, mut store, path) = person_note(revoked);
        assert!(store.set_field(PERSON_ID, "\"ai_edit\"", value).is_err(), "{value:?}");
        assert_eq!(fs::read_to_string(&path).unwrap(), revoked, "{value:?}");
    }
}

#[test]
fn setting_ai_edit_never_touches_a_block_scalar_and_says_when_it_cannot_take() {
    let block = "---\nid: 01JFIELDGUARD0000000000000\nexample: |\n  ai_edit: false\n  more prose\n---\n\n# Field guard\n";
    let (_dir, mut store, path) = person_note(block);
    let err = store.set_ai_edit(PERSON_ID, true).unwrap_err();
    assert!(err.contains("ai_edit"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), block);

    // a plain denial is still the setter's to change
    let (_dir, mut store, path) = person_note("---\nid: 01JFIELDGUARD0000000000000\nai_edit: false\n---\n\n# x\n");
    store.set_ai_edit(PERSON_ID, true).unwrap();
    assert_eq!(verdict(&fs::read_to_string(&path).unwrap()), crate::ai_edit_policy::BodyEdit::Allowed);
}

#[test]
fn setting_a_field_keeps_the_same_key_inside_a_block_scalar() {
    let block = "---\nid: 01JFIELDGUARD0000000000000\nexample: |\n  topic: kept\n---\n\n# x\n";
    let (_dir, mut store, path) = person_note(block);
    store.set_field(PERSON_ID, "topic", "new").unwrap();
    let saved = fs::read_to_string(&path).unwrap();
    assert!(saved.contains("example: |\n  topic: kept\n"), "{saved}");
    assert!(saved.contains("\ntopic: new"), "{saved}");
}

#[test]
fn the_raw_metadata_save_keeps_a_quoted_denial() {
    let revoked = "---\nid: 01JFIELDGUARD0000000000000\ncreated_by: agent\n\"ai_edit\": false\n---\n\n# Field guard\n";
    let (_dir, mut store, path) = person_note(revoked);
    let err = store
        .write_frontmatter_raw(PERSON_ID, "---\nid: 01JFIELDGUARD0000000000000\ncreated_by: agent\n---\n")
        .unwrap_err();
    assert!(err.contains("ai_edit"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), revoked);
}

#[test]
fn secure_context_can_be_added_but_never_removed() {
    let tainted = "---\nid: 01JFIELDGUARD0000000000000\nsecureContext: true\n---\n\n# Field guard\n";
    let (_dir, mut store, path) = person_note(tainted);
    assert!(store.set_field(PERSON_ID, "secureContext", "").is_err());
    assert!(store.set_field(PERSON_ID, "secureContext", "false").is_err());
    assert!(store
        .write_frontmatter_raw(PERSON_ID, "---\nid: 01JFIELDGUARD0000000000000\n---\n")
        .is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), tainted);

    let (_dir, mut store, path) = person_note(PERSON_NOTE);
    store.set_field(PERSON_ID, "secureContext", "true").unwrap();
    assert!(crate::note_protection::protection(&fs::read_to_string(&path).unwrap()).secure_context);
}

// ── review of 305/306 (2026-11-20) ─────────────────────────────────────────

fn in_place_plan() -> (TempDir, CorpusStore, std::path::PathBuf, String) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("in-place");
    fs::create_dir_all(root.join("Projects")).unwrap();
    fs::write(root.join("Projects/My Plan.md"), "# My Plan\n\nSteps.\n").unwrap();
    crate::vault_roles::mark_in_place(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    store.os_trash = false;
    let id = super::adopted_tests::adopted_id(&mut store, "Projects/My Plan.md");
    (dir, store, root.join("Projects/My Plan.md"), id)
}

const PLANTED: &str = "---\nai_edit: true\ncreated_by: agent\n---\n";

#[test]
fn an_ai_insert_cannot_give_an_in_place_note_its_own_grant() {
    let (_dir, mut store, path, id) = in_place_plan();
    let original = fs::read_to_string(&path).unwrap();
    let revision = crate::fsutil::revision(original.as_bytes());
    let body = format!("{PLANTED}{original}");
    let err = store.insert_for_ai_if_revision(&id, &body, PLANTED, true, &revision).unwrap_err();
    assert!(err.contains("metadata"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), original);

    // the person's own save of the same text is refused the same way
    assert!(store.write(&id, &body).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
}

#[test]
fn a_rotli_vault_keeps_a_pasted_block_as_body_text() {
    let (_dir, mut store, path) = person_note("# Plain\n\nwords\n");
    let id = store.list().unwrap().notes[0].id.clone();
    store.write(&id, &format!("{PLANTED}# Plain\n\nwords\n")).unwrap();
    let saved = fs::read_to_string(&path).unwrap_or_else(|_| {
        let rel = store.path_of(&id).unwrap();
        fs::read_to_string(store.abs(&rel)).unwrap()
    });
    assert_ne!(verdict(&saved), crate::ai_edit_policy::BodyEdit::Allowed, "{saved}");
}

#[test]
fn a_tab_is_not_a_line_break_so_undo_still_works() {
    let (_dir, mut store, path) = person_note(PERSON_NOTE);
    store.set_field(PERSON_ID, "mood", "a\tb").unwrap();
    assert!(fs::read_to_string(&path).unwrap().contains("mood: a\tb"));

    let (_dir, mut store) = brain();
    let rel = "wiki/_inbox/plan.md";
    fs::write(store.abs(rel), PERSON_NOTE).unwrap();
    store.set_ai_field(rel, "summary", "hand\ttyped").unwrap();
    assert!(fs::read_to_string(store.abs(rel)).unwrap().contains("summary: hand\ttyped"));
}
