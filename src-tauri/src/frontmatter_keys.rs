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
            let close = quoted_end(rest, quote)?;
            // a quoted key is decoded as YAML decodes it (`"ai\u005fedit"` is ai_edit)
            (yaml::decode_quoted_key(&rest[..=close]).unwrap_or_else(|| rest[1..close].to_string()), &rest[close + 1..])
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
    // Rust writes `key: value` with one space, or `key:` at the end: a tab
    // or a second space after the colon is another spelling (review of PR #303)
    let gap = &after[1.min(after.len())..];
    canonical &= gap.is_empty() || (gap.starts_with(' ') && !gap[1..].starts_with(is_js_space));
    if name.is_empty() || name.contains(is_js_space) && !explicit {
        return None;
    }
    let value = js_trim(after.strip_prefix(':').unwrap_or_default());
    Some((FrontmatterKey { name, canonical }, value))
}

/// The byte index of the quote closing the quoted scalar `rest` starts with:
/// a `\` escapes in double quotes, `''` is a quote in single quotes.
fn quoted_end(rest: &str, quote: char) -> Option<usize> {
    let mut chars = rest.char_indices().skip(1).peekable();
    while let Some((at, c)) = chars.next() {
        if quote == '"' && c == '\\' {
            chars.next();
        } else if c == quote {
            if quote == '\'' && chars.peek().is_some_and(|(_, next)| *next == '\'') {
                chars.next();
            } else {
                return Some(at);
            }
        }
    }
    None
}

#[path = "frontmatter_yaml.rs"]
mod yaml;
#[path = "frontmatter_writes.rs"]
mod writes;
#[cfg(test)]
#[path = "frontmatter_differential_tests.rs"]
pub(crate) mod differential_tests;
pub(crate) use writes::{field_name, guard_write, keeps, keeps_its_metadata, keeps_other_verdicts, key_lines, leaves_managed, put_field, read_in_any_spelling, remove_key};
use yaml::{decoded_value, undecidable, Decoded};

/// Whether a frontmatter line names `key` in any spelling, quoted keys
/// decoded. Every setter of a permission key removes each such line.
pub(crate) fn names_key(line: &str, key: &str) -> bool {
    frontmatter_field(line).is_some_and(|(spelled, _)| spelled.name == key)
}

/// The key and value a top-level line sets in a one-line spelling (`key:`,
/// `key :`, `"key":`, `'key':`, quoted keys decoded); None for an indented
/// line, a list item, `? key`, or a line without a colon. A key the line
/// reader doesn't name (one with a space inside, as Obsidian's
/// `date created`) is its text before the colon. A write in a folder opened
/// in place replaces the line this names, so a key the person spelled their
/// own way is replaced rather than repeated beside Rotli's line.
pub(crate) fn top_level_field(line: &str) -> Option<(String, String)> {
    let line = line.trim_end_matches('\r');
    if line.starts_with(is_js_space) || line.starts_with("- ") || line.starts_with("? ") {
        return None;
    }
    match frontmatter_field(line) {
        Some((key, value)) => Some((key.name, value.to_string())),
        None => line.split_once(':').map(|(key, value)| (js_trim(key).to_string(), value.trim().to_string())),
    }
}

/// The key of [`top_level_field`].
pub(crate) fn top_level_key(line: &str) -> Option<String> {
    top_level_field(line).map(|(key, _)| key)
}

/// The keys Rust writes that grant or deny an AI permission. Any spelling of
/// one can deny, so every writer clears every spelling before writing its
/// own line (Codex review round 5 of PR #295).
pub(crate) const PERMISSION_KEYS: [&str; 3] = ["created_by", "ai_edit", "local_ai_allowed"];

/// `(key, value)` of a line spelled the way Rust writes its own keys, and
/// None for every other spelling. (Writers now match a key through
/// [`top_level_field`]; this pins what "Rust's spelling" means in tests.)
#[cfg(test)]
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
    // every line, in any spelling (quoted keys decoded); a second line naming
    // the key, or one holding a character the two YAML parsers could read
    // differently, decides nothing and so denies
    let mut grant = None;
    let mut named = false;
    for line in fields {
        let line = line.as_ref().trim_end_matches('\r');
        let Some((spelled, value)) = frontmatter_field(line) else { continue };
        if spelled.name != key {
            continue;
        }
        if named || !grants(value) || line.chars().any(undecidable) || line.contains('\t') {
            return Says::Deny;
        }
        named = true;
        if spelled.canonical {
            grant = Some(value);
        }
    }
    // and the frontmatter read as YAML (escapes, flow maps, tags): a value
    // there that doesn't grant denies, a grant needs it to agree, and
    // frontmatter that can't be read (frontmatter_yaml.rs) is refused
    match decoded_value(fields, key) {
        // frontmatter nobody can read denies only where a line could spell
        // the key: its text, or an escape (review of PR #303, item 3)
        Decoded::Refused if could_spell(fields, key) => Says::Deny,
        Decoded::Refused => grant.map_or(Says::Unset, Says::Grant),
        Decoded::Value(Some(value)) if !grants(&value) => Says::Deny,
        Decoded::Value(None) if grant.is_some() => Says::Deny,
        Decoded::Value(_) => grant.map_or(Says::Unset, Says::Grant),
    }
}

/// Whether a line the line reader doesn't name as `key` could still spell it:
/// it holds the key's text, an escape (`\u005f`), or an alias. Unreadable frontmatter
/// denies a key only then; the lines that name it the line reader has judged.
fn could_spell<S: AsRef<str>>(fields: &[S], key: &str) -> bool {
    fields.iter().map(AsRef::as_ref).any(|line| !names_key(line, key) && (line.contains(key) || line.contains('\\') || has_alias(line)))
}

/// Whether a line holds a YAML alias (`*name` after a space, `[`, `{`, `,` or
/// `:`, or at its start): in unreadable frontmatter an alias could stand for a
/// key, so it denies there (the unresolved-alias verdict, PR #303).
fn has_alias(line: &str) -> bool {
    let chars: Vec<char> = line.chars().collect();
    chars.iter().enumerate().any(|(at, c)| {
        *c == '*'
            && (at == 0 || chars[at - 1].is_whitespace() || "[{,:".contains(chars[at - 1]))
            && chars.get(at + 1).is_some_and(|next| !next.is_whitespace() && !",[]{}".contains(*next))
    })
}

/// Whether a protection flag (`locked`, `secure`) is on: a line in any
/// spelling saying anything but `false`, the root value as YAML reads it
/// saying anything but `false`, or unreadable frontmatter a line could spell
/// it in. Fails closed like the permission keys (review of PR #303, item 8).
/// TypeScript's twin: frontmatterKeys.ts `flagOn`.
fn flag_on<S: AsRef<str>>(fields: &[S], key: &str) -> bool {
    let typed = fields.iter().any(|line| {
        frontmatter_field(line.as_ref()).is_some_and(|(spelled, value)| spelled.name == key && value != "false")
    });
    typed
        || match decoded_value(fields, key) {
            Decoded::Value(value) => value.is_some_and(|value| value != "false"),
            Decoded::Refused => could_spell(fields, key),
        }
}

/// Whether the note is locked (no AI edits it).
pub(crate) fn locked<S: AsRef<str>>(fields: &[S]) -> bool {
    flag_on(fields, "locked")
}

/// Whether the note is marked secure (no remote model reads it).
pub(crate) fn secure<S: AsRef<str>>(fields: &[S]) -> bool {
    flag_on(fields, "secure")
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
#[path = "frontmatter_keys_tests.rs"]
mod tests;
