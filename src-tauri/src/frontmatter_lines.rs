//! How Rotli reads the permission keys off a note's frontmatter lines, with
//! no YAML parser: `locked`, `secure`, and the keys only Rust writes
//! (`ai_edit`, `created_by`, `local_ai_allowed`). The twin of
//! src/lib/frontmatterLines.ts, character for character; the seeded
//! differential harness (permission_differential_tests.rs) and parity.json
//! `permissionLineCases` hold the two to the same verdicts.
//!
//! The rules (decision 2026-11-20, replacing PR 303's YAML readers):
//! 1. `locked`/`secure` are on for any line spelling of the key (indent,
//!    `- `, `? `, quotes, a `!tag` or `&anchor`, a `{…}` flow entry, an
//!    escaped quoted key) unless the value says off: `false`, `no` or `off`
//!    in any case, optionally quoted, optionally followed by a `# comment`.
//! 2. The same spellings deny `ai_edit`/`local_ai_allowed` and restrict
//!    `created_by` with any value that doesn't grant.
//! 3. A grant line continued onto a deeper plain line doesn't grant: YAML
//!    reads `ai_edit: true` + `  until friday` as the text "true until friday".
//! 4. A lone CR, U+0085, U+2028 and U+2029 split a line. A line they split is
//!    also read whole, never grants, and can only tighten.
//!
//! Text inside a block scalar (`key: |`, `key: >-`, …) is text, as in YAML:
//! it names no key. Only Rotli's own unbroken `key: value` line grants.

use crate::frontmatter_keys::{is_js_space, js_trim};

/// The keys these rules read. A typed fact (`id:`, `pinned:` …) whose line
/// names one is kept as a foreign line, so the readers see it.
const PERMISSION_KEYS: [&str; 5] = ["locked", "secure", "ai_edit", "created_by", "local_ai_allowed"];

/// One mention of a key on a line.
pub(crate) struct Mention<'a> {
    /// The value, trimmed with [`js_trim`].
    pub(crate) value: &'a str,
    /// Everything after the colon, untrimmed ("" when there is none).
    raw: &'a str,
    /// `key: value` at the start of the line, unquoted: Rotli's spelling.
    canonical: bool,
    /// At the start of the line with no `- `, `? `, tag or anchor (it may be
    /// quoted): a top-level key an off-switch can remove.
    plain: bool,
    /// A block key (not a `{…}` flow entry).
    block: bool,
    /// Leading space characters before the key.
    indent: usize,
    /// The piece after the one holding the mention, where a continuation
    /// would start (rule 3).
    next: usize,
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

/// `text` (already trimmed at the start) past every `- `/`? ` indicator and
/// every `!tag`/`&anchor` property before a key, in any order; whether any
/// was there, and whether one was `? `.
fn undecorated(text: &str) -> (&str, bool, bool) {
    let (mut rest, mut decorated, mut explicit) = (text, false, false);
    loop {
        let mut chars = rest.chars();
        match chars.next() {
            Some(c @ ('-' | '?')) if chars.next().is_some_and(is_space) => {
                explicit |= c == '?';
                rest = rest[1..].trim_start_matches(is_space);
            }
            Some('!' | '&') => match rest.find(is_space) {
                Some(end) => rest = rest[end..].trim_start_matches(is_space),
                None => break,
            },
            _ => break,
        }
        decorated = true;
    }
    (rest, decorated, explicit)
}

/// The block key `text` sets, when it is `key`, in any line spelling.
fn block_mention<'a>(text: &'a str, key: &str) -> Option<Mention<'a>> {
    let indent = indent_of(text);
    let (rest, decorated, explicit) = undecorated(text.trim_start_matches(is_space));
    let mut canonical = indent == 0 && !decorated;
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
    Some(Mention { value: js_trim(raw), raw, canonical, plain: indent == 0 && !decorated, block: true, indent, next: 0 })
}

/// Every `{…, key: value}` flow entry naming `key` in `text`, past any `? `,
/// tag or anchor before the key.
fn flow_mentions<'a>(text: &'a str, key: &str, out: &mut Vec<Mention<'a>>) {
    for (at, c) in text.char_indices() {
        if c != '{' && c != ',' {
            continue;
        }
        let (mut rest, _, _) = undecorated(text[at + 1..].trim_start_matches(is_space));
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
        out.push(Mention { value: js_trim(raw), raw, canonical: false, plain: false, block: false, indent: 0, next: 0 });
    }
}

/// Does `piece` open a block scalar: `key: |`, `key: >-`, `key: |2`? A
/// header with a trailing comment doesn't count: reading less as text can
/// only tighten.
fn opens_block(piece: &str) -> bool {
    let text = piece.trim_end_matches(is_space);
    let indicator = text.trim_end_matches(|c: char| c == '-' || c == '+' || c.is_ascii_digit());
    let Some(before) = indicator.strip_suffix(['|', '>']) else { return false };
    let spaced = before.trim_end_matches([' ', '\t']);
    spaced.len() < before.len() && spaced.ends_with(':')
}

/// A note's frontmatter lines cut into pieces at every break, each marked
/// when it is block-scalar text.
struct Pieces<'a> {
    text: Vec<&'a str>,
    in_block: Vec<bool>,
    /// The index of each line's first piece.
    first: Vec<usize>,
    whole: Vec<bool>,
}

/// Which pieces are block-scalar text, fed one piece at a time.
#[derive(Default)]
pub(crate) struct BlockText {
    /// The open block's header indent.
    open: Option<usize>,
}

impl BlockText {
    /// Feed the next piece; true when it is text inside an open block.
    fn feed(&mut self, piece: &str) -> bool {
        let in_block = self.open.is_some_and(|indent| trim_space(piece).is_empty() || indent_of(piece) > indent);
        if !in_block {
            self.open = opens_block(piece).then(|| indent_of(piece));
        }
        in_block
    }

    /// Feed a whole frontmatter line, piece by piece.
    pub(crate) fn feed_line(&mut self, line: &str) {
        for piece in segments(line).0 {
            self.feed(piece);
        }
    }

    /// Would the first non-blank line of `rest` continue the open block, if
    /// it came next?
    pub(crate) fn continues<S: AsRef<str>>(&self, rest: &[S]) -> bool {
        let Some(indent) = self.open else { return false };
        rest.iter().map(AsRef::as_ref).find(|line| !trim_space(line).is_empty()).is_some_and(|line| indent_of(line) > indent)
    }
}

fn pieces<S: AsRef<str>>(fields: &[S]) -> Pieces<'_> {
    let mut out = Pieces { text: Vec::new(), in_block: Vec::new(), first: Vec::new(), whole: Vec::new() };
    let mut block = BlockText::default();
    for line in fields {
        let (parts, whole) = segments(line.as_ref());
        out.first.push(out.text.len());
        out.whole.push(whole);
        for part in parts {
            out.in_block.push(block.feed(part));
            out.text.push(part);
        }
    }
    out
}

/// Every mention of `key` on line `line`: in each piece outside a block
/// scalar, and, on a broken line, in the line read whole as well.
fn mentions<'a, S: AsRef<str>>(fields: &'a [S], pieces: &Pieces<'a>, line: usize, key: &str) -> Vec<Mention<'a>> {
    let end = pieces.first.get(line + 1).copied().unwrap_or(pieces.text.len());
    let mut out = Vec::new();
    for at in pieces.first[line]..end {
        if !pieces.in_block[at] {
            let from = out.len();
            out.extend(block_mention(pieces.text[at], key));
            flow_mentions(pieces.text[at], key, &mut out);
            out[from..].iter_mut().for_each(|mention| mention.next = at + 1);
        }
    }
    if !pieces.whole[line] && !pieces.in_block[pieces.first[line]] {
        out.extend(block_mention(fields[line].as_ref().trim_end_matches('\r'), key).map(|mention| Mention { next: end, ..mention }));
    }
    out
}

/// Does this value say off: `false`, `no` or `off` in any case, optionally
/// quoted, optionally followed by a `# comment` (rule 1)?
fn says_off(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    let cut = (1..bytes.len()).find(|&i| bytes[i] == b'#' && matches!(bytes[i - 1], b' ' | b'\t')).unwrap_or(bytes.len());
    let value = raw[..cut].trim_matches([' ', '\t']);
    let value = ['"', '\'']
        .iter()
        .find_map(|&q| value.strip_prefix(q).and_then(|v| v.strip_suffix(q)))
        .unwrap_or(value);
    matches!(value.to_ascii_lowercase().as_str(), "false" | "no" | "off")
}

/// The first line that turns `locked`/`secure` on: any mention whose value
/// doesn't say off (rule 1), or says off but continues onto a deeper plain
/// line, which YAML folds into the value (`false until friday` is no off).
pub(crate) fn flag_line<S: AsRef<str>>(fields: &[S], key: &str) -> Option<usize> {
    let pieces = pieces(fields);
    let on = |mention: &Mention| !says_off(mention.raw) || (mention.block && continued(&pieces.text, mention.next, mention.indent));
    (0..fields.len()).find(|&line| mentions(fields, &pieces, line, key).iter().any(on))
}

/// Is `locked`/`secure` on in these frontmatter lines?
pub(crate) fn flag_on<S: AsRef<str>>(fields: &[S], key: &str) -> bool {
    flag_line(fields, key).is_some()
}

/// Does a typed fact's line (`id:`, `pinned:` …) name a permission key, in a
/// flow entry or on a broken line? Then it stays a foreign line.
pub(crate) fn names_permission_key(line: &str) -> bool {
    let fields = [line];
    let pieces = pieces(&fields);
    PERMISSION_KEYS.iter().any(|key| !mentions(&fields, &pieces, 0, key).is_empty())
}

/// Is this value all on its line: no block-scalar indicator, and any
/// bracket or quote it opens closed again?
fn on_one_line(value: &str) -> bool {
    const PAIRS: [(char, char); 4] = [('{', '}'), ('[', ']'), ('"', '"'), ('\'', '\'')];
    let balanced = |&(first, last): &(char, char)| !value.starts_with(first) || (value.len() > 1 && value.ends_with(last));
    !value.starts_with(['|', '>']) && PAIRS.iter().all(balanced)
}

/// The first non-blank piece from `from`.
fn next_text<'a>(texts: &[&'a str], from: usize) -> Option<&'a str> {
    texts.iter().skip(from).copied().find(|piece| !trim_space(piece).is_empty())
}

/// `fields` without every line an off-switch may remove as `key`'s: only a
/// top-level, single-line spelling (unbroken, at the margin with no `- `,
/// `? `, tag or anchor, its value on this line, nothing deeper after it).
/// Removing anything else could leave frontmatter YAML can't read.
pub(crate) fn without_flag(fields: &[String], key: &str) -> Vec<String> {
    let pieces = pieces(fields);
    let removable = |line: usize| {
        let at = pieces.first[line];
        pieces.whole[line]
            && !pieces.in_block[at]
            && block_mention(fields[line].trim_end_matches('\r'), key).is_some_and(|m| m.plain && on_one_line(trim_space(m.raw)))
            && !next_text(&pieces.text, at + 1).is_some_and(|piece| indent_of(piece) > 0)
    };
    fields.iter().enumerate().filter(|&(line, _)| !removable(line)).map(|(_, text)| text.clone()).collect()
}

/// An off-switch refuses, rather than report success, when its flag is still
/// on in `fields` after it removed what it can (a `{locked: true}` flow
/// entry inside another key, a list item, block text it can't reach, a key
/// on a broken line, or in a folder opened in place a spelling other than
/// Rotli's). TypeScript: folderMetadata.ts `refuseIfStillOn`.
pub(crate) fn refuse_if_still_on<S: AsRef<str>>(fields: &[S], key: &str) -> Result<(), String> {
    match flag_line(fields, key) {
        Some(line) => Err(format!(
            "This note still turns {key} on in a line the switch can't change ({}). Remove that line in the note's metadata, then try again.",
            fields[line].as_ref().trim()
        )),
        None => Ok(()),
    }
}

/// Whether the first non-blank piece from `from` continues a key at `indent`
/// as YAML plain text: deeper, not a comment, not itself a `key: value`.
fn continued(pieces: &[&str], from: usize, indent: usize) -> bool {
    let Some(piece) = next_text(pieces, from) else {
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
    let pieces = pieces(fields);
    let mut grant = None;
    for line in 0..fields.len() {
        for mention in mentions(fields, &pieces, line, key) {
            if !pieces.whole[line] || !grants(mention.value) {
                return Says::Deny;
            }
            if mention.block && continued(&pieces.text, mention.next, mention.indent) {
                return Says::Deny;
            }
            if mention.canonical && grant.is_none() {
                grant = Some(mention.value);
            }
        }
    }
    grant.map_or(Says::Unset, Says::Grant)
}
