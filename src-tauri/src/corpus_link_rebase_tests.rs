use super::*;
use std::fs;
use tempfile::TempDir;

fn always(_: &str) -> bool {
    true
}

#[test]
fn a_moved_note_rebases_paths_and_keeps_everything_else() {
    let body = "\
![photo](../attachments/sun%20set.png) and [plan](Plan.md#steps \"title\")
[site](https://rotli.co) [mail](mailto:a@b.c) [top](#intro) [abs](/x.md)
![[Plan]] [[Plan|the plan]] ![old](storage:x.png) [out](../../../far.md)
`[code](Plan.md)` and <[angle](<Sub dir/a b.md>)>
```
[fenced](Plan.md)
```";
    let (out, changed) = rebase_body(body, "Inbox", "Work/Clients", &|_| None, &always);
    assert_eq!(changed, 3);
    assert_eq!(
        out,
        "\
![photo](../../attachments/sun%20set.png) and [plan](../../Inbox/Plan.md#steps \"title\")
[site](https://rotli.co) [mail](mailto:a@b.c) [top](#intro) [abs](/x.md)
![[Plan]] [[Plan|the plan]] ![old](storage:x.png) [out](../../../far.md)
`[code](Plan.md)` and <[angle](../../Inbox/Sub%20dir/a%20b.md)>
```
[fenced](Plan.md)
```"
    );
}

#[test]
fn a_link_to_a_missing_file_stays_as_written() {
    let body = "![gone](../nothing.png)";
    let (out, changed) = rebase_body(body, "Inbox", "Work/Clients", &|_| None, &|_| false);
    assert_eq!((out.as_str(), changed), (body, 0));
}

#[test]
fn a_linker_follows_only_the_note_that_moved() {
    let body = "[a](../Inbox/a.md) [b](../Inbox/b.md) ![a again](../Inbox/a.md)";
    let moved = |rel: &str| (rel == "Inbox/a.md").then(|| "Work/Clients/a.md".to_string());
    let (out, changed) = rebase_body(body, "Work", "Work", &moved, &always);
    assert_eq!(changed, 2);
    assert_eq!(out, "[a](Clients/a.md) [b](../Inbox/b.md) ![a again](Clients/a.md)");
}

#[test]
fn a_note_and_the_image_beside_it_moving_together_keep_their_link() {
    let body = "![](glaze.png) and ![](../shared/logo.png)";
    let moved = |rel: &str| (rel == "Studio/2023/glaze.png").then(|| "Kept/2023/glaze.png".to_string());
    let (out, changed) = rebase_body(body, "Studio/2023", "Kept/2023", &moved, &always);
    // the image moved with it, so its link stays; a file left behind is rebased
    assert_eq!(changed, 1, "{out}");
    assert_eq!(out, "![](glaze.png) and ![](../../Studio/shared/logo.png)");
}

use crate::librarian_map::tests::write;

/// A copy where an Inbox note links an image, one note links back to it, and a
/// locked journal entry links it too.
fn copy_with_linkers() -> (TempDir, std::path::PathBuf, CorpusStore, String) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("copy");
    write(&root, "Inbox/Call back.md", "# Call back\n\n![card](../attachments/card.png)\n");
    write(&root, "attachments/card.png", "png");
    write(
        &root,
        "Work/Plan.md",
        "---\nkeep: this exact line\n---\n# Plan\n\nSee [the call](../Inbox/Call%20back.md).\n",
    );
    write(
        &root,
        "Daily/2026-10-16.md",
        "---\nlocked: true\n---\n# Today\n\n[call](../Inbox/Call%20back.md)\n",
    );
    crate::vault_roles::mark_imported(&root).unwrap();
    let mut store = CorpusStore::open(root.clone()).unwrap();
    let id = store
        .list()
        .unwrap()
        .notes
        .into_iter()
        .find(|n| n.title == "Call back")
        .unwrap()
        .id;
    (dir, root, store, id)
}

#[test]
fn a_move_keeps_the_notes_links_and_its_linkers_working() {
    let (_dir, root, mut store, id) = copy_with_linkers();

    let meta = store.move_note(&id, "Work/Clients").unwrap();

    assert_eq!(meta.id, id, "the id is stable, so Main and views need nothing");
    let moved = fs::read_to_string(root.join("Work/Clients/Call back.md")).unwrap();
    assert!(moved.contains("![card](../../attachments/card.png)"), "{moved}");
    let plan = fs::read_to_string(root.join("Work/Plan.md")).unwrap();
    assert_eq!(
        plan,
        "---\nkeep: this exact line\n---\n# Plan\n\nSee [the call](Clients/Call%20back.md).\n"
    );
    // a person's move never edits a locked note; its link is left as written
    let daily = fs::read_to_string(root.join("Daily/2026-10-16.md")).unwrap();
    assert!(daily.contains("[call](../Inbox/Call%20back.md)"));
}

#[test]
fn an_agent_may_not_move_a_note_a_locked_note_links_to() {
    let (_dir, root, mut store, id) = copy_with_linkers();

    let refused = store.move_for_remote_agent(&id, "Work").unwrap_err();

    assert!(refused.contains("locked note links to it"), "{refused}");
    assert!(root.join("Inbox/Call back.md").exists());
}

#[test]
fn in_a_rotli_vault_a_linker_follows_a_rename_on_move_too() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    crate::corpus::tests::seed_memex(&root);
    write(&root, "wiki/_inbox/x1.md", "# Quarterly review\n\n![chart](../../storage/q3.png)\n");
    write(&root, "storage/q3.png", "png");
    write(&root, "wiki/Work/index-of-reviews.md", "# Reviews\n\n[Q3](../_inbox/x1.md)\n");
    let mut store = CorpusStore::open(root.clone()).unwrap();
    let id = store.list().unwrap().notes.into_iter().find(|n| n.title == "Quarterly review").unwrap().id;

    store.move_note(&id, "wiki/Work/Reviews").unwrap();

    let new_rel = store.resolve_note_rel(&id).unwrap();
    assert!(new_rel.starts_with("wiki/Work/Reviews/"), "{new_rel}");
    let moved = fs::read_to_string(root.join(&new_rel)).unwrap();
    assert!(moved.contains("![chart](../../../storage/q3.png)"), "{moved}");
    let index = fs::read_to_string(root.join("wiki/Work/index-of-reviews.md")).unwrap();
    let file = new_rel.trim_start_matches("wiki/Work/");
    assert!(index.contains(&format!("[Q3]({file})")), "{index}");
}
