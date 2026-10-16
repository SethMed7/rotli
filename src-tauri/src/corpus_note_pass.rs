//! What every vault-wide Settings pass shares (leftover note names, link
//! format): the default vault to run in, and the one safe way to rewrite a
//! note mid-pass. Declared as a CHILD of `corpus` so it reuses the store's
//! own gates.

use std::fs;

use super::{CorpusState, CorpusStore};

impl CorpusStore {
    /// Rewrite one note for a pass: a read-only location is skipped, and the
    /// file is re-read under its lock so a concurrent save isn't lost. `next`
    /// decides the new text from the current one (`None`: nothing to change).
    /// True when the note was written.
    pub(super) fn rewrite_note_locked(
        &mut self,
        rel: &str,
        next: impl Fn(&Self, &str) -> Option<String>,
    ) -> Result<bool, String> {
        if self.writable(rel).is_err() {
            return Ok(false);
        }
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let current = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let Some(text) = next(self, &current) else {
                return Ok(false);
            };
            self.suppress.mark(&path);
            super::atomic_write(&path, &text)?;
            Ok(true)
        })
    }
}

/// Settings → General: count (or, with `apply`, run) a vault-wide pass in the
/// default vault — `aliases` (leftover note names) or `links` (link format).
#[tauri::command]
pub fn corpus_vault_pass(
    state: tauri::State<'_, CorpusState>,
    kind: String,
    apply: bool,
) -> Result<serde_json::Value, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| match kind.as_str() {
        "aliases" => store.alias_cleanup(apply).and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        "links" => store.convert_links(apply).and_then(|r| serde_json::to_value(r).map_err(|e| e.to_string())),
        other => Err(format!("no vault pass called {other}")),
    })
}
