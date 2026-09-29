//! The AI write lane's guarantees, as tests (split out of corpus.rs,
//! 2026-09-29): who may rewrite a note's text (ai_edit_policy.rs), LOCKED as
//! the edit control every class obeys, the laundering rule, the read gate on
//! writes, and filing as a metadata-only move.

use std::fs;

use tempfile::TempDir;

use super::tests::seed_memex;
use super::*;

/// The Librarian's filing is metadata and location only (2026-09-29): the
/// file moves into its area, and every byte after the frontmatter fence —
/// the note's text, its odd spacing, a CRLF separator — lands unchanged.
#[test]
fn filing_moves_a_note_without_touching_a_byte_of_its_text() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("brain");
    seed_memex(&root);
    fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
    let text = "---\r\nid: 01JFILINGBYTESULID00000000\r\ncreated: 2026-09-01\r\nupdated: 2026-09-01\r\npinned: false\r\nowner: rotli\r\narea:\r\n---\r\n# Trip  \r\n\r\nPack   light.\r\n\r\n\r\n";
    fs::write(root.join("wiki/_inbox/trip.md"), text).unwrap();
    let after_fence = |t: &str| t[raw_frontmatter_block(t).len()..].to_string();
    let before = after_fence(text);
    let mut store = CorpusStore::open(root.clone()).unwrap();
    store.os_trash = false;
    store.list().unwrap();
    store
        .set_ai_field("01JFILINGBYTESULID00000000", "area", "Projects")
        .unwrap();
    let meta = store.file_note("01JFILINGBYTESULID00000000").unwrap();
    let rel = store.path_of(&meta.id).unwrap();
    assert!(rel.starts_with("wiki/Projects/"), "{rel}");
    let landed = fs::read_to_string(store.abs(&rel)).unwrap();
    assert_eq!(after_fence(&landed), before);
}

/// AI BODY EDITS (2026-09-29): a note a person wrote is closed to every AI
/// until they grant it; a note an AI made is open until they turn it off.
#[test]
fn ai_body_edits_follow_who_wrote_the_note_and_the_persons_grant() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    store.os_trash = false;
    let person = store.create("Inbox", "# Mine\n\nmy words").unwrap();
    let chat = store
        .create_as(
            "Inbox",
            "# From chat\n\nchat words",
            false,
            Some(crate::ai_edit_policy::Creator::Chat),
        )
        .unwrap();
    let agent = store.create_for_remote_agent("Inbox", "# From agent\n\nx").unwrap();
    let text = |store: &mut CorpusStore, id: &str| {
        let rel = store.path_of(id).unwrap();
        fs::read_to_string(store.abs(&rel)).unwrap()
    };
    assert!(text(&mut store, &chat.id).contains("created_by: chat"));
    assert!(text(&mut store, &agent.id).contains("created_by: agent"));
    assert!(!text(&mut store, &person.id).contains("created_by"));

    // a person's note: every AI class and the agent lane are refused, and
    // the view says why; the person's own save is untouched
    for local in [true, false] {
        let err = store.write_for_ai(&person.id, "# Mine\n\nAI", local).unwrap_err();
        assert!(err.contains("written by the person"), "{err}");
    }
    assert!(store
        .write_for_remote_agent(&person.id, "# Mine\n\nagent")
        .unwrap_err()
        .contains("written by the person"));
    assert_eq!(store.read_frontmatter(&person.id).unwrap().ai_body_edit, "person-written");
    assert!(text(&mut store, &person.id).contains("my words"));
    store.write(&person.id, "# Mine\n\nmy edit").unwrap();

    // AI-made notes are editable until the person turns it off
    store.write_for_ai(&chat.id, "# From chat\n\nrevised", false).unwrap();
    store.write_for_remote_agent(&agent.id, "# From agent\n\ny").unwrap();
    store.set_ai_edit(&chat.id, false).unwrap();
    assert_eq!(store.read_frontmatter(&chat.id).unwrap().ai_body_edit, "revoked");
    assert!(store
        .write_for_ai(&chat.id, "# From chat\n\nagain", false)
        .unwrap_err()
        .contains("turned off"));

    // the grant opens a person's note; the keys never show as fields
    store.set_ai_edit(&person.id, true).unwrap();
    let view = store.read_frontmatter(&person.id).unwrap();
    assert_eq!(view.ai_body_edit, "allowed");
    assert!(view.fields.iter().all(|l| !l.starts_with("ai_edit") && !l.starts_with("created_by")));
    store.write_for_ai(&person.id, "# Mine\n\nAI with a grant", true).unwrap();
}

#[test]
fn the_raw_metadata_editor_cannot_forge_provenance_or_the_grant() {
    let original = "---\nid: 01J\nowner: rotli\n---\n\n# Mine\n\nwords\n";
    let merged =
        merge_raw_frontmatter(original, "id: 01J\nowner: rotli\ncreated_by: chat\nai_edit: true\n")
            .unwrap();
    assert!(!merged.contains("created_by"), "{merged}");
    assert!(!merged.contains("ai_edit"), "{merged}");
    let chat = "---\nid: 01J\nowner: rotli\ncreated_by: chat\n---\n\n# Chat\n";
    let kept = merge_raw_frontmatter(chat, "id: 01J\nowner: rotli\n").unwrap();
    assert!(kept.contains("created_by: chat"), "{kept}");
}

/// LOCKED is an EDIT control, not a visibility one: every class SEES a
/// locked note and no class edits it. The user's own write lane is
/// untouched — locking protects a note from models, not from its author.
#[test]
fn locked_notes_are_readable_by_every_model_and_editable_by_none() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    store.os_trash = false;
    let note = store.create("Inbox", "# Plan\n\noriginal body").unwrap();
    // the person grants AI edits; LOCKED must still win over the grant
    store.set_ai_edit(&note.id, true).unwrap();
    store.set_locked(&note.id, true).unwrap();

    // SEE: both classes
    assert!(store.read_for_ai(&note.id, true).is_ok());
    assert!(store.read_for_ai(&note.id, false).is_ok());
    // EDIT: neither class
    for local in [true, false] {
        let err = store
            .write_for_ai(&note.id, "# Plan\n\nrewritten", local)
            .unwrap_err();
        assert!(err.contains("locked"), "{err}");
    }
    let rel = store.path_of(&note.id).unwrap();
    assert!(fs::read_to_string(store.abs(&rel))
        .unwrap()
        .contains("original body"));
    // the human's own save still works
    assert!(store.write(&note.id, "# Plan\n\nmy own edit").is_ok());
    // unlocked, an AI write lands
    store.set_locked(&note.id, false).unwrap();
    assert!(store
        .write_for_ai(&note.id, "# Plan\n\nAI edit", true)
        .is_ok());
}

/// AUDIT 2026-08-01, GAP 9 — the laundering rule, in Rust. The TS host has
/// enforced "secure content flows only into secure containers" by tracking
/// the CHAT's taint, but a chat id is a webview assertion. Rust cannot see
/// chats; it CAN see that the incoming body is protected content.
#[test]
fn write_for_ai_refuses_to_launder_secure_prose_into_an_open_note() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    store.os_trash = false;
    let secret = store
        .create_with_policy(
            "Secure notes",
            "# Wardship\n\nThe wardship stipend renews each Candlemas quarter.",
            true,
        )
        .unwrap();
    let open = store
        .create("Inbox", "# Open\n\nnothing sensitive here")
        .unwrap();
    // granted, so the LAUNDERING rule is what refuses below
    store.set_ai_edit(&open.id, true).unwrap();
    store.set_ai_edit(&secret.id, true).unwrap();
    store.list().unwrap(); // the walk teaches the ledger

    let laundered = "# Open\n\nThe wardship stipend renews each Candlemas quarter.";
    // the compromised shape: read secure on-device, write it into an OPEN note
    let err = store.write_for_ai(&open.id, laundered, true).unwrap_err();
    assert!(err.contains("secure"), "{err}");
    let rel = store.path_of(&open.id).unwrap();
    assert!(
        fs::read_to_string(store.abs(&rel))
            .unwrap()
            .contains("nothing sensitive"),
        "the open note must be untouched"
    );

    // the SAME text into a SECURE container is fine — that is the rule, not
    // a blanket refusal
    assert!(store.write_for_ai(&secret.id, laundered, true).is_ok());
    // and an ordinary edit to the open note still lands
    assert!(store
        .write_for_ai(&open.id, "# Open\n\nbuy more oats", true)
        .is_ok());
}

/// A secure note is EDITABLE by the class that can see it (secure gates
/// visibility, not authorship) and refused to the class that cannot.
#[test]
fn write_for_ai_follows_the_same_read_gate() {
    let tmp = TempDir::new().unwrap();
    let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
    store.os_trash = false;
    let note = store
        .create_with_policy("Secure notes", "# Private\n\nbody", true)
        .unwrap();
    store.set_ai_edit(&note.id, true).unwrap();
    assert!(store
        .write_for_ai(&note.id, "# Private\n\nremote edit", false)
        .is_err());
    assert!(store
        .write_for_ai(&note.id, "# Private\n\nlocal edit", true)
        .is_ok());
}
