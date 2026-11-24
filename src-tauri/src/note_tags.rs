//! A note's tags (2026-11-24): one shared top-level `tags:` key the person,
//! the Librarian, chat, and agents all read. Pure policy, no filesystem; the
//! store's lanes (corpus_tags.rs) decide who may write. TypeScript twin:
//! `src/lib/noteTags.ts`, pinned by `noteTagCases` and `noteTagEditCases` in
//! scripts/fixtures/parity.json.
//!
//! A new tag is held to an allowlist (letters, numbers, `-`, `_`, `/`), so no
//! value can carry a line break, a colon, a bracket, a quote, or a control
//! character into the frontmatter. Tags already on disk are read leniently and
//! written back exactly as they were spelled; a `tags:` field in a shape this
//! reader doesn't follow is never rewritten.

use unicode_normalization::UnicodeNormalization;

/// The longest tag, in characters (Unicode scalar values).
pub(crate) const TAG_MAX_CHARS: usize = 40;
/// The most tags one change may add or remove.
pub(crate) const TAGS_PER_CHANGE_MAX: usize = 32;
/// The most tags a write may leave on a note.
pub(crate) const TAGS_PER_NOTE_MAX: usize = 100;

/// Plain YAML words a reader would take as a boolean or null, not text.
const YAML_WORDS: [&str; 9] = ["y", "n", "yes", "no", "true", "false", "on", "off", "null"];

/// Why a value can't be a tag.
pub(crate) fn tag_refusal(tag: &str) -> Option<&'static str> {
    let chars: Vec<char> = tag.chars().collect();
    if chars.is_empty() {
        return Some("a tag can't be empty");
    }
    if chars.len() > TAG_MAX_CHARS {
        return Some("a tag is at most 40 characters");
    }
    if !chars.iter().all(|&c| c.is_alphabetic() || c.is_numeric() || matches!(c, '-' | '_' | '/')) {
        return Some("a tag uses only letters, numbers, -, _ and /");
    }
    if matches!(chars[0], '-' | '/') || chars[chars.len() - 1] == '/' || tag.contains("//") {
        return Some("a tag can't start with - or /, end with /, or hold //");
    }
    if YAML_WORDS.contains(&tag.to_ascii_lowercase().as_str()) || reads_as_number(tag) {
        return Some("a tag can't be a bare yes/no/true/false/null word or a number");
    }
    None
}

/// Would YAML read this plain scalar as a number?
fn reads_as_number(tag: &str) -> bool {
    let lower = tag.to_ascii_lowercase();
    if !lower.starts_with(|c: char| c.is_ascii_digit()) {
        return false;
    }
    let digits = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || c == '_');
    if digits(&lower) {
        return true;
    }
    for prefix in ["0x", "0o", "0b"] {
        if let Some(rest) = lower.strip_prefix(prefix) {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_hexdigit() || c == '_') {
                return true;
            }
        }
    }
    matches!(lower.split_once('e'), Some((mantissa, exponent)) if digits(mantissa) && digits(exponent))
}

/// A person's or model's input as a tag: one leading `#` dropped, outer
/// spaces trimmed (JavaScript's set), NFC, then the allowlist.
pub(crate) fn normalize_tag(input: &str) -> Result<String, String> {
    let trimmed = crate::frontmatter_keys::js_trim(input);
    let bare = trimmed.strip_prefix('#').unwrap_or(trimmed);
    let tag: String = bare.nfc().collect();
    match tag_refusal(&tag) {
        Some(reason) => Err(format!("\"{}\" can't be a tag: {reason}", printable(input))),
        None => Ok(tag),
    }
}

/// An input echoed in a refusal, with control characters and line breaks shown
/// as `?` so the message stays one line.
fn printable(input: &str) -> String {
    input
        .chars()
        .take(60)
        .map(|c| if c.is_control() || crate::frontmatter_lines::is_break(c) { '?' } else { c })
        .collect()
}

/// One tag as it is written on disk, and what it says.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Item {
    raw: String,
    value: String,
    /// The block-list line it sits on.
    line: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Form {
    Absent,
    /// `tags:` with nothing after it
    Empty,
    /// `tags: [a, b]`
    Flow,
    /// `tags: a, b`
    Bare,
    /// `tags:` then `  - a` lines
    Block,
}

#[derive(Debug, Clone)]
struct Field {
    form: Form,
    /// The `tags:` line's index in the frontmatter lines.
    line: Option<usize>,
    items: Vec<Item>,
}

const UNREADABLE: &str =
    "this note's tags are written in a form Rotli won't rewrite; change them in Show file metadata";

fn indent(line: &str) -> usize {
    line.len() - line.trim_start_matches([' ', '\t']).len()
}

/// One scalar of a list: quoted text unquoted, plain text as written. None for
/// anything that isn't a plain one-line scalar (a nested map or list, an
/// escape, an anchor, a comment).
fn scalar(raw: &str) -> Option<String> {
    let raw = raw.trim_matches([' ', '\t']);
    if raw.is_empty() || raw.chars().any(|c| c.is_control() || crate::frontmatter_lines::is_break(c)) {
        return None;
    }
    for quote in ['"', '\''] {
        if let Some(inner) = raw.strip_prefix(quote) {
            let inner = inner.strip_suffix(quote)?;
            if inner.contains(quote) || inner.contains('\\') {
                return None;
            }
            return Some(inner.to_string());
        }
    }
    let starts_special = raw.starts_with(['[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`', '#', ',', '?', '-']);
    if starts_special || raw.contains(": ") || raw.ends_with(':') || raw.contains(" #") || raw.contains(['[', ']', '{', '}']) {
        return None;
    }
    Some(raw.to_string())
}

/// Split a flow or bare list on commas outside quotes.
fn split_list(text: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for c in text.chars() {
        match quote {
            Some(q) if c == q => {
                quote = None;
                current.push(c);
            }
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                current.push(c);
            }
            None if c == ',' => parts.push(std::mem::take(&mut current)),
            None => current.push(c),
        }
    }
    if quote.is_some() {
        return None;
    }
    parts.push(current);
    Some(parts)
}

fn list_items(text: &str, flow: bool) -> Option<Vec<Item>> {
    let mut parts = split_list(text)?;
    // a flow list may end with a comma; an empty list has one empty part
    if parts.last().is_some_and(|p| p.trim_matches([' ', '\t']).is_empty()) && (flow || parts.len() == 1) {
        parts.pop();
    }
    parts
        .into_iter()
        .map(|part| {
            let raw = part.trim_matches([' ', '\t']).to_string();
            scalar(&raw).map(|value| Item { raw, value, line: None })
        })
        .collect()
}

/// Where the `tags:` field is and what it holds. Err when it is spelled or
/// shaped in a way no writer here may rewrite.
fn read_field(foreign: &[String]) -> Result<Field, &'static str> {
    let named: Vec<usize> = foreign
        .iter()
        .enumerate()
        .filter(|(_, line)| {
            crate::frontmatter_keys::frontmatter_field(line).is_some_and(|(key, _)| key.name == "tags")
        })
        .map(|(at, _)| at)
        .collect();
    let at = match named.as_slice() {
        [] => return Ok(Field { form: Form::Absent, line: None, items: Vec::new() }),
        [at] => *at,
        _ => return Err(UNREADABLE),
    };
    let line = foreign[at].trim_end_matches('\r');
    let value = line.strip_prefix("tags:").ok_or(UNREADABLE)?;
    if !value.is_empty() && !value.starts_with([' ', '\t']) {
        return Err(UNREADABLE);
    }
    let value = value.trim_matches([' ', '\t']);
    let next = foreign.get(at + 1).map(|l| l.trim_end_matches('\r'));
    if value.is_empty() {
        let mut items = Vec::new();
        let mut item_indent = None;
        for (offset, raw_line) in foreign[at + 1..].iter().enumerate() {
            let raw_line = raw_line.trim_end_matches('\r');
            let depth = indent(raw_line);
            let rest = &raw_line[depth..];
            let Some(item) = rest.strip_prefix("- ") else {
                if item_indent.is_some_and(|d| depth > d) || (item_indent.is_none() && depth > 0) {
                    return Err(UNREADABLE);
                }
                break;
            };
            if item_indent.is_some_and(|d| d != depth) {
                return Err(UNREADABLE);
            }
            item_indent = Some(depth);
            let value = scalar(item).ok_or(UNREADABLE)?;
            items.push(Item { raw: item.trim_matches([' ', '\t']).to_string(), value, line: Some(at + 1 + offset) });
        }
        let form = if items.is_empty() { Form::Empty } else { Form::Block };
        return Ok(Field { form, line: Some(at), items });
    }
    // a deeper line after a one-line value continues it (YAML folds it in)
    if next.is_some_and(|l| indent(l) > 0 && !l.trim().is_empty()) {
        return Err(UNREADABLE);
    }
    if let Some(inner) = value.strip_prefix('[') {
        let inner = inner.strip_suffix(']').ok_or(UNREADABLE)?;
        let items = list_items(inner, true).ok_or(UNREADABLE)?;
        return Ok(Field { form: Form::Flow, line: Some(at), items });
    }
    let items = list_items(value, false).ok_or(UNREADABLE)?;
    Ok(Field { form: Form::Bare, line: Some(at), items })
}

/// The tags a note carries, as written (quotes removed), in order. A field
/// this reader can't follow reads as no tags.
pub(crate) fn tag_values(foreign: &[String]) -> Vec<String> {
    read_field(foreign).map(|field| field.items.into_iter().map(|item| item.value).collect()).unwrap_or_default()
}

/// May a whole-value writer (the Librarian's `set_ai_field`) replace this
/// note's `tags:` line? Not when its tags are a block list or a shape this
/// reader can't follow: replacing only the key line would leave the list's
/// item lines behind as text under the new value.
pub(crate) fn whole_value_replaceable(foreign: &[String]) -> Result<(), String> {
    match read_field(foreign)?.form {
        Form::Block => Err(UNREADABLE.into()),
        _ => Ok(()),
    }
}

fn folded(tag: &str) -> String {
    tag.to_lowercase()
}

/// The frontmatter lines with `add` (already normalized) added and every tag
/// matching one of `remove` (any case, as written on disk) taken off. Tags
/// already there keep their bytes. Ok(None) when nothing changes.
pub(crate) fn apply_change(foreign: &[String], add: &[String], remove: &[String]) -> Result<Option<Vec<String>>, String> {
    if add.len() + remove.len() > TAGS_PER_CHANGE_MAX {
        return Err(format!("one change adds or removes at most {TAGS_PER_CHANGE_MAX} tags"));
    }
    let field = read_field(foreign)?;
    let gone: Vec<String> = remove.iter().map(|t| folded(crate::frontmatter_keys::js_trim(t))).collect();
    let mut kept: Vec<Item> = field.items.iter().filter(|item| !gone.contains(&folded(&item.value))).cloned().collect();
    let removed = kept.len() != field.items.len();
    let mut added = Vec::new();
    for tag in add {
        if tag_refusal(tag).is_some() {
            return Err(format!("\"{}\" can't be a tag", printable(tag)));
        }
        if !kept.iter().chain(added.iter()).any(|item: &Item| folded(&item.value) == folded(tag)) {
            added.push(Item { raw: tag.clone(), value: tag.clone(), line: None });
        }
    }
    if !removed && added.is_empty() {
        return Ok(None);
    }
    if kept.len() + added.len() > TAGS_PER_NOTE_MAX {
        return Err(format!("a note holds at most {TAGS_PER_NOTE_MAX} tags"));
    }
    let mut out: Vec<String> = Vec::with_capacity(foreign.len() + added.len());
    let flow = |items: &[Item]| format!("tags: [{}]", items.iter().map(|i| i.raw.as_str()).collect::<Vec<_>>().join(", "));
    match (field.form, field.line) {
        (Form::Block, Some(at)) if !kept.is_empty() || !added.is_empty() => {
            let item_lines: Vec<usize> = field.items.iter().filter_map(|i| i.line).collect();
            let last = *item_lines.last().unwrap_or(&at);
            let prefix: String = {
                let first = foreign[item_lines[0]].trim_end_matches('\r');
                first[..indent(first)].to_string()
            };
            let ending = if foreign[at].ends_with('\r') { "\r" } else { "" };
            let kept_lines: Vec<usize> = kept.iter().filter_map(|i| i.line).collect();
            for (index, line) in foreign.iter().enumerate() {
                if item_lines.contains(&index) && !kept_lines.contains(&index) {
                    // dropped item
                } else {
                    out.push(line.clone());
                }
                if index == last {
                    out.extend(added.iter().map(|item| format!("{prefix}- {}{ending}", item.raw)));
                }
            }
        }
        (Form::Absent, _) | (_, None) => {
            out.extend(foreign.iter().cloned());
            kept.extend(added);
            let ending = if foreign.last().is_some_and(|l| l.ends_with('\r')) { "\r" } else { "" };
            out.push(format!("{}{ending}", flow(&kept)));
        }
        (_, Some(at)) => {
            let item_lines: Vec<usize> = field.items.iter().filter_map(|i| i.line).collect();
            let ending = if foreign[at].ends_with('\r') { "\r" } else { "" };
            kept.extend(added);
            for (index, line) in foreign.iter().enumerate() {
                if index == at {
                    out.push(format!("{}{ending}", flow(&kept)));
                } else if !item_lines.contains(&index) {
                    out.push(line.clone());
                }
            }
        }
    }
    Ok(Some(out))
}

/// A note's whole frontmatter block (fences included, as
/// `raw_frontmatter_block` cuts it) with the change applied to its lines and
/// every other byte kept: the tags write touches only `tags:` lines, never the
/// typed facts a full recompose would fill in. Ok(None) when nothing changes.
pub(crate) fn apply_to_block(block: &str, add: &[String], remove: &[String]) -> Result<Option<String>, String> {
    let pieces: Vec<&str> = block.split_inclusive('\n').collect();
    let fence = |piece: &str| piece.trim_end_matches(['\n', '\r']) == "---";
    let (Some(head), Some(foot)) = (pieces.first(), pieces.last()) else {
        return Err(UNREADABLE.into());
    };
    if pieces.len() < 2 || !fence(head) || !fence(foot) {
        return Err(UNREADABLE.into());
    }
    let inner: Vec<String> =
        pieces[1..pieces.len() - 1].iter().map(|line| line.strip_suffix('\n').unwrap_or(line).to_string()).collect();
    Ok(apply_change(&inner, add, remove)?.map(|lines| {
        let body: String = lines.iter().map(|line| format!("{line}\n")).collect();
        format!("{head}{body}{foot}")
    }))
}

#[cfg(test)]
#[path = "note_tags_tests.rs"]
pub(crate) mod tests;
