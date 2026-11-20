//! How Rotli removes a key from a note's frontmatter lines before writing its
//! own line: every writer of a key goes through here, so a key is replaced as
//! a whole (its line, the lines indented under it, a `? key`'s `: value`
//! line) and never by deleting text inside a block scalar (`example: |`).
//! TypeScript's twin is src/lib/frontmatterWrites.ts (Codex review of PR
//! #303, items 1, 2 and 4).

use super::{frontmatter_field, is_js_space, names_key, top_level_key, PERMISSION_KEYS};

/// Keys read in any spelling that protect a note (`locked`, `secure`) besides
/// the permission keys: their writers remove every spelling too, so a writer
/// and the reader agree on which lines count.
pub(crate) const PROTECTION_KEYS: [&str; 2] = ["locked", "secure"];

/// Whether `key` is read in any spelling (a permission or protection key).
pub(crate) fn read_in_any_spelling(key: &str) -> bool {
    PERMISSION_KEYS.contains(&key) || PROTECTION_KEYS.contains(&key)
}

fn indent(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').count()
}

fn blank(line: &str) -> bool {
    line.trim_matches(is_js_space).is_empty()
}

/// Whether a line opens a block scalar (`key: |`, `key: >-`, `- |2`).
fn opens_block_scalar(line: &str) -> bool {
    let value = match frontmatter_field(line) {
        Some((_, value)) => value,
        None => match line.trim_start_matches([' ', '\t']).strip_prefix("- ") {
            Some(rest) => rest.trim(),
            None => return false,
        },
    };
    let value = value.split(" #").next().unwrap_or_default().trim();
    let mut chars = value.chars();
    matches!(chars.next(), Some('|' | '>')) && chars.all(|c| c.is_ascii_digit() || c == '+' || c == '-')
}

/// For each line, whether it is a block scalar's text (never a key).
pub(crate) fn block_scalar_text(lines: &[String]) -> Vec<bool> {
    let mut text = vec![false; lines.len()];
    let mut at = 0;
    while at < lines.len() {
        if opens_block_scalar(&lines[at]) {
            let header = indent(&lines[at]);
            let mut next = at + 1;
            while next < lines.len() && (blank(&lines[next]) || indent(&lines[next]) > header) {
                text[next] = true;
                next += 1;
            }
            at = next;
        } else {
            at += 1;
        }
    }
    text
}

/// Whether line `at` sets `key`: in any spelling for a key read in any
/// spelling, otherwise in a top-level one-line spelling; never block text.
fn sets_key(lines: &[String], text: &[bool], at: usize, key: &str) -> bool {
    !text[at]
        && if read_in_any_spelling(key) {
            names_key(&lines[at], key)
        } else {
            top_level_key(&lines[at]).as_deref() == Some(key)
        }
}

/// The end (exclusive) of the key/value span that starts at line `at`: the
/// lines indented deeper than the key itself, and after `? key` its
/// `: value` line at the same indent.
fn span_end(lines: &[String], at: usize) -> usize {
    let line = &lines[at];
    let dash = line.trim_start_matches([' ', '\t']).starts_with("- ");
    let column = indent(line) + if dash { 2 } else { 0 };
    let explicit = line.trim_start_matches([' ', '\t']).starts_with("? ");
    let (mut end, mut next, mut took_value) = (at + 1, at + 1, false);
    while next < lines.len() {
        let candidate = &lines[next];
        if blank(candidate) {
            next += 1;
        } else if indent(candidate) > column {
            next += 1;
            end = next;
        } else if explicit && !took_value && indent(candidate) == column && candidate.trim_start().starts_with(':') {
            took_value = true;
            next += 1;
            end = next;
        } else {
            break;
        }
    }
    end
}

/// Every line of every span that sets `key`, in order (to compare and to copy).
pub(crate) fn key_lines(lines: &[String], key: &str) -> Vec<String> {
    let text = block_scalar_text(lines);
    let mut out = Vec::new();
    let mut at = 0;
    while at < lines.len() {
        if sets_key(lines, &text, at, key) {
            let end = span_end(lines, at);
            out.extend(lines[at..end].iter().cloned());
            at = end;
        } else {
            at += 1;
        }
    }
    out
}

/// Remove every span that sets `key`; the index where the first one began.
/// A list item's first key going (`- ai_edit: false`) hands its dash to the
/// item's next key, so the item's other keys stay in it.
pub(crate) fn remove_key(lines: &mut Vec<String>, key: &str) -> Option<usize> {
    let mut first = None;
    let mut at = 0;
    loop {
        let text = block_scalar_text(lines);
        let Some(start) = (at..lines.len()).find(|&i| sets_key(lines, &text, i, key)) else { return first };
        let end = span_end(lines, start);
        let dash_at = indent(&lines[start]);
        let dash = lines[start][dash_at..].starts_with("- ");
        lines.drain(start..end);
        if dash {
            if let Some(sibling) = lines.get_mut(start).filter(|l| !blank(l) && indent(l) == dash_at + 2) {
                sibling.replace_range(dash_at..dash_at + 2, "- ");
            }
        }
        first.get_or_insert(start);
        at = start;
    }
}

/// A generic metadata write's key and value, checked (Codex review of PR
/// #303, item 1): each one line, the key without a colon, and the key as YAML
/// reads it (`"ai_edit"` is ai_edit) none of `refused`. The name to replace.
pub(crate) fn field_name(key: &str, value: &str, refused: &[&str]) -> Result<String, String> {
    if key.contains(['\n', '\r', ':']) || value.contains(['\n', '\r']) || key.starts_with(['{', '[', '&', '*', '!', '|', '>', '%', '@', '`', '#', ',', '?', '-']) {
        return Err("a field's name and value are one line each, and a name has no colon and doesn't start with a YAML sign".into());
    }
    let name = frontmatter_field(&format!("{key}: x")).map_or_else(|| key.to_string(), |(spelled, _)| spelled.name);
    if refused.contains(&name.as_str()) || refused.contains(&key) || read_in_any_spelling(&name) {
        return Err(format!("`{name}` is managed by rotli, not editable here"));
    }
    Ok(name)
}

/// A generic write's frontmatter change: `name`'s spans go, and `key: value`
/// (the key as typed) is added unless the value is empty.
pub(crate) fn put_field(foreign: &mut Vec<String>, name: &str, key: &str, value: &str) {
    remove_key(foreign, name);
    let value = value.trim();
    if !value.is_empty() {
        foreign.push(format!("{key}: {value}"));
    }
}

/// Refuse a generic write that changes any line of a Rotli-managed key,
/// whatever was typed (Codex review of PR #303, item 1).
pub(crate) fn leaves_managed(before: &str, after: &str, managed: &[&str]) -> Result<(), String> {
    if lines_setting(before, managed) != lines_setting(after, managed) {
        return Err("that change would touch a field rotli manages".into());
    }
    keeps_other_verdicts(before, after, &[])
}

/// A setting's write checked both ways: `after` says what it promised, and
/// no setting outside `owned` reads differently than in `before`.
pub(crate) fn keeps(before: &str, after: &str, owned: &[&str], holds: impl Fn(&[String]) -> bool) -> Result<(), String> {
    keeps_promise(after, holds)?;
    keeps_other_verdicts(before, after, owned)
}

/// The frontmatter lines of `text` that set any of `keys` (Rotli's typed
/// facts aside, which a write carries itself), for checking that a write left
/// them byte for byte.
pub(crate) fn lines_setting(text: &str, keys: &[&str]) -> Vec<String> {
    let foreign = crate::corpus::parse_document(text).0.unwrap_or_default().foreign;
    keys.iter().flat_map(|key| key_lines(&foreign, key)).collect()
}

const UNSAFE: &str = "Rotli couldn't change this safely: the note's metadata has a line for a setting that Rotli can't read or won't remove (inside a block of text, for example). Edit the note's metadata by hand.";

/// Refuse a write whose result doesn't say what the setter promised: a line
/// for the setting Rotli can't safely remove (inside a text block) would
/// otherwise outlive the person's choice.
pub(crate) fn keeps_promise(text: &str, holds: impl Fn(&[String]) -> bool) -> Result<(), String> {
    let foreign = crate::corpus::parse_document(text).0.unwrap_or_default().foreign;
    if holds(&foreign) {
        Ok(())
    } else {
        Err(UNSAFE.into())
    }
}

/// The settings a note's metadata decides, and how each reads now.
const VERDICTS: [&str; 5] = ["created_by", "ai_edit", "local_ai_allowed", "locked", "secure"];

fn verdict(foreign: &[String], key: &str) -> String {
    match key {
        "locked" => foreign.iter().any(|l| crate::corpus::locked_field(l) == Some(true)).to_string(),
        "secure" => foreign.iter().any(|l| crate::corpus::secure_field(l) == Some(true)).to_string(),
        "created_by" => format!("{:?}", super::owned_key(foreign, key, |v| crate::ai_edit_policy::AI_CREATORS.contains(&v))),
        _ => format!("{:?}", super::owned_key(foreign, key, |v| v == "true")),
    }
}

/// Refuse a write that changes how any setting it doesn't own reads: a
/// generic edit, or one setting's write, never erases another's denial
/// (Codex review of PR #303, second round).
pub(crate) fn keeps_other_verdicts(before: &str, after: &str, owned: &[&str]) -> Result<(), String> {
    let read = |text: &str| crate::corpus::parse_document(text).0.unwrap_or_default().foreign;
    let (before, after) = (read(before), read(after));
    match VERDICTS.iter().find(|key| !owned.contains(key) && verdict(&before, key) != verdict(&after, key)) {
        None => Ok(()),
        Some(_) => Err(UNSAFE.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(text: &str) -> Vec<String> {
        text.split('\n').map(str::to_string).collect()
    }

    #[test]
    fn a_key_goes_with_its_span_and_never_from_block_text() {
        let mut fm = lines("example: |\n  ai_edit: false\ntags: [a]\nai_edit:\n  - nested\n? ai_edit\n: false\nitems:\n- ai_edit: false\n  other: x");
        assert_eq!(key_lines(&fm, "ai_edit"), ["ai_edit:", "  - nested", "? ai_edit", ": false", "- ai_edit: false"]);
        assert_eq!(remove_key(&mut fm, "ai_edit"), Some(3));
        assert_eq!(fm, lines("example: |\n  ai_edit: false\ntags: [a]\nitems:\n- other: x"));
    }

    /// Codex review of PR #303, blocker 1: a generic write checks the key as
    /// YAML reads it, and a newline never writes a second line (the filer's
    /// `set_ai_field` takes this check too).
    #[test]
    fn a_generic_write_is_one_line_of_a_key_rotli_does_not_manage() {
        for (key, value) in [("'created_by'", "agent"), ("\"local_ai_allowed\"", "true"), ("tags", "[a]\rlocked: false"), ("area", "b\ncreated_by: agent"), ("x:y", "z"), ("\"locked\"", "false")] {
            assert!(field_name(key, value, &["reserved_here"]).is_err(), "{key:?} {value:?}");
        }
        assert_eq!(field_name("'mood'", "calm", &[]), Ok("mood".to_string()));
        assert!(field_name("mood", "calm", &["mood"]).is_err());
    }

    #[test]
    fn a_plain_key_is_matched_only_at_the_top_level() {
        let mut fm = lines("date created : 2020\nmeta:\n  date created: inner");
        assert_eq!(remove_key(&mut fm, "date created"), Some(0));
        assert_eq!(fm, lines("meta:\n  date created: inner"));
    }
}
