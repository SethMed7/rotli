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

#[test]
fn remote_metrics_and_references_hide_keyword_protected_boards_and_files() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    fs::create_dir_all(workspace.store.root().join("Storage")).unwrap();
    workspace
        .store
        .dot_write("settings", r#"{"librarianRules":{"secureKeywords":["bank"]}}"#)
        .unwrap();
    let board = empty_board("", "");
    for (rel, body) in [
        ("Storage/bank-plan.csv", "ordinary,contents"),
        ("Storage/bank-sketch.excalidraw", board.as_str()),
    ] {
        fs::write(workspace.store.root().join(rel), body).unwrap();
        assert!(!workspace.reference_visible_to_remote(rel), "{rel}");
    }
    let listed = workspace.list_remote(100).unwrap();
    assert!(!listed.notes.iter().any(|meta| meta.id.contains("bank")));
    let metrics = workspace.metrics().unwrap();
    assert_eq!(metrics.boards, 0);
    assert_eq!(metrics.files, 0);
}

#[test]
fn uppercase_markdown_frontmatter_is_refused_in_remote_agent_routes() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    let before = workspace.metrics().unwrap().visible_notes;
    let rel = "Storage/private.MD";
    fs::create_dir_all(workspace.store.root().join("Storage")).unwrap();
    fs::write(
        workspace.store.root().join(rel),
        "---\nsecure: true\n---\n# Private\n\nordinary words",
    )
    .unwrap();
    assert!(!workspace.reference_visible_to_remote(rel));
    assert!(workspace.store.read_for_ai(rel, false).is_err());
    assert!(!workspace
        .list_remote(100)
        .unwrap()
        .notes
        .iter()
        .any(|meta| meta.title == "Private"));
    assert_eq!(workspace.metrics().unwrap().visible_notes, before);
}

#[test]
fn uppercase_board_with_secret_shaped_scene_is_not_a_remote_file() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    let rel = "Storage/private.EXCALIDRAW";
    fs::create_dir_all(workspace.store.root().join("Storage")).unwrap();
    fs::write(
        workspace.store.root().join(rel),
        empty_board("-----BEGIN RSA PRIVATE KEY-----", ""),
    )
    .unwrap();
    assert!(!workspace.reference_visible_to_remote(rel));
    assert!(!workspace.list_remote(100).unwrap().notes.iter().any(|meta| meta.id == rel));
}

/// A board Excalidraw saved carries float coordinates whose fractional digits
/// can pass Luhn (2026-10-13: a real board was refused to agents for this).
/// They are not card numbers; a real card number in a text element still is.
#[test]
fn board_coordinates_are_not_card_numbers_but_a_card_in_text_is() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    let board = workspace.create_board("Company breakdown", "", "", MAIN_ROOT).unwrap();
    let local = workspace.local_id(&board.id).unwrap();
    let body = workspace.store.read_board(&local).unwrap().body;
    let mut scene: Value = serde_json::from_str(&body).unwrap();
    let element = |text: &str| {
        json!({
            "id": "org-chart-title", "type": "text", "text": text,
            "x": -2045.6097236063079, "y": 17.140276393692147,
            "width": 3935.2297743867343, "height": 1436.7200927734375
        })
    };
    scene["elements"] = json!([element("Org chart")]);
    workspace.store.write_board(&local, &serde_json::to_string(&scene).unwrap()).unwrap();
    let read = workspace.read_board(&local).expect("float coordinates are not a card number");
    workspace
        .apply_board(&local, &[], &read.revision, Some("still readable"), None)
        .expect("and the board takes an agent's edit");

    scene["elements"] = json!([element("pay with 4242424242424242")]);
    workspace.store.write_board(&local, &serde_json::to_string(&scene).unwrap()).unwrap();
    let err = workspace.read_board(&local).unwrap_err();
    assert!(err.contains("connected agents"), "{err}");
}

#[test]
fn remote_listing_and_metrics_hide_secret_shaped_ordinary_files() {
    let temp = TempDir::new().unwrap();
    let mut workspace = test_workspace(&temp);
    fs::create_dir_all(workspace.store.root().join("Storage")).unwrap();
    let rel = "Storage/ordinary.csv";
    fs::write(workspace.store.root().join(rel), "card,4242 4242 4242 4242").unwrap();
    assert!(!workspace.reference_visible_to_remote(rel));
    assert!(!workspace.list_remote(100).unwrap().notes.iter().any(|meta| meta.id == rel));
    assert_eq!(workspace.metrics().unwrap().files, 0);
}

#[test]
fn workspace_policy_describes_secure_home_and_keyword_board_protection() {
    let privacy = workspace_policy()["privacy"].as_str().unwrap().to_lowercase();
    assert!(privacy.contains("secure homes"));
    assert!(privacy.contains("keyword"));
}
