//! Tantivy full-text search — the narrow adapter behind `CorpusStore::search`.
//!
//! DERIVED, gitignored, rebuildable. The `.md` files are the only durable truth
//! (ROTLI_CORE rule 0); this index is a projection of them that may be deleted at
//! any moment and rebuilt from the walk. A corrupt, absent, or version-mismatched
//! index is never a crash and never data loss — it is a rebuild, or a fallback to
//! the substring scan the store keeps for exactly this reason.
//!
//! SECURITY: this index contains secure-note text (its tokens + positions). It is
//! NOT the visibility gate. `CorpusStore::search` is the user lane and returns
//! secure hits, as it always has; `corpus_search_ai` re-applies `read_for_ai` per
//! hit — reading the note's frontmatter from DISK — before any hit crosses the
//! command boundary. So a stale or wrong `secure` bit in this index cannot leak a
//! thing: the authoritative verdict is re-derived from the source of truth after
//! this adapter returns. See docs/design/tantivy-search.md and the egress threat
//! model.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use tantivy::collector::{DocSetCollector, TopDocs};
use tantivy::query::{BooleanQuery, FuzzyTermQuery, Occur, PhraseQuery, Query, RegexQuery};
use tantivy::schema::{
    IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, FAST, STORED, STRING,
};
use tantivy::{Index, IndexReader, IndexWriter, TantivyDocument, Term};

/// Bump when the schema, tokenizer, or hash function changes: a mismatch wipes
/// and rebuilds rather than reading an index this binary can no longer trust.
const SCHEMA_VERSION: u32 = 2;

/// The stamp file that records `SCHEMA_VERSION` beside the segment files.
const META_FILE: &str = "rotli-search-meta.json";

/// Writer heap budget (bytes) — single-threaded and small on purpose: a menu-bar
/// app indexing a local vault, not a server. Tantivy's floor is ~15 MB.
const WRITER_HEAP: usize = 15_000_000;

/// One note projected for indexing. Built by `CorpusStore::search` from the walk
/// cache (bodies are already resident there — the index never stores a second
/// copy of the prose).
#[derive(Clone)]
pub struct IndexDoc {
    pub id: String,
    pub title: String,
    pub body: String,
    /// Frontmatter search projection + aliases, newline-joined.
    pub meta: String,
    /// The same classification `read_for_ai` applies (flag/marker/detector).
    /// Recorded for self-description only — never trusted as the gate.
    pub secure: bool,
}

struct Fields {
    id: tantivy::schema::Field,
    /// One combined searchable field — title, body, and the meta projection are
    /// all indexed into it. Membership is what matters (presentation and the
    /// title-vs-body rank come from `search_match` over the walk cache, not from
    /// the index), so a single field lets an INFIX regex scan the term dictionary
    /// ONCE per query token instead of once per field — the difference between
    /// infix being slower than the old substring scan and being faster than it.
    all: tantivy::schema::Field,
    hash: tantivy::schema::Field,
    secure: tantivy::schema::Field,
}

pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    fields: Fields,
    /// id → content hash of what is currently indexed. Lets `sync` re-write only
    /// changed docs. Rebuilt from the stored index at open, so incremental updates
    /// survive a restart.
    doc_hashes: HashMap<String, u64>,
    /// The corpus generation this index was last synced at. `search` skips the
    /// diff entirely when the generation has not moved — the index rides the
    /// existing suppress-marked watcher, never rebuilds per keystroke.
    synced_generation: Option<u64>,
}

fn build_schema() -> (Schema, Fields) {
    let mut sb = Schema::builder();
    // Lowercasing + unicode word split, WITH positions so phrase queries work.
    // The "default" tokenizer (no stemming) keeps behavior close to today's
    // substring search: an INFIX regex on a query token matches it anywhere inside
    // an indexed term (so `config` finds "reconfigure", as `find_ci` did), plus
    // real multi-token AND, phrase, and fuzzy queries substring could never do.
    let text = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("default")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );
    let id = sb.add_text_field("id", STRING | STORED);
    let all = sb.add_text_field("all", text);
    let hash = sb.add_u64_field("hash", STORED | FAST);
    let secure = sb.add_u64_field("secure", STORED | FAST);
    (
        sb.build(),
        Fields {
            id,
            all,
            hash,
            secure,
        },
    )
}

/// Deterministic FNV-1a 64 over a doc's searchable content + its secure bit, so a
/// secure-flag flip re-indexes the note. Stability is needed only WITHIN a binary
/// (the stored hash and the fresh hash are computed by the same build); a hash
/// change across versions just looks like "everything changed" → a safe full
/// resync, and SCHEMA_VERSION exists to force a wipe when that is cleaner.
fn content_hash(doc: &IndexDoc) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |bytes: &[u8]| {
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    mix(doc.title.as_bytes());
    mix(&[0]);
    mix(doc.body.as_bytes());
    mix(&[0]);
    mix(doc.meta.as_bytes());
    mix(&[if doc.secure { 1 } else { 0 }]);
    h
}

impl SearchIndex {
    /// Open the on-disk index, or wipe+recreate it on ANY mismatch (missing dir,
    /// absent/wrong schema stamp, or a Tantivy open error from a format bump or
    /// corruption). Never returns an error the caller must treat as fatal — an
    /// `Err` here just means the store falls back to the substring scan.
    pub fn open_or_create(dir: &Path) -> Result<Self, String> {
        let (schema, fields) = build_schema();
        let stamp_ok = read_stamp(dir).is_some_and(|v| v == SCHEMA_VERSION);
        let index = if stamp_ok {
            match Index::open_in_dir(dir) {
                Ok(index) => index,
                // Corruption or a Tantivy format change: rebuild, don't crash.
                Err(_) => recreate(dir, &schema)?,
            }
        } else {
            recreate(dir, &schema)?
        };
        let reader = index
            .reader_builder()
            .reload_policy(tantivy::ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| format!("search reader: {e}"))?;
        let mut me = Self {
            index,
            reader,
            fields,
            doc_hashes: HashMap::new(),
            synced_generation: None,
        };
        me.load_hashes()?;
        Ok(me)
    }

    /// Populate `doc_hashes` from the stored (id, hash) of every indexed doc, so a
    /// restart resumes incremental updates instead of rebuilding wholesale.
    fn load_hashes(&mut self) -> Result<(), String> {
        let searcher = self.reader.searcher();
        let addrs = searcher
            .search(&tantivy::query::AllQuery, &DocSetCollector)
            .map_err(|e| format!("search index scan: {e}"))?;
        for addr in addrs {
            let doc: TantivyDocument = searcher
                .doc(addr)
                .map_err(|e| format!("search index read: {e}"))?;
            let id = doc
                .get_first(self.fields.id)
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let hash = doc.get_first(self.fields.hash).and_then(|v| v.as_u64());
            if let (Some(id), Some(hash)) = (id, hash) {
                self.doc_hashes.insert(id, hash);
            }
        }
        Ok(())
    }

    pub fn synced_generation(&self) -> Option<u64> {
        self.synced_generation
    }

    /// Bring the index into agreement with `docs` — the current searchable set —
    /// touching only what changed. A no-op when the generation has not moved since
    /// the last sync, so a burst of queries at a steady corpus costs one diff, not
    /// one per query.
    pub fn sync(&mut self, generation: u64, docs: &[IndexDoc]) -> Result<(), String> {
        if self.synced_generation == Some(generation) {
            return Ok(());
        }
        let mut writer: IndexWriter = self
            .index
            .writer_with_num_threads(1, WRITER_HEAP)
            .map_err(|e| format!("search writer: {e}"))?;

        let mut changed = false;
        let mut seen: std::collections::HashSet<&str> =
            std::collections::HashSet::with_capacity(docs.len());
        for doc in docs {
            seen.insert(String::as_str(&doc.id));
            let hash = content_hash(doc);
            if self.doc_hashes.get(&doc.id) == Some(&hash) {
                continue;
            }
            let term = Term::from_field_text(self.fields.id, &doc.id);
            writer.delete_term(term);
            let mut td = TantivyDocument::default();
            td.add_text(self.fields.id, &doc.id);
            // title, body, and meta all index into the one `all` field. Multiple
            // values are indexed with a position gap between them, so a phrase
            // query cannot straddle the title/body boundary.
            td.add_text(self.fields.all, &doc.title);
            td.add_text(self.fields.all, &doc.body);
            if !doc.meta.is_empty() {
                td.add_text(self.fields.all, &doc.meta);
            }
            td.add_u64(self.fields.hash, hash);
            td.add_u64(self.fields.secure, u64::from(doc.secure));
            writer
                .add_document(td)
                .map_err(|e| format!("search add: {e}"))?;
            self.doc_hashes.insert(doc.id.clone(), hash);
            changed = true;
        }
        // Deletions: ids we hold but the walk no longer sees.
        let gone: Vec<String> = self
            .doc_hashes
            .keys()
            .filter(|id| !seen.contains(String::as_str(id)))
            .cloned()
            .collect();
        for id in gone {
            writer.delete_term(Term::from_field_text(self.fields.id, &id));
            self.doc_hashes.remove(&id);
            changed = true;
        }

        if changed {
            writer.commit().map_err(|e| format!("search commit: {e}"))?;
            self.reader
                .reload()
                .map_err(|e| format!("search reload: {e}"))?;
        }
        self.synced_generation = Some(generation);
        Ok(())
    }

    /// Candidate note ids for `query`, best-scoring first (title-boosted). The
    /// caller re-ranks with `sort_hits` and re-derives the snippet with
    /// `search_match`, so this decides MEMBERSHIP, not the final wire order.
    /// `over_fetch` should exceed the display limit so post-filtering (Trash,
    /// chats, per-hit AI gate) still fills the page.
    pub fn query(&self, query: &str, over_fetch: usize) -> Result<Vec<String>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let Some(q) = self.build_query(trimmed) else {
            return Ok(Vec::new());
        };
        let searcher = self.reader.searcher();
        let collector = TopDocs::with_limit(over_fetch.max(1)).order_by_score();
        let top = searcher
            .search(&*q, &collector)
            .map_err(|e| format!("search query: {e}"))?;
        let mut ids = Vec::with_capacity(top.len());
        for (_score, addr) in top {
            let doc: TantivyDocument = searcher
                .doc(addr)
                .map_err(|e| format!("search hit read: {e}"))?;
            if let Some(id) = doc.get_first(self.fields.id).and_then(|v| v.as_str()) {
                ids.push(id.to_string());
            }
        }
        Ok(ids)
    }

    /// A quoted `"exact phrase"` becomes a PhraseQuery over the combined field.
    /// Otherwise every query token must match somewhere as an INFIX (`.*tok.*`) —
    /// the same anywhere-in-the-text recall the old `find_ci` substring lane had,
    /// which subsumes prefix/as-you-type — with a distance-1 fuzzy fallback on the
    /// trailing token so a typo while typing still surfaces the note.
    fn build_query(&self, raw: &str) -> Option<Box<dyn Query>> {
        let all = self.fields.all;
        // Explicit phrase: "a b c"
        if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
            let inner = raw.trim_matches('"').trim();
            let toks = tokenize(inner);
            if toks.len() >= 2 {
                let terms: Vec<Term> = toks.iter().map(|t| Term::from_field_text(all, t)).collect();
                return Some(Box::new(PhraseQuery::new(terms)));
            }
            // one-word "phrase" degrades to the normal token path below
        }

        let toks = tokenize(raw);
        if toks.is_empty() {
            return None;
        }
        let last = toks.len() - 1;
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::with_capacity(toks.len());
        for (i, tok) in toks.iter().enumerate() {
            // INFIX, not prefix: `.*tok.*` matches the token anywhere inside an
            // indexed term, so `config` finds "reconfigure" exactly as the old
            // `find_ci` substring lane did. The membership set MUST be a SUPERSET
            // of that lane (verifier 2026-08-01), and infix is what makes it one —
            // a token match is a superset of a prefix match, which was a superset
            // of an exact match. It is a leading-wildcard regex (no FST prefix
            // pruning, it streams the term dictionary), so it is run ONCE per token
            // over the single combined `all` field rather than once per field.
            let mut union: Vec<(Occur, Box<dyn Query>)> = Vec::new();
            if let Ok(rx) = RegexQuery::from_pattern(&format!(".*{}.*", regex_escape(tok)), all) {
                union.push((Occur::Should, Box::new(rx)));
            }
            // trailing-token typo tolerance (only when it is worth it) — catches a
            // typo the infix regex cannot, e.g. `cofnig` → `config`.
            if i == last && tok.chars().count() >= 4 {
                let term = Term::from_field_text(all, tok);
                union.push((Occur::Should, Box::new(FuzzyTermQuery::new(term, 1, true))));
            }
            if union.is_empty() {
                return None;
            }
            clauses.push((Occur::Must, Box::new(BooleanQuery::new(union))));
        }
        Some(Box::new(BooleanQuery::new(clauses)))
    }
}

/// Whitespace tokenize + lowercase, matching the "default" tokenizer's word
/// boundaries closely enough for query building (indexing does the authoritative
/// split). Punctuation is dropped so a stray comma does not break a term.
fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .take(16)
        .map(|t| t.to_lowercase())
        .collect()
}

/// Escape the regex metacharacters that can appear in a query token. Tokens are
/// alphanumeric after `tokenize`, so this is belt-and-suspenders.
fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if "\\.+*?()|[]{}^$".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn read_stamp(dir: &Path) -> Option<u32> {
    let raw = fs::read_to_string(dir.join(META_FILE)).ok()?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()?
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .map(|v| v as u32)
}

/// Wipe the index directory and create a fresh index + schema stamp.
fn recreate(dir: &Path, schema: &Schema) -> Result<Index, String> {
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("wipe search index: {e}"))?;
    }
    fs::create_dir_all(dir).map_err(|e| format!("create search index dir: {e}"))?;
    let index = Index::create_in_dir(dir, schema.clone())
        .map_err(|e| format!("create search index: {e}"))?;
    let stamp = serde_json::json!({ "schemaVersion": SCHEMA_VERSION }).to_string();
    fs::write(dir.join(META_FILE), stamp).map_err(|e| format!("write search stamp: {e}"))?;
    Ok(index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn doc(id: &str, title: &str, body: &str, secure: bool) -> IndexDoc {
        IndexDoc {
            id: id.into(),
            title: title.into(),
            body: body.into(),
            meta: String::new(),
            secure,
        }
    }

    /// Tokenized AND, as-you-type prefix, trailing-token fuzzy, and phrase — the
    /// four things substring could not do — over one built-from-scratch index.
    #[test]
    fn builds_and_queries_tokenized_prefix_fuzzy_phrase() {
        let tmp = TempDir::new().unwrap();
        let mut idx = SearchIndex::open_or_create(&tmp.path().join("search")).unwrap();
        idx.sync(
            1,
            &[
                doc("a", "Wire limit", "call the bank about the cap", false),
                doc(
                    "b",
                    "Meeting prep",
                    "raise the wire limit question with finance",
                    false,
                ),
                doc("c", "Groceries", "olive oil and sourdough bread", false),
            ],
        )
        .unwrap();

        // multi-token AND — both notes contain both tokens, the grocery note neither
        let ids = idx.query("wire limit", 20).unwrap();
        assert!(
            ids.contains(&"a".to_string()) && ids.contains(&"b".to_string()),
            "{ids:?}"
        );
        assert!(
            !ids.contains(&"c".to_string()),
            "AND excludes the unrelated note: {ids:?}"
        );

        // prefix / as-you-type: "groc" finds "Groceries" without a full token
        assert!(idx.query("groc", 20).unwrap().contains(&"c".to_string()));
        // fuzzy: a distance-1 typo on the trailing token still surfaces the note
        assert!(idx
            .query("sourdogh", 20)
            .unwrap()
            .contains(&"c".to_string()));
        // phrase: adjacency required
        assert!(idx
            .query("\"olive oil\"", 20)
            .unwrap()
            .contains(&"c".to_string()));
        assert!(
            idx.query("\"oil olive\"", 20).unwrap().is_empty(),
            "wrong order, no phrase hit"
        );
        // blank query is empty, never everything
        assert!(idx.query("   ", 20).unwrap().is_empty());
    }

    /// INFIX parity with the old `find_ci` substring lane: a query token matches
    /// anywhere inside an indexed term, not just at its start. These are the exact
    /// cases prefix matching silently dropped (verifier 2026-08-01).
    #[test]
    fn infix_matches_mid_word_like_the_old_substring_lane() {
        let tmp = TempDir::new().unwrap();
        let mut idx = SearchIndex::open_or_create(&tmp.path().join("s")).unwrap();
        idx.sync(
            1,
            &[
                doc("a", "Router", "steps to reconfigure the router", false),
                doc("b", "Session", "how to reauthenticate the session", false),
                doc("c", "Carbon", "reduce the carbon footprint", false),
                doc("d", "Garden", "unrelated notes about gardens", false),
            ],
        )
        .unwrap();
        assert!(
            idx.query("config", 20).unwrap().contains(&"a".to_string()),
            "config → reconfigure"
        );
        assert!(
            idx.query("auth", 20).unwrap().contains(&"b".to_string()),
            "auth → reauthenticate"
        );
        assert!(
            idx.query("print", 20).unwrap().contains(&"c".to_string()),
            "print → footprint"
        );
        // infix is targeted, not a blanket match — the unrelated note stays out
        assert!(!idx.query("config", 20).unwrap().contains(&"d".to_string()));
    }

    /// Incremental sync: an edit re-indexes only the changed doc (old term gone,
    /// new term found), a new doc is added, and a vanished doc is deleted.
    #[test]
    fn incremental_add_change_delete() {
        let tmp = TempDir::new().unwrap();
        let mut idx = SearchIndex::open_or_create(&tmp.path().join("s")).unwrap();
        idx.sync(1, &[doc("a", "Alpha", "kelpie fragment", false)])
            .unwrap();
        assert!(idx.query("kelpie", 10).unwrap().contains(&"a".to_string()));

        // edit "a" and add "b" at a new generation
        idx.sync(
            2,
            &[
                doc("a", "Alpha", "selkie fragment", false),
                doc("b", "Beta", "brand new note", false),
            ],
        )
        .unwrap();
        assert!(
            idx.query("kelpie", 10).unwrap().is_empty(),
            "old term gone after the edit"
        );
        assert!(idx.query("selkie", 10).unwrap().contains(&"a".to_string()));
        assert!(idx.query("brand", 10).unwrap().contains(&"b".to_string()));

        // drop "b" at another generation
        idx.sync(3, &[doc("a", "Alpha", "selkie fragment", false)])
            .unwrap();
        assert!(
            idx.query("brand", 10).unwrap().is_empty(),
            "deleted doc no longer indexed"
        );
        assert!(idx.query("selkie", 10).unwrap().contains(&"a".to_string()));
    }

    /// The hot-path skip: a sync at the already-synced generation is a no-op, even
    /// if handed different docs — the index rides the generation, not the query.
    #[test]
    fn same_generation_sync_is_a_noop() {
        let tmp = TempDir::new().unwrap();
        let mut idx = SearchIndex::open_or_create(&tmp.path().join("s")).unwrap();
        idx.sync(5, &[doc("a", "Alpha", "kelpie", false)]).unwrap();
        assert_eq!(idx.synced_generation(), Some(5));
        // same generation, empty docs — MUST be ignored (would otherwise delete "a")
        idx.sync(5, &[]).unwrap();
        assert!(
            idx.query("kelpie", 10).unwrap().contains(&"a".to_string()),
            "no-op held the doc"
        );
    }

    /// Reopen resumes incrementally (hashes reloaded from the persisted index), and
    /// a schema-version mismatch WIPES and rebuilds rather than crashing.
    #[test]
    fn reopen_resumes_then_version_mismatch_rebuilds() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("s");
        {
            let mut idx = SearchIndex::open_or_create(&dir).unwrap();
            idx.sync(1, &[doc("a", "Alpha", "kelpie fragment", false)])
                .unwrap();
        }
        // reopen: the persisted segment answers immediately, no re-sync needed
        let idx = SearchIndex::open_or_create(&dir).unwrap();
        assert!(idx.query("kelpie", 10).unwrap().contains(&"a".to_string()));
        drop(idx);

        // a stamp this binary does not recognize ⇒ wipe + rebuild, never a crash
        fs::write(dir.join(META_FILE), r#"{"schemaVersion":99999}"#).unwrap();
        let idx = SearchIndex::open_or_create(&dir).unwrap();
        assert!(
            idx.query("kelpie", 10).unwrap().is_empty(),
            "mismatch wiped the stale index"
        );
        // and it is immediately usable again (rebuildable)
        let mut idx = idx;
        idx.sync(1, &[doc("z", "Zed", "new after rebuild", false)])
            .unwrap();
        assert!(idx.query("rebuild", 10).unwrap().contains(&"z".to_string()));
    }

    /// A deleted index directory recreates empty on next open — never data loss,
    /// never an error the caller must treat as fatal.
    #[test]
    fn deleted_index_dir_recreates_empty() {
        let tmp = TempDir::new().unwrap();
        let dir = tmp.path().join("s");
        {
            let mut idx = SearchIndex::open_or_create(&dir).unwrap();
            idx.sync(1, &[doc("a", "Alpha", "kelpie", false)]).unwrap();
        }
        fs::remove_dir_all(&dir).unwrap();
        let idx = SearchIndex::open_or_create(&dir).expect("recreate, not error");
        assert!(
            idx.query("kelpie", 10).unwrap().is_empty(),
            "gone with the wiped dir"
        );
    }

    /// Rebuild-from-scratch parity: two indexes fed the same docs answer the same
    /// query with the same id set, whatever order the docs arrived in.
    #[test]
    fn rebuild_from_scratch_is_deterministic() {
        let corpus = [
            doc("a", "One", "the wire limit rose", false),
            doc("b", "Two", "wire and limit", false),
        ];
        let query = "wire limit";

        let t1 = TempDir::new().unwrap();
        let mut i1 = SearchIndex::open_or_create(&t1.path().join("s")).unwrap();
        i1.sync(1, &corpus).unwrap();
        let mut a = i1.query(query, 50).unwrap();
        a.sort();

        // rebuild in a fresh dir, docs reversed
        let t2 = TempDir::new().unwrap();
        let mut i2 = SearchIndex::open_or_create(&t2.path().join("s")).unwrap();
        let mut rev = corpus.to_vec();
        rev.reverse();
        i2.sync(1, &rev).unwrap();
        let mut b = i2.query(query, 50).unwrap();
        b.sort();

        assert_eq!(a, b, "membership is independent of build order");
    }
}

#[cfg(test)]
mod bench {
    use super::*;
    use std::time::Instant;
    use tempfile::TempDir;

    /// Query latency at realistic scale: the indexed lookup vs the pre-Tantivy
    /// substring scan over the SAME corpus (perf-audit 2/5). Ignored by default —
    /// run with: cargo test --release search_index::bench -- --ignored --nocapture
    #[test]
    #[ignore]
    fn latency_index_vs_substring_scan() {
        const N: usize = 5000;
        let words = [
            "wire",
            "limit",
            "meeting",
            "finance",
            "kelpie",
            "settlement",
            "quarterly",
            "invoice",
            "runtime",
            "preferences",
            "olive",
            "sourdough",
            "ashgrove",
            "budget",
        ];
        let docs: Vec<IndexDoc> = (0..N)
            .map(|i| {
                let body = format!(
                    "note {i} about {} and {} and some {} filler prose to make a realistic body",
                    words[i % words.len()],
                    words[(i * 7) % words.len()],
                    words[(i * 13) % words.len()],
                );
                IndexDoc {
                    id: format!("id-{i}"),
                    title: format!("Note {i} {}", words[i % words.len()]),
                    body,
                    meta: String::new(),
                    secure: false,
                }
            })
            .collect();

        let tmp = TempDir::new().unwrap();
        let mut idx = SearchIndex::open_or_create(&tmp.path().join("s")).unwrap();
        let t = Instant::now();
        idx.sync(1, &docs).unwrap();
        let build = t.elapsed();

        let queries = [
            "wire limit",
            "kelpie",
            "quarterly settlement",
            "runtime",
            "budget invoice",
        ];
        let rounds = 40;

        // INDEX path
        let t = Instant::now();
        let mut hits_idx = 0;
        for _ in 0..rounds {
            for q in queries {
                hits_idx += idx.query(q, 50).unwrap().len();
            }
        }
        let index_total = t.elapsed();

        // SUBSTRING scan over the same corpus — the REAL pre-Tantivy per-query
        // cost: `search_match` (fold_chars allocations + find_ci) per note, as
        // `search_substring` still does on the walk cache.
        let t = Instant::now();
        let mut hits_sub = 0;
        for _ in 0..rounds {
            for q in queries {
                for d in &docs {
                    if crate::corpus::search_match(q, &d.title, &d.body, "").is_some() {
                        hits_sub += 1;
                    }
                }
            }
        }
        let sub_total = t.elapsed();

        let per =
            |d: std::time::Duration| d.as_secs_f64() * 1000.0 / (rounds * queries.len()) as f64;
        println!("\n=== corpus_search latency @ {N} notes ===");
        println!("index build (full):   {:?}", build);
        println!(
            "index   per query:    {:.3} ms  ({} hits)",
            per(index_total),
            hits_idx
        );
        println!(
            "substr  per query:    {:.3} ms  ({} hits)",
            per(sub_total),
            hits_sub
        );
        println!(
            "speedup:              {:.1}x",
            per(sub_total) / per(index_total).max(1e-9)
        );
    }
}
