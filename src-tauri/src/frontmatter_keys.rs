//! One way to read a frontmatter line's key, for every reader and writer that
//! must agree on the keys Rust owns (the raw metadata editor's merger, the
//! Librarian route's page ownership, `created_by`). The independent review of
//! PR #295 found the merger and the ownership reader disagreeing: the merger
//! let an indented `  librarian_page: index` through as "some other key", and
//! the reader trimmed it into the real one, so a person's note became the
//! Librarian's index. Rust writes each of its keys in exactly one spelling,
//! `key: value` at the start of a line; YAML allows many more, and every one
//! of them still names the key.

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

/// The keys a line sets inside a `{flow: mapping}`, in any quoting.
fn flow_keys(line: &str) -> Vec<String> {
    let mut keys = Vec::new();
    for (at, c) in line.char_indices() {
        if c != '{' && c != ',' {
            continue;
        }
        let rest = line[at + 1..].trim_start();
        let (name, after) = match rest.chars().next() {
            Some(quote @ ('"' | '\'')) => match rest[1..].find(quote) {
                Some(close) => (&rest[1..close + 1], &rest[close + 2..]),
                None => continue,
            },
            _ => {
                let end = rest.find(|ch: char| !(ch.is_alphanumeric() || ch == '_' || ch == '-')).unwrap_or(rest.len());
                (&rest[..end], &rest[end..])
            }
        };
        if !name.is_empty() && after.trim_start().starts_with(':') {
            keys.push(name.to_string());
        }
    }
    keys
}

/// Whether a frontmatter line names `key` in any spelling, block or flow.
pub(crate) fn frontmatter_names_key(line: &str, key: &str) -> bool {
    frontmatter_key(line).is_some_and(|k| k.name == key) || flow_keys(line).iter().any(|k| k == key)
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
    // Reserved-key match is the CANONICAL spelling, as parse_fields reads it:
    // an INDENTED `  created:` under a nested map is a foreign line to the
    // codec and is never deleted or replaced (2026-07-01 review).
    let is_key = |line: &str, key: &str| frontmatter_key(line).is_some_and(|k| k.canonical && k.name == key);
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
    // any OTHER spelling of a reserved key (indented, quoted, a list item,
    // `? key`, `key :`, inside a {flow: map}) can't be minted either: a line
    // the file already had survives byte for byte, and a new one goes. A
    // reader that trims, or a YAML parser, would take it for the real key
    // (independent review of PR #295: a forged `  librarian_page: index`).
    lines.retain(|line| {
        orig_lines.contains(&line.as_str())
            || !RAW_IMMUTABLE_KEYS.iter().any(|key| frontmatter_names_key(line, key) && !is_key(line, key))
    });

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
        for spelling in ["  created_by: x", "\tcreated_by: x", "\"created_by\": x", "'created_by': x", "- created_by: x", "? created_by", "created_by : x", "-  - created_by: x"] {
            assert_eq!(key(spelling), Some(("created_by".into(), false)), "{spelling:?}");
        }
        for not_a_key in ["- plain item", "# created_by: comment", "continued prose", ""] {
            assert_eq!(key(not_a_key), None, "{not_a_key:?}");
        }
        assert!(frontmatter_names_key("x: {a: 1, created_by: librarian}", "created_by"));
        assert!(frontmatter_names_key("x: {'librarian_page': index}", "librarian_page"));
        assert!(!frontmatter_names_key("tags: [created_by]", "created_by"));
        assert_eq!(canonical_field("created_by: librarian"), Some(("created_by", "librarian")));
        assert_eq!(canonical_field("  created_by: librarian"), None);
        assert_eq!(canonical_field("\"created_by\": librarian"), None);
    }

    /// The guard for the class the second review of PR #295 found: a reader
    /// of a key only Rust writes must read it the one way the metadata editor
    /// protects it. Every production file that names `created_by` or
    /// `librarian_page` as a key is listed here, and each reader goes through
    /// `canonical_field`. A new reader fails this test until it does too.
    #[test]
    fn the_keys_rust_owns_are_read_only_through_the_shared_parser() {
        const LISTS_ONLY: &str = "corpus.rs";
        const READERS: [&str; 2] = ["ai_edit_policy.rs", "workspace_librarian_pages.rs"];
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") || name.starts_with("frontmatter_keys") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            // everything above the file's test module (a `#[cfg(test)]` item higher up is still production)
            let production = text.split(concat!("#[cfg(test)]\n", "mod tests")).next().unwrap_or_default();
            if !production.contains("\"created_by\"") && !production.contains("\"librarian_page\"") {
                continue;
            }
            if name == LISTS_ONLY {
                continue; // RESERVED_KEYS and RAW_IMMUTABLE_KEYS name them; they read nothing
            }
            assert!(READERS.contains(&name.as_str()), "{name} reads a key only Rust writes; read it with frontmatter_keys::canonical_field and add it here");
            assert!(production.contains("canonical_field"), "{name} reads a key only Rust writes without canonical_field");
        }
    }
}
