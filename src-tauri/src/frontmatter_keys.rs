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
            (decode_scalar(&rest[..=close]).unwrap_or_else(|| rest[1..close].to_string()), &rest[close + 1..])
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

/// A quoted YAML scalar, decoded by the YAML parser; None when it won't parse.
fn decode_scalar(token: &str) -> Option<String> {
    let docs = yaml_rust2::YamlLoader::load_from_str(token).ok()?;
    docs.first()?.as_str().map(str::to_string)
}

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
        None => line.split_once(':').map(|(key, value)| (key.to_string(), value.trim().to_string())),
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
        if named || !grants(value) || line.chars().any(undecidable) {
            return Says::Deny;
        }
        named = true;
        if spelled.canonical {
            grant = Some(value);
        }
    }
    // and the frontmatter as a YAML parser decodes it (escapes, flow maps):
    // a decoded value that doesn't grant denies, and a grant needs both to
    // agree. Frontmatter that won't decode (the organizer writes values
    // unquoted, people type what they like) says nothing by itself; it denies
    // only when a line the reader above can't name mentions the key.
    match decoded_value(fields, key) {
        Decoded::Value(Some(value)) if !grants(&value) => Says::Deny,
        Decoded::Value(None) if grant.is_some() => Says::Deny,
        Decoded::Unreadable if mentioned_unnamed(fields, key) => Says::Deny,
        _ => grant.map_or(Says::Unset, Says::Grant),
    }
}

/// Characters the two YAML parsers (yaml-rust2 here, `yaml` in TypeScript)
/// could read differently: C0 and C1 controls other than tab and the line
/// feed between lines, and U+FEFF. A line about a key holding one denies that
/// key; frontmatter holding one elsewhere isn't decoded.
fn undecidable(c: char) -> bool {
    (c < ' ' && c != '\t' && c != '\n') || ('\u{7f}'..='\u{9f}').contains(&c) || c == '\u{feff}'
}

/// What a YAML parser makes of the frontmatter for one key.
enum Decoded {
    /// A single mapping: the key's top-level value as text, None when absent.
    Value(Option<String>),
    /// It won't decode, isn't one mapping, repeats a key, holds an
    /// [`undecidable`] character, or isn't [`affordable`]: the parser says
    /// nothing.
    Unreadable,
}

#[cfg(test)]
impl Decoded {
    fn is_readable(&self) -> bool {
        matches!(self, Decoded::Value(_))
    }
}

/// Whether a line the line reader doesn't name as `key` still contains the
/// key's text (`!!str ai_edit: false`, `{ai_edit: false}`, a value that
/// mentions it): in frontmatter that won't decode, such a line might be a
/// denial nobody can read, so it denies.
fn mentioned_unnamed<S: AsRef<str>>(fields: &[S], key: &str) -> bool {
    fields.iter().map(AsRef::as_ref).any(|line| line.contains(key) && !names_key(line, key))
}

/// The most frontmatter the decoder reads, in UTF-8 bytes, and the deepest
/// nesting it builds; past either it says nothing (the line rules still
/// apply). TypeScript's twins: `DECODE_MAX_BYTES`, `DECODE_MAX_DEPTH`.
const DECODE_MAX_BYTES: usize = 64 * 1024;
const DECODE_MAX_DEPTH: usize = 64;

/// Whether the decoder may build `block` into a tree: within
/// [`DECODE_MAX_BYTES`], no alias (yaml-rust2 copies an alias's whole target,
/// so a few hundred bytes of nested aliases expand without bound), and
/// nesting within [`DECODE_MAX_DEPTH`] (its loader recurses once per level).
/// Walked event by event and stopped at the first excess, so the check itself
/// is linear and never recurses.
fn affordable(block: &str) -> bool {
    use yaml_rust2::Event;
    if block.len() > DECODE_MAX_BYTES {
        return false;
    }
    let mut parser = yaml_rust2::parser::Parser::new_from_str(block);
    let mut depth = 0usize;
    loop {
        match parser.next_token() {
            Err(_) | Ok((Event::Alias(_), _)) => return false,
            Ok((Event::StreamEnd, _)) => return true,
            Ok((Event::SequenceStart(..) | Event::MappingStart(..), _)) => {
                depth += 1;
                if depth > DECODE_MAX_DEPTH {
                    return false;
                }
            }
            Ok((Event::SequenceEnd | Event::MappingEnd, _)) => depth = depth.saturating_sub(1),
            Ok(_) => {}
        }
    }
}

/// The top-level value of `key` once the frontmatter is decoded as YAML, as
/// text (`true`, `false`, a string, a number). TypeScript's twin:
/// `decodedValue` in frontmatterKeys.ts.
fn decoded_value<S: AsRef<str>>(fields: &[S], key: &str) -> Decoded {
    use yaml_rust2::Yaml;
    let block = fields.iter().map(|line| line.as_ref().trim_end_matches('\r')).collect::<Vec<_>>().join("\n");
    if block.chars().any(undecidable) || !affordable(&block) {
        return Decoded::Unreadable;
    }
    let Ok(docs) = yaml_rust2::YamlLoader::load_from_str(&block) else { return Decoded::Unreadable };
    let map = match docs.first() {
        None | Some(Yaml::Null) => return Decoded::Value(None),
        Some(Yaml::Hash(map)) if docs.len() == 1 => map,
        _ => return Decoded::Unreadable,
    };
    Decoded::Value(map.get(&Yaml::String(key.to_string())).map(|value| match value {
        Yaml::Boolean(flag) => flag.to_string(),
        Yaml::String(text) | Yaml::Real(text) => text.clone(),
        Yaml::Integer(number) => number.to_string(),
        Yaml::Null => String::new(),
        _ => "\u{0}".to_string(), // a list or a map: grants nothing
    }))
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
        // a second line naming the creator denies the creator, not AI editing
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
    /// `links: [[A]], [[B]]`), and people type frontmatter no strict YAML
    /// parser reads. Frontmatter that won't decode says nothing about a key
    /// by itself: the note keeps its permissions (the round-5 WIP denied all
    /// three on such a note, so a filed AI note stopped being editable).
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
        // a repeated ordinary key, a stray control character, a tab-indented line
        for extra in ["tags: [a]\ntags: [b]", "summary: pasted\u{85}text", "x: [unclosed", "\tnested: tab"] {
            let fields: Vec<&str> = ["created_by: agent"].into_iter().chain(extra.split('\n')).collect();
            assert_eq!(body_edit(&fields), BodyEdit::Allowed, "{extra:?}");
        }
    }

    /// The fail-closed cases that remain on frontmatter that won't decode: a
    /// line about the key itself (a second copy, a control character, a
    /// spelling the line reader can't name) still denies.
    #[test]
    fn undecodable_frontmatter_still_denies_where_a_line_is_about_the_key() {
        use crate::ai_edit_policy::{body_edit, BodyEdit};
        assert_eq!(body_edit(&["created_by: agent", "ai_edit: true", "ai_edit: true"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "!!str ai_edit: false"]), BodyEdit::Revoked);
        assert_eq!(body_edit(&["created_by: agent", "summary: a: b", "\"ai\\u005fedit\": false"]), BodyEdit::Revoked);
        assert_eq!(local_ai_allowed(&["local_ai_allowed: true", "summary: about local_ai_allowed: x"]), Some(false));
        assert_eq!(local_ai_allowed(&["local_ai_allowed: \u{feff}true", "summary: a: b"]), Some(false));
        // a well-formed document still decides: a denial only a YAML parser
        // sees (a top-level flow map) holds
        assert_eq!(body_edit(&["{created_by: agent, ai_edit: false}"]), BodyEdit::Revoked);
    }

    /// The decoder reads untrusted frontmatter (any file in the vault), so it
    /// never builds what it can't afford: nested aliases (exponential copies
    /// in yaml-rust2), nesting past 64 levels (its loader recurses), or more
    /// than 64 KiB. Such frontmatter says nothing, the line rules still decide,
    /// and a denial only a parser would see still denies through its text.
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
        for hostile in [laughs.join("\n"), deep, wide] {
            let started = std::time::Instant::now();
            let mut fields: Vec<String> = hostile.split('\n').map(str::to_string).collect();
            fields.push("created_by: agent".into());
            assert_eq!(body_edit(&fields), BodyEdit::Allowed);
            fields.push("{ai_edit: false}".into());
            assert_eq!(body_edit(&fields), BodyEdit::Revoked);
            assert!(started.elapsed() < std::time::Duration::from_secs(2), "{:?}", started.elapsed());
        }
        // an escaped key in a flow map is a denial only a decoder sees: it
        // holds at 64 levels of nesting, and at 65 the frontmatter isn't decoded
        let flow = |lists: usize| [format!("{{\"local\\u005fai_allowed\": false, x: {}{}}}", "[".repeat(lists), "]".repeat(lists))];
        assert_eq!(local_ai_allowed(&flow(63)), Some(false));
        assert!(decoded_value(&flow(63), "local_ai_allowed").is_readable());
        assert_eq!(local_ai_allowed(&flow(64)), None);
        assert!(!decoded_value(&flow(64), "local_ai_allowed").is_readable());
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
