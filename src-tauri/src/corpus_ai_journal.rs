//! The AI body-edit journal (docs/architecture/agent-workspace.md, "AI edit
//! history"). Every successful AI body write — chat and chat memory
//! (`write_for_ai_if_revision`) and external agents
//! (`write_for_remote_agent_if_revision`) — appends one JSON row to
//! `.rotli/ai-edit-journal.jsonl`. The grammar is the brain journal's: one row
//! per line, `id` + `ts` + `status`, and a same-id re-append is a status
//! transition (the last line wins). It is a deletable per-machine sidecar:
//! losing it loses history, never a note.
//!
//! A row carries a one-hunk reversible patch of the editor body, never a
//! second copy of the note. A note no remote agent could read when it was
//! written (secure, in a protected lane, or secret-shaped before or after) is
//! journaled CONTENT-FREE: who, when, and the two revisions, no text.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{atomic_write, editor_body, parse_document, read_existing_text, CorpusStore, DOT_DIR};

pub(crate) const AI_EDIT_JOURNAL: &str = "ai-edit-journal.jsonl";
/// Rows kept; older ones fall off on append (every append rewrites the file).
const MAX_ROWS: usize = 500;
/// A hunk larger than this is journaled without its text (no undo).
const MAX_PATCH_BYTES: usize = 32_000;

/// Row actions and statuses.
pub(crate) const EDIT: &str = "edit";
pub(crate) const UNDO: &str = "undo";
pub(crate) const TRASH: &str = "trash";
pub(crate) const APPLIED: &str = "applied";
pub(crate) const REVERTED: &str = "reverted";

/// Who made a body edit, recorded on its journal row.
pub(crate) struct AiEditor<'a> {
    /// `chat` (the in-app chat and its memory), `inline` (a `/ai` insertion
    /// the person accepted), or `agent` (CLI/MCP/relay).
    pub actor: &'a str,
    /// The MCP client's name for an agent; none for the chat.
    pub agent: Option<String>,
    /// `remote` or `on-device` — the model class that wrote.
    pub lane: &'a str,
    /// The journal row this write reverts, when it is an undo.
    pub undo_of: Option<&'a str>,
}

impl<'a> AiEditor<'a> {
    /// The in-app chat (and its memory), on either model lane.
    pub(crate) fn chat(model_is_local: bool) -> Self {
        let lane = if model_is_local { "on-device" } else { "remote" };
        AiEditor { actor: "chat", agent: None, lane, undo_of: None }
    }

    /// A `/ai` insertion the person read and accepted in the editor.
    pub(crate) fn inline(model_is_local: bool) -> Self {
        let lane = if model_is_local { "on-device" } else { "remote" };
        AiEditor { actor: "inline", agent: None, lane, undo_of: None }
    }

    /// An external agent (CLI, MCP, relay), named by its MCP client.
    pub(crate) fn agent(undo_of: Option<&'a str>) -> Self {
        let agent = Some(crate::agent_bridge::client_name());
        AiEditor { actor: "agent", agent, lane: "remote", undo_of }
    }
}

/// One journal row. Fields this build doesn't know ride along in `extra`, so
/// a status re-append never drops what a newer writer recorded.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiEditRow {
    pub id: String,
    pub ts: i64,
    pub action: String,
    pub note_id: String,
    pub path: String,
    pub actor: String,
    #[serde(default)]
    pub agent: Option<String>,
    pub lane: String,
    pub before_revision: String,
    #[serde(default)]
    pub after_revision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch: Option<Hunk>,
    #[serde(default)]
    pub content_free: bool,
    #[serde(default)]
    pub too_large: bool,
    #[serde(default)]
    pub undo_of: Option<String>,
    pub status: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl AiEditRow {
    /// A fresh applied row for one action on one note.
    pub(crate) fn new(action: &str, note_id: &str, path: &str, editor: &AiEditor, before_revision: &str) -> Self {
        AiEditRow {
            id: ulid::Ulid::new().to_string(),
            ts: now_ms(),
            action: action.into(),
            note_id: note_id.into(),
            path: path.into(),
            actor: editor.actor.into(),
            agent: editor.agent.clone(),
            lane: editor.lane.into(),
            before_revision: before_revision.into(),
            undo_of: editor.undo_of.map(str::to_string),
            status: APPLIED.into(),
            ..AiEditRow::default()
        }
    }

    /// The same row, re-appended as reverted.
    pub(crate) fn reverted(&self) -> Self {
        AiEditRow { ts: now_ms(), status: REVERTED.into(), ..self.clone() }
    }
}

pub(crate) fn now_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// One reversible hunk: the editor body's lines from `line` (0-based) that
/// read `before` now read `after`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Hunk {
    pub line: usize,
    pub before: String,
    pub after: String,
}

/// The editor Markdown of a whole note file (what reads return and writes take).
pub(crate) fn editor_text(file: &str) -> &str {
    match parse_document(file) {
        (Some(_), raw) => editor_body(raw),
        (None, raw) => raw,
    }
}

/// The smallest single hunk that turns `before` into `after`: the common
/// leading and trailing lines are dropped, the middle is kept on both sides.
pub(crate) fn hunk(before: &str, after: &str) -> Hunk {
    let old: Vec<&str> = before.split_inclusive('\n').collect();
    let new: Vec<&str> = after.split_inclusive('\n').collect();
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let room = old.len().min(new.len()) - prefix;
    let suffix = old
        .iter()
        .rev()
        .zip(new.iter().rev())
        .take(room)
        .take_while(|(a, b)| a == b)
        .count();
    Hunk {
        line: prefix,
        before: old[prefix..old.len() - suffix].concat(),
        after: new[prefix..new.len() - suffix].concat(),
    }
}

/// Undo a hunk on the body it produced. `None` when `current` does not hold
/// the hunk's `after` text at its line — the body is not the one it wrote.
pub(crate) fn revert(current: &str, hunk: &Hunk) -> Option<String> {
    let lines: Vec<&str> = current.split_inclusive('\n').collect();
    let start: usize = lines.get(..hunk.line)?.iter().map(|line| line.len()).sum();
    let rest = current.get(start..)?;
    let tail = rest.strip_prefix(hunk.after.as_str())?;
    Some(format!("{}{}{tail}", &current[..start], hunk.before))
}

/// The hunk as a unified diff, for people and agents reading history.
pub(crate) fn unified(path: &str, hunk: &Hunk) -> String {
    let side = |text: &str| text.split_inclusive('\n').count();
    let (old, new) = (side(&hunk.before), side(&hunk.after));
    let start = |count: usize| if count == 0 { hunk.line } else { hunk.line + 1 };
    let mut out = format!(
        "--- a/{path}\n+++ b/{path}\n@@ -{},{old} +{},{new} @@\n",
        start(old),
        start(new)
    );
    for (mark, text) in [('-', &hunk.before), ('+', &hunk.after)] {
        for line in text.split_inclusive('\n') {
            out.push(mark);
            out.push_str(line.trim_end_matches('\n'));
            out.push('\n');
        }
    }
    out
}

impl CorpusStore {
    /// Journal one landed AI body write. Best effort: the write has already
    /// landed, so a journal failure is logged, never reported as a failed edit.
    pub(super) fn journal_ai_edit(
        &self,
        note_id: &str,
        rel: &str,
        before_file: &str,
        after_file: &[u8],
        remote_visible: bool,
        editor: &AiEditor,
    ) {
        let after_file = String::from_utf8_lossy(after_file);
        let (before, after) = (editor_text(before_file), editor_text(&after_file));
        let content_free = !remote_visible || crate::secret::looks_secure(after);
        let change = hunk(before, after);
        let too_large = change.before.len() + change.after.len() > MAX_PATCH_BYTES;
        let action = if editor.undo_of.is_some() { UNDO } else { EDIT };
        let before_revision = crate::fsutil::revision(before_file.as_bytes());
        let row = AiEditRow {
            after_revision: Some(crate::fsutil::revision(after_file.as_bytes())),
            patch: (!content_free && !too_large).then_some(change),
            content_free,
            too_large: too_large && !content_free,
            ..AiEditRow::new(action, note_id, rel, editor, &before_revision)
        };
        self.ai_journal_record(&row);
    }

    /// Append one row after its change already landed: a failure is logged,
    /// never reported as a failed edit.
    pub(crate) fn ai_journal_record(&self, row: &AiEditRow) {
        if let Err(error) = self.ai_journal_append(row) {
            eprintln!("rotli: AI edit journal: {error}");
        }
    }

    /// Append one row, keeping the newest `MAX_ROWS`.
    fn ai_journal_append(&self, row: &AiEditRow) -> Result<(), String> {
        self.mutation_allowed()?;
        let dir = self.guard_rel(DOT_DIR)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = self.guard_rel(&format!("{DOT_DIR}/{AI_EDIT_JOURNAL}"))?;
        let line = serde_json::to_string(row).map_err(|e| e.to_string())?;
        crate::fsutil::with_file_lock(&path, || {
            // a failed read must not silently REPLACE the journal with one row
            let existing = read_existing_text(&path)?;
            let mut lines: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).collect();
            lines.push(&line);
            let keep = lines.len().saturating_sub(MAX_ROWS);
            atomic_write(&path, &(lines[keep..].join("\n") + "\n"))
        })
    }

    /// Every row, oldest first; unreadable lines are skipped.
    pub(crate) fn ai_journal_rows(&self) -> Vec<AiEditRow> {
        let Ok(path) = self.guard_rel(&format!("{DOT_DIR}/{AI_EDIT_JOURNAL}")) else {
            return Vec::new();
        };
        std::fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_hunk_keeps_only_the_changed_lines_and_reverts_exactly() {
        let before = "# Plan\n\nalpha\nbeta\ngamma\n";
        let after = "# Plan\n\nalpha\nBETA\nmore\ngamma\n";
        let change = hunk(before, after);
        assert_eq!(change, Hunk { line: 3, before: "beta\n".into(), after: "BETA\nmore\n".into() });
        assert_eq!(revert(after, &change).as_deref(), Some(before));
        // a body that no longer holds the hunk's text refuses to revert
        assert_eq!(revert("# Plan\n\nalpha\nother\ngamma\n", &change), None);
    }

    #[test]
    fn hunks_cover_appends_deletions_and_bodies_without_a_final_newline() {
        for (before, after) in [
            ("a\nb", "a\nb\nc"),
            ("a\nb\nc\n", "a\nc\n"),
            ("", "# New\n"),
            ("same\n", "same\n"),
            ("x\ny\nx\n", "x\nx\n"),
        ] {
            let change = hunk(before, after);
            assert_eq!(revert(after, &change).as_deref(), Some(before), "{before:?} -> {after:?}");
        }
    }

    #[test]
    fn a_unified_diff_names_the_lines_it_changed() {
        let change = hunk("a\nb\nc\n", "a\nB\nc\n");
        assert_eq!(
            unified("wiki/n.md", &change),
            "--- a/wiki/n.md\n+++ b/wiki/n.md\n@@ -2,1 +2,1 @@\n-b\n+B\n"
        );
    }

    #[test]
    fn editor_text_drops_frontmatter_and_the_fence_blank_line() {
        assert_eq!(editor_text("---\nid: x\n---\n\n# T\n"), "# T\n");
        assert_eq!(editor_text("# Bare\n"), "# Bare\n");
    }
}
