use super::tests::test_workspace;
use super::*;
use tempfile::TempDir;

#[test]
fn remote_references_omit_secure_home_files() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    for rel in ["Secure notes/plan.csv", "wiki/_secure/ledger.xlsx", "Storage/public.csv"] {
        fs::create_dir_all(workspace.store.root().join(Path::new(rel).parent().unwrap()))
            .unwrap();
        fs::write(workspace.store.root().join(rel), "ordinary file contents").unwrap();
    }
    assert!(!workspace.reference_visible_to_remote("Secure notes/plan.csv"));
    assert!(!workspace.reference_visible_to_remote("wiki/_secure/ledger.xlsx"));
    assert!(workspace.reference_visible_to_remote("Storage/public.csv"));
    let filtered = workspace.filter_reference_nodes(vec![
        MainNode::Note { note: "Secure notes/plan.csv".into() },
        MainNode::Note { note: "wiki/_secure/ledger.xlsx".into() },
        MainNode::Note { note: "Storage/public.csv".into() },
    ]);
    assert_eq!(filtered.len(), 1);
    assert!(main_contains(&filtered, "Storage/public.csv"));
}

#[test]
fn remote_board_paths_in_secure_homes_are_hidden_too() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    let rel = "Secure notes/sketch.excalidraw";
    fs::create_dir_all(workspace.store.root().join("Secure notes")).unwrap();
    let body = empty_board("", "");
    fs::write(workspace.store.root().join(rel), &body).unwrap();
    assert!(!workspace.reference_visible_to_remote(rel));
    assert!(!workspace
        .list_remote(100)
        .unwrap()
        .notes
        .iter()
        .any(|meta| meta.id == rel));
    assert!(workspace.read_board(rel).is_err());
    let revision = revision(body.as_bytes());
    assert!(workspace.update_board(rel, &body, &revision).is_err());
    assert!(workspace.apply_board(rel, &[], &revision, None, None).is_err());
}
