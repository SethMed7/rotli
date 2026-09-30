//! The secure review lane (feature B, decision 2026-07-22): the Activity
//! pane's "review this" rows for notes the daemon skipped as secure, and the
//! user's "Not sensitive" answer. A child of `organizer` (split out at its size
//! ceiling, 2026-09-30), so it reads the daemon's private state directly.

use super::*;

/// One "review this" row for the Activity pane — a note the daemon skipped as
/// secure. `flagged` = the explicit frontmatter flag (already protected; the
/// repair/passive lanes own those) vs detector-only (the confirm lane: the
/// detector proposes, the user disposes — nothing is ever auto-marked here).
/// `title` is for the user's own local UI, exactly like the sidebar shows it;
/// nothing from this payload is journaled or sent anywhere.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecureHint {
    pub rel: String,
    pub title: String,
    pub flagged: bool,
}

/// The current review rows, RE-VALIDATED fresh per call: each pending rel is
/// re-snapshotted, entries that stopped looking secure (or vanished) drop out.
pub(crate) fn secure_hints(
    corpus_state: &CorpusState,
    handle: &OrganizerHandle,
) -> Result<Vec<SecureHint>, String> {
    let pending: Vec<String> = handle
        .0
        .status
        .lock()
        .unwrap()
        .secure_pending
        .iter()
        .cloned()
        .collect();
    if pending.is_empty() {
        return Ok(Vec::new());
    }
    let root_id = corpus_state.default_root_id()?;
    corpus_state.route(&root_id, |s| {
        let root = s.root().to_path_buf();
        let mut out = Vec::new();
        for rel in &pending {
            // the set only ever holds our own sweep rels, but the IPC boundary
            // re-checks anyway — dot components (../) never touch the fs
            if !candidate_rel(rel) {
                continue;
            }
            let Ok(snap) = snapshot_note(&root, rel) else {
                continue;
            };
            if !snap.secure {
                continue; // cleaned since the last cycle — not review material
            }
            out.push(SecureHint {
                rel: rel.clone(),
                title: snap.title,
                flagged: snap.secure_flagged,
            });
        }
        Ok(out)
    })
}

/// The user's "Not sensitive" answer for a detector-only note: persist the
/// whole-file hash so this exact content is never re-nagged, and clear the row
/// immediately. Refuses explicitly flagged notes (they are protected, not
/// pending) and non-candidate rels. Same benign raciness as `learn_field`
/// (#28): a mid-flight cycle may re-persist over this write — the failure mode
/// is one extra nag next cycle, never corruption.
pub(crate) fn dismiss_secure(
    corpus_state: &CorpusState,
    handle: &OrganizerHandle,
    rel: &str,
) -> Result<(), String> {
    if !candidate_rel(rel) {
        return Err(format!("not a reviewable note: {rel}"));
    }
    let root_id = corpus_state.default_root_id()?;
    corpus_state.route(&root_id, |s| {
        let root = s.root().to_path_buf();
        let snap = snapshot_note(&root, rel)?;
        if snap.secure_flagged {
            return Err("This note is marked secure — unmark it from its own menu instead.".into());
        }
        let mut st = parse_state(&s.dot_read("organizer")?);
        st.notes
            .entry(state_key(&snap))
            .or_default()
            .secure_dismissed = snap.text_hash.clone();
        s.dot_write("organizer", &state_pretty(&st))
    })?;
    handle.0.status.lock().unwrap().secure_pending.remove(rel);
    Ok(())
}

#[tauri::command]
pub fn organizer_secure_hints(
    corpus: tauri::State<CorpusState>,
    state: tauri::State<OrganizerState>,
) -> Result<Vec<SecureHint>, String> {
    secure_hints(&corpus, &state.0)
}

#[tauri::command]
pub fn organizer_dismiss_secure(
    corpus: tauri::State<CorpusState>,
    state: tauri::State<OrganizerState>,
    rel: String,
) -> Result<(), String> {
    dismiss_secure(&corpus, &state.0, &rel)
}
