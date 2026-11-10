//! Second review of PR #267 (#3): the memex reader and chat transcript reads
//! followed a hard link to a file outside the vault.

use super::*;
use crate::fsutil::hard_link_outside;

#[test]
fn a_hard_linked_vault_file_or_transcript_is_never_read() {
    let temp = tempfile::TempDir::new().unwrap();
    let root = std::fs::canonicalize(temp.path()).unwrap();
    std::fs::write(root.join("plain.md"), "an ordinary file").unwrap();
    assert_eq!(read_at(&root, "plain.md").unwrap(), "an ordinary file", "the reader works on its own files");
    let _inbox = hard_link_outside(&root.join("inbox.md"), b"words from beyond the vault");
    assert!(read_at(&root, "inbox.md").unwrap_err().contains("of its own"), "the generic memex reader");
    let chat = root.join(crate::vault_roles::chats_dir(&root)).join("planning.md");
    let _chat = hard_link_outside(&chat, b"---\ntitle: planning\n---\nwords from beyond the vault\n");
    let refused = read_chat_at(&root, "planning").err().unwrap_or_default();
    assert!(refused.contains("of its own"), "a chat transcript: {refused}");
}
