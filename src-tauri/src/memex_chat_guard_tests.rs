//! Review 2026-11-20: a chat rewrite dropped `secure` and `locked`. A re-save
//! keeps every protection the transcript had and may only tighten it.

use super::*;

#[test]
fn a_chat_rewrite_keeps_its_locked_and_secure_flags() {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    write_chat_at(
        &root,
        "guarded",
        "---\ntitle: Guarded\nlocked: true\nsecure: true\n---\n\nfirst turn\n",
        None,
    )
    .unwrap();
    let revision = read_chat_at(&root, "guarded").unwrap().revision;

    write_chat_at(
        &root,
        "guarded",
        "---\ntitle: Guarded\n---\n\nfirst turn\n\nsecond turn\n",
        Some(&revision),
    )
    .unwrap();

    let saved = fs::read_to_string(root.join("chats/guarded.md")).unwrap();
    let kept = crate::note_protection::protection(&saved);
    assert!(kept.locked && kept.secure, "{saved}");
    assert!(saved.contains("second turn"));

    // a chat with no frontmatter block still gets its flags back
    let revision = read_chat_at(&root, "guarded").unwrap().revision;
    write_chat_at(&root, "guarded", "plain rewrite\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/guarded.md")).unwrap();
    let kept = crate::note_protection::protection(&saved);
    assert!(kept.locked && kept.secure, "{saved}");

    // `locked: no` is still unlocked to the app, so it is restored too
    let revision = read_chat_at(&root, "guarded").unwrap().revision;
    write_chat_at(&root, "guarded", "---\nlocked: no\nsecure: true\n---\nx\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/guarded.md")).unwrap();
    assert!(crate::note_protection::protection(&saved).locked, "{saved}");
}

#[test]
fn a_chat_rewrite_keeps_its_denials_and_refuses_new_grants() {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    let denied = "---\ncreated_by: chat\nai_edit: false\nlocal_ai_allowed: false\n---\n\nturn\n";
    write_chat_at(&root, "revoked", denied, None).unwrap();
    let revision = read_chat_at(&root, "revoked").unwrap().revision;
    write_chat_at(&root, "revoked", "---\ncreated_by: chat\n---\n\nturn\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/revoked.md")).unwrap();
    assert!(crate::note_protection::loosened(denied, &saved).is_empty(), "{saved}");

    write_chat_at(&root, "open", "---\ntitle: Open\n---\n", None).unwrap();
    let revision = read_chat_at(&root, "open").unwrap().revision;
    let err = write_chat_at(&root, "open", "---\nlocal_ai_allowed: true\n---\n", Some(&revision)).unwrap_err();
    assert!(err.contains("local_ai_allowed"), "{err}");
}

#[test]
fn a_locked_chat_keeps_its_ai_edit_denial_too() {
    // self-review of 305: `locked` used to hide the revoked grant, so a
    // rewrite dropping both put back only the lock
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    let old = "---\nlocked: true\ncreated_by: chat\nai_edit: false\n---\n\nturn\n";
    write_chat_at(&root, "both", old, None).unwrap();
    let revision = read_chat_at(&root, "both").unwrap().revision;
    write_chat_at(&root, "both", "---\ncreated_by: chat\n---\n\nturn\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/both.md")).unwrap();
    assert!(crate::note_protection::loosened(old, &saved).is_empty(), "{saved}");
    let unlocked: String = saved.lines().filter(|l| !l.starts_with("locked:")).map(|l| format!("{l}\n")).collect();
    let foreign = parse_document_fm(&unlocked);
    assert_ne!(crate::ai_edit_policy::body_edit(&foreign), crate::ai_edit_policy::BodyEdit::Allowed, "{saved}");
}

#[test]
fn a_chat_rewrite_keeps_its_secure_context() {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    write_chat_at(&root, "taint", "---\ntitle: T\nsecureContext: true\n---\n\nturn\n", None).unwrap();
    let revision = read_chat_at(&root, "taint").unwrap().revision;
    write_chat_at(&root, "taint", "---\ntitle: T\nsecureContext: false\n---\n\nturn\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/taint.md")).unwrap();
    assert!(crate::note_protection::protection(&saved).secure_context, "{saved}");
}

fn parse_document_fm(text: &str) -> Vec<String> {
    crate::corpus::parse_document(text).0.unwrap_or_default().foreign
}

#[test]
fn a_chat_with_an_unclosed_taint_keeps_it() {
    // self-review at d0c659dd: notes read an unclosed block as no mark, but a
    // chat's taint stays fail-closed, so a rewrite can't strip it
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    let tainted = "---\ntitle: Open\nsecureContext: true\n\nturn\n";
    write_chat_at(&root, "open", tainted, None).unwrap();
    let revision = read_chat_at(&root, "open").unwrap().revision;
    write_chat_at(&root, "open", "turn\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/open.md")).unwrap();
    assert!(crate::protection_mark::marked(&saved, "secureContext"), "{saved}");
}

#[test]
fn a_chat_restore_never_rewrites_block_text() {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    write_chat_at(&root, "block", "---\nlocked: true\n---\n\nturn\n", None).unwrap();
    let revision = read_chat_at(&root, "block").unwrap().revision;
    write_chat_at(&root, "block", "---\nexample: |\n  locked: false\n---\n\nturn\n", Some(&revision)).unwrap();
    let saved = fs::read_to_string(root.join("chats/block.md")).unwrap();
    assert!(saved.contains("example: |\n  locked: false\n"), "{saved}");
    assert!(crate::note_protection::protection(&saved).locked, "{saved}");
}
