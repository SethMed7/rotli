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

// ── re-check of 306 at d4a22c34 (2026-11-20) ───────────────────────────────

fn in_place_note(name: &str, text: &str) -> (TempDir, CorpusStore, std::path::PathBuf, String) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("in-place");
    fs::create_dir_all(root.join("Notes")).unwrap();
    fs::write(root.join(format!("Notes/{name}")), text).unwrap();
    crate::vault_roles::mark_in_place(&root).unwrap();
    let root = fs::canonicalize(root).unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    store.os_trash = false;
    let id = super::adopted_tests::adopted_id(&mut store, &format!("Notes/{name}"));
    (dir, store, root.join(format!("Notes/{name}")), id)
}

fn first_id(store: &mut CorpusStore) -> String {
    store.list().unwrap().notes[0].id.clone()
}

#[test]
fn a_person_can_save_a_note_that_opens_with_a_rule() {
    // R1: an unclosed `---` read as a chat's secureContext, so every save
    // of the person's own note "removed" it
    for text in ["---\n\nIntro after a rule\n", "\n\n---\nIntro\n", "---\r\n\r\nIntro\r\n"] {
        let (_dir, mut store, _path) = person_note(text);
        let id = first_id(&mut store);
        store.write(&id, &format!("{text}x")).unwrap_or_else(|e| panic!("{text:?}: {e}"));
        store.set_field(&id, "topic", "rules").unwrap_or_else(|e| panic!("{text:?}: {e}"));
    }
    let (_dir, mut store, path, id) = in_place_note("Rule.md", "---\n\nIntro after a rule\n");
    store.write(&id, "Intro after a rule\n").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "Intro after a rule\n");
}

const MARKED: &str = "\n---\nsecureContext: true\n---\n\nwords\n";

#[test]
fn the_backstop_refuses_an_ai_write_that_drops_a_mark() {
    // R3: a leading blank line means no frontmatter for the editor, but the
    // mark grammar still reads this block; only the backstop sees the loss
    let (_dir, mut store, path, id) = in_place_note("Marked.md", MARKED);
    let revision = crate::fsutil::revision(MARKED.as_bytes());
    let err = store
        .write_for_ai_as(&id, "\nwords\n", true, &revision, AiWrite::ConsentedReplace)
        .unwrap_err();
    assert!(err.contains("secureContext"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), MARKED);
}

#[test]
fn the_backstop_lets_the_person_edit_their_own_text() {
    let (_dir, mut store, path, id) = in_place_note("Marked.md", MARKED);
    store.write(&id, "\nwords\n").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "\nwords\n");
}

fn ignore_of(store: &CorpusStore) -> String {
    fs::read_to_string(store.root().join(".gitignore")).unwrap_or_default()
}

#[test]
fn in_place_remove_protection_says_so_when_another_line_keeps_it() {
    for text in [
        "---\nsecure: true\nexample: |\n  secure: true\n---\n# S\n",
        "---\nsecure : true\n---\n# S\n",
        "---\n\u{feff}secure: true\n---\n# S\n",
    ] {
        let (_dir, mut store, path, id) = in_place_note("Secret.md", text);
        fs::write(store.root().join(".gitignore"), "Notes/Secret.md\n").unwrap();
        let err = store.set_secure(&id, false).unwrap_err();
        assert!(err.contains("secure"), "{text:?}: {err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), text, "{text:?}");
        assert_eq!(ignore_of(&store), "Notes/Secret.md\n", "{text:?}");
    }
}

#[test]
fn in_place_unlock_says_so_when_another_line_keeps_it() {
    for text in [
        "---\nlocked: true\nexample: |\n  locked: true\n---\n# L\n",
        "---\nlocked : true\n---\n# L\n",
    ] {
        let (_dir, mut store, path, id) = in_place_note("Locked.md", text);
        let err = store.set_locked(&id, false).unwrap_err();
        assert!(err.contains("locked"), "{text:?}: {err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), text, "{text:?}");
    }
}

#[test]
fn rotli_vault_unlock_and_remove_protection_never_touch_block_text() {
    // self-review of 306 at d4a22c34: these two still deleted an indented
    // `locked:` / `secure:` inside a block scalar
    let locked = "---\nid: 01JFIELDGUARD0000000000000\nlocked: true\nexample: |\n  locked: true\n---\n\n# L\n";
    let (_dir, mut store, path) = person_note(locked);
    let err = store.set_locked(PERSON_ID, false).unwrap_err();
    assert!(err.contains("locked"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), locked);

    let secure = "---\nid: 01JFIELDGUARD0000000000000\nsecure: true\nexample: |\n  secure: true\n---\n\n# S\n";
    let (_dir, mut store, path) = person_note(secure);
    fs::write(store.root().join(".gitignore"), "field-guard.md\n").unwrap();
    let err = store.set_secure(PERSON_ID, false).unwrap_err();
    assert!(err.contains("secure"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), secure);
    assert_eq!(ignore_of(&store), "field-guard.md\n");

    // locking keeps the block's own text
    let block = "---\nid: 01JFIELDGUARD0000000000000\nexample: |\n  locked: false\n---\n\n# B\n";
    let (_dir, mut store, path) = person_note(block);
    store.set_locked(PERSON_ID, true).unwrap();
    let saved = fs::read_to_string(&path).unwrap();
    assert!(saved.contains("example: |\n  locked: false\n"), "{saved}");
    assert!(crate::note_protection::protection(&saved).locked, "{saved}");
}

// ── lane check of 306 at 5a4deb57 (2026-11-20) ─────────────────────────────

const UNCLOSED_MARK: &str = "---\nsecureContext: true\nwords\n";

#[test]
fn a_local_model_edit_never_opens_a_marked_note_to_remote_models() {
    // S1: the AI backstop read the marker closed-block only, the read gate
    // fail-closed, so a local edit dropping it made the note remote-readable
    let (_dir, mut store, path, id) = in_place_note("Unclosed.md", UNCLOSED_MARK);
    let rel = store.path_of(&id).unwrap();
    assert!(store.read_for_ai(&rel, false).is_err());
    let revision = crate::fsutil::revision(UNCLOSED_MARK.as_bytes());
    let err = store.write_for_ai_as(&id, "words\n", true, &revision, AiWrite::ConsentedReplace).unwrap_err();
    assert!(err.contains("secureContext"), "{err}");
    assert_eq!(fs::read_to_string(&path).unwrap(), UNCLOSED_MARK);
    assert!(store.read_for_ai(&rel, false).is_err());

    // a Rotli vault keeps the taint in its own block (N1), so the edit may land
    let (_dir, mut store, _path) = person_note(UNCLOSED_MARK);
    let id = first_id(&mut store);
    let rel = store.path_of(&id).unwrap();
    let revision = crate::fsutil::revision(fs::read(store.abs(&rel)).unwrap().as_slice());
    let _ = store.write_for_ai_as(&id, "words\n", true, &revision, AiWrite::ConsentedReplace);
    let rel = store.path_of(&id).unwrap();
    assert!(store.read_for_ai(&rel, false).is_err(), "{}", fs::read_to_string(store.abs(&rel)).unwrap());
}

#[test]
fn a_filer_field_never_drops_an_unclosed_mark() {
    let (_dir, mut store) = brain();
    let rel = "wiki/_inbox/marked.md";
    fs::write(store.abs(rel), UNCLOSED_MARK).unwrap();
    assert!(store.set_ai_field(rel, "tags", "[plans]").is_err());
    assert_eq!(fs::read_to_string(store.abs(rel)).unwrap(), UNCLOSED_MARK);
}

#[test]
fn an_index_rewrite_never_drops_an_unclosed_mark() {
    let (_dir, mut store) = brain();
    fs::create_dir_all(store.abs("wiki/Projects")).unwrap();
    let marked = "---\nsecureContext: true\n# Projects\n";
    fs::write(store.abs("wiki/Projects/_index.md"), marked).unwrap();
    assert!(store.write_index("Projects", "# Projects\n\n- regenerated\n").is_err());
    assert_eq!(fs::read_to_string(store.abs("wiki/Projects/_index.md")).unwrap(), marked);
}

#[test]
fn the_editor_save_lets_the_person_edit_their_own_text() {
    // Q4: the real editor lane (corpus_write → write_if_revision_with_body_base)
    let (_dir, mut store, path, id) = in_place_note("Marked.md", MARKED);
    let revision = crate::fsutil::revision(MARKED.as_bytes());
    store.write_if_revision_with_body_base(&id, "\nwords\n", &revision, None).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "\nwords\n");
}

#[test]
fn every_body_save_names_its_lane() {
    // Q4: the AI/agent saves run the backstop, the person's never. Two of
    // them can't reach it by behaviour (the remote lane refuses a person's
    // note first; a task tick can't loosen), so their lane is pinned here.
    let source = include_str!("corpus.rs");
    let want = [
        ("write_for_ai", "true"),
        ("write_for_ai_as", "true"),
        ("write_for_remote_agent", "true"),
        ("write_for_remote_agent_if_revision", "true"),
        ("toggle_task", "false"),
        ("write", "false"),
        ("write_if_revision_with_body_base", "false"),
    ];
    let mut found = Vec::new();
    let mut current = "";
    for line in source.lines() {
        let trimmed = line.trim_start();
        for prefix in ["pub(crate) fn ", "pub fn ", "fn "] {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                current = rest.split(['(', '<']).next().unwrap_or("");
            }
        }
        if line.contains("self.write_resolved(") {
            let lane = if line.contains(", true)") { "true" } else if line.contains(", false)") { "false" } else { "?" };
            found.push((current.to_string(), lane));
        }
    }
    let found: Vec<(&str, &str)> = found.iter().map(|(f, l)| (f.as_str(), *l)).collect();
    assert_eq!(found.len(), want.len(), "{found:?}");
    for pair in want {
        assert!(found.contains(&pair), "{pair:?} not in {found:?}");
    }
}

#[test]
fn a_persons_save_keeps_a_taint_only_the_marker_reader_saw() {
    // N1: a Rotli vault rebuilds the block; the taint rides into it
    for text in [UNCLOSED_MARK, MARKED] {
        let (_dir, mut store, _path) = person_note(text);
        let id = first_id(&mut store);
        store.write(&id, "words, edited\n").unwrap();
        let rel = store.path_of(&id).unwrap();
        let saved = fs::read_to_string(store.abs(&rel)).unwrap();
        assert!(crate::note_protection::protection(&saved).secure_context, "{text:?} → {saved}");
        assert!(store.read_for_ai(&rel, false).is_err(), "{saved}");
    }
}
