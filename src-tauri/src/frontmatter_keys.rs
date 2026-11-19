//! How Rust reads a key only Rust writes (`created_by`, `ai_edit`,
//! `local_ai_allowed`): in the one spelling Rust writes, `key: value` at the
//! start of a line, and no other. YAML (and a hand edit) allows many more
//! spellings of a key (indented, quoted, a list item, `? key`); the raw
//! metadata editor keeps such lines as the person typed them, because an
//! indented line may be a nested key or a block scalar's text, so a reader
//! that trimmed would take a person's typed `  created_by: librarian` for
//! Rust's stamp (second independent review of PR #295).
//!
//! Also home to the raw metadata editor's merger, moved here unchanged from
//! corpus.rs (it is dev's: the third review of PR #295 found a stricter merger
//! deleting values that merely contained a key's name).

use crate::corpus::{parse_document, raw_frontmatter_block, RAW_IMMUTABLE_KEYS};

/// A frontmatter line's block key: its name with any quotes, list dash, `? `
/// or indentation taken off, and whether it is spelled the way Rust writes it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FrontmatterKey {
    pub(crate) name: String,
    /// `key: value` (or `key:`) at the start of the line, unquoted, with no
    /// space before the colon: the only spelling Rust writes.
    pub(crate) canonical: bool,
}

/// JavaScript's `String.prototype.trim` set: Rust's whitespace with U+FEFF
/// added and U+0085 left out. The web build reads the same frontmatter, so a
/// value or key trims the same way on both sides (parity.json pins it).
pub(crate) fn is_js_space(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}

/// `s` without leading or trailing [`is_js_space`] characters.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// The key a frontmatter line sets, in any YAML spelling: `key:`, `  key:`,
/// `"key":`, `'key':`, `- key:`, `? key`, `key :`. None for a line that sets
/// no key (a list item's plain value, a continuation, a comment).
#[cfg(test)]
pub(crate) fn frontmatter_key(line: &str) -> Option<FrontmatterKey> {
    frontmatter_field(line).map(|(key, _)| key)
}

/// A line's key in any spelling and its value, trimmed with
/// [`is_js_space`] (empty for `? key`, whose value is on the next line).
pub(crate) fn frontmatter_field(line: &str) -> Option<(FrontmatterKey, &str)> {
    let line = line.trim_end_matches('\r');
    let mut rest = line.trim_start_matches(is_js_space);
    let mut canonical = rest.len() == line.len();
    let mut explicit = false;
    loop {
        if let Some(after) = rest.strip_prefix("- ") {
            rest = after.trim_start_matches(is_js_space);
            canonical = false;
        } else if let Some(after) = rest.strip_prefix("? ") {
            rest = after.trim_start_matches(is_js_space);
            canonical = false;
            explicit = true;
        } else {
            break;
        }
    }
    if rest.starts_with('#') {
        return None;
    }
    let (name, after) = match rest.chars().next() {
        Some(quote @ ('"' | '\'')) => {
            canonical = false;
            let close = rest[1..].find(quote)? + 1;
            (rest[1..close].to_string(), &rest[close + 1..])
        }
        _ => match rest.find(':') {
            Some(colon) => {
                let raw = &rest[..colon];
                canonical &= raw == raw.trim_end_matches(is_js_space);
                (js_trim(raw).to_string(), &rest[colon..])
            }
            None if explicit => (js_trim(rest).to_string(), ""),
            None => return None,
        },
    };
    let after = after.trim_start_matches(is_js_space);
    if !explicit && !after.starts_with(':') {
        return None;
    }
    if name.is_empty() || name.contains(is_js_space) && !explicit {
        return None;
    }
    let value = js_trim(after.strip_prefix(':').unwrap_or_default());
    Some((FrontmatterKey { name, canonical }, value))
}

/// `(key, value)` of a line spelled the way Rust writes its own keys, and
/// None for every other spelling.
pub(crate) fn canonical_field(line: &str) -> Option<(&str, &str)> {
    let (key, value) = frontmatter_field(line).filter(|(key, _)| key.canonical)?;
    Some((&line[..key.name.len()], value))
}

/// What a note's frontmatter says about one key only Rust writes.
#[derive(Debug, PartialEq)]
pub(crate) enum Says<'a> {
    /// No line names the key in any spelling that grants or denies.
    Unset,
    /// Rust's own spelling grants, with this value, and nothing denies.
    Grant(&'a str),
    /// Some spelling of the key holds a value that doesn't grant.
    Deny,
}

/// The one rule for keys only Rust writes (`created_by`, `ai_edit`,
/// `local_ai_allowed`), failing closed both ways (Codex review of 7f542f5b):
/// a line in ANY spelling (indented, quoted, a list item…) whose value isn't
/// a grant denies, because a denial or restriction must hold however it was
/// typed; only Rust's own spelling grants, because a grant typed any other
/// way isn't Rust's; and a denial wins over a grant. TypeScript's twin is
/// src/lib/frontmatterKeys.ts `ownedKey`.
pub(crate) fn owned_key<'a, S: AsRef<str>>(fields: &'a [S], key: &str, grants: impl Fn(&str) -> bool) -> Says<'a> {
    let mut grant = None;
    for line in fields {
        let Some((spelled, value)) = frontmatter_field(line.as_ref()) else { continue };
        if spelled.name != key {
            continue;
        }
        if !grants(value) {
            return Says::Deny;
        }
        if spelled.canonical && grant.is_none() {
            grant = Some(value);
        }
    }
    grant.map_or(Says::Unset, Says::Grant)
}

/// The note's own on-device permission: `Some(true)` only for Rust's
/// `local_ai_allowed: true` with nothing saying otherwise, `Some(false)` when
/// any spelling says anything but `true`, `None` to follow the vault.
pub(crate) fn local_ai_allowed<S: AsRef<str>>(fields: &[S]) -> Option<bool> {
    match owned_key(fields, "local_ai_allowed", |value| value == "true") {
        Says::Grant(_) => Some(true),
        Says::Deny => Some(false),
        Says::Unset => None,
    }
}

/// Rebuild a document from a user-typed raw frontmatter block (the "Show file
/// metadata" editor). The submitted text is taken VERBATIM — line order,
/// spacing, everything — with exactly one correction: the reserved provenance
/// lines (id/owner/created/local permission/view tag) must match the ORIGINAL file exactly (changed →
/// restored, dropped → re-inserted at the top, invented → removed). The body
/// is byte-exact from disk; only the block between the fences is rebuilt.
/// Tolerant input: with or without the `---` fences, surrounding blank noise
/// trimmed. A bare `---` line INSIDE the block is refused — it would silently
/// truncate the frontmatter on the next parse.
pub fn merge_raw_frontmatter(original: &str, submitted: &str) -> Result<String, String> {
    let (_, body) = parse_document(original);
    let orig_block = raw_frontmatter_block(original);
    // the original block's lines, fences stripped, VERBATIM (never re-serialized
    // through Frontmatter — a hand-formatted `id:  x` line survives untouched)
    let orig_lines: Vec<&str> = if orig_block.is_empty() {
        Vec::new()
    } else {
        let mut v: Vec<&str> = orig_block.lines().collect();
        v.remove(0); // opening ---
        v.pop(); // closing ---
        v
    };

    // unfence the submitted text (the UI shows the fences; a bare key list is
    // accepted too). Blank lines INSIDE the block are kept verbatim.
    let mut lines: Vec<String> = submitted.lines().map(str::to_string).collect();
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if lines.first().is_some_and(|l| l.trim() == "---") {
        lines.remove(0);
        if lines.last().is_some_and(|l| l.trim() == "---") {
            lines.pop();
        }
    }
    if lines.iter().any(|l| l.trim() == "---") {
        return Err("the metadata block can't contain a bare --- line".into());
    }

    // reserved provenance: the output's id/owner/created lines must be EXACTLY
    // the original's — present ↔ present (same bytes), absent ↔ absent.
    // Reserved-key match mirrors parse_fields EXACTLY (UNtrimmed key): an
    // INDENTED `  created:` under a nested map is a foreign line to the codec,
    // so it must be foreign here too — field_key's trim misclassified it as
    // the top-level reserved line and deleted/replaced it (2026-07-01 review).
    let is_key = |line: &str, key: &str| line.split_once(':').is_some_and(|(k, _)| k == key);
    let mut restore: Vec<&str> = Vec::new();
    for key in RAW_IMMUTABLE_KEYS {
        let orig = orig_lines.iter().copied().find(|l| is_key(l, key));
        let typed = lines.iter().position(|l| is_key(l, key));
        match (orig, typed) {
            (Some(o), Some(i)) => {
                lines[i] = o.to_string();
                // duplicates beyond the first are dropped (keep the restored one)
                let mut seen = 0usize;
                lines.retain(|l| {
                    if is_key(l, key) {
                        seen += 1;
                        seen == 1
                    } else {
                        true
                    }
                });
            }
            // dropped → collect, re-inserted at the top in id/created/owner order
            (Some(o), None) => restore.push(o),
            // invented → a user can't mint provenance; the line goes
            (None, Some(_)) => lines.retain(|l| !is_key(l, key)),
            (None, None) => {}
        }
    }
    for line in restore.into_iter().rev() {
        lines.insert(0, line.to_string());
    }

    // an emptied block: with nothing reserved to restore the fences go too
    if lines.is_empty() {
        return Ok(if orig_block.is_empty() {
            original.to_string()
        } else {
            body.to_string()
        });
    }
    let mut out = String::with_capacity(body.len() + submitted.len() + 16);
    out.push_str("---\n");
    for l in &lines {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(body);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spelling_names_its_key_and_only_rusts_is_canonical() {
        let key = |line: &str| frontmatter_key(line).map(|k| (k.name, k.canonical));
        assert_eq!(key("created_by: librarian"), Some(("created_by".into(), true)));
        assert_eq!(key("created_by:"), Some(("created_by".into(), true)));
        for spelling in ["  created_by: x", "\tcreated_by: x", "\"created_by\": x", "'created_by': x", "- created_by: x", "? created_by", "created_by : x"] {
            assert_eq!(key(spelling), Some(("created_by".into(), false)), "{spelling:?}");
        }
        for not_a_key in ["- plain item", "# created_by: comment", "continued prose", ""] {
            assert_eq!(key(not_a_key), None, "{not_a_key:?}");
        }
        assert_eq!(canonical_field("created_by: librarian"), Some(("created_by", "librarian")));
        assert_eq!(canonical_field("  created_by: librarian"), None);
        assert_eq!(canonical_field("\"created_by\": librarian"), None);
    }

    /// Codex review of 7f542f5b: a denial typed in any spelling still denies,
    /// in both directions of every key only Rust writes; only Rust's spelling
    /// grants. (Canonical-only reading turned an indented `false` into a
    /// grant under the default.)
    #[test]
    fn a_denial_in_any_spelling_holds_and_only_rusts_spelling_grants() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        for spelling in ["  {k}: false", "\"{k}\": false", "- {k}: false", "{k} : no"] {
            let line = |k: &str| spelling.replace("{k}", k);
            assert_eq!(local_ai_allowed(&["local_ai_allowed: true".to_string(), line("local_ai_allowed")]), Some(false), "{spelling}");
            assert_eq!(body_edit(&["created_by: agent".to_string(), line("ai_edit")]), BodyEdit::Revoked, "{spelling}");
        }
        assert_eq!(body_edit(&["created_by: agent", "  created_by: someone"]), BodyEdit::PersonWritten);
        assert_eq!(body_edit(&["  created_by: agent"]), BodyEdit::PersonWritten, "a typed creator grants nothing");
        assert_eq!(body_edit(&["  ai_edit: true"]), BodyEdit::PersonWritten, "a typed grant grants nothing");
        assert_eq!(local_ai_allowed(&["  local_ai_allowed: true"]), None, "a typed grant follows the vault");
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true"]), Some(true));
        assert_eq!(body_edit(&["ai_edit: true"]), BodyEdit::Allowed);
        // values trim with JavaScript's set: U+0085 stays (no grant), U+FEFF goes
        assert_eq!(body_edit(&["ai_edit: \u{85}true"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["ai_edit: \u{feff}true"]), BodyEdit::Allowed);
    }

    /// The person's setters clear every spelling of the key they set, so a
    /// typed denial never outlives the person's own grant.
    #[test]
    fn setters_see_every_spelling_of_their_key() {
        assert_eq!(crate::ai_edit_policy::ai_edit_field("  ai_edit: false"), Some(false));
        assert_eq!(crate::corpus::local_ai_allowed_field("\"local_ai_allowed\": false"), Some(false));
    }

    /// Third independent review of PR #295: a stricter merger read a quoted
    /// value as a mapping and deleted a person's whole summary. The merger is
    /// dev's again; a value that merely contains a key's name is kept byte for
    /// byte, and so is a block scalar's indented text.
    #[test]
    fn the_metadata_editor_never_drops_a_value_that_mentions_a_key() {
        let original = "---\nid: 01J\n---\n\n# Diary\n\nprose\n";
        for line in [
            "summary: \"Discuss {created_by: librarian} next week\"",
            "notes: [created: soon, owner: me]",
            "plan: |\n  created_by: nobody, this is prose\n  ai_edit: also prose",
        ] {
            let merged = merge_raw_frontmatter(original, &format!("id: 01J\n{line}\n")).unwrap();
            assert!(merged.contains(line), "{line:?} was altered:\n{merged}");
        }
    }

    /// The guard for the class: a production reader of a key only Rust writes
    /// goes through this module (`owned_key` for policy, `frontmatter_field`
    /// for a setter, `canonical_field` for a writer). A new file that names one of these keys
    /// fails this test until it does too (the key lists in corpus.rs read
    /// nothing, but corpus.rs reads `local_ai_allowed` through it as well).
    #[test]
    fn the_keys_rust_owns_are_read_only_through_the_shared_parser() {
        const KEYS: [&str; 3] = ["\"created_by\"", "\"ai_edit\"", "\"local_ai_allowed\""];
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut readers = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") || name.starts_with("frontmatter_keys") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            // everything above the file's test module (a `#[cfg(test)]` item higher up is still production)
            let production = text.split(concat!("#[cfg(test)]\n", "mod tests")).next().unwrap_or_default();
            if KEYS.iter().any(|key| production.contains(key)) {
                assert!(production.contains("frontmatter_keys::"), "{name} reads a key only Rust writes without frontmatter_keys");
                readers.push(name);
            }
        }
        readers.sort();
        assert_eq!(readers, ["ai_edit_policy.rs", "corpus.rs", "corpus_in_place.rs"], "a new reader of a key only Rust writes: check it, then add it here");
    }
}
