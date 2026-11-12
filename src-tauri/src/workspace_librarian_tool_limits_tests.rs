//! Finding #8 (review 2026-11-09): the tool schemas both MCP servers advertise
//! (`maxLength`, `additionalProperties: false`, types, enums, bounds) are the
//! limits every call is held to, before any tool runs.

use serde_json::{json, Map, Value};
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::{handle_mcp_request_for_root, mcp_tools};
use super::tests::{mcp, public_build, refusal, turn_on};
use super::*;

/// One call to the full `rotli-workspace` server over `temp`.
fn workspace_call(temp: &TempDir, name: &str, arguments: Value) -> Value {
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": arguments } });
    handle_mcp_request_for_root(&request, temp.path().to_path_buf(), false).unwrap()["result"].clone()
}

/// Every tool of both servers, with the server's way of calling it.
fn every_tool() -> Vec<(&'static str, Value)> {
    let librarian = (SERVER.tools)().into_iter().map(|tool| ("librarian", tool));
    librarian.chain(mcp_tools().into_iter().map(|tool| ("workspace", tool))).collect()
}

fn call_on(server: &str, temp: &TempDir, name: &str, arguments: Value) -> Value {
    if server == "librarian" { mcp(temp, name, arguments) } else { workspace_call(temp, name, arguments) }
}

fn properties(tool: &Value) -> Map<String, Value> {
    tool.pointer("/inputSchema/properties").and_then(Value::as_object).cloned().unwrap_or_default()
}

#[test]
fn every_tool_on_both_servers_refuses_an_undeclared_argument() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let _ = test_workspace(&temp);
    for (server, tool) in every_tool() {
        let name = tool["name"].as_str().unwrap();
        // the declared arguments are left out: the undeclared one must be the reason given
        let why = refusal(&call_on(server, &temp, name, json!({ "zzUndeclared": "x" })));
        assert!(why.contains("zzUndeclared"), "{server} {name}: {why}");
    }
}

#[test]
fn every_length_limit_on_both_servers_is_enforced() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let _ = test_workspace(&temp);
    let mut checked = 0;
    for (server, tool) in every_tool() {
        let name = tool["name"].as_str().unwrap();
        for (property, schema) in properties(&tool) {
            let Some(max) = schema.get("maxLength").and_then(Value::as_u64) else { continue };
            let over = "x".repeat(max as usize + 1);
            let why = refusal(&call_on(server, &temp, name, json!({ property.clone(): over })));
            assert!(why.contains(&property) && why.contains(&format!("at most {max}")), "{server} {name}.{property}: {why}");
            checked += 1;
        }
    }
    assert!(checked >= 20, "only {checked} limits checked");
}

#[test]
fn an_over_length_capture_writes_nothing() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let mut ws = test_workspace(&temp);
    let before = ws.store.list().unwrap().notes.len();
    let why = refusal(&mcp(&temp, CAPTURE, json!({"title":"Huge","body":"x".repeat(100_001)})));
    assert!(why.contains("body") && why.contains("at most 100000"), "{why}");
    assert_eq!(ws.store.list().unwrap().notes.len(), before, "neither the note nor a log page was made");
}

#[test]
fn types_bounds_and_enums_are_the_schemas() {
    if public_build() { return; } // development-only; feature_policy tests the refusal
    let temp = TempDir::new().unwrap();
    turn_on(&temp);
    let _ = test_workspace(&temp);
    for (arguments, word) in [
        (json!({"query": 7}), "query"),
        (json!({"query": "x", "limit": 51}), "limit"),
        (json!({"query": "x", "limit": 0}), "limit"),
        (json!({"query": "x", "limit": "5"}), "limit"),
        (json!({}), "query"),
    ] {
        let why = refusal(&mcp(&temp, SEARCH, arguments.clone()));
        assert!(why.contains(word), "{arguments}: {why}");
    }
    assert!(refusal(&mcp(&temp, GUIDE, json!({"skill":"no-such-skill"}))).contains("skill"));
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": SEARCH, "arguments": "query" } });
    let target = super::tests::target(super::super::DEFAULT_ROOT_ID, &temp, true);
    let identity = crate::containment::folder_identity(&target.path);
    let result = super::tests::call_bound(Some(Bound { target, identity }), "tools/call", request["params"].clone());
    assert!(refusal(&result).contains("arguments"), "{result}");
    // a nested limit: a Word-document action's text
    let action = json!({"op":"replace","block":1,"text":"x".repeat(100_001)});
    let why = refusal(&workspace_call(&temp, "rotli_apply_document", json!({"file":"a.docx","expectedRevision":"r","actions":[action]})));
    assert!(why.contains("text"), "{why}");
}

/// No schema advertises a keyword the checker doesn't enforce.
#[test]
fn every_advertised_keyword_is_one_the_checker_enforces() {
    for (server, tool) in every_tool() {
        let name = tool["name"].as_str().unwrap();
        let unenforced = crate::mcp_arguments::unenforced(&tool["inputSchema"], name);
        assert!(unenforced.is_empty(), "{server}: {unenforced:?}");
        assert_eq!(tool["inputSchema"]["type"], "object", "{server} {name}");
    }
}
