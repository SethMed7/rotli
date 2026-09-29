//! The store's AI edit controls (split out of corpus.rs, 2026-09-29; policy in
//! ai_edit_policy.rs):
//!
//! - `set_ai_edit` writes the person's grant, `ai_edit: true|false`.
//! - `claim_chat_memory` stamps `created_by: chat` on a note Rotli itself wrote
//!   as a chat's memory before provenance existed. Rust checks the note's text
//!   is exactly that shape, so a note a person wrote can never be claimed.

use std::fs;

use super::{
    atomic_write, compose_document, editor_body, locked_field, parse_document, split_root_id,
    CorpusState, CorpusStore,
};
use crate::ai_edit_policy::{ai_edit_field, created_by_field, is_chat_memory_shape, Creator};

impl CorpusStore {
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

    /// Claim one of Rotli's own pre-provenance chat-memory notes for its chat.
    /// `Ok(true)` when the note is now `created_by: chat`; `Ok(false)` when it
    /// is not exactly a memory note for `chat_slug`, already carries
    /// provenance or a grant, or is locked — nothing is written then.
    pub(crate) fn claim_chat_memory(&mut self, id_or_rel: &str, chat_slug: &str) -> Result<bool, String> {
        self.mutation_allowed()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.writable(rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (fm, body) = parse_document(&text);
            let Some(mut fm) = fm else { return Ok(false) };
            let decided = fm.foreign.iter().any(|l| {
                created_by_field(l).is_some()
                    || ai_edit_field(l).is_some()
                    || locked_field(l) == Some(true)
            });
            if decided || !is_chat_memory_shape(editor_body(body), chat_slug) {
                return Ok(false);
            }
            fm.foreign.push(Creator::Chat.line());
            atomic_write(&path, &compose_document(&fm, body))?;
            Ok(true)
        })
    }
}

/// Claim a pre-provenance chat-memory note for `chat_slug` (see above).
#[tauri::command]
pub fn corpus_claim_chat_memory(
    state: tauri::State<'_, CorpusState>,
    id: String,
    chat_slug: String,
) -> Result<bool, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.claim_chat_memory(&rel, &chat_slug))
}
