//! Chat audit 2026-11-24: no chat file is ever replaced by another one. A new
//! chat refuses a taken name (D1), Trash and Archive keep every chat they are
//! given (D2), and a rename never lands on another chat (D6).

use super::*;

fn vault() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(dir.path()).unwrap();
    (dir, root)
}

fn chat(root: &Path, slug: &str, text: &str) {
    write_chat_at(root, slug, &format!("---\ntitle: {slug}\n---\n\n{text}\n"), None).unwrap();
}

fn read(path: PathBuf) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn trash_and_archive_keep_every_chat_with_the_same_name() {
    for bucket in ["trash", "archive"] {
        let (_dir, root) = vault();
        for text in ["first", "second", "third"] {
            chat(&root, "hi", text);
            move_chat_to_bucket_at(&root, "hi", bucket).unwrap();
        }
        let bin = root.join("chats").join(bucket);
        assert!(read(bin.join("hi.md")).contains("first"), "{bucket}");
        assert!(read(bin.join("hi-2.md")).contains("second"), "{bucket}");
        assert!(read(bin.join("hi-3.md")).contains("third"), "{bucket}");
        assert!(!root.join("chats/hi.md").exists());
    }
}

#[test]
fn a_kept_name_stays_a_chat_name_within_the_length_limit() {
    let (_dir, root) = vault();
    let long = "a".repeat(80);
    for text in ["first", "second"] {
        chat(&root, &long, text);
        move_chat_to_bucket_at(&root, &long, "trash").unwrap();
    }
    let second = format!("{}-2", "a".repeat(78));
    assert!(read(root.join(format!("chats/trash/{second}.md"))).contains("second"));
    assert!(safe_slug(&second).is_ok());
    assert_eq!(chat_moves::numbered_chat_slug("a-b-", 2), "a-b-2");
}

#[test]
fn a_missing_chat_is_not_found_and_moves_nothing() {
    let (_dir, root) = vault();
    let error = move_chat_to_bucket_at(&root, "gone", "trash").unwrap_err();
    assert!(error.contains("chat not found"), "{error}");
}

#[test]
fn a_rename_never_lands_on_another_chat() {
    let (_dir, root) = vault();
    chat(&root, "plan", "the plan");
    chat(&root, "notes", "the notes");
    let error = rename_chat_at(&root, "plan", "notes").unwrap_err();
    assert!(error.contains("already exists"), "{error}");
    assert!(read(root.join("chats/plan.md")).contains("the plan"));
    assert!(read(root.join("chats/notes.md")).contains("the notes"));

    assert_eq!(rename_chat_at(&root, "plan", "week").unwrap(), "week");
    assert!(read(root.join("chats/week.md")).contains("the plan"));
    assert!(!root.join("chats/plan.md").exists());
    assert_eq!(rename_chat_at(&root, "week", "week").unwrap(), "week");
    assert!(rename_chat_at(&root, "plan", "other").unwrap_err().contains("chat not found"));
}

// The rename's own refusal, without the earlier look at the target that hides
// a race: whatever appears at the destination is never replaced (D6).
#[test]
fn the_no_replace_move_refuses_a_taken_destination_and_keeps_both_files() {
    let (_dir, root) = vault();
    let from = root.join("from.md");
    let to = root.join("to.md");
    fs::write(&from, "mine").unwrap();
    fs::write(&to, "theirs").unwrap();
    let error = crate::fsutil::rename_no_replace(&from, &to).unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(read(from.clone()), "mine");
    assert_eq!(read(to.clone()), "theirs");

    fs::remove_file(&to).unwrap();
    crate::fsutil::rename_no_replace(&from, &to).unwrap();
    assert_eq!(read(to), "mine");
    assert!(!from.exists());
}

// D1 in Rust: a create presents no revision and never replaces a chat, even
// one that appeared after the caller last looked.
#[test]
fn a_create_never_replaces_a_chat_that_exists() {
    let (_dir, root) = vault();
    chat(&root, "hi", "first");
    let error = write_chat_at(&root, "hi", "---\ntitle: hi\n---\n\nsecond\n", None).unwrap_err();
    assert!(error.contains("chat already exists: hi"), "{error}");
    assert!(read(root.join("chats/hi.md")).contains("first"));
}
