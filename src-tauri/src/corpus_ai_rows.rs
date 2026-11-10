//! The rows an AI lane may show (split out of corpus.rs, 2026-11-09): a search
//! hit, a listing row, and the folders beside them, built from ONE read the AI
//! gate approved and from nothing else.
//!
//! Structural on purpose (second review, 2026-11-09): the first version took
//! the walk cache's row and replaced the fields it thought of, so a field it
//! didn't (the shelf behind `folderId`, the dates) still carried an older,
//! secure version out. Nothing here takes a cached `NoteMeta` or `SearchHit`:
//! the only input is an id, every row is built by the walk's own builders
//! (`note_row`, `reference_row`) from the `Approved` snapshot, and a source
//! test keeps it that way (`no_cached_row_reaches_an_ai_row`).

use std::path::PathBuf;

use super::{
    editor_body, ensure_backing_folders, leading_snippet, note_row, parse_document, reference_row,
    search_match, searchable_metadata, surfaced, CorpusStore, FolderMeta, NoteMeta, SearchHit,
    SearchMatch, Surface,
};

/// One note's text exactly as the AI read gate approved it, and where it
/// lives. Only `CorpusStore::approved` makes one.
struct Approved {
    id: String,
    rel: String,
    abs: PathBuf,
    text: String,
}

/// The row and the parsed parts of an approved snapshot.
struct Parsed {
    row: NoteMeta,
    body: String,
    metadata: String,
}

impl CorpusStore {
    fn approved(&mut self, id: &str, model_is_local: bool) -> Option<Approved> {
        let text = self.read_for_ai(id, model_is_local).ok()?;
        let rel = self.resolve_note_rel(id).ok()?;
        let abs = self.guard_rel(&rel).ok()?;
        Some(Approved { id: id.to_string(), rel, abs, text })
    }

    fn parse_approved(&self, snapshot: Approved) -> Parsed {
        let (fm, raw) = parse_document(&snapshot.text);
        let had_fm = fm.is_some();
        let body = if had_fm { editor_body(raw) } else { raw };
        let fm = fm.unwrap_or_default();
        let row = if surfaced(self.layout, &snapshot.rel) == Surface::Reference {
            reference_row(&snapshot.rel, &snapshot.abs, &fm, body)
        } else {
            note_row(self.layout, snapshot.id, &snapshot.rel, &snapshot.abs, &fm, body)
        };
        let metadata = if had_fm { searchable_metadata(&fm) } else { String::new() };
        Parsed { row, body: body.to_string(), metadata }
    }

    /// The listing row an AI lane may show for note `id`, or None when the
    /// gate refuses it.
    pub(crate) fn note_row_for_ai(&mut self, id: &str, model_is_local: bool) -> Option<NoteMeta> {
        let snapshot = self.approved(id, model_is_local)?;
        Some(self.parse_approved(snapshot).row)
    }

    /// The search hit an AI lane may show for note `id` and `query`. A note the
    /// approved bytes no longer match is dropped; a fuzzy (typo-tolerant) hit
    /// stays only when the index saw exactly these bytes, so a search can't
    /// confirm a word a secure version once held.
    pub(crate) fn search_row_for_ai(&mut self, query: &str, id: &str, model_is_local: bool) -> Option<SearchHit> {
        let snapshot = self.approved(id, model_is_local)?;
        let Parsed { row, body, metadata } = self.parse_approved(snapshot);
        let aliases = row.aliases.join("\n");
        let found = search_match(query, &row.title, &body, &row.snippet)
            .or_else(|| search_match(query, &row.title, &metadata, &row.snippet))
            .or_else(|| search_match(query, &row.title, &aliases, &row.snippet));
        let m = match found {
            Some(m) => m,
            None => {
                let indexed = self.list_cache.as_ref().and_then(|cache| cache.texts.get(id));
                if !indexed.is_some_and(|cached| cached.body == body && cached.metadata == metadata) {
                    return None;
                }
                SearchMatch {
                    rank: crate::search_match::RANK_FUZZY,
                    snippet: leading_snippet(&body),
                    match_start: 0,
                    match_len: 0,
                    spans: Vec::new(),
                }
            }
        };
        Some(SearchHit {
            id: row.id,
            title: row.title,
            folder_id: row.folder_id,
            kind: row.kind,
            rank: m.rank,
            snippet: m.snippet,
            match_start: m.match_start,
            match_len: m.match_len,
            spans: m.spans,
            updated_at: row.updated_at,
        })
    }

    /// The folder rows an AI lane may show beside `rows`: the vault's walked
    /// directories, and the shelves of exactly these rows. A shelf comes from
    /// a note's content, so one synthesized from a note the lane may not see
    /// (or from its older, secure version) never appears.
    pub(crate) fn folders_for_ai(&mut self, rows: &[NoteMeta]) -> Result<Vec<FolderMeta>, String> {
        self.ensure_walked()?;
        let mut folders = self.list_cache.as_ref().map(|cache| cache.dir_folders.clone()).unwrap_or_default();
        ensure_backing_folders(&mut folders, rows);
        folders.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(folders)
    }
}
