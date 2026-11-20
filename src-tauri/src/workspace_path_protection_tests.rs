//! Codex re-checks of pull request 302 (2026-11-20), against what shipped in
//! 1.9.4: each place an agent was shown a protected path, run end to end
//! through the workspace's listing, metrics, search, and reads. Every case
//! here leaked on origin/dev before `protected_path`.

use super::tests::test_workspace;
use super::*;
use tempfile::TempDir;

fn put(root: &Path, rel: &str, text: &str) {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, text).unwrap();
}

fn vault(keyword: Option<&str>) -> TempDir {
    let temp = TempDir::new().unwrap();
    fs::write(temp.path().join("memex.json"), "{\"id\":\"mx_path_protection\"}\n").unwrap();
    if let Some(keyword) = keyword {
        put(temp.path(), ".rotli/settings.json", &format!("{{\"librarianRules\":{{\"secureKeywords\":[\"{keyword}\"]}}}}\n"));
    }
    put(temp.path(), "wiki/Projects/open.md", "---\nid: 01PATHOPEN00000000000000000\n---\n# Open\n\nplain words\n");
    temp
}

/// What an agent can learn from the vault: the listing at both ends of the
/// limit, a search, and the metrics.
fn answers(temp: &TempDir) -> String {
    let mut ws = test_workspace(temp);
    let mut seen = String::new();
    for limit in [0, 100] {
        seen += &serde_json::to_string(&ws.list_remote(limit).unwrap()).unwrap();
    }
    seen += &serde_json::to_string(&ws.search_remote("plain", 100).unwrap()).unwrap();
    // a query also returns a public note's own frontmatter values: the note's
    // text, like its body, not a path Rotli derived, so only the derived
    // fields are checked here
    for row in ws.query_remote(r#"title:~"e""#, 100).unwrap().notes {
        seen += &format!("{} {} {}", row.id, row.title, row.path);
    }
    seen += &serde_json::to_string(&ws.metrics().unwrap()).unwrap();
    seen
}

fn assert_hidden(temp: &TempDir, markers: &[&str]) {
    let seen = answers(temp);
    for marker in markers {
        assert!(!seen.contains(marker), "{marker:?} reached an agent: {seen}");
    }
}

fn metrics(temp: &TempDir) -> (usize, usize, usize, usize) {
    let mut ws = test_workspace(temp);
    let m = ws.metrics().unwrap();
    (m.visible_notes, m.boards, m.files, m.physical_folders)
}

#[test]
fn a_case_or_unicode_variant_of_the_secure_home_is_the_secure_home() {
    for home in ["_ſecure", "_SECURE", "_Secure"] {
        let temp = vault(None);
        put(temp.path(), &format!("wiki/{home}/Sub/n.md"), "# Hidden note\n\nplain words\n");
        put(temp.path(), &format!("wiki/{home}/Sub/b.excalidraw"), "{\"elements\":[]}");
        put(temp.path(), &format!("wiki/{home}/Sub/f.csv"), "a,b\n1,2\n");
        assert_hidden(&temp, &[home, "Hidden note", "f.csv"]);
        assert_eq!(metrics(&temp), metrics(&vault(None)), "{home}");
    }
}

#[test]
fn a_keyword_matches_every_spelling_and_protects_everything_under_it() {
    let temp = vault(Some("Straße"));
    put(temp.path(), "wiki/STRASSE/n.md", "# Plain\n\nplain words\n");
    assert_hidden(&temp, &["STRASSE"]);
    let temp = vault(Some("Juniper"));
    put(temp.path(), "wiki/Projects/jUNIPER/Ordinary/n.md", "# Plain\n\nplain words\n");
    put(temp.path(), "wiki/Projects/jUNIPER/Ordinary/b.excalidraw", "{\"elements\":[]}");
    put(temp.path(), "wiki/Projects/jUNIPER/Ordinary/f.csv", "a,b\n1,2\n");
    assert_hidden(&temp, &["jUNIPER", "Ordinary"]);
}

#[cfg(unix)]
#[test]
fn a_shelf_or_note_id_never_names_a_protected_or_unclean_path() {
    let temp = vault(None);
    put(temp.path(), "wiki/_secure/DirectExample/s.md", "# Secret\n\nplain words\n");
    put(temp.path(), "wiki/_secure/PrivateProject/s.md", "# Secret\n\nplain words\n");
    put(temp.path(), "wiki/_secure/Win/s.md", "# Secret\n\nplain words\n");
    put(temp.path(), "wiki/_secure/Deep/s.md", "# Secret\n\nplain words\n");
    std::os::unix::fs::symlink(temp.path().join("wiki/_secure"), temp.path().join("wiki/Link")).unwrap();
    let shelved = |shelf: &str, title: &str| format!("---\nshelf: [{shelf}]\n---\n# {title}\n\nplain words\n");
    put(temp.path(), "wiki/Projects/direct.md", &shelved("wiki/_secure/DirectExample", "Direct"));
    put(temp.path(), "wiki/Projects/up.md", &shelved("wiki/../outside", "Up"));
    put(temp.path(), "wiki/Projects/dot.md", &shelved("wiki/./dot", "Dot"));
    put(temp.path(), "wiki/Projects/double.md", &shelved("wiki//double", "Double"));
    put(temp.path(), "wiki/Projects/win.md", &shelved("wiki\\\\_secure\\\\Win", "Win"));
    put(temp.path(), "wiki/Projects/link.md", &shelved("wiki/Link/Deep", "Link"));
    put(temp.path(), "wiki/Projects/decoy.md", "---\nid: wiki/_secure/PrivateProject\n---\n# Decoy\n\nplain words\n");
    assert_hidden(&temp, &["_secure", "DirectExample", "PrivateProject", "outside", "/./", "//", "\\\\", "Link/Deep", "Decoy"]);
    // the public notes stay listed, on the folder they live in
    let mut ws = test_workspace(&temp);
    let listed = ws.list_remote(100).unwrap();
    for title in ["Direct", "Up", "Dot", "Double", "Win", "Link"] {
        let row = listed.notes.iter().find(|row| row.title == title).unwrap_or_else(|| panic!("{title} listed"));
        assert_eq!(row.folder_id, "wiki/Projects", "{title}");
    }
}

#[test]
fn a_protected_note_is_refused_to_a_read_by_any_spelling() {
    let temp = vault(None);
    put(temp.path(), "wiki/_ſecure/n.md", "---\nid: 01PATHHIDDEN000000000000000\n---\n# Hidden\n\nplain words\n");
    let mut ws = test_workspace(&temp);
    ws.list_remote(100).unwrap();
    assert!(ws.read_note("01PATHHIDDEN000000000000000").is_err());
    assert!(ws.read_note("wiki/_ſecure/n.md").is_err());
}

/// The secure home spelled canonically on disk, and asked for by an agent in
/// another spelling the Mac's disk opens as the same file, or through a
/// symlink. Each refusal has a public control asked the same way, so the
/// request is known to reach the file.
#[cfg(target_os = "macos")]
#[test]
fn a_request_in_another_spelling_or_through_a_symlink_is_refused() {
    let temp = vault(None);
    let root = temp.path();
    put(root, "wiki/_secure/n.md", "# Hidden\n\nplain words\n");
    put(root, "wiki/_secure/b.excalidraw", "{\"elements\":[]}");
    put(root, "wiki/_secure/f.csv", "a,b\n1,2\n");
    put(root, "wiki/Projects/c.excalidraw", "{\"elements\":[]}");
    put(root, "wiki/Projects/pub.csv", "a,b\n1,2\n");
    std::os::unix::fs::symlink(root.join("wiki/_secure"), root.join("wiki/Link")).unwrap();
    let links = "[a](wiki/_\u{17f}ecure/f.csv) [b](wiki/_SECURE/f.csv) [c](wiki/Link/f.csv) [d](wiki/PROJECTS/pub.csv)";
    put(root, "wiki/Projects/links.md", &format!("---\nid: 01PATHLINKS0000000000000000\n---\n# Links\n\n{links}\n"));
    let mut ws = test_workspace(&temp);
    for spelling in ["wiki/_\u{17f}ecure", "wiki/_SECURE", "wiki/_Secure", "wiki/Link"] {
        assert!(ws.store.read_for_ai(&format!("{spelling}/n.md"), false).is_err(), "{spelling} note");
        assert!(ws.read_board_for_remote(&format!("{spelling}/b.excalidraw")).is_err(), "{spelling} board");
        assert!(ws.store.file_for_ai(&format!("{spelling}/f.csv"), false).is_err(), "{spelling} file");
    }
    assert!(ws.store.read_for_ai("wiki/PROJECTS/open.md", false).is_ok(), "control note");
    assert!(ws.read_board_for_remote("wiki/PROJECTS/c.excalidraw").is_ok(), "control board");
    assert!(ws.store.file_for_ai("wiki/PROJECTS/pub.csv", false).is_ok(), "control file");
    let described = ws.attachments("01PATHLINKS0000000000000000", Some(64), false).unwrap();
    let available: Vec<bool> =
        described["attachments"].as_array().unwrap().iter().map(|a| a["available"].as_bool().unwrap()).collect();
    assert_eq!(available, vec![false, false, false, true], "{described}");
}

/// Opus review of pull request 304, #1: an archived or trashed note carries
/// `origin`, the folder it came from, which Rotli writes itself; it named a
/// protected folder to every agent lane.
#[test]
fn an_archived_notes_origin_never_names_a_protected_folder() {
    let temp = vault(Some("Juniper"));
    put(temp.path(), "archive/plan2.md", "---\nid: 01PATHPLAN20000000000000000\norigin: wiki/Projects/Juniper\n---\n# Plan two\n\nplain words\n");
    put(temp.path(), "archive/plan3.md", "---\nid: 01PATHPLAN30000000000000000\norigin: wiki/_secure/PrivateProject\n---\n# Plan three\n\nplain words\n");
    put(temp.path(), "archive/plan4.md", "---\nid: 01PATHPLAN40000000000000000\norigin: wiki/Projects\n---\n# Plan four\n\nplain words\n");
    assert_hidden(&temp, &["Juniper", "PrivateProject", "_secure"]);
    let mut ws = test_workspace(&temp);
    for id in ["01PATHPLAN20000000000000000", "01PATHPLAN30000000000000000"] {
        assert_eq!(ws.read_note(id).unwrap().note.origin, None, "{id}");
    }
    // an ordinary origin still travels
    assert_eq!(ws.read_note("01PATHPLAN40000000000000000").unwrap().note.origin.as_deref(), Some("wiki/Projects"));
}

/// The same, archived by the person in the app (Rotli writes `origin`).
#[test]
fn a_note_archived_out_of_a_keyword_folder_names_no_origin() {
    let temp = TempDir::new().unwrap();
    put(temp.path(), ".rotli/settings.json", "{\"librarianRules\":{\"secureKeywords\":[\"Juniper\"]}}\n");
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Plan", "plain words", MAIN_ROOT).unwrap();
    ws.store.move_note(&note.id, "Projects/Juniper").unwrap();
    let archived = ws.store.move_note(&note.id, "Archive").unwrap();
    assert_eq!(archived.origin.as_deref(), Some("Projects/Juniper"), "the person's own row keeps it");
    let mut ws = test_workspace(&temp);
    let listed = serde_json::to_string(&ws.list_remote(50).unwrap()).unwrap();
    assert!(!listed.contains("Juniper"), "{listed}");
    let local = ws.local_id(&note.id).unwrap();
    assert_eq!(ws.read_note(&local).unwrap().note.origin, None);
}
