//! The store's AI edit control (split out of corpus.rs, 2026-09-29; policy in
//! ai_edit_policy.rs): `set_ai_edit` writes the person's grant,
//! `ai_edit: true|false`.

use std::fs;

use super::{atomic_write, compose_document, parse_document, CorpusStore};
use crate::ai_edit_policy::ai_edit_field;

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
}

