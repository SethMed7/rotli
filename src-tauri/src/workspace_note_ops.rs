//! The workspace's note lifecycle tools beyond read and write
//! (docs/architecture/agent-workspace.md): MCP rename (the CLI's own service
//! path), attachments, Trash, and the AI edit history with its revision-gated
//! undo. Each runs through the store's existing gates: the remote read gate
//! first, then the body-edit policy (`ai_edit_policy.rs`) for anything that
//! changes or removes a note.

use serde::Serialize;
use serde_json::{json, Value};

use super::attachments::{TEXT_DEFAULT_BYTES, TEXT_MAX_BYTES};
use super::{
    arg_required, arg_string, arg_usize, flag, json_value, positional, require_revision,
    required_option, usize_option, NoteReadResult, Workspace, CONNECTOR_ROOT,
};
use crate::corpus::ai_journal::{revert, unified, AiEditRow, AiEditor, APPLIED, EDIT, TRASH};

pub(super) const RENAME: &str = "rotli_rename";
pub(super) const ATTACHMENTS: &str = "rotli_note_attachments";
pub(super) const TRASH_NOTE: &str = "rotli_trash_note";
pub(super) const HISTORY: &str = "rotli_note_history";
pub(super) const UNDO_AI_EDIT: &str = "rotli_undo_ai_edit";

pub(super) fn tools(tool: fn(&str, &str, Value, bool) -> Value) -> Vec<Value> {
    let schema = |extra: Value, required: Value| {
        let mut schema = json!({"type":"object","properties":{"id":{"type":"string","maxLength":1024},"rootId":{"type":"string","maxLength":128}},"required":required,"additionalProperties":false});
        if let (Some(props), Some(extra)) = (schema["properties"].as_object_mut(), extra.as_object()) {
            props.extend(extra.clone());
        }
        schema
    };
    let revision = || json!({"expectedRevision":{"type":"string","maxLength":128}});
    let gated = || schema(revision(), json!(["id", "expectedRevision"]));
    let mut rename = revision();
    rename["title"] = json!({"type":"string","maxLength":500});
    vec![
        tool(RENAME, "Rename one note: its H1 title and its physical file follow; the prior title stays in aliases. id may be the note id or an exact title, filename, or alias; ambiguous or missing selectors are refused. Pass expectedRevision from a read to refuse a stale rename. Person-written notes need the person's \"Let AI edit\" grant; secure and locked notes are refused.", schema(rename, json!(["id", "title"])), false),
        tool(ATTACHMENTS, "List the files a note's Markdown links and images name (storage: and vault-relative paths), with MIME type, size, and kind; on this Mac also the absolute path for your own file tools. includeText returns small text attachments (capped, secret-shaped text withheld). Images and other binaries are never inlined. Secure notes are refused, and a linked file an agent may not read (a secure note, anything in a secure folder) is listed with its link only.", schema(json!({"includeText":{"type":"boolean"},"maxBytes":{"type":"integer","minimum":1,"maximum":TEXT_MAX_BYTES}}), json!(["id"])), true),
        tool(TRASH_NOTE, "Move one note to Rotli's Trash, where the person can restore it; nothing is deleted. Only a note an AI made, or one the person granted \"Let AI edit\", may be trashed; secure and locked notes are refused. Requires the revision from the read just before. Requires approval.", gated(), false),
        tool(HISTORY, "List the AI body edits journaled for one note, newest first: who (chat or agent), when, the before and after revisions, and a unified diff when the edit was journaled with its text. Secure notes are refused.", schema(json!({"limit":{"type":"integer","minimum":1,"maximum":100}}), json!(["id"])), true),
        tool(UNDO_AI_EDIT, "Undo the last AI body edit of one note, only while the note is exactly as that edit left it (its revision matches). The undo is itself an AI edit under the same rules and is journaled. Requires approval.", gated(), false),
    ]
}

/// One of these tools' calls, or None when `name` isn't one.
pub(super) fn call(name: &str, args: &Value) -> Option<Result<Value, String>> {
    [RENAME, ATTACHMENTS, TRASH_NOTE, HISTORY, UNDO_AI_EDIT]
        .contains(&name)
        .then(|| dispatch(name, args))
}

fn dispatch(name: &str, args: &Value) -> Result<Value, String> {
    let id = arg_required(args, "id")?;
    let (mut workspace, local) = Workspace::open_for_item(id, arg_string(args, "rootId"))?;
    let expected = arg_string(args, "expectedRevision");
    match name {
        RENAME => json_value(workspace.rename_note(&local, arg_required(args, "title")?, expected)?),
        ATTACHMENTS => {
            let text = (args.get("includeText").and_then(Value::as_bool) == Some(true))
                .then(|| arg_usize(args, "maxBytes", TEXT_DEFAULT_BYTES));
            workspace.attachments(&local, text, caller_is_local())
        }
        HISTORY => json_value(workspace.note_history(&local, arg_usize(args, "limit", 20))?),
        _ => {
            let expected = expected.ok_or("expectedRevision is required")?;
            match name {
                TRASH_NOTE => json_value(workspace.trash_note(&local, expected)?),
                _ => json_value(workspace.undo_last_ai_edit(&local, expected)?),
            }
        }
    }
}

/// `rotli notes attachments|trash|history|undo-ai-edit`, or None for any
/// other notes command.
pub(super) fn notes_cli(sub: &str, args: &[String], root_id: Option<&str>) -> Option<Result<Value, String>> {
    if !matches!(sub, "attachments" | "trash" | "history" | "undo-ai-edit") {
        return None;
    }
    Some((|| {
        let id = positional(args, 2, &format!("notes {sub} needs an id"))?;
        let (mut workspace, local) = Workspace::open_for_item(id, root_id)?;
        match sub {
            "attachments" => {
                let text = flag(args, "--text")
                    .then(|| usize_option(args, "--max-bytes", TEXT_DEFAULT_BYTES))
                    .transpose()?;
                workspace.attachments(&local, text, true)
            }
            "trash" => json_value(workspace.trash_note(&local, required_option(args, "--revision")?)?),
            "history" => json_value(workspace.note_history(&local, usize_option(args, "--limit", 20)?)?),
            _ => json_value(workspace.undo_last_ai_edit(&local, required_option(args, "--revision")?)?),
        }
    })())
}

/// Absolute paths mean something only on this Mac: the relay connector's
/// remote callers get vault-relative paths alone.
fn caller_is_local() -> bool {
    CONNECTOR_ROOT.with(|root| root.borrow().is_none())
}

fn conflict(expected: &str, found: &str) -> String {
    format!("revision conflict: expected {expected}, found {found}; read the item again before editing")
}

impl Workspace {
    /// The rename lane's optional revision gate: a caller holding a read may
    /// insist the note is still exactly as read.
    pub(super) fn check_revision(current: &NoteReadResult, expected: Option<&str>) -> Result<(), String> {
        match expected {
            Some(expected) if expected != current.revision => Err(conflict(expected, &current.revision)),
            _ => Ok(()),
        }
    }

    /// Move one note to Trash through the app's own soft delete (the lane the
    /// note menu's Move to Trash rides), with the gates a body edit takes
    /// checked under the note's file lock, around the move itself.
    pub(super) fn trash_note(&mut self, local_id: &str, expected: &str) -> Result<Trashed, String> {
        let rel = self.store.resolve_note_rel(local_id)?;
        let moved = self.store.trash_for_remote_agent_if_revision(local_id, expected)?;
        let row = AiEditRow { content_free: true, ..AiEditRow::new(TRASH, &moved.id, &rel, &AiEditor::agent(None), expected) };
        self.store.ai_journal_record(&row);
        Ok(Trashed {
            trashed: true,
            id: self.wire(local_id),
            to: self.store.resolve_note_rel(local_id).unwrap_or_default(),
            from: rel,
            restore: "The person can restore it from Rotli's Trash.",
        })
    }

    /// This note's journal rows, folded (last line per id wins), newest first.
    fn journal_rows_for(&mut self, local_id: &str) -> Result<Vec<AiEditRow>, String> {
        let text = self.store.read_for_ai(local_id, false)?;
        let rel = self.store.resolve_note_rel(local_id)?;
        let ulid = crate::corpus::parse_document(&text).0.and_then(|fm| fm.id);
        let mine = |row: &AiEditRow| {
            Some(row.note_id.as_str()) == ulid.as_deref() || row.note_id == local_id || row.path == rel
        };
        let mut latest: Vec<AiEditRow> = Vec::new();
        for row in self.store.ai_journal_rows().into_iter().filter(mine) {
            match latest.iter_mut().find(|seen| seen.id == row.id) {
                Some(seen) => *seen = row,
                None => latest.push(row),
            }
        }
        latest.reverse();
        Ok(latest)
    }

    pub(super) fn note_history(&mut self, local_id: &str, limit: usize) -> Result<NoteHistory, String> {
        let current = self.read_note(local_id)?;
        let rows = self.journal_rows_for(local_id)?;
        let undoable = undo_target(&rows, &current.revision).map(|row| row.id.clone());
        let entries = rows
            .into_iter()
            .take(limit.clamp(1, 100))
            .map(|mut row| {
                let diff = row
                    .patch
                    .take()
                    .filter(|hunk| !crate::secret::blocked_for_remote(&format!("{}{}", hunk.before, hunk.after)))
                    .map(|hunk| unified(&row.path, &hunk));
                HistoryEntry { undoable: undoable.as_deref() == Some(row.id.as_str()), diff, row }
            })
            .collect();
        Ok(NoteHistory { id: current.note.id, revision: current.revision, entries })
    }

    /// Reverse the last AI body edit — only while the note is byte-for-byte as
    /// that edit left it — through the agent write seam, so locked, secure,
    /// and person-written notes refuse exactly as an edit would.
    pub(super) fn undo_last_ai_edit(&mut self, local_id: &str, expected: &str) -> Result<NoteReadResult, String> {
        require_revision(expected)?;
        let current = self.read_note(local_id)?;
        Self::check_revision(&current, Some(expected))?;
        let rows = self.journal_rows_for(local_id)?;
        let row = undo_target(&rows, &current.revision).ok_or(
            "nothing to undo: no AI edit left this note as it is now (it changed since, or was journaled without its text)",
        )?;
        let body = row
            .patch
            .as_ref()
            .and_then(|hunk| revert(&current.note.body, hunk))
            .ok_or("the journaled edit no longer matches the note's text; nothing was changed")?;
        let reverted = row.reverted();
        self.store
            .write_for_remote_agent_if_revision(local_id, &body, expected, Some(&reverted.id))?;
        self.store.ai_journal_record(&reverted);
        self.read_note(local_id)
    }
}

/// What a trash call answers.
#[derive(Debug, Serialize)]
pub(super) struct Trashed {
    pub trashed: bool,
    pub id: String,
    pub from: String,
    pub to: String,
    pub restore: &'static str,
}

/// One journal row as history shows it: a unified diff in place of the patch.
#[derive(Debug, Serialize)]
pub(super) struct HistoryEntry {
    #[serde(flatten)]
    pub row: AiEditRow,
    pub diff: Option<String>,
    pub undoable: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct NoteHistory {
    pub id: String,
    pub revision: String,
    pub entries: Vec<HistoryEntry>,
}

/// The applied edit whose result is the note's current bytes.
fn undo_target<'a>(rows: &'a [AiEditRow], current_revision: &str) -> Option<&'a AiEditRow> {
    rows.iter().find(|row| {
        row.action == EDIT
            && row.status == APPLIED
            && row.after_revision.as_deref() == Some(current_revision)
            && row.patch.is_some()
    })
}

#[cfg(test)]
#[path = "workspace_note_ops_tests.rs"]
mod tests;
