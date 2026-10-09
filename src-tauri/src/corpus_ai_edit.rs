//! The store's AI edit control (split out of corpus.rs, 2026-09-29; policy in
//! ai_edit_policy.rs): `set_ai_edit` writes the person's grant,
//! `ai_edit: true|false`; `trash_for_remote_agent_if_revision` is an agent's
//! Trash under that same policy; `insert_for_ai_if_revision` is the `/ai`
//! insert lane (2026-10-05), the AI write in its narrower Insert mode.

use std::fs;

use super::{
    atomic_write, compose_document, lifecycle_disk_folder, parse_document, prefix_write_result,
    split_root_id, CorpusState, CorpusStore, CorpusWriteResult, NoteMeta,
};
use crate::ai_edit_policy::ai_edit_field;

/// How an AI body write may change a note: rewrite it (chat, under the grant)
/// or add one accepted passage (`/ai`, under the person's consent).
#[derive(Clone, Copy)]
pub(crate) enum AiWrite<'a> {
    Replace,
    Insert(&'a str),
}

impl CorpusStore {
    /// A `/ai` insertion the person accepted (2026-10-05): the body may differ
    /// from the note only by `text` at one place, and the person's consent
    /// stands in for the standing grant — never for a lock or an explicit no.
    pub(crate) fn insert_for_ai_if_revision(
        &mut self,
        id_or_rel: &str,
        body: &str,
        text: &str,
        model_is_local: bool,
        expected_revision: &str,
    ) -> Result<CorpusWriteResult, String> {
        self.write_for_ai_as(id_or_rel, body, model_is_local, expected_revision, AiWrite::Insert(text))
    }


    /// The person's per-note grant for AI body edits. Writes `ai_edit: true`
    /// or `ai_edit: false` — never removes it, so turning AI editing off sticks
    /// even on a note an AI made. SANCTIONED writable() exception, like
    /// set_locked: it is a Rotli control flag, not content.
    pub(crate) fn set_ai_edit(&mut self, id_or_rel: &str, allowed: bool) -> Result<(), String> {
        self.mutation_allowed()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (fm, body) = parse_document(&text);
            let mut fm = fm.unwrap_or_default();
            fm.foreign.retain(|l| ai_edit_field(l).is_none());
            fm.foreign.push(format!("ai_edit: {allowed}"));
            atomic_write(&path, &compose_document(&fm, body))
        })
    }

    /// Move one note to Trash for an agent: the soft delete `delete` performs,
    /// with the read gate (secure), the body-edit policy (locked, a person's
    /// note without "Let AI edit"), and the revision all checked UNDER the
    /// note's file lock, around the move itself — a note locked, made secure,
    /// or changed after the agent's read is refused, never trashed. Mirrors
    /// `write_for_remote_agent_if_revision`. Returns the moved note's meta.
    pub(crate) fn trash_for_remote_agent_if_revision(
        &mut self,
        id: &str,
        expected_revision: &str,
    ) -> Result<NoteMeta, String> {
        crate::fsutil::require_revision(expected_revision)?;
        let rel = self.resolve_note_rel(id)?;
        if !rel.ends_with(".md") {
            return Err("agents trash Markdown notes only".into());
        }
        let trash = lifecycle_disk_folder(self.layout, "Trash");
        self.writable(&rel)?;
        self.writable(&trash)?;
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = self.read_for_ai(&rel, false)?;
            let fm = parse_document(&text).0.unwrap_or_default();
            if let Some(refusal) = crate::ai_edit_policy::body_edit(&fm.foreign).refusal() {
                return Err(refusal.into());
            }
            crate::fsutil::compare_revision(expected_revision, text.as_bytes())?;
            // the caller's id, never the rel: `relocate` stamps it back as the
            // note's identity (see `delete`)
            self.relocate(id, &rel, &trash)
        })
    }
}

/// Insert a `/ai` answer the person accepted. Rust checks the new body is the
/// note plus exactly `text`, then runs the AI write lane's gates in insert
/// mode: the read gate, the lock, an explicit `ai_edit: false`, the laundering
/// rule, the revision, and an `inline` journal row.
#[tauri::command]
pub fn corpus_insert_ai(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
    text: String,
    model_id: String,
    endpoint: String,
    expected_revision: String,
) -> Result<CorpusWriteResult, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    let (root, rel) = split_root_id(&id);
    state
        .route(&root, |s| {
            s.insert_for_ai_if_revision(&rel, &body, &text, model_is_local, &expected_revision)
        })
        .map(|result| prefix_write_result(&root, result))
}

