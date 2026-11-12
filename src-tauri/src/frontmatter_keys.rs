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

/// The key a frontmatter line sets, in any YAML spelling: `key:`, `  key:`,
/// `"key":`, `'key':`, `- key:`, `? key`, `key :`. None for a line that sets
/// no key (a list item's plain value, a continuation, a comment).
pub(crate) fn frontmatter_key(line: &str) -> Option<FrontmatterKey> {
    let line = line.trim_end_matches('\r');
    let mut rest = line.trim_start();
    let mut canonical = rest.len() == line.len();
    let mut explicit = false;
    loop {
        if let Some(after) = rest.strip_prefix("- ") {
            rest = after.trim_start();
            canonical = false;
        } else if let Some(after) = rest.strip_prefix("? ") {
            rest = after.trim_start();
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
                canonical &= raw == raw.trim_end();
                (raw.trim().to_string(), &rest[colon..])
            }
            None if explicit => (rest.trim().to_string(), ""),
            None => return None,
        },
    };
    if !explicit && !after.trim_start().starts_with(':') {
        return None;
    }
    if name.is_empty() || name.contains(char::is_whitespace) && !explicit {
        return None;
    }
    Some(FrontmatterKey { name, canonical })
}

/// `(key, value)` of a line spelled the way Rust writes its own keys, and
/// None for every other spelling, so a reader of a Rust-owned key never
/// accepts a form the metadata editor could have let through.
pub(crate) fn canonical_field(line: &str) -> Option<(&str, &str)> {
    let key = frontmatter_key(line).filter(|k| k.canonical)?;
    let (_, value) = line.trim_end_matches('\r').split_once(':')?;
    Some((&line[..key.name.len()], value.trim()))
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

    /// The readers of keys only Rust writes take no other spelling: a person
    /// can type any of these into the raw editor, which keeps them as typed.
    #[test]
    fn readers_of_rust_owned_keys_take_only_rusts_spelling() {
        for spelling in ["  {k}: true", "\"{k}\": true", "- {k}: true", "{k} : true"] {
            let line = |k: &str| spelling.replace("{k}", k);
            assert_eq!(crate::ai_edit_policy::created_by_field(&line("created_by")), None, "{spelling}");
            assert_eq!(crate::ai_edit_policy::ai_edit_field(&line("ai_edit")), None, "{spelling}");
            assert_eq!(crate::corpus::local_ai_allowed_field(&line("local_ai_allowed")), None, "{spelling}");
        }
        assert_eq!(crate::ai_edit_policy::created_by_field("created_by: agent"), Some("agent"));
        assert_eq!(crate::ai_edit_policy::ai_edit_field("ai_edit: true"), Some(true));
        assert_eq!(crate::corpus::local_ai_allowed_field("local_ai_allowed: false"), Some(false));
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
    /// goes through `canonical_field`. A new file that names one of these keys
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
                assert!(production.contains("canonical_field"), "{name} reads a key only Rust writes without frontmatter_keys::canonical_field");
                readers.push(name);
            }
        }
        readers.sort();
        assert_eq!(readers, ["ai_edit_policy.rs", "corpus.rs", "corpus_in_place.rs"], "a new reader of a key only Rust writes: check it, then add it here");
    }
}
