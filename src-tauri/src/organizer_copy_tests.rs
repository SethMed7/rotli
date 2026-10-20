// The Librarian on a copy (slice 4c-2): it does in a copy what it does in a
// Rotli vault, in the person's own tree; never in a folder connected in place.

use super::*;
use crate::librarian_map::tests::write;
use std::fs;
use std::sync::atomic::AtomicUsize;
use tempfile::TempDir;

/// A copy of an Obsidian vault: a loose note at the root (with an image) that a
/// Projects note links to, an inbox, nested Projects folders, a journal, and the
/// templates and files folders Obsidian's settings name.
fn garden_copy(in_place: bool) -> (TempDir, PathBuf, CorpusState, OrganizerHandle) {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("Garden (Rotli)");
    write(&root, "Stray thought.md", "# Stray thought\n\nNorthwind wants a quote.\n\n![card](files/card.png)\n");
    write(&root, "files/card.png", "png");
    write(&root, "Inbox/Ring the bank.md", "# Ring the bank\n\nAsk Northwind about the loan.\n");
    write(&root, "Projects/Budget.md", "# Budget\n\nSee [the idea](../Stray%20thought.md).\n");
    write(&root, "Projects/Vendors/Northwind.md", "# Northwind\n\nOur paper supplier.\n");
    write(&root, "Journal/2026-10-16.md", "# Today\n\nNothing yet.\n");
    write(&root, "Admin/Templates/Standup.md", "# Standup {{date}}\n");
    write(&root, ".obsidian/templates.json", r#"{"folder":"Admin/Templates"}"#);
    write(&root, ".obsidian/app.json", r#"{"attachmentFolderPath":"files"}"#);
    if in_place {
        crate::vault_roles::mark_in_place(&root).unwrap();
    } else {
        crate::vault_roles::mark_imported(&root).unwrap();
    }
    let store = corpus::CorpusStore::open(root.clone()).unwrap();
    let root = store.root().to_path_buf();
    let mut reg = corpus::CorpusRegistry::new("default".to_string());
    reg.insert("default".to_string(), store).unwrap();
    (dir, root, CorpusState(Mutex::new(reg)), OrganizerHandle::new())
}

fn trust(state: &CorpusState, rung: &str) {
    let settings = format!("{{\"organizerTrust\":\"{rung}\",\"organizerQuietSecs\":0}}");
    state.route("default", |s| s.dot_write("settings", &settings)).unwrap();
}

/// Classify answers the nested client folder; Enrich a plain annotation. The
/// classify prompt must offer the nested folder and never a set-aside one.
fn copy_transport(prompt: &str) -> Result<String, String> {
    if !prompt.contains("Pick the ONE best area") {
        return Ok("{\"summary\":\"one line\",\"tags\":[\"acme\"],\"links\":[]}".to_string());
    }
    let areas = prompt.split("Answer with").next().unwrap_or_default();
    assert!(areas.contains("- Projects/Vendors"), "{prompt}");
    assert!(!areas.contains("Templates") && !areas.contains("files"), "{prompt}");
    Ok("{\"area\":\"Projects/Vendors\",\"confidence\":0.95}".to_string())
}

fn cycle(root: &Path, state: &CorpusState, handle: &OrganizerHandle, rels: &[&str]) -> CycleReport {
    let paths: Vec<PathBuf> = rels.iter().map(|rel| root.join(rel)).collect();
    handle.enqueue(root, &paths);
    run_cycle(state, "default", root, &handle.0, &|| true, &copy_transport).unwrap()
}

fn note_files(root: &Path) -> Vec<(String, String)> {
    let mut rels = Vec::new();
    crate::librarian_map::collect_md(root, "", &mut rels);
    rels.sort();
    rels.into_iter().map(|rel| (fs::read_to_string(root.join(&rel)).unwrap(), rel)).collect()
}

#[test]
fn a_copys_areas_are_its_own_folders_and_their_folders() {
    let (_dir, root, _state, _handle) = garden_copy(false);
    let areas: Vec<String> = area_vocab(&root, false).into_iter().map(|(name, _)| name).collect();
    assert_eq!(areas, ["Journal", "Projects"], "templates and files hold nothing to file into");
    let targets: Vec<String> = area_vocab(&root, true).into_iter().map(|(name, _)| name).collect();
    assert_eq!(targets, ["Journal", "Projects", "Projects/Vendors"]);
}

#[test]
fn suggest_proposes_filing_root_and_inbox_notes_and_writes_no_note() {
    let (_dir, root, state, handle) = garden_copy(false);
    trust(&state, "suggest");
    let before = note_files(&root);

    let report = cycle(&root, &state, &handle, &["Stray thought.md", "Inbox/Ring the bank.md"]);

    assert!(report.proposals >= 2, "{report:?}");
    assert_eq!(note_files(&root), before, "Suggest only proposes");
    let journal = state.route("default", |s| s.journal_read()).unwrap();
    let filings: Vec<serde_json::Value> = journal
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .filter(|row| row["action"] == "file")
        .collect();
    assert_eq!(filings.len(), 2, "{journal}");
    let root_row = filings.iter().find(|row| row["noteId"] == "Stray thought.md").unwrap();
    assert_eq!((root_row["before"].as_str(), root_row["after"].as_str()), (Some(""), Some("Projects/Vendors")));
    assert!(root_row["noteUlid"].is_string(), "a copy's note carries its stable id");
}

#[test]
fn organize_files_a_root_note_into_a_nested_folder_and_keeps_its_links() {
    let (_dir, root, state, handle) = garden_copy(false);
    trust(&state, "organize");
    let id = state.route("default", |s| s.wire_id_of("Stray thought.md")).unwrap();

    let report = cycle(&root, &state, &handle, &["Stray thought.md"]);

    assert_eq!(report.errors, 0, "{report:?}");
    assert!(!root.join("Stray thought.md").exists());
    let filed = fs::read_to_string(root.join("Projects/Vendors/Stray thought.md")).unwrap();
    assert!(filed.contains("![card](../../files/card.png)"), "{filed}");
    let plan = fs::read_to_string(root.join("Projects/Budget.md")).unwrap();
    assert!(plan.contains("[the idea](Vendors/Stray%20thought.md)"), "{plan}");
    let rel = state.route("default", |s| s.resolve_note_rel(&id)).unwrap();
    assert_eq!(rel, "Projects/Vendors/Stray thought.md", "same id, so Main and views keep their slot");

    // Undo moves it back to the vault's root, links and all
    state.route("default", |s| s.filer_move(&id, "")).unwrap();
    let back = fs::read_to_string(root.join("Stray thought.md")).unwrap();
    assert!(back.contains("![card](files/card.png)"), "{back}");
    let budget = fs::read_to_string(root.join("Projects/Budget.md")).unwrap();
    assert!(budget.contains("[the idea](../Stray%20thought.md)"), "{budget}");
}

#[test]
fn a_locked_note_linking_to_it_keeps_the_note_where_it_is() {
    let (_dir, root, state, handle) = garden_copy(false);
    write(&root, "Journal/2026-10-17.md", "---\nlocked: true\n---\n# Kept\n\n[idea](../Stray%20thought.md)\n");
    trust(&state, "organize");

    let report = cycle(&root, &state, &handle, &["Stray thought.md"]);

    assert_eq!(report.errors, 1, "{report:?}");
    assert!(root.join("Stray thought.md").exists());
    let kept = fs::read_to_string(root.join("Journal/2026-10-17.md")).unwrap();
    assert!(kept.contains("[idea](../Stray%20thought.md)"));
}

#[test]
fn folder_notes_land_only_in_areas() {
    let (_dir, root, state, _handle) = garden_copy(false);
    state.route("default", |s| s.write_index("Projects", "# Projects\n\nWhat we are building.\n")).unwrap();
    assert!(root.join("Projects/_index.md").exists());
    for bad in ["Projects/Vendors", "", "../outside"] {
        assert!(state.route("default", |s| s.write_index(bad, "# x\n")).is_err(), "{bad}");
    }
    for rotli_owned in ["Trash (Rotli)", "files", "Admin/Templates", ".obsidian"] {
        let refused = state.route("default", |s| s.filer_move("Stray thought.md", rotli_owned));
        assert!(refused.is_err(), "{rotli_owned}");
    }
}

#[test]
fn a_folder_connected_in_place_is_refused_three_ways() {
    let (_dir, root, state, handle) = garden_copy(true);
    state
        .route("default", |s| {
            assert!(!s.librarian_writes(), "its switch reads off");
            assert!(!s.brain_enabled(), "the store's own gate");
            assert!(s.filer_move("Stray thought.md", "Projects").is_err(), "the filer refuses");
            Ok(())
        })
        .unwrap();
    trust(&state, "organize");
    let calls = AtomicUsize::new(0);
    let counting = |prompt: &str| {
        calls.fetch_add(1, Ordering::SeqCst);
        copy_transport(prompt)
    };
    handle.enqueue(&root, &[root.join("Stray thought.md")]);
    run_cycle(&state, "default", &root, &handle.0, &|| true, &counting).unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 0, "nothing is modeled");
    assert!(root.join("Stray thought.md").exists());
}

#[test]
fn a_rotli_vault_files_into_a_folder_inside_an_area_too() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("brain");
    write(&root, "memex.json", "{\"id\":\"mx_test123\",\"contract\":\"3.4\"}");
    write(&root, "wiki/_inbox/.keep", "");
    write(&root, "wiki/Projects/Vendors/Northwind.md", "# Acme\n");
    let targets: Vec<String> = area_vocab(&root, true).into_iter().map(|(name, _)| name).collect();
    assert!(targets.contains(&"Projects/Vendors".to_string()), "{targets:?}");

    let mut store = corpus::CorpusStore::open(root.clone()).unwrap();
    let note = store.create("wiki/_inbox", "# Call Acme\n").unwrap();
    for (area, ok) in [("Projects/Vendors", true), ("Projects/Nowhere", false)] {
        store.set_ai_field(&note.id, "area", area).unwrap();
        assert_eq!(store.file_note(&note.id).is_ok(), ok, "{area}");
    }
    assert!(store.resolve_note_rel(&note.id).unwrap().starts_with("wiki/Projects/Vendors/"));
}
