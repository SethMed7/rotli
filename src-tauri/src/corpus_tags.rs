//! The store's tag lanes (2026-11-24; policy in note_tags.rs, contract in
//! docs/architecture/memex-data-contract.md "Tags"). The person may add and
//! remove any tag on any note they can open, locked and secure ones included.
//! An AI (chat, an agent) may change tags only where it could rewrite the
//! body: the same read gate, lock refusal, body-edit grant, laundering rule,
//! and revision check, all under the note's file lock. No tag write may change
//! the note's protection, in either direction.

use serde::Serialize;

use super::{
    is_archive_folder, is_chats_lane, is_trash_folder, locked_on, looks_secure, parse_document, secure_on,
    Authority, CorpusStore, Layout, NoteKind,
};

/// What a tag change asks for: tags to add (any input; each is normalized and
/// refused when it can't be a tag) and tags to take off (matched as written).
#[derive(Debug, Clone, Default)]
pub(crate) struct TagChange {
    pub(crate) add: Vec<String>,
    pub(crate) remove: Vec<String>,
}

impl TagChange {
    fn normalized_add(&self) -> Result<Vec<String>, String> {
        if self.add.len() + self.remove.len() > crate::note_tags::TAGS_PER_CHANGE_MAX {
            return Err(format!(
                "one change adds or removes at most {} tags",
                crate::note_tags::TAGS_PER_CHANGE_MAX
            ));
        }
        if self.add.is_empty() && self.remove.is_empty() {
            return Err("name at least one tag to add or remove".into());
        }
        self.add.iter().map(|tag| crate::note_tags::normalize_tag(tag)).collect()
    }
}

/// A tag write's answer: the note's tags now, and the revision of its bytes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteTags {
    pub id: String,
    pub tags: Vec<String>,
    pub revision: String,
}

/// One tag across the vault: how it is most often spelled, and its notes.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
    pub ids: Vec<String>,
}

/// Which AI lane is asking.
#[derive(Clone, Copy)]
pub(crate) enum AiTagger {
    /// Chat: `local` is the model's locality; `consented` is the person's
    /// "Allow once" for this edit, which never covers a lock or a deliberate
    /// `ai_edit: false`. Its caller, chat's tag tool, is the next change.
    #[cfg_attr(not(test), allow(dead_code))]
    Chat { local: bool, consented: bool },
    /// The CLI, MCP, and relay: always remote.
    Agent,
}

impl CorpusStore {
    /// The person's own tag change. Works on a locked or secure note: the lock
    /// stops AI, never its owner. `expected`, when given, refuses a change to
    /// a note changed since that read; without it the change is a delta
    /// applied under the note's file lock, so it can't undo anyone's edit.
    pub(crate) fn change_tags_as_person(
        &mut self,
        id_or_rel: &str,
        change: &TagChange,
        expected: Option<&str>,
    ) -> Result<NoteTags, String> {
        let add = change.normalized_add()?;
        let rel = self.tag_target(id_or_rel)?;
        self.writable(&rel)?;
        let path = self.abs(&rel);
        self.lock_note(&rel, None, Authority::Person).and_then(|_held| {
            let text = crate::fsutil::read_own_text(&path).map_err(|e| e.to_string())?;
            if let Some(expected) = expected {
                crate::fsutil::compare_revision(expected, text.as_bytes())?;
            }
            self.write_tags(id_or_rel, &path, &text, &add, &change.remove, false)
        })
    }

    /// An AI's tag change, under the gates an AI body write passes
    /// (`write_for_ai_as`, `write_for_remote_agent_if_revision`), in their
    /// order: read gate first (a secure note refuses a remote caller before
    /// its revision is computed), then the lock, the body-edit grant, the
    /// laundering rule for the tag text, and the revision.
    pub(crate) fn change_tags_for_ai(
        &mut self,
        id_or_rel: &str,
        change: &TagChange,
        tagger: AiTagger,
        expected: &str,
    ) -> Result<NoteTags, String> {
        crate::fsutil::require_revision(expected)?;
        let add = change.normalized_add()?;
        let rel = self.tag_target(id_or_rel)?;
        let (local, consented, authority) = match tagger {
            AiTagger::Chat { local, consented } => (local, consented, Authority::Model { local }),
            AiTagger::Agent => (false, false, Authority::Agent),
        };
        if matches!(tagger, AiTagger::Agent) && self.layout == Layout::Memex && (rel == "wiki" || rel.starts_with("wiki/")) {
            self.filer_writable(&rel)?;
        } else {
            self.writable(&rel)?;
        }
        let path = self.abs(&rel);
        self.lock_note(&rel, None, authority).and_then(|_held| {
            let text = self.read_for_ai(&rel, local)?;
            let (fm, body) = parse_document(&text);
            let fm = fm.unwrap_or_default();
            if locked_on(&fm.foreign) {
                return Err("This note is locked — no AI may change its tags. Unlock it from the note's menu first.".into());
            }
            let refusal = if consented {
                crate::ai_edit_policy::consented_insert_refusal(&fm.foreign)
            } else {
                crate::ai_edit_policy::body_edit(&fm.foreign).refusal()
            };
            if let Some(refusal) = refusal {
                return Err(refusal.into());
            }
            let target_secure = secure_on(&fm.foreign) || looks_secure(body);
            if let Some(refusal) = crate::secret::secure_write_refusal(target_secure, &add.join(" ")) {
                return Err(refusal.into());
            }
            if !local && add.iter().any(|tag| crate::secret::blocked_for_remote(tag)) {
                return Err("refused: that tag looks like a secret".into());
            }
            crate::fsutil::compare_revision(expected, text.as_bytes())?;
            self.write_tags(id_or_rel, &path, &text, &add, &change.remove, true)
        })
    }

    fn tag_target(&mut self, id_or_rel: &str) -> Result<String, String> {
        super::raw::refuse_in_raw(self, "change")?;
        let rel = self.resolve_note_rel(id_or_rel)?;
        if !rel.to_ascii_lowercase().ends_with(".md") {
            return Err("only Markdown notes carry tags".into());
        }
        Ok(rel)
    }

    fn write_tags(
        &mut self,
        id_or_rel: &str,
        path: &std::path::Path,
        text: &str,
        add: &[String],
        remove: &[String],
        ai: bool,
    ) -> Result<NoteTags, String> {
        let answer = |text: &str, tags: Vec<String>| NoteTags {
            id: id_or_rel.to_string(),
            tags,
            revision: crate::fsutil::revision(text.as_bytes()),
        };
        let unchanged = || answer(text, crate::note_tags::tag_values(&parse_document(text).0.unwrap_or_default().foreign));
        // a note with frontmatter changes only its `tags:` lines; one without
        // gets the fence a note of this vault is written with
        let block = super::raw_frontmatter_block(text);
        let out = if block.is_empty() {
            let (fm, body) = parse_document(text);
            let mut fm = fm.unwrap_or_default();
            let Some(next) = crate::note_tags::apply_change(&fm.foreign, add, remove)? else {
                return Ok(unchanged());
            };
            fm.foreign = next;
            self.compose_for(text, &fm, body)
        } else {
            let Some(next) = crate::note_tags::apply_to_block(block, add, remove)? else {
                return Ok(unchanged());
            };
            format!("{next}{}", &text[block.len()..])
        };
        // a tag is never a permission: the note reads exactly as protected after
        if crate::note_protection::protection(text) != crate::note_protection::protection(&out) {
            return Err("refused: changing tags may not change how this note is protected".into());
        }
        if ai {
            self.write_ai_tightened(path, text, &out)?;
        } else {
            self.write_tightened(path, text, &out)?;
        }
        let tags = crate::note_tags::tag_values(&parse_document(&out).0.unwrap_or_default().foreign);
        Ok(answer(&out, tags))
    }

    /// Every tag in the vault's notes (not Trash, Archive, or chats) with the
    /// notes that carry it, most used first. `for_remote`: only notes the remote
    /// read gate passes count, so a tag found only on a secure note is neither
    /// named nor counted.
    pub(crate) fn tag_counts(&mut self, for_remote: bool) -> Result<Vec<TagCount>, String> {
        let layout = self.layout;
        let notes = self.list()?.notes;
        let mut counts: Vec<TagCount> = Vec::new();
        let mut spellings: Vec<Vec<(String, usize)>> = Vec::new();
        for meta in notes {
            if meta.kind != NoteKind::Note
                || is_trash_folder(layout, &meta.folder_id)
                || is_archive_folder(layout, &meta.folder_id)
                || is_chats_lane(layout, &meta.folder_id)
            {
                continue;
            }
            let text = if for_remote {
                match self.note_for_ai(&meta.id, false) {
                    Some((_, text)) => text,
                    None => continue,
                }
            } else {
                let Ok(rel) = self.resolve_note_rel(&meta.id) else { continue };
                let Ok(text) = crate::fsutil::read_own_text(&self.abs(&rel)) else { continue };
                text
            };
            let mut seen: Vec<String> = Vec::new();
            for tag in crate::note_tags::tag_values(&parse_document(&text).0.unwrap_or_default().foreign) {
                let key = tag.to_lowercase();
                if seen.contains(&key) {
                    continue;
                }
                seen.push(key.clone());
                let at = match counts.iter().position(|c| c.tag.to_lowercase() == key) {
                    Some(at) => at,
                    None => {
                        counts.push(TagCount { tag: tag.clone(), count: 0, ids: Vec::new() });
                        spellings.push(Vec::new());
                        counts.len() - 1
                    }
                };
                counts[at].count += 1;
                counts[at].ids.push(meta.id.clone());
                match spellings[at].iter_mut().find(|(s, _)| *s == tag) {
                    Some((_, n)) => *n += 1,
                    None => spellings[at].push((tag, 1)),
                }
            }
        }
        for (count, spelled) in counts.iter_mut().zip(spellings) {
            // the most common spelling; the first seen wins a tie
            let mut best: Option<(String, usize)> = None;
            for (spelling, n) in spelled {
                if best.as_ref().is_none_or(|(_, top)| n > *top) {
                    best = Some((spelling, n));
                }
            }
            if let Some((spelling, _)) = best {
                count.tag = spelling;
            }
        }
        counts.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.to_lowercase().cmp(&b.tag.to_lowercase())));
        Ok(counts)
    }
}

/// The person's tag change from the note header or `/tag`.
#[tauri::command]
pub fn corpus_change_tags(
    state: tauri::State<'_, super::CorpusState>,
    id: String,
    add: Vec<String>,
    remove: Vec<String>,
    expected_revision: Option<String>,
) -> Result<NoteTags, String> {
    let (root, rel) = super::split_root_id(&id);
    let change = TagChange { add, remove };
    state
        .route(&root, |s| s.change_tags_as_person(&rel, &change, expected_revision.as_deref()))
        .map(|tags| NoteTags { id, ..tags })
}

/// Every tag in the active vault with its notes, for the sidebar's filter and
/// `/tag`'s suggestions. The person's own view: secure notes count.
#[tauri::command]
pub async fn corpus_list_tags(app: tauri::AppHandle) -> Result<Vec<TagCount>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<super::CorpusState>();
        let default_id = state.0.lock().map_err(|_| "corpus lock poisoned".to_string())?.default_id.clone();
        state.route(&default_id, |s| s.tag_counts(false))
    })
    .await
    .map_err(|e| format!("corpus tags worker failed ({e})"))?
}

#[cfg(test)]
#[path = "corpus_tags_tests.rs"]
mod tests;
