//! A chat listing is complete or it is an error — never a silently short list.
//! Chat projects drop assignments for chats a successful listing lacks
//! (src/services/chatFolders.ts pruneAssignments), so an unreadable chats
//! folder answering "no chats" would strip every project of its chats.

use super::*;

#[test]
fn a_missing_chats_folder_is_a_complete_empty_list() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(list_chats_at(tmp.path()).unwrap().is_empty());
}

#[test]
fn an_unreadable_chats_folder_is_an_error_not_an_empty_list() {
    let tmp = tempfile::tempdir().unwrap();
    // a file where the folder should be: read_dir fails with something other
    // than NotFound, exactly the case the old lister answered with []
    fs::write(tmp.path().join("chats"), "not a folder").unwrap();
    match list_chats_at(tmp.path()) {
        Ok(chats) => panic!("listed {} chats from an unreadable folder", chats.len()),
        Err(error) => assert!(error.contains("couldn't list the chats folder"), "{error}"),
    }
}

#[test]
fn a_readable_folder_lists_every_chat() {
    let tmp = tempfile::tempdir().unwrap();
    fs::create_dir_all(tmp.path().join("chats")).unwrap();
    for slug in ["alpha", "beta"] {
        write_chat_at(tmp.path(), slug, "---\ntitle: Synthetic\n---\nbody\n", None).unwrap();
    }
    let slugs: Vec<String> = list_chats_at(tmp.path()).unwrap().into_iter().map(|c| c.slug).collect();
    assert_eq!(slugs, ["alpha", "beta"]);
}
