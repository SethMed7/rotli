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
fn a_chat_rewrite_cannot_grant_ai_edits_it_did_not_have() {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    write_chat_at(&root, "revoked", "---\nlocal_ai_allowed: false\n---\n\nturn\n", None).unwrap();
    let revision = read_chat_at(&root, "revoked").unwrap().revision;
    let err = write_chat_at(&root, "revoked", "---\n---\n\nturn\n", Some(&revision)).unwrap_err();
    assert!(err.contains("local_ai_allowed"), "{err}");
}
