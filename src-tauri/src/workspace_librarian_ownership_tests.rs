//! The second independent review of PR #295 (head 0cc50ce9): the Librarian's
//! pages are its own only by keys Rust wrote, a page record is a hint for a
//! positive id only, and withdrawal resolves a link as navigation does.

use std::fs;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::{handle_mcp_request_for_root, run_notes_cli, Workspace, CONNECTOR_ROOT, MAIN_ROOT};
use super::review_tests::hits;
use super::tests::{body_of, make_secure, mcp, ok, public_build, turn_on};
use super::*;
use crate::corpus::{merge_raw_frontmatter, raw_frontmatter_block, RAW_IMMUTABLE_KEYS};
use crate::frontmatter_keys::{frontmatter_key, frontmatter_names_key};

/// A secure note's work, and the index line that summarises it.
const WORK: &str = "Berthing schedule";
const SUMMARY: &str = "quayside marigold";

/// Every spelling YAML (or a careless editor) gives a key, other than the one
/// Rust writes.
fn other_spellings(key: &str) -> Vec<String> {
    vec![
        format!("  {key}: x"),
        format!("\t{key}: x"),
        format!("\"{key}\": x"),
        format!("'{key}': x"),
        format!("- {key}: x"),
        format!("? {key}"),
        format!("{key} : x"),
        format!("nested: {{{key}: x}}"),
        format!("nested: {{a: 1, \"{key}\": x}}"),
    ]
}

/// The mechanical guard for the class (AGENTS.md: a class of finding gets a
/// guard): no spelling of a Rust-owned key can be minted through the raw
/// metadata editor, the one metadata path that takes typed YAML; lines already
/// in the file survive byte for byte; and the canonical lines can't be removed.
#[test]
fn no_spelling_of_a_rust_owned_key_can_be_minted_through_the_metadata_editor() {
    let original = "---\nid: 01J\nmeta:\n  created: 2020\n---\n\n# Diary\n\nprose\n";
    for key in RAW_IMMUTABLE_KEYS {
        for spelling in other_spellings(key) {
            assert!(frontmatter_names_key(&spelling, key), "the shared parser reads {spelling:?} as {key}");
            assert!(!frontmatter_key(&spelling).is_some_and(|k| k.canonical && k.name == key), "{spelling:?} isn't the form Rust writes");
            let merged = merge_raw_frontmatter(original, &format!("id: 01J\nmeta:\n  created: 2020\n{spelling}\n")).unwrap();
            let block = raw_frontmatter_block(&merged);
            let minted: Vec<&str> = block.lines().filter(|line| frontmatter_names_key(line, key)).collect();
            let kept: Vec<&str> = if key == "id" { vec!["id: 01J"] } else if key == "created" { vec!["  created: 2020"] } else { vec![] };
            assert_eq!(minted, kept, "{key} via {spelling:?}:\n{merged}");
        }
    }
    // the Librarian's marker can't be removed through the editor either
    let page = "---\nid: 01P\ncreated_by: librarian\nlibrarian_page: index\n---\n\n# Librarian index\n";
    let merged = merge_raw_frontmatter(page, "id: 01P\n").unwrap();
    assert!(merged.contains("\ncreated_by: librarian\n") && merged.contains("\nlibrarian_page: index\n"), "{merged}");
}

/// Codex's reproduction: indented keys typed into a person's note made it the
/// Librarian's index, which `librarian_index` then rewrote without a proposal.
/// Through the editor the keys are dropped; written into the file by hand in
/// any spelling but Rust's, discovery still doesn't adopt the note.
#[test]
fn a_forged_marker_never_makes_a_persons_note_the_index() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    for how in ["editor", "indented", "quoted", "flow"] {
        let temp = TempDir::new().unwrap();
        turn_on(&temp);
        let mut ws = test_workspace(&temp);
        let person = ws.store.create_as("Inbox", "# Personal diary\n\nperson prose", false, None).unwrap();
        let rel = ws.store.resolve_note_rel(&person.id).unwrap();
        let path = ws.store.root().join(rel);
        let original = fs::read_to_string(&path).unwrap();
        let fields = raw_frontmatter_block(&original).trim().trim_start_matches("---").trim_end_matches("---").trim().to_string();
        let forged = match how {
            "editor" => merge_raw_frontmatter(&original, &format!("{fields}\n  created_by: librarian\n  librarian_page: index\n")).unwrap(),
            "indented" => original.replacen("---\n", "---\n  created_by: librarian\n  librarian_page: index\n", 1),
            "quoted" => original.replacen("---\n", "---\n\"created_by\": librarian\n'librarian_page': index\n", 1),
            _ => original.replacen("---\n", "---\nx: {created_by: librarian, librarian_page: index}\n", 1),
        };
        fs::write(&path, &forged).unwrap();
        let index = ok(mcp(&temp, INDEX, json!({"body":"- replacement prose"})));
        assert_ne!(index["id"], json!(person.id), "{how}");
        assert!(body_of(&mut ws, &person.id).contains("person prose"), "{how}");
    }
}

/// No agent tool on either server, and no `rotli notes` command, can write
/// `created_by` or `librarian_page` into a note: only the route's own page
/// creation does, so discovery can only ever find a page it made.
#[test]
fn no_agent_or_cli_path_can_write_the_page_keys() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let forged = "---\ncreated_by: librarian\nlibrarian_page: index\n---\nprose";
    let note = ws.create_note("Target", "words", MAIN_ROOT).unwrap();
    let call = |server: &str, name: &str, arguments: Value| {
        let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": arguments } });
        if server == "librarian" { return mcp(&temp, name, request["params"]["arguments"].clone()) }
        handle_mcp_request_for_root(&request, temp.path().to_path_buf(), false).unwrap()["result"].clone()
    };
    let revision = |ws: &mut Workspace| ws.read_note(&note.id).unwrap().revision;
    // every tool that writes, on both servers, with every text argument forged
    // (opening the app and the Word-document bridge need the running app)
    let tools = (SERVER.tools)().into_iter().map(|t| ("librarian", t)).chain(super::super::mcp_tools().into_iter().map(|t| ("workspace", t)));
    for (server, tool) in tools.filter(|(_, t)| t.pointer("/annotations/readOnlyHint") == Some(&json!(false))) {
        let name = tool["name"].as_str().unwrap();
        if name.ends_with("_open") || name.contains("document") {
            continue;
        }
        let mut arguments = serde_json::Map::new();
        for (property, schema) in tool["inputSchema"]["properties"].as_object().unwrap() {
            let value = match (property.as_str(), schema["type"].as_str()) {
                ("rootId", _) => continue,
                ("id", _) => json!(note.id),
                (key, _) if key.to_lowercase().contains("revision") => json!(revision(&mut ws)),
                (_, Some("string")) => schema["enum"].get(0).cloned().unwrap_or(json!(forged)),
                (_, Some("integer")) => json!(1),
                (_, Some("boolean")) => json!(false),
                (_, Some("array")) => json!([]),
                _ => continue,
            };
            arguments.insert(property.clone(), value);
        }
        let _ = call(server, name, Value::Object(arguments));
    }
    let cli = |args: &[&str]| {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        CONNECTOR_ROOT.with(|value| *value.borrow_mut() = Some((temp.path().to_path_buf(), false)));
        let result = run_notes_cli(&args, None);
        CONNECTOR_ROOT.with(|value| *value.borrow_mut() = None);
        result
    };
    let _ = cli(&["notes", "create", "--title", "Cli", "--body", forged]);
    let mut ws = test_workspace(&temp);
    let current = ws.read_note(&note.id).map(|read| read.revision).unwrap_or_default();
    let _ = cli(&["notes", "update", &note.id, "--body", forged, "--revision", &current]);

    let mut ws = test_workspace(&temp);
    let notes = ws.store.list().unwrap().notes.into_iter().filter(|meta| meta.kind == crate::corpus::NoteKind::Note);
    let mut pages = Vec::new();
    for meta in notes.collect::<Vec<_>>() {
        let rel = ws.store.resolve_note_rel(&meta.id).unwrap();
        let text = fs::read_to_string(ws.store.root().join(rel)).unwrap();
        let routes_own = [INDEX_TITLE, LOG_TITLE].contains(&meta.title.as_str());
        for line in raw_frontmatter_block(&text).lines() {
            for key in ["created_by", "librarian_page"] {
                if frontmatter_names_key(line, key) {
                    // Rust's own stamps: an agent's notes, and the route's two pages
                    assert!(line == "created_by: agent" || routes_own, "{}: {line}", meta.title);
                }
            }
        }
        if routes_own {
            pages.push(meta.title);
        }
    }
    pages.sort();
    assert!(pages.len() <= 2 && pages.windows(2).all(|pair| pair[0] != pair[1]), "one index and one log at most: {pages:?}");
}

/// Codex's reproduction: a record saying "no index" (or a row with no id)
/// turned discovery off, so a secure note's summary stayed searchable. A
/// record is a hint for a positive id only.
#[test]
fn a_negative_or_unusable_page_record_never_disables_withdrawal() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    for variant in ["null", "missing_id", "malformed", "a_person", "missing", "stale_id"] {
        let temp = TempDir::new().unwrap();
        turn_on(&temp);
        let mut ws = test_workspace(&temp);
        let harbor = ws.create_note("Harbor plan", WORK, MAIN_ROOT).unwrap();
        let person = ws.create_note("Personal diary", "person prose", MAIN_ROOT).unwrap();
        ok(mcp(&temp, INDEX, json!({"body": format!("- [[Harbor plan]] — {SUMMARY}")})));
        let pages = temp.path().join(".rotli/librarian/pages.jsonl");
        match variant {
            "null" => fs::write(&pages, "{\"page\":\"index\",\"id\":null}\n").unwrap(),
            "missing_id" => fs::write(&pages, "{\"page\":\"index\"}\n").unwrap(),
            "malformed" => fs::write(&pages, "broken\n").unwrap(),
            "a_person" => fs::write(&pages, format!("{}\n", json!({"page":"index","id":person.id}))).unwrap(),
            "stale_id" => fs::write(&pages, "{\"page\":\"index\",\"id\":\"01NOSUCHNOTE\"}\n").unwrap(),
            _ => fs::remove_file(&pages).unwrap(),
        }
        make_secure(&mut ws, &harbor.id);
        assert_eq!(hits(&temp, SUMMARY), 0, "{variant}");
        assert!(body_of(&mut ws, &person.id).contains("person prose"), "{variant}");
    }
}

/// Codex's reproductions: an alias written with spaces, and an imported note
/// whose id ends in `.md`, are links navigation follows, so withdrawal must
/// too: both sides are compared through the same normalisation.
#[test]
fn withdrawal_resolves_links_as_navigation_does() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let cases = [
        ("---\naliases: [\" Dock project \"]\n---\n\n", "Dock project"),
        ("---\nid: opaque.md\n---\n\n", "opaque.md"),
        ("", "Inbox/harbor-record.MD#Heading|Alias"),
    ];
    for (head, link) in cases {
        let text = format!("{head}# Harbor plan\n\n{WORK}\n");
        let temp = TempDir::new().unwrap();
        turn_on(&temp);
        let mut ws = test_workspace(&temp);
        let path = temp.path().join("Inbox/harbor-record.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, &text).unwrap();
        let meta = ws.store.list().unwrap().notes.into_iter().find(|n| n.title == "Harbor plan").unwrap();
        ok(mcp(&temp, INDEX, json!({"body": format!("- [[{link}]] — {SUMMARY}")})));
        let secure = if text.starts_with("---\n") { text.replacen("---\n", "---\nsecure: true\n", 1) } else { format!("---\nsecure: true\n---\n\n{text}") };
        fs::write(&path, secure).unwrap();
        assert!(ws.store.read_for_ai(&meta.id, false).is_err());
        assert_eq!(hits(&temp, SUMMARY), 0, "[[{link}]]");
    }
}
