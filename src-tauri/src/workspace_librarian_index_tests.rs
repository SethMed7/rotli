//! The Librarian's index and log after Seth's redesign: Rotli's own sidecars
//! under `.rotli/librarian/`, written by note id and rendered through the read
//! gate each time, so a note that turns secure drops out without anything
//! being rewritten.

use std::fs;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::{handle_mcp_request_for_root, MAIN_ROOT};
use super::review_tests::hits;
use super::tests::{body_of, make_secure, mcp, ok, public_build, refusal, turn_on};
use super::*;

fn pages(temp: &TempDir) -> Value {
    ok(mcp(temp, INDEX_READ, json!({})))
}

fn sidecar(temp: &TempDir, name: &str) -> String {
    fs::read_to_string(temp.path().join(".rotli/librarian").join(name)).unwrap_or_default()
}

fn titles(list: &Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|entry| entry["title"].as_str().unwrap().to_string()).collect()
}

#[test]
fn an_entry_for_a_note_that_turns_secure_drops_out_of_the_rendering() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let harbor = ws.create_note("Harbor plan", "Berthing schedule", MAIN_ROOT).unwrap();
    let dock = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    ok(mcp(&temp, INDEX, json!({"entries": [{"id": harbor.id, "summary": "quayside marigold moorings"}, {"id": dock.id, "summary": "the dock work"}]})));
    ok(mcp(&temp, LOG, json!({"entry": "Summarised the moorings", "ids": [harbor.id]})));
    ok(mcp(&temp, LOG, json!({"entry": "Compared the two", "ids": [harbor.id, dock.id]})));
    ok(mcp(&temp, LOG, json!({"entry": "Tidied intake"})));
    let before = pages(&temp);
    assert_eq!(titles(&before["index"]), ["Harbor plan", "Dock notes"]);
    assert_eq!(before["log"].as_array().unwrap().len(), 3);

    make_secure(&mut ws, &harbor.id);
    let after = pages(&temp);
    assert_eq!(titles(&after["index"]), ["Dock notes"]);
    let log: Vec<&str> = after["log"].as_array().unwrap().iter().map(|line| line["text"].as_str().unwrap()).collect();
    assert_eq!(log, ["Tidied intake"], "every line naming the secure note is gone: {after}");
    assert!(!after.to_string().contains("Harbor") && !after.to_string().contains("quayside"), "{after}");
    // nothing was rewritten: the stored rows are as written, and render again if the note turns public
    assert!(sidecar(&temp, "index.jsonl").contains("quayside marigold moorings"));
}

#[test]
fn titles_come_from_the_live_note_and_are_never_stored() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Harbor plan", "words", MAIN_ROOT).unwrap();
    ok(mcp(&temp, INDEX, json!({"entries": [{"id": note.id, "summary": "how the berths are shared"}]})));
    ws.rename_note(&note.id, "Port plan", None).unwrap();
    assert_eq!(titles(&pages(&temp)["index"]), ["Port plan"]);
    assert!(!sidecar(&temp, "index.jsonl").contains("Harbor"), "no title is stored: {}", sidecar(&temp, "index.jsonl"));
    ok(mcp(&temp, INDEX, json!({"entries": [], "remove": [note.id]})));
    assert_eq!(pages(&temp)["index"], json!([]), "a removed entry is gone");
}

#[test]
fn a_write_refuses_an_id_the_agent_cannot_read() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let public = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    let secure = ws.store.create_as("Secure notes", "# Bank login\n\nmarigold", true, None).unwrap();
    let both = json!([{"id": public.id, "summary": "fine"}, {"id": secure.id, "summary": "no"}]);
    assert!(refusal(&mcp(&temp, INDEX, json!({"entries": both}))).contains("not a note you can read"));
    assert!(refusal(&mcp(&temp, INDEX, json!({"entries": [{"id": "01NOSUCHNOTE", "summary": "x"}]}))).contains("read"));
    assert!(refusal(&mcp(&temp, LOG, json!({"entry": "x", "ids": [secure.id]}))).contains("not a note you can read"));
    assert!(mcp(&temp, INDEX, json!({"entries": [{"id": public.id, "summary": "card 4242 4242 4242 4242"}]}))["isError"] == true);
    assert!(refusal(&mcp(&temp, INDEX, json!({"entries": [{"id": public.id, "summary": "two\nlines"}]}))).contains("one line"));
    assert_eq!(sidecar(&temp, "index.jsonl"), "", "a refused call writes nothing, the readable entry included");
    assert_eq!(sidecar(&temp, "log.jsonl"), "");
}

#[test]
fn a_forged_sidecar_row_never_renders_a_secure_note_or_unchecked_text() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let public = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    let secure = ws.store.create_as("Secure notes", "# Bank login\n\nmarigold", true, None).unwrap();
    fs::create_dir_all(temp.path().join(".rotli/librarian")).unwrap();
    let index = [json!({"id": secure.id, "summary": "the bank login"}), json!({"id": public.id, "summary": "line one\nline two"})];
    let log = [json!({"at": 0, "text": "about the bank", "ids": [secure.id]}), json!({"at": 0, "text": "card 4242 4242 4242 4242", "ids": [public.id]}), json!({"at": 0, "text": "kept", "ids": [public.id]})];
    let lines = |rows: &[Value]| rows.iter().map(|row| format!("{row}\n")).collect::<String>();
    fs::write(temp.path().join(".rotli/librarian/index.jsonl"), lines(&index)).unwrap();
    fs::write(temp.path().join(".rotli/librarian/log.jsonl"), lines(&log)).unwrap();
    let shown = pages(&temp);
    assert_eq!(shown["index"], json!([]), "{shown}");
    assert_eq!(shown["log"].as_array().unwrap().len(), 1, "{shown}");
    assert!(!shown.to_string().contains("bank") && !shown.to_string().contains("Bank") && !shown.to_string().contains("4242"), "{shown}");
}

#[test]
fn nothing_under_rotli_librarian_is_searchable_or_listed() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    ok(mcp(&temp, INDEX, json!({"entries": [{"id": note.id, "summary": "zephyrine harbour"}]})));
    ok(mcp(&temp, LOG, json!({"entry": "zephyrine sweep", "ids": [note.id]})));
    assert!(sidecar(&temp, "index.jsonl").contains("zephyrine"));
    assert_eq!(hits(&temp, "zephyrine"), 0, "the route's search");
    let workspace = |name: &str, arguments: Value| {
        let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": arguments } });
        handle_mcp_request_for_root(&request, temp.path().to_path_buf(), false).unwrap()["result"]["structuredContent"].clone()
    };
    assert_eq!(workspace("rotli_search", json!({"query": "zephyrine"}))["items"], json!([]));
    assert_eq!(workspace("rotli_query", json!({"query": "zephyrine"}))["notes"], json!([]));
    // every read-only workspace tool that needs no argument: listings, Main, views, status
    for tool in super::super::mcp_tools() {
        let free = tool.pointer("/inputSchema/required").is_none_or(|required| required == &json!([]));
        if tool.pointer("/annotations/readOnlyHint") != Some(&json!(true)) || !free {
            continue;
        }
        let name = tool["name"].as_str().unwrap();
        let answer = workspace(name, json!({})).to_string();
        assert!(!answer.contains("zephyrine") && !answer.contains(".jsonl"), "{name}: {answer}");
    }
    let mut ws = test_workspace(&temp);
    assert!(ws.store.list().unwrap().notes.iter().all(|meta| !meta.id.contains(".rotli")), "the walk never lists .rotli");
    assert!(ws.store.search("zephyrine", 10, false).unwrap().is_empty(), "nor does the app's own search");
    assert_eq!(mcp(&temp, READ, json!({"id": ".rotli/librarian/index.jsonl"}))["isError"], true);
}

#[test]
fn an_index_note_from_an_earlier_build_is_left_alone() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    // the page as an earlier development build wrote it
    let path = temp.path().join(ws.store.layout().intake_dir()).join("librarian-index.md");
    let before = "---\nid: 01OLDLIBRARIANPAGE\ncreated_by: librarian\nlibrarian_page: index\n---\n\n# Librarian index\n\n- [[Dock notes]] — older words\n";
    fs::write(&path, before).unwrap();
    let old = ws.store.list().unwrap().notes.into_iter().find(|meta| meta.title == "Librarian index").unwrap();
    let dock = ws.create_note("Dock notes", "more", MAIN_ROOT).unwrap();
    ok(mcp(&temp, INDEX, json!({"entries": [{"id": dock.id, "summary": "new words"}]})));
    ok(mcp(&temp, LOG, json!({"entry": "Tidied", "ids": [dock.id]})));
    assert_eq!(fs::read_to_string(&path).unwrap(), before, "the old page is an ordinary note now");
    assert!(body_of(&mut ws, &old.id).contains("older words"));
}
