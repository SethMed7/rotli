//! What the walk remembers about each note's text, beside its meta: the body,
//! the searchable metadata projection, whether it is protected, and whether
//! its frontmatter id is one another file holds (split from corpus.rs at its
//! size ceiling, with the duplicate-id record the Librarian route needs).

use std::collections::HashSet;

use super::{looks_secure, secure_context_field, CorpusStore, Frontmatter};

/// One walked note's parsed text, cached beside its meta.
///
/// MEMORY TRADEOFF (deliberate, Greptile PR #14): the whole corpus's note
/// bodies stay resident while the walk cache is valid — ~3 MB for a typical
/// 1k-note corpus, ~200 MB for an extreme 20k×10 KB one. That buys
/// search()/tasks() answering from one parse instead of a second full-vault
/// read per call. No eviction on purpose (the cache IS the working set of a
/// local-first notes app); if a future corpus class outgrows this, the
/// refactor seam is: evict `body`/`metadata` here while keeping the metas,
/// and let search/tasks fall back to per-note reads.
pub(super) struct CachedNoteText {
    pub(super) body: String,
    /// The searchable frontmatter projection ("" when the note has none).
    pub(super) metadata: String,
    /// Decided on the WALK, from the same rule `read_for_ai` applies: the
    /// `secure:` flag, the chat taint marker, or the body detector. It cannot
    /// be re-derived from `metadata`, which is an 8-key search projection that
    /// deliberately omits protection state. The secure-prose ledger is fed
    /// from this (audit 2026-08-01, GAP 2).
    pub(super) secure: bool,
    /// The frontmatter id this file claims but the walk gave to another file
    /// (a copy carrying the same id). None for every other note.
    pub(super) claims_id: Option<String>,
}

impl CachedNoteText {
    /// One walked note's cache entry. `assigned` is the id the walk gave the
    /// note (None in the reference lane, which has no ids of its own).
    pub(super) fn new(fm: &Frontmatter, had_fm: bool, body: &str, text: &str, assigned: Option<&str>) -> Self {
        CachedNoteText {
            body: body.to_string(),
            metadata: if had_fm { searchable_metadata(fm) } else { String::new() },
            secure: walked_secure(fm, body, text),
            claims_id: assigned.and(fm.id.clone()).filter(|claimed| !claimed.is_empty() && Some(claimed.as_str()) != assigned),
        }
    }
}

impl CorpusStore {
    /// Frontmatter ids more than one file carries. The walk gives such an id
    /// to one of the files and a fresh id to each other (two notes never
    /// collapse into one), so which file holds it depends on the walk's order
    /// and the id names no one note. Nothing in the app shows these today; the
    /// Librarian route refuses and hides them (Codex review round 5 of PR #295).
    pub(crate) fn ids_held_twice(&mut self) -> Result<HashSet<String>, String> {
        self.ensure_walked()?;
        let cache = self.list_cache.as_ref().ok_or("the walk left no cache")?;
        Ok(cache.texts.values().filter_map(|text| text.claims_id.clone()).collect())
    }
}

/// The clean, top-level metadata vocabulary retrieval may search. This makes
/// organizer-generated keywords useful without exposing arbitrary nested or
/// provenance/control frontmatter. Values stay plain text and are never an
/// independent source of truth.
pub(super) fn searchable_metadata(fm: &Frontmatter) -> String {
    const KEYS: [&str; 8] = [
        "aliases", "area", "summary", "tags", "links", "shelf", "reach", "view_tag",
    ];
    fm.foreign
        .iter()
        .filter(|line| {
            let Some((key, _)) = line.split_once(':') else {
                return false;
            };
            key == key.trim() && KEYS.contains(&key)
        })
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Is this walked note protected content? The same three-way rule
/// `read_for_ai` applies — the explicit flag, the chat taint marker, or the
/// body detector for a note whose metadata panel was never opened.
pub(crate) fn walked_secure(fm: &Frontmatter, body: &str, text: &str) -> bool {
    crate::frontmatter_keys::secure(&fm.foreign)
        || fm
            .foreign
            .iter()
            .any(|l| secure_context_field(l) == Some(true))
        // the chat mark by the grammar TypeScript shares (eighth review: the
        // line rule above missed `TRUE`, a quoted true, `key : true`)
        || crate::protection_mark::marked(text, "secureContext")
        || looks_secure(body)
}
