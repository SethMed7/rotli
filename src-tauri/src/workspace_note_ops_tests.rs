//! The note lifecycle tools' guarantees: MCP rename parity, Trash under the
//! body-edit policy, and the journaled AI edit history with its gated undo.

use std::fs;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::super::tests::test_workspace;
use super::super::{handle_mcp_request_for_root, Workspace, MAIN_ROOT};
use super::RENAME;
use crate::ai_edit_policy::Creator;
use crate::corpus::ai_journal::{AiEditor, APPLIED, EDIT, REVERTED, TRASH, UNDO};

fn mcp(temp: &TempDir, name: &str, arguments: Value) -> Value {
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": arguments } });
    let response = handle_mcp_request_for_root(&request, temp.path().to_path_buf(), false).unwrap();
    response["result"].clone()
}

fn error_text(result: &Value) -> String {
    assert_eq!(result["isError"], true, "{result}");
    result["content"][0]["text"].as_str().unwrap_or_default().to_string()
}

fn add_frontmatter_line(ws: &mut Workspace, id: &str, line: &str) {
    let rel = ws.store.resolve_note_rel(id).unwrap();
    let path = ws.store.root().join(rel);
    let raw = fs::read_to_string(&path).unwrap().replacen("\n---\n", &format!("\n{line}\n---\n"), 1);
    fs::write(path, raw).unwrap();
}

#[test]
fn mcp_rename_rides_the_cli_rename_and_honours_a_revision() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Draft plan", "Body", MAIN_ROOT).unwrap();
    let read = ws.read_note(&note.id).unwrap();

    let stale = mcp(&temp, RENAME, json!({ "id": note.id, "title": "Final plan", "expectedRevision": "fnv1a64:0" }));
    assert!(error_text(&stale).contains("revision conflict"));

    let renamed = mcp(&temp, RENAME, json!({ "id": "Draft plan", "title": "Final plan", "expectedRevision": read.revision }));
    assert_eq!(renamed["isError"], false, "{renamed}");
    assert_eq!(renamed["structuredContent"]["note"]["body"], "# Final plan\n\nBody\n");
    assert!(temp.path().join("Inbox/final-plan.md").exists());

    // a person's note stays theirs
    let person = ws.store.create("Inbox", "# Mine\n\nwords").unwrap();
    let refused = mcp(&temp, RENAME, json!({ "id": person.id, "title": "Taken" }));
    assert!(error_text(&refused).contains("written by the person"));
}

#[test]
fn trash_moves_an_ai_made_note_and_refuses_people_locks_and_stale_reads() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Scratch", "temporary", MAIN_ROOT).unwrap();
    let read = ws.read_note(&note.id).unwrap();
    assert!(ws.trash_note(&note.id, "fnv1a64:0").unwrap_err().contains("revision conflict"));

    let trashed = ws.trash_note(&note.id, &read.revision).unwrap();
    assert!(trashed.trashed);
    let rel = ws.store.resolve_note_rel(&note.id).unwrap();
    assert!(rel.starts_with("Trash/"), "soft delete, not gone: {rel}");
    assert!(ws.store.root().join(&rel).exists());
    let rows = ws.store.ai_journal_rows();
    assert_eq!(rows.last().unwrap().action, TRASH);
    assert!(rows.last().unwrap().content_free);

    let person = ws.store.create("Inbox", "# Mine\n\nwords").unwrap();
    let revision = ws.read_note(&person.id).unwrap().revision;
    assert!(ws.trash_note(&person.id, &revision).unwrap_err().contains("written by the person"));

    let locked = ws.create_note("Kept", "body", MAIN_ROOT).unwrap();
    add_frontmatter_line(&mut ws, &locked.id, "locked: true");
    let revision = ws.read_note(&locked.id).unwrap().revision;
    assert!(ws.trash_note(&locked.id, &revision).unwrap_err().contains("locked"));

    let secure = ws.store.create_as("Secure notes", "# Vault\n\nx", true, Some(Creator::Agent)).unwrap();
    assert!(ws.trash_note(&secure.id, "fnv1a64:0").unwrap_err().contains("secure"));
}

#[test]
fn every_agent_edit_is_journaled_and_the_last_one_undoes_only_while_current() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Plan", "alpha\nbeta\ngamma", MAIN_ROOT).unwrap();
    let first = ws.read_note(&note.id).unwrap();
    ws.patch_note(&note.id, "beta", "BETA", &first.revision).unwrap();
    let edited = ws.read_note(&note.id).unwrap();

    let history = ws.note_history(&note.id, 20).unwrap();
    let entry = &history.entries[0];
    assert_eq!(entry.row.action, EDIT);
    assert_eq!(entry.row.actor, AiEditor::agent(None).actor);
    assert_eq!(entry.row.before_revision, first.revision);
    assert_eq!(entry.row.after_revision.as_deref(), Some(edited.revision.as_str()));
    assert!(entry.undoable);
    assert!(entry.diff.as_deref().unwrap().contains("-beta\n+BETA\n"), "{entry:?}");
    assert!(entry.row.patch.is_none(), "history shows a diff, not the raw patch");

    assert!(ws.undo_last_ai_edit(&note.id, &first.revision).unwrap_err().contains("revision conflict"));
    let undone = ws.undo_last_ai_edit(&note.id, &edited.revision).unwrap();
    assert_eq!(undone.note.body, first.note.body);

    let history = ws.note_history(&note.id, 20).unwrap();
    let actions: Vec<_> = history.entries.iter().map(|e| (e.row.action.as_str(), e.row.status.as_str())).collect();
    assert_eq!(actions[..2], [(UNDO, APPLIED), (EDIT, REVERTED)]);
    assert!(ws
        .undo_last_ai_edit(&note.id, &undone.revision)
        .unwrap_err()
        .contains("nothing to undo"));
}

#[test]
fn an_edit_that_was_overtaken_cannot_be_undone() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let note = ws.create_note("Plan", "one", MAIN_ROOT).unwrap();
    let read = ws.read_note(&note.id).unwrap();
    ws.update_note(&note.id, "# Plan\n\ntwo\n", &read.revision).unwrap();
    // the person edits after the agent did
    let rel = ws.store.resolve_note_rel(&note.id).unwrap();
    let path = ws.store.root().join(rel);
    fs::write(&path, fs::read_to_string(&path).unwrap().replace("two", "three")).unwrap();
    let now = ws.read_note(&note.id).unwrap();
    assert!(!ws.note_history(&note.id, 5).unwrap().entries[0].undoable);
    assert!(ws.undo_last_ai_edit(&note.id, &now.revision).unwrap_err().contains("nothing to undo"));
}

#[test]
fn a_secure_notes_edits_are_journaled_without_their_text_and_its_history_is_refused() {
    let temp = TempDir::new().unwrap();
    let mut ws = test_workspace(&temp);
    let secure = ws.store.create_as("Secure notes", "# Vault\n\nold words", true, Some(Creator::Chat)).unwrap();
    let rel = ws.store.resolve_note_rel(&secure.id).unwrap();
    let revision = crate::fsutil::revision(&fs::read(ws.store.root().join(&rel)).unwrap());
    ws.store
        .write_for_ai_if_revision(&secure.id, "# Vault\n\nnew words\n", true, &revision)
        .unwrap();

    let row = ws.store.ai_journal_rows().pop().unwrap();
    let chat = AiEditor::chat(true);
    assert_eq!((row.actor.as_str(), row.lane.as_str()), (chat.actor, chat.lane));
    assert!(row.content_free);
    assert!(row.patch.is_none());
    let raw = fs::read_to_string(ws.store.root().join(".rotli/ai-edit-journal.jsonl")).unwrap();
    assert!(!raw.contains("words"), "no secure prose in the journal");
    assert!(ws.note_history(&secure.id, 5).is_err());
}

#[test]
fn opening_a_connected_roots_item_queues_its_wire_id_in_the_default_mailbox() {
    let default = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let mut connected = Workspace::open_target(super::super::RootTarget {
        id: "work".into(),
        label: "Work".into(),
        path: other.path().to_path_buf(),
        read_only: false,
        is_default: false,
    })
    .unwrap();
    let note = connected.store.create_for_remote_agent("Inbox", "# Elsewhere\n\nx").unwrap();
    super::super::CONNECTOR_ROOT.with(|root| *root.borrow_mut() = Some((default.path().to_path_buf(), false)));
    let queued = connected.write_open_request(&note.id, "note");
    super::super::CONNECTOR_ROOT.with(|root| *root.borrow_mut() = None);
    let queued = queued.unwrap();

    let wire = format!("work:{}", note.id);
    assert_eq!(queued["id"], wire.as_str());
    assert_eq!(queued["deepLink"], super::super::deep_link_for(&wire, "note").as_str());
    let mailbox = fs::read_to_string(default.path().join(".rotli/workspace-open.json")).unwrap();
    assert!(mailbox.contains(&wire), "{mailbox}");
    assert!(!other.path().join(".rotli/workspace-open.json").exists());
}
