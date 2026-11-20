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
pub(crate) use writes::{field_name, guard_write, keeps, keeps_other_verdicts, key_lines, leaves_managed, put_field, read_in_any_spelling, remove_key};
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
        // frontmatter that won't parse denies only the keys a line could
        // spell: the creator here, not AI editing (review of PR #303, item 3)
        assert_eq!(body_edit(&["created_by: agent", "  created_by: someone"]), BodyEdit::PersonWritten);
        assert_eq!(body_edit(&["  created_by: agent"]), BodyEdit::PersonWritten, "a typed creator grants nothing");
        assert_eq!(body_edit(&["  ai_edit: true"]), BodyEdit::PersonWritten, "a typed grant grants nothing");
        assert_eq!(local_ai_allowed(&["  local_ai_allowed: true"]), None, "a typed grant follows the vault");
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true"]), Some(true));
        assert_eq!(body_edit(&["ai_edit: true"]), BodyEdit::Allowed);
        // a control character or U+FEFF, which two YAML parsers could read
        // differently, decides nothing: it denies on both sides
        assert_eq!(body_edit(&["ai_edit: \u{85}true"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["ai_edit: \u{feff}true"]), BodyEdit::Revoked);
    }

    /// The organizer writes values unquoted (`summary: <one line>`,
    /// `links: [[A]], [[B]]`), so frontmatter that won't parse is read once
    /// more with the values of plain non-permission keys blanked, and the note
    /// keeps its permissions (the round-5 WIP denied all three on such a note,
    /// so a filed AI note stopped being editable).
    #[test]
    fn a_filed_note_with_an_unquoted_colon_keeps_its_permissions() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        let filed = ["summary: Plan: phase two", "links: [[Alpha]], [[Beta]]"];
        let with = |head: &[&str]| head.iter().chain(filed.iter()).map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(body_edit(&with(&["created_by: librarian"])), BodyEdit::Allowed);
        assert_eq!(body_edit(&with(&["created_by: agent", "ai_edit: true"])), BodyEdit::Allowed);
        assert_eq!(body_edit(&with(&[])), BodyEdit::PersonWritten, "not revoked: a consented insert still lands");
        assert_eq!(local_ai_allowed(&with(&["secure: true", "local_ai_allowed: true"])), Some(true));
        assert_eq!(local_ai_allowed(&with(&["secure: true"])), None, "follows the vault");
        // a repeated ordinary key, a stray control character in a plain value, an unclosed list
        for extra in ["tags: [a]\ntags: [b]", "summary: pasted\u{85}text", "x: [unclosed"] {
            let fields: Vec<&str> = ["created_by: agent"].into_iter().chain(extra.split('\n')).collect();
            assert_eq!(body_edit(&fields), BodyEdit::Allowed, "{extra:?}");
        }
    }

    /// Codex review of PR #303, item 3: a denial only a YAML reader sees (an
    /// escaped key in a flow map) holds whatever else the frontmatter holds:
    /// an alias elsewhere, a plain value that won't parse. Frontmatter that
    /// can't be read even with plain values blanked is refused, which denies.
    #[test]
    fn a_denial_only_yaml_sees_holds_beside_an_alias_or_a_bad_value() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        let flow = "{\"local\\u005fai_allowed\": false, note: x}";
        for extra in ["a: &k one", "b: *k", "summary: a: b"] {
            let fields = ["secure: true".to_string(), "local_ai_allowed: true".to_string(), flow.replace("{", "{s: 1, ").to_string(), extra.to_string()];
            assert_eq!(local_ai_allowed(&fields), Some(false), "{extra:?}");
        }
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true", "flow: {\"local\\u005fai_allowed\": false}", "a: &k one", "b: *k"]), Some(true), "nested, not a root key");
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true", "a: &k local_ai_allowed", "*k : false"]), Some(false), "an alias as a root key");
        assert_eq!(body_edit(&["created_by: agent", "ai_edit: true", "ai_edit: true"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "!!str ai_edit: false"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "\"ai\\u005fedit\": false"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["{created_by: agent, ai_edit: false}"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "\tnested: tab"]), BodyEdit::Allowed, "an unreadable line that spells no key decides nothing");
        assert_eq!(local_ai_allowed(&["local_ai_allowed: \u{feff}true", "summary: a: b"]), Some(false));
    }

    /// Codex review of PR #303, item 5: identity and repeats are the same on
    /// both sides; keys `1.0` and `1.00` are two keys, not a repeat.
    #[test]
    fn unrelated_keys_never_change_the_verdict() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        assert_eq!(body_edit(&["created_by: agent", "1.0: a", "1.00: b", "summary: The ai_edit setting"]), BodyEdit::Allowed);
        assert_eq!(body_edit(&["created_by: agent", "1: a", "1: b"]), BodyEdit::Allowed, "a repeat of another key decides nothing");
    }

    /// The reader takes any file's frontmatter, so it never builds a YAML tree
    /// and bounds the work first: over 64 KiB, `[`/`{` nested past 64, or YAML
    /// nesting past 64 levels is refused, which denies. Nested aliases cost
    /// nothing, since no alias is expanded.
    #[test]
    fn hostile_frontmatter_is_never_built_into_a_tree() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        let mut laughs = vec!["a: &a [x, x, x, x, x, x, x, x, x]".to_string()];
        for (at, name) in "bcdefghijk".chars().enumerate() {
            let prev = "abcdefghijk".chars().nth(at).unwrap();
            laughs.push(format!("{name}: &{name} [{}]", vec![format!("*{prev}"); 9].join(", ")));
        }
        let deep = format!("x: {}{}", "[".repeat(30_000), "]".repeat(30_000));
        let wide = format!("summary: {}", "x".repeat(70_000));
        let long_key = format!("\"{}\": false", "\\u0061".repeat(20_000));
        // refused: a key is denied only where another line could spell it
        // (the escaped key could spell any of them)
        for (hostile, verdict) in [(laughs.join("\n"), BodyEdit::Allowed), (deep, BodyEdit::Allowed), (wide, BodyEdit::Allowed), (long_key, BodyEdit::Locked)] {
            let started = std::time::Instant::now();
            let mut fields: Vec<String> = hostile.split('\n').map(str::to_string).collect();
            fields.push("created_by: agent".into());
            assert_eq!(body_edit(&fields), verdict);
            assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
        }
        // 64 levels of YAML nesting are read; at 65 the frontmatter is refused,
        // and then a key is denied only where another line could spell it
        let nested = |lists: usize, extra: &str| ["local_ai_allowed: true".to_string(), format!("x: {{y: {}{}}}", "[".repeat(lists), "]".repeat(lists)), extra.to_string()];
        assert_eq!(decoded_value(&nested(62, ""), "local_ai_allowed"), Decoded::Value(Some("true".into())));
        assert_eq!(decoded_value(&nested(63, ""), "local_ai_allowed"), Decoded::Refused);
        assert_eq!(local_ai_allowed(&nested(63, "")), Some(true));
        assert_eq!(local_ai_allowed(&nested(63, "z: \"local\\u005fai_allowed\"")), Some(false));
    }

    /// Review of PR #303 at 828f994d, found by the differential harness: the
    /// readers agree on tabs, stray lines, `...`, carriage returns, quoted or
    /// YAML-only locks and merge keys, and bound list markers before parsing.
    #[test]
    fn what_the_differential_harness_found() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        // item 1: a tab after the colon never grants
        assert_eq!(body_edit(&["ai_edit:\ttrue"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by:\tagent"]), BodyEdit::PersonWritten, "a typed creator grants nothing");
        assert_eq!(local_ai_allowed(&["secure: true", "local_ai_allowed:\ttrue"]), Some(false));
        assert_eq!(body_edit(&["date created:\t2024-01-01"]), BodyEdit::PersonWritten);
        assert_eq!(body_edit(&["created_by: agent", "date created:\t2024-01-01"]), BodyEdit::Allowed);
        assert_eq!(body_edit(&["created_by:  agent"]), BodyEdit::PersonWritten);
        // item 3: one malformed ordinary line changes no permission
        for odd in ["date created: Meeting: x", "c", "- item", "\t- a", "{a: 1,", "%YAML 1.2", "  y: z"] {
            assert_eq!(body_edit(&["created_by: agent", odd]), BodyEdit::Allowed, "{odd:?}");
            assert_eq!(body_edit(&[odd]), BodyEdit::PersonWritten, "{odd:?}");
            assert_eq!(local_ai_allowed(&["secure: true", odd]), None, "{odd:?}");
        }
        assert_eq!(body_edit(&["created_by: agent", "\"a\\qb\": c"]), BodyEdit::Allowed, "blanked: a plain key now");
        assert_eq!(body_edit(&["created_by: agent", "c", "{\"ai\\u005fedit\": false"]), BodyEdit::Locked, "an escape could spell any key, `locked` too");
        // item 6
        assert_eq!(local_ai_allowed(&["...", "secure: true", "local_ai_allowed: true"]), Some(true), "nothing else spells the key");
        assert_eq!(local_ai_allowed(&["...", "local_ai_allowed: true", "x: *nope"]), Some(false), "an alias could");
        assert_eq!(body_edit(&["ai_edit: true\r\r\r"]), BodyEdit::Allowed);
        assert_eq!(body_edit(&["\tnested: tab"]), BodyEdit::PersonWritten);
        // item 8
        for lock in ["locked: \"true\"", "locked: True", "{locked: true}", "!!str locked: true"] {
            assert_eq!(body_edit(&[lock, "created_by: agent"]), BodyEdit::Locked, "{lock:?}");
        }
        assert_eq!(body_edit(&["created_by: agent", "<<: {ai_edit: false}"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "base: &x {ai_edit: false}", "<<: *x"]), BodyEdit::Locked, "an alias could carry any key");
        // item 7
        let started = std::time::Instant::now();
        let markers = format!("  {}a", "- ".repeat(30_000));
        assert_eq!(body_edit(&["created_by: agent", "x:", markers.as_str()]), BodyEdit::Allowed);
        assert!(started.elapsed() < std::time::Duration::from_millis(500), "{:?}", started.elapsed());
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

    /// The guard for the writer class (Codex re-check of PR #303): every
    /// production function that composes a note's frontmatter runs
    /// `guard_write` (or a wrapper of it) before writing, so no writer can
    /// leave a note more permissive than the action owns. A new writer fails
    /// this test until it does, or is named below with its reason.
    #[test]
    fn every_frontmatter_writer_runs_the_guard() {
        const COMPOSERS: [&str; 8] = ["compose_for(", "compose_document(", "compose_in_place(", "with_top_level_line(", "with_key_lines(", "with_secure_line_only(", "with_view_tag(", "merge_raw_frontmatter("];
        const GUARDS: [&str; 4] = ["guard_write(", "keeps(", "keeps_other_verdicts(", "leaves_managed("];
        let exempt: std::collections::HashMap<&str, &str> = [
            ("compose_for", "picks the composer for a write; each caller guards the result"),
            ("create_marked", "creates a new note: there is no earlier frontmatter to loosen"),
            ("compose_in_place", "a pure composer: returns text; its callers write and guard it"),
            ("with_secure_line_only", "a pure composer: returns text; its callers write and guard it"),
            ("with_top_level_line", "a pure composer: returns text; its callers write and guard it"),
            ("with_view_tag", "a pure composer: returns text; its callers write and guard it"),
        ]
        .into_iter()
        .collect();
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut unguarded = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let production = text.split(concat!("#[cfg(test)]\n", "mod tests")).next().unwrap_or_default();
            // each function's text, from its `fn` line to the next one
            let mut function: Option<(String, String)> = None;
            let mut check = |function: Option<(String, String)>| {
                let Some((fn_name, body)) = function else { return };
                let composes = COMPOSERS.iter().any(|call| body.contains(call) && !call.starts_with(&format!("{fn_name}(")));
                if composes && !GUARDS.iter().any(|guard| body.contains(guard)) && !exempt.contains_key(fn_name.as_str()) {
                    unguarded.push(format!("{name}: {fn_name}"));
                }
            };
            for line in production.lines() {
                let trimmed = line.trim_start();
                let declares = ["fn ", "pub fn ", "pub(crate) fn ", "pub(super) fn ", "async fn ", "pub(crate) async fn "].iter().find(|p| trimmed.starts_with(*p));
                if let Some(prefix) = declares {
                    check(function.take());
                    let rest = &trimmed[prefix.len()..];
                    let fn_name = rest.split(|c: char| !(c.is_alphanumeric() || c == '_')).next().unwrap_or_default().to_string();
                    function = Some((fn_name, String::new()));
                } else if let Some((_, body)) = function.as_mut() {
                    body.push_str(line);
                    body.push('\n');
                }
            }
            check(function.take());
        }
        unguarded.sort();
        assert!(unguarded.is_empty(), "frontmatter writers without guard_write: {unguarded:?}");
    }

    /// The guard for the class: a production reader of a key only Rust writes
    /// goes through this module (`owned_key` for policy, `frontmatter_field`
    /// for a setter, `top_level_field` for an in-place writer). A new file that names one of these keys
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
            if path.extension() != Some(std::ffi::OsStr::new("rs")) || name.contains("test") || name.starts_with("frontmatter_") {
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
        assert_eq!(readers, ["ai_edit_policy.rs", "corpus.rs", "corpus_ai_edit.rs", "corpus_in_place.rs"], "a new reader of a key only Rust writes: check it, then add it here");
    }
}
