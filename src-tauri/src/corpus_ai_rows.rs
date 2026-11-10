//! The rows an AI lane may show (split out of corpus.rs, 2026-11-09): a search
//! hit or a listing row, gated on one read of the note and built from those
//! same bytes, never from the walk cache's older copy.

use super::{
    editor_body, leading_snippet, note_aliases, parse_document, search_match, searchable_metadata,
    snippet_of, title_of, CorpusStore, NoteMeta, SearchHit, SearchMatch,
};

impl CorpusStore {
    /// One search hit as an AI lane may show it: gated on ONE read of the
    /// note, and titled, snippeted, and matched from those same bytes. The hit
    /// itself comes from the walk cache, which can hold an older version: a
    /// note that was secure when walked and public by the time the gate read
    /// it carried the secure version's title and snippet out on the public
    /// version's approval (review 2026-11-09). A hit the judged bytes no longer
    /// match is dropped; a fuzzy (typo-tolerant) hit is kept only when the
    /// index saw exactly these bytes.
    pub(crate) fn present_hit_for_ai(
        &mut self,
        query: &str,
        hit: SearchHit,
        model_is_local: bool,
    ) -> Option<SearchHit> {
        let text = self.read_for_ai(&hit.id, model_is_local).ok()?;
        let rel = self.resolve_note_rel(&hit.id).ok()?;
        let (fm, raw) = parse_document(&text);
        let had_fm = fm.is_some();
        let body = if had_fm { editor_body(raw) } else { raw };
        let fm = fm.unwrap_or_default();
        let title = title_of(body);
        let metadata = if had_fm { searchable_metadata(&fm) } else { String::new() };
        let snippet = snippet_of(body);
        let aliases = note_aliases(&rel, &title, &hit.id, &fm).join("\n");
        let found = search_match(query, &title, body, &snippet)
            .or_else(|| search_match(query, &title, &metadata, &snippet))
            .or_else(|| search_match(query, &title, &aliases, &snippet));
        let m = match found {
            Some(m) => m,
            None => {
                let indexed = self.list_cache.as_ref().and_then(|cache| cache.texts.get(&hit.id));
                if !indexed.is_some_and(|cached| cached.body == body && cached.metadata == metadata) {
                    return None;
                }
                SearchMatch {
                    rank: crate::search_match::RANK_FUZZY,
                    snippet: leading_snippet(body),
                    match_start: 0,
                    match_len: 0,
                    spans: Vec::new(),
                }
            }
        };
        Some(SearchHit {
            title,
            rank: m.rank,
            snippet: m.snippet,
            match_start: m.match_start,
            match_len: m.match_len,
            spans: m.spans,
            ..hit
        })
    }

    /// One note's listing row as an AI lane may show it: gated on ONE read,
    /// with its title, snippet, and aliases rebuilt from those bytes instead of
    /// the walk cache (see `present_hit_for_ai`). Boards and files are not
    /// notes and keep their own gates.
    pub(crate) fn present_meta_for_ai(&mut self, mut meta: NoteMeta, model_is_local: bool) -> Option<NoteMeta> {
        let text = self.read_for_ai(&meta.id, model_is_local).ok()?;
        let rel = self.resolve_note_rel(&meta.id).ok()?;
        let (fm, raw) = parse_document(&text);
        let body = if fm.is_some() { editor_body(raw) } else { raw };
        let fm = fm.unwrap_or_default();
        meta.title = title_of(body);
        meta.snippet = snippet_of(body);
        meta.body_empty = body.trim().is_empty();
        meta.aliases = note_aliases(&rel, &meta.title, &meta.id, &fm);
        Some(meta)
    }
}
