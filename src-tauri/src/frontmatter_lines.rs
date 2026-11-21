//! How Rotli reads the permission keys off a note's frontmatter lines, with
//! no YAML parser: `locked`, `secure`, and the keys only Rust writes
//! (`ai_edit`, `created_by`, `local_ai_allowed`). The twin of
//! src/lib/frontmatterLines.ts, character for character; the seeded
//! differential harness (permission_differential_tests.rs) and parity.json
//! `permissionLineCases` hold the two to the same verdicts.
//!
//! The rules (decision 2026-11-20, replacing PR 303's YAML readers):
//! 1. `locked`/`secure` are on for any line spelling of the key (indent,
//!    `- `, `? `, quotes, a `!tag`, a `{…}` flow entry, an escaped quoted
//!    key) whose value isn't exactly `false`.
//! 2. The same spellings deny `ai_edit`/`local_ai_allowed` and restrict
//!    `created_by` with any value that doesn't grant.
//! 3. A grant line continued onto a deeper plain line doesn't grant: YAML
//!    reads `ai_edit: true` + `  until friday` as the text "true until friday".
//! 4. A lone CR, U+0085, U+2028 and U+2029 split a line. A line they split is
//!    also read whole, never grants, and can only tighten.
//!
//! Only Rotli's own unbroken `key: value` line grants.

use crate::frontmatter_keys::{is_js_space, js_trim};

/// One mention of a key on a line.
pub(crate) struct Mention<'a> {
    /// The value, trimmed with [`js_trim`].
    pub(crate) value: &'a str,
    /// Everything after the colon, untrimmed ("" when there is none).
    raw: &'a str,
    /// `key: value` at the start of the line, unquoted: Rotli's spelling.
    canonical: bool,
    /// A block key (not a `{…}` flow entry).
    block: bool,
    /// Leading space characters before the key.
    indent: usize,
}

fn is_break(c: char) -> bool {
    matches!(c, '\r' | '\n' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

/// Unicode White_Space plus U+FEFF: [`is_js_space`] with U+0085 added.
fn is_space(c: char) -> bool {
    c == '\u{85}' || is_js_space(c)
}

fn trim_space(s: &str) -> &str {
    s.trim_matches(is_space)
}

fn indent_of(s: &str) -> usize {
    s.chars().take_while(|&c| is_space(c)).count()
}

/// A physical frontmatter line without its trailing CRs, split at every break
/// left inside it, and whether nothing split it.
pub(crate) fn segments(line: &str) -> (Vec<&str>, bool) {
    let parts: Vec<&str> = line.trim_end_matches('\r').split(is_break).collect();
    let whole = parts.len() == 1;
    (parts, whole)
}

/// A quoted key starting at `rest`'s first character, decoded: its name and
/// the byte where it ends. None when it never closes or an escape doesn't
/// name a character.
fn quoted(rest: &str, quote: char) -> Option<(String, usize)> {
    let mut name = String::new();
    let mut chars = rest.char_indices().skip(1).peekable();
    while let Some((at, c)) = chars.next() {
        if quote == '\'' {
            if c != '\'' {
                name.push(c);
            } else if chars.peek().is_some_and(|&(_, next)| next == '\'') {
                chars.next();
                name.push('\'');
            } else {
                return Some((name, at + 1));
            }
            continue;
        }
        if c == '"' {
            return Some((name, at + 1));
        }
        if c != '\\' {
            name.push(c);
            continue;
        }
        let (_, escaped) = chars.next()?;
        let width = match escaped {
            'x' => 2,
            'u' => 4,
            'U' => 8,
            _ => 0,
        };
        if width > 0 {
            let mut hex = String::new();
            for _ in 0..width {
                let (_, digit) = chars.next()?;
                if !digit.is_ascii_hexdigit() {
                    return None;
                }
                hex.push(digit);
            }
            name.push(char::from_u32(u32::from_str_radix(&hex, 16).ok()?)?);
            continue;
        }
        name.push(match escaped {
            'n' => '\n',
            't' => '\t',
            'r' => '\r',
            '0' => '\0',
            other => other,
        });
    }
    None
}

/// The block key `text` sets, when it is `key`, in any line spelling.
fn block_mention<'a>(text: &'a str, key: &str) -> Option<Mention<'a>> {
    let mut rest = text.trim_start_matches(is_space);
    let indent = indent_of(text);
    let mut canonical = indent == 0;
    let mut explicit = false;
    loop {
        let mut chars = rest.chars();
        match (chars.next(), chars.next()) {
            (Some(c @ ('-' | '?')), Some(space)) if is_space(space) => {
                rest = rest[1..].trim_start_matches(is_space);
                canonical = false;
                explicit |= c == '?';
            }
            _ => break,
        }
    }
    if rest.starts_with('!') {
        let end = rest.find(is_space)?;
        rest = rest[end..].trim_start_matches(is_space);
        canonical = false;
    }
    if rest.starts_with('#') {
        return None;
    }
    let (name, after) = match rest.chars().next() {
        Some(quote @ ('"' | '\'')) => {
            canonical = false;
            let (name, end) = quoted(rest, quote)?;
            (name, rest[end..].trim_start_matches(is_space))
        }
        _ => match rest.find(':') {
            Some(colon) => {
                let raw = &rest[..colon];
                canonical &= raw == raw.trim_end_matches(is_space);
                (trim_space(raw).to_string(), &rest[colon..])
            }
            None if explicit => (trim_space(rest).to_string(), ""),
            None => return None,
        },
    };
    if !explicit && !after.starts_with(':') || name != key {
        return None;
    }
    let raw = after.strip_prefix(':').unwrap_or_default();
    Some(Mention { value: js_trim(raw), raw, canonical, block: true, indent })
}

/// Every `{…, key: value}` flow entry naming `key` in `text`.
fn flow_mentions<'a>(text: &'a str, key: &str, out: &mut Vec<Mention<'a>>) {
    for (at, c) in text.char_indices() {
        if c != '{' && c != ',' {
            continue;
        }
        let mut rest = text[at + 1..].trim_start_matches(is_space);
        let name = match rest.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let Some((name, end)) = quoted(rest, quote) else { continue };
                rest = rest[end..].trim_start_matches(is_space);
                name
            }
            _ => {
                let end = rest.find([':', ',', '{', '}', '"', '\'']).unwrap_or(rest.len());
                let name = trim_space(&rest[..end]).to_string();
                rest = &rest[end..];
                name
            }
        };
        let Some(value) = rest.strip_prefix(':').filter(|_| name == key) else { continue };
        let raw = &value[..value.find([',', '}']).unwrap_or(value.len())];
        out.push(Mention { value: js_trim(raw), raw, canonical: false, block: false, indent: 0 });
    }
}

/// Every mention of `key` on one physical line: in each piece a break
/// leaves, and, on a broken line, in the line read whole as well.
pub(crate) fn line_mentions<'a>(line: &'a str, key: &str) -> (Vec<Mention<'a>>, bool) {
    let (parts, whole) = segments(line);
    let mut mentions = Vec::new();
    for part in parts {
        mentions.extend(block_mention(part, key));
        flow_mentions(part, key, &mut mentions);
    }
    if !whole {
        mentions.extend(block_mention(line.trim_end_matches('\r'), key));
    }
    (mentions, whole)
}

/// `locked`/`secure` on one line: `Some(true)` when any spelling of the key
/// holds a value other than exactly `false`, `Some(false)` when every one
/// says `false`, None when the line doesn't name it (rule 1).
pub(crate) fn flag_field(line: &str, key: &str) -> Option<bool> {
    let (mentions, _) = line_mentions(line, key);
    if mentions.is_empty() {
        return None;
    }
    Some(mentions.iter().any(|mention| mention.raw.trim_matches([' ', '\t']) != "false"))
}

/// Does this line set `key` in a block spelling? The person's off-switches
/// remove every line it matches, as `local_ai_allowed_field` does.
pub(crate) fn sets_key(line: &str, key: &str) -> bool {
    crate::frontmatter_keys::frontmatter_field(line).is_some_and(|(spelled, _)| spelled.name == key)
}

/// An off-switch refuses, rather than report success, when its flag is still
/// on in `fields` after it removed what it can (a `{locked: true}` flow
/// entry inside another key, a key on a broken line, or in a folder opened
/// in place a spelling other than Rotli's). TypeScript: folderMetadata.ts.
pub(crate) fn refuse_if_still_on<S: AsRef<str>>(fields: &[S], key: &str) -> Result<(), String> {
    match fields.iter().find(|line| flag_field(line.as_ref(), key) == Some(true)) {
        Some(line) => Err(format!(
            "This note still turns {key} on in a line the switch can't change ({}). Remove that line in the note's metadata, then try again.",
            line.as_ref().trim()
        )),
        None => Ok(()),
    }
}

/// Whether the first non-blank piece from `from` continues a key at `indent`
/// as YAML plain text: deeper, not a comment, not itself a `key: value`.
fn continued(pieces: &[&str], from: usize, indent: usize) -> bool {
    let Some(piece) = pieces.iter().skip(from).find(|piece| !trim_space(piece).is_empty()) else {
        return false;
    };
    let text = trim_space(piece);
    let mapping = text.ends_with(':') || text.match_indices(':').any(|(at, _)| text[at + 1..].starts_with(is_space));
    indent_of(piece) > indent && !text.starts_with('#') && !mapping
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
/// `local_ai_allowed`), failing closed both ways (rules 2-4): any mention on
/// a broken line, any value that isn't a grant, or a grant continued onto a
/// plain line denies; only Rust's own unbroken spelling grants; a denial
/// wins. TypeScript's twin is src/lib/frontmatterLines.ts `ownedKey`.
pub(crate) fn owned_key<'a, S: AsRef<str>>(fields: &'a [S], key: &str, grants: impl Fn(&str) -> bool) -> Says<'a> {
    let mut pieces = Vec::new();
    let mut first = Vec::with_capacity(fields.len());
    for line in fields {
        first.push(pieces.len());
        pieces.extend(segments(line.as_ref()).0);
    }
    let mut grant = None;
    for (i, line) in fields.iter().enumerate() {
        let (mentions, whole) = line_mentions(line.as_ref(), key);
        for mention in mentions {
            if !whole || !grants(mention.value) {
                return Says::Deny;
            }
            if mention.block && continued(&pieces, first[i] + 1, mention.indent) {
                return Says::Deny;
            }
            if mention.canonical && grant.is_none() {
                grant = Some(mention.value);
            }
        }
    }
    grant.map_or(Says::Unset, Says::Grant)
}
