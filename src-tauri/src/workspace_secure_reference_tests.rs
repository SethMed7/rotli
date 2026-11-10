use super::tests::test_workspace;
use crate::corpus::review_tests::{
    alternating_memex, assert_nothing_private, with_canary, CANARY, HARBOR_BODY, HARBOR_TITLE, OUTSIDE_NOTE, PRIVATE,
};
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

/// Review 2026-11-09 #1 through the CLI agents use (`rotli notes search`,
/// `list`, `query`): the walk cached a secure version with a canary, the
/// note went public, and the cached title and snippet rode out on the
/// approval of the public bytes.
#[test]
fn the_notes_cli_shows_agents_only_the_bytes_the_gate_judged() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let meta = ws.create_note(HARBOR_TITLE, HARBOR_BODY, MAIN_ROOT).unwrap();
    let local = ws.local_id(&meta.id).unwrap();
    let abs = temp.path().join(ws.store.resolve_note_rel(&local).unwrap());
    let public = fs::read_to_string(&abs).unwrap();
    fs::write(&abs, with_canary(&public)).unwrap();
    let _ = ws.store.search("harbor", 10, false).unwrap(); // the walk caches the secure version
    fs::write(&abs, &public).unwrap();

    let searched = serde_json::to_string(&ws.search_remote("harbor", 10).unwrap()).unwrap();
    assert!(searched.contains(HARBOR_TITLE) && !searched.contains(CANARY), "{searched}");
    let listed = serde_json::to_string(&ws.list_remote(50).unwrap()).unwrap();
    assert!(listed.contains(HARBOR_TITLE) && !listed.contains(CANARY), "{listed}");
    let queried = serde_json::to_string(&ws.query_remote("harbor", 50).unwrap()).unwrap();
    assert!(!queried.contains(CANARY), "{queried}");
}

/// Review pass on #4 and #5 through the CLI agents use: `rotli notes read`
/// refuses a note whose file became a hard link to a file outside the vault,
/// and `rotli notes move` leaves a note locked while the move waited.
#[cfg(unix)]
#[test]
fn the_notes_cli_refuses_hard_links_and_moves_no_note_locked_meanwhile() {
    let temp = TempDir::new().unwrap();
    let outside = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let linked = ws.create_note("Ledger link", "ordinary words", MAIN_ROOT).unwrap();
    let local = ws.local_id(&linked.id).unwrap();
    let abs = temp.path().join(ws.store.resolve_note_rel(&local).unwrap());
    let far = outside.path().join("far.md");
    fs::write(&far, OUTSIDE_NOTE).unwrap();
    fs::remove_file(&abs).unwrap();
    fs::hard_link(&far, &abs).unwrap();
    assert!(ws.read_note(&local).is_err(), "rotli notes read");

    ws.store.create_folder("Projects", None).unwrap();
    let ferry = ws.create_note("Ferry timetable", "boats at noon", MAIN_ROOT).unwrap();
    let local = ws.local_id(&ferry.id).unwrap();
    let abs = temp.path().join(ws.store.resolve_note_rel(&local).unwrap());
    let (held, wait_for_hold) = std::sync::mpsc::channel();
    let writer = {
        let abs = abs.clone();
        std::thread::spawn(move || {
            crate::fsutil::with_file_lock(&abs, || {
                held.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(300));
                let text = fs::read_to_string(&abs).unwrap();
                fs::write(&abs, text.replacen("---\n", "---\nlocked: true\n", 1)).unwrap();
                Ok(())
            })
            .unwrap();
        })
    };
    wait_for_hold.recv().unwrap();
    let moved = ws.move_note(&local, "Projects");
    writer.join().unwrap();
    assert!(moved.expect_err("rotli notes move refuses").contains("locked"));
    assert!(abs.is_file());
}

/// Second review #1 through the CLI agents use: search, list (its folder rows
/// included), and query carry no field from the cached secure version.
#[test]
fn the_notes_cli_rows_carry_no_field_from_the_cached_version() {
    let temp = TempDir::new().unwrap();
    let alt = alternating_memex(temp.path());
    let mut ws = test_workspace(&temp);
    let warmed = serde_json::to_string(&ws.store.list().unwrap()).unwrap();
    assert!(warmed.contains(PRIVATE), "the walk cached the secure version");
    let _ = ws.store.search("harbor", 10, false).unwrap();
    fs::write(&alt.abs, &alt.public).unwrap();

    let searched = serde_json::to_string(&ws.search_remote("harbor", 10).unwrap()).unwrap();
    assert!(searched.contains(HARBOR_TITLE), "{searched}");
    assert_nothing_private(&searched);
    let listed = serde_json::to_string(&ws.list_remote(50).unwrap()).unwrap();
    assert!(listed.contains(HARBOR_TITLE), "{listed}");
    assert_nothing_private(&listed);
    assert_nothing_private(&serde_json::to_string(&ws.query_remote("harbor", 50).unwrap()).unwrap());
}
