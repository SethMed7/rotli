//! A new notes folder is born with Inbox and one welcome note: Rotli's own,
//! pinned byte for byte, or a host's (`HostWords::welcome_note`), named from
//! its own heading.

use super::tests::{bare, fresh};
use super::*;

#[test]
fn first_run_creates_inbox_and_one_welcome_note() {
    let (_dir, mut store) = fresh();
    assert!(store.root().join("Inbox").is_dir());
    assert!(store.root().join(DOT_DIR).is_dir());
    let list = store.list().unwrap();
    assert_eq!(
        list.notes.len(),
        1,
        "exactly ONE welcome note, no demo corpus"
    );
    let welcome = &list.notes[0];
    assert_eq!(welcome.folder_id, "Inbox");
    assert_eq!(welcome.title, "Welcome to rotli");
    // it opens cleanly elsewhere: valid fence, body below
    let rel = store.index.get(&welcome.id).unwrap();
    let text = fs::read_to_string(store.root().join(rel)).unwrap();
    assert_eq!(rel, "Inbox/welcome-to-rotli.md");
    assert!(text.starts_with("---\nid: "));
    assert!(text.contains("\n---\n\n# Welcome to rotli"));
    // and the editor sees no frontmatter
    let doc = store.read(&welcome.id).unwrap();
    assert!(doc.body.starts_with("# Welcome to rotli"));
    // Rotli's note is pinned byte for byte, under its own file name
    let shipped = text.split_once("\n---\n\n").unwrap().1;
    assert_eq!(
        format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(shipped)),
        "2faa611ef6c54beb64dee5692e18a2cdc8a9823111da771331f85ccdf1789b77"
    );
    // opening the same root again is NOT a first run
    drop(store);
    let mut again = CorpusStore::open(_dir.path().join("corpus")).unwrap();
    again.os_trash = false;
    assert_eq!(again.list().unwrap().notes.len(), 1);
    // a host's own first note is written instead, named from its own heading
    let body = "# Welcome to Synthetic\n\nA synthetic first note.\n";
    let words = crate::app_identity::HostWords { welcome_note: Some(body.into()), ..Default::default() };
    let (_other, mut host) = bare();
    host.first_run(words.welcome_note.as_deref()).unwrap();
    let list = host.list().unwrap();
    assert_eq!((list.notes.len(), list.notes[0].title.as_str()), (1, "Welcome to Synthetic"));
    let rel = &host.index[&list.notes[0].id];
    assert_eq!(rel, "Inbox/welcome-to-synthetic.md");
    let text = fs::read_to_string(host.root().join(rel)).unwrap();
    assert_eq!(text.split_once("\n---\n\n").unwrap().1, body);
}
