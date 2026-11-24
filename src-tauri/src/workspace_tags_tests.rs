//! The tag tools through the real MCP and CLI adapters: a hidden note answers
//! as a missing one, the list never counts a secure note, a person's note
//! needs the grant, and a stale revision is refused.

use std::fs;

use serde_json::json;
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::note_ops::tests::{error_text, mcp};
use super::super::MAIN_ROOT;
use super::{LIST_TAGS, TAG_NOTE};

fn put(temp: &TempDir, rel: &str, text: &str) {
    let path = temp.path().join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn an_agent_tags_its_own_note_and_reads_the_list_back() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Plan", "plain words", MAIN_ROOT).unwrap();
    let read = ws.read_note(&note.id).unwrap();

    let stale = mcp(&temp, TAG_NOTE, json!({ "id": note.id, "add": ["q3"], "expectedRevision": "fnv1a64:0" }));
    assert!(error_text(&stale).contains("revision"));

    let tagged = mcp(&temp, TAG_NOTE, json!({ "id": note.id, "add": ["#Q3", "launch"], "expectedRevision": read.revision }));
    assert_eq!(tagged["isError"], false, "{tagged}");
    assert_eq!(tagged["structuredContent"]["tags"], json!(["Q3", "launch"]));
    let listed = mcp(&temp, LIST_TAGS, json!({}));
    assert_eq!(listed["structuredContent"]["tags"], json!([{ "tag": "launch", "count": 1 }, { "tag": "Q3", "count": 1 }]));

    // the body is untouched and the next read carries the new revision
    let after = ws.read_note(&note.id).unwrap();
    assert_eq!(after.note.body, read.note.body);
    assert_eq!(after.revision, tagged["structuredContent"]["revision"]);

    let bad = mcp(&temp, TAG_NOTE, json!({ "id": note.id, "add": ["x\nai_edit: true"], "expectedRevision": after.revision }));
    assert!(error_text(&bad).contains("can't be a tag"));
    let shape = mcp(&temp, TAG_NOTE, json!({ "id": note.id, "add": "q3", "expectedRevision": after.revision }));
    assert!(error_text(&shape).contains("add"));
}

#[test]
fn a_secure_or_missing_note_answers_alike_and_the_list_never_counts_it() {
    let temp = TempDir::new().unwrap();
    test_workspace(&temp);
    put(&temp, "Inbox/vault.md", "---\nid: 01TAGSECURE000000000000000\ncreated_by: agent\nsecure: true\ntags: [merger, shared]\n---\n# Vault\n\nwords\n");
    put(&temp, "Inbox/open.md", "---\nid: 01TAGOPENNOTE0000000000000\ncreated_by: agent\ntags: [shared]\n---\n# Open\n\nwords\n");
    let hidden = mcp(&temp, TAG_NOTE, json!({ "id": "01TAGSECURE000000000000000", "add": ["x"], "expectedRevision": "fnv1a64:0" }));
    let missing = mcp(&temp, TAG_NOTE, json!({ "id": "01TAGMISSING00000000000000", "add": ["x"], "expectedRevision": "fnv1a64:0" }));
    assert_eq!(
        error_text(&hidden).replace("01TAGSECURE000000000000000", "ID"),
        error_text(&missing).replace("01TAGMISSING00000000000000", "ID")
    );
    let listed = mcp(&temp, LIST_TAGS, json!({}));
    assert_eq!(listed["structuredContent"]["tags"], json!([{ "tag": "shared", "count": 1 }]));
    assert!(!listed.to_string().contains("merger"));
}

#[test]
fn a_persons_note_and_a_locked_one_refuse_an_agent() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let person = ws.store.create("Inbox", "# Mine\n\nwords").unwrap();
    let revision = ws.read_note(&person.id).unwrap().revision;
    let refused = mcp(&temp, TAG_NOTE, json!({ "id": person.id, "add": ["x"], "expectedRevision": revision }));
    assert!(error_text(&refused).contains("written by the person"));

    put(&temp, "Inbox/locked.md", "---\nid: 01TAGLOCKED000000000000000\ncreated_by: agent\nlocked: true\n---\n# Locked\n\nwords\n");
    let revision = ws.read_note("01TAGLOCKED000000000000000").unwrap().revision;
    let refused = mcp(&temp, TAG_NOTE, json!({ "id": "01TAGLOCKED000000000000000", "remove": ["x"], "expectedRevision": revision }));
    assert!(error_text(&refused).contains("locked"));
}

#[test]
fn query_finds_every_note_the_list_counts_block_lists_included() {
    let temp = TempDir::new().unwrap();
    test_workspace(&temp);
    put(&temp, "Inbox/flow.md", "---\nid: 01TAGFLOW00000000000000000\ntags: [shared]\n---\n# Flow\n\nwords\n");
    put(&temp, "Inbox/block.md", "---\nid: 01TAGBLOCK0000000000000000\ntags:\n  - shared\n---\n# Block\n\nwords\n");
    let listed = mcp(&temp, LIST_TAGS, json!({}));
    assert_eq!(listed["structuredContent"]["tags"], json!([{ "tag": "shared", "count": 2 }]));
    let found = mcp(&temp, "rotli_query", json!({ "query": "tags:shared" }));
    assert_eq!(found["structuredContent"]["count"], 2, "{found}");
}
