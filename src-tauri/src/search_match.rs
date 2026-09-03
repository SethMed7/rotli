//! The full-text search grammar: rank, snippet window, and highlight spans for
//! one hit. Pure (no store, no index) and unit-tested; `src/services/search.ts`
//! is its byte-identical TS twin (search.test.ts mirrors these vectors).
//!
//! Rank — lower sorts first (`sort_hits`: rank asc → recency desc → id asc):
//!   0  the whole query is a contiguous substring of the TITLE
//!   1  every query WORD occurs in the title (any order, any spacing —
//!      "checklist launch" finds "Launch checklist")
//!   2  the whole query is a contiguous substring of the body
//!   3  every query word occurs in the body
//!   4  the index found it (typo tolerance) but nothing here can frame it
//! Before 2026-09-03 only 0 and 2 existed (as 0 and 1); every tokenized hit
//! fell to the fuzzy rank and sorted by recency, so a note whose title carried
//! all the words sat beneath whatever the Filer regenerated that morning — and
//! carried no highlight at all.
//!
//! `spans` are [start, len] CHAR offsets (code points, never bytes/UTF-16):
//! into the title for ranks 0–1, into the returned snippet for ranks 2–3,
//! empty for rank 4. `match_start`/`match_len` mirror the first span for the
//! callers that predate spans.

use serde::Serialize;

use crate::corpus::NoteKind;

/// One full-text hit on the wire (camelCase → src/types.ts SearchHit).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub folder_id: String,
    pub kind: NoteKind,
    pub rank: u8,
    pub snippet: String,
    pub match_start: usize,
    pub match_len: usize,
    pub spans: Vec<[usize; 2]>,
    pub updated_at: i64,
}

/// The pure core of one hit — what `search_match` derives from a query + note.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchMatch {
    pub rank: u8,
    pub snippet: String,
    pub match_start: usize,
    pub match_len: usize,
    pub spans: Vec<[usize; 2]>,
}

pub const RANK_TITLE: u8 = 0;
pub const RANK_TITLE_WORDS: u8 = 1;
pub const RANK_BODY: u8 = 2;
pub const RANK_BODY_WORDS: u8 = 3;
pub const RANK_FUZZY: u8 = 4;

/// Context chars on each side of a body match in the snippet window.
const SNIPPET_CTX: usize = 60;
/// Query words considered (the index takes the same cap).
const MAX_TOKENS: usize = 16;

/// Per-char case fold: the FIRST code point of each lowercase expansion —
/// strictly 1:1 so folded offsets equal original offsets ('İ' → 'i').
fn fold_chars(s: &str) -> Vec<char> {
    s.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect()
}

/// Char offset of the first occurrence of `needle` in `hay` at or after `from`.
fn find_ci_from(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() || from > hay.len() - needle.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()] == *needle)
}

fn find_ci(hay: &[char], needle: &[char]) -> Option<usize> {
    find_ci_from(hay, needle, 0)
}

/// The query's words: split on anything non-alphanumeric, lowercased, deduped,
/// first 16. Shared with the index's query builder so membership and
/// presentation agree on what a word is. Twin: `queryTokens` in search.ts.
pub fn query_tokens(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in s.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()) {
        let t = t.to_lowercase();
        if !out.contains(&t) {
            out.push(t);
        }
        if out.len() == MAX_TOKENS {
            break;
        }
    }
    out
}

/// `<!-- … -->` blocks removed (an unterminated one runs to the end). The
/// Filer stamps generated notes with one, and it read as their summary.
pub fn strip_html_comments(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("<!--") {
        out.push_str(&rest[..i]);
        match rest[i + 4..].find("-->") {
            Some(j) => rest = &rest[i + 4 + j + 3..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// Sorted, merged spans (overlaps and touching spans coalesce).
fn merge_spans(mut spans: Vec<[usize; 2]>) -> Vec<[usize; 2]> {
    spans.sort_unstable();
    let mut out: Vec<[usize; 2]> = Vec::with_capacity(spans.len());
    for [s, l] in spans {
        if let Some(last) = out.last_mut() {
            if s <= last[0] + last[1] {
                let end = (s + l).max(last[0] + last[1]);
                last[1] = end - last[0];
                continue;
            }
        }
        out.push([s, l]);
    }
    out
}

/// Every word's first occurrence in `hay`, or None when one is missing.
fn word_spans(hay: &[char], words: &[Vec<char>]) -> Option<Vec<[usize; 2]>> {
    let mut spans = Vec::with_capacity(words.len());
    for w in words {
        spans.push([find_ci(hay, w)?, w.len()]);
    }
    Some(merge_spans(spans))
}

/// A ±60-char window of `chars` around `anchor`: newlines flatten to spaces,
/// emphasis chars (`*` `_` `` ` ``) are stripped OUTSIDE the spans (inside they
/// stay verbatim so a span always frames exactly what matched), "…" marks a
/// clipped edge. `spans` are absolute; the returned spans index the snippet.
fn window(chars: &[char], anchor: usize, anchor_len: usize, spans: &[[usize; 2]]) -> (String, Vec<[usize; 2]>) {
    let start = anchor.saturating_sub(SNIPPET_CTX);
    let end = (anchor + anchor_len + SNIPPET_CTX).min(chars.len());
    let mut snippet = String::new();
    let mut out_spans: Vec<[usize; 2]> = Vec::new();
    let mut written = 0usize;
    if start > 0 {
        snippet.push('…');
        written = 1;
    }
    let inside = |p: usize| spans.iter().position(|[s, l]| p >= *s && p < s + l);
    let mut open: Option<(usize, usize)> = None; // (span index, out start)
    for (p, &c) in chars.iter().enumerate().take(end).skip(start) {
        let in_span = inside(p);
        if in_span.is_none() && matches!(c, '*' | '_' | '`') {
            continue;
        }
        if let Some(k) = in_span {
            if open.map(|(idx, _)| idx) != Some(k) {
                open = Some((k, written));
                out_spans.push([written, 0]);
            }
            out_spans.last_mut().expect("opened")[1] += 1;
        } else {
            open = None;
        }
        snippet.push(if matches!(c, '\n' | '\r' | '\t') { ' ' } else { c });
        written += 1;
    }
    if end < chars.len() {
        snippet.push('…');
    }
    (snippet, out_spans)
}

fn first(spans: &[[usize; 2]]) -> (usize, usize) {
    spans.first().map(|[s, l]| (*s, *l)).unwrap_or((0, 0))
}

/// The ranking + snippet grammar (see the module doc). `stored_snippet` rides
/// through for title hits (ranks 0–1), where the snippet is the list snippet.
pub fn search_match(query: &str, title: &str, body: &str, stored_snippet: &str) -> Option<SearchMatch> {
    let q = fold_chars(query.trim());
    if q.is_empty() {
        return None;
    }
    let words: Vec<Vec<char>> = query_tokens(query).iter().map(|w| fold_chars(w)).collect();
    let title_f = fold_chars(title);
    let title_hit = find_ci(&title_f, &q)
        .map(|i| (RANK_TITLE, vec![[i, q.len()]]))
        .or_else(|| (!words.is_empty()).then(|| word_spans(&title_f, &words)).flatten().map(|s| (RANK_TITLE_WORDS, s)));
    if let Some((rank, spans)) = title_hit {
        let (match_start, match_len) = first(&spans);
        return Some(SearchMatch { rank, snippet: stored_snippet.to_string(), match_start, match_len, spans });
    }
    let chars: Vec<char> = body.chars().collect();
    let body_f = fold_chars(body);
    if let Some(i) = find_ci(&body_f, &q) {
        let (snippet, spans) = window(&chars, i, q.len(), &[[i, q.len()]]);
        let (match_start, match_len) = first(&spans);
        return Some(SearchMatch { rank: RANK_BODY, snippet, match_start, match_len, spans });
    }
    if words.is_empty() {
        return None;
    }
    let all = word_spans(&body_f, &words)?;
    // anchor on the earliest word; then, for each word, highlight its first
    // occurrence inside the window (a later duplicate outside is not shown)
    let anchor = all[0];
    let start = anchor[0].saturating_sub(SNIPPET_CTX);
    let end = (anchor[0] + anchor[1] + SNIPPET_CTX).min(chars.len());
    let mut in_window: Vec<[usize; 2]> = Vec::new();
    for w in &words {
        if let Some(i) = find_ci_from(&body_f, w, start) {
            if i + w.len() <= end {
                in_window.push([i, w.len()]);
            }
        }
    }
    let (snippet, spans) = window(&chars, anchor[0], anchor[1], &merge_spans(in_window));
    let (match_start, match_len) = first(&spans);
    Some(SearchMatch { rank: RANK_BODY_WORDS, snippet, match_start, match_len, spans })
}

/// A leading-context snippet for a hit the index found by TOKEN/FUZZY match but
/// `search_match` cannot frame. Newlines flatten to spaces, ~140 chars, "…" if
/// clipped, HTML comments dropped.
pub fn leading_snippet(body: &str) -> String {
    const MAX: usize = 140;
    let body = strip_html_comments(body);
    let flat: String = body
        .chars()
        .map(|c| if matches!(c, '\n' | '\r' | '\t') { ' ' } else { c })
        .collect();
    let flat = flat.trim();
    let mut out: String = flat.chars().take(MAX).collect();
    if flat.chars().count() > MAX {
        out.push('…');
    }
    out
}

/// rank asc (title hits first) → recency desc → id asc (deterministic wire).
pub fn sort_hits(hits: &mut [SearchHit]) {
    hits.sort_by(|a, b| a.rank.cmp(&b.rank).then(b.updated_at.cmp(&a.updated_at)).then(a.id.cmp(&b.id)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn framed(m: &SearchMatch, text: &str) -> Vec<String> {
        let chars: Vec<char> = text.chars().collect();
        m.spans.iter().map(|[s, l]| chars[*s..s + l].iter().collect()).collect()
    }

    #[test]
    fn search_match_ranks_title_over_body_with_offsets() {
        // title hit: rank 0, offsets index the TITLE, stored snippet rides through
        let m = search_match("groc", "Groceries", "# Groceries\n\nOlive oil.\n", "Olive oil.").unwrap();
        assert_eq!((m.rank, m.match_start, m.match_len), (0, 0, 4));
        assert_eq!(m.spans, vec![[0, 4]]);
        assert_eq!(m.snippet, "Olive oil.");

        // body hit: rank 2, snippet frames the match, offsets index the SNIPPET
        let m = search_match("sourdough", "Groceries", "# Groceries\n\nOlive oil, sourdough, butter.\n", "x").unwrap();
        assert_eq!(m.rank, RANK_BODY);
        assert_eq!(framed(&m, &m.snippet), vec!["sourdough"]);
        let chars: Vec<char> = m.snippet.chars().collect();
        let hit: String = chars[m.match_start..m.match_start + m.match_len].iter().collect();
        assert_eq!(hit, "sourdough");

        // case-insensitive both directions; no match / blank query → None
        assert!(search_match("OLIVE", "Groceries", "olive oil", "").is_some());
        assert!(search_match("olive", "Groceries", "OLIVE OIL", "").is_some());
        assert!(search_match("zebra", "Groceries", "olive oil", "").is_none());
        assert!(search_match("   ", "Groceries", "olive oil", "").is_none());
    }

    #[test]
    fn every_query_word_in_the_title_ranks_1_with_a_span_per_word() {
        let m = search_match("checklist launch", "Launch checklist", "body", "snip").unwrap();
        assert_eq!(m.rank, RANK_TITLE_WORDS);
        assert_eq!(framed(&m, "Launch checklist"), vec!["Launch", "checklist"]);
        assert_eq!((m.match_start, m.match_len), (0, 6));
        assert_eq!(m.snippet, "snip");
        // punctuation and unicode hyphens in the title no longer hide it
        let m = search_match("gateway local-to-pr", "Gateway Local\u{2011}to\u{2011}Production", "", "").unwrap();
        assert_eq!(m.rank, RANK_TITLE_WORDS);
        assert_eq!(framed(&m, "Gateway Local\u{2011}to\u{2011}Production"), vec!["Gateway", "Local", "to", "Pr"]);
        // one word missing from the title → not a title hit
        assert!(search_match("launch rocket", "Launch checklist", "", "").is_none());
    }

    #[test]
    fn every_query_word_in_the_body_ranks_3_and_highlights_the_words_in_the_window() {
        let body = "Notes on the gateway.\n\nThe local run of the **production** cut-over went fine.";
        let m = search_match("production gateway", "T", body, "").unwrap();
        assert_eq!(m.rank, RANK_BODY_WORDS);
        assert_eq!(framed(&m, &m.snippet), vec!["gateway", "production"]);
        assert!(!m.snippet.contains('*') && !m.snippet.contains('\n'));
        assert_eq!(m.match_len, 7);
    }

    #[test]
    fn search_match_snippet_window_strips_and_marks_edges() {
        let long = format!("{}NEEDLE{}", "a".repeat(100), "b".repeat(100));
        let m = search_match("needle", "T", &long, "").unwrap();
        assert!(m.snippet.starts_with('…') && m.snippet.ends_with('…'));
        assert_eq!(framed(&m, &m.snippet), vec!["NEEDLE"]);
        assert_eq!(m.snippet.chars().count(), 1 + 60 + 6 + 60 + 1);

        let m = search_match("needle", "T", "**bold**\nneedle `x`", "").unwrap();
        assert_eq!(framed(&m, &m.snippet), vec!["needle"]);
        assert!(!m.snippet.contains('*') && !m.snippet.contains('`') && !m.snippet.contains('\n'));
    }

    #[test]
    fn tokens_dedupe_and_html_comments_vanish_from_snippets() {
        assert_eq!(query_tokens("Local-to-Pr LOCAL, to"), vec!["local", "to", "pr"]);
        assert_eq!(strip_html_comments("# reference <!-- Generated by the rotli Filer --> | Note |"), "# reference  | Note |");
        assert_eq!(strip_html_comments("a <!-- open"), "a ");
        assert_eq!(leading_snippet("<!-- x -->\n\nreal text"), "real text");
    }

    #[test]
    fn sort_hits_ranks_then_recency_then_id_lockstep() {
        let hit = |id: &str, rank: u8, updated_at: i64| SearchHit {
            id: id.into(),
            title: "t".into(),
            folder_id: "Inbox".into(),
            kind: NoteKind::Note,
            rank,
            snippet: String::new(),
            match_start: 0,
            match_len: 1,
            spans: vec![[0, 1]],
            updated_at,
        };
        let mut hits = vec![hit("old-body", 2, 10), hit("new-body", 2, 20), hit("words", 1, 0), hit("title", 0, 1)];
        sort_hits(&mut hits);
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, ["title", "words", "new-body", "old-body"]);
        let mut ties = vec![hit("b", 1, 5), hit("a", 1, 5)];
        sort_hits(&mut ties);
        assert_eq!((ties[0].id.as_str(), ties[1].id.as_str()), ("a", "b"));
    }
}
