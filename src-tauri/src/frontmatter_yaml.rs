//! How Rust reads one permission key out of a note's frontmatter as YAML,
//! for `frontmatter_keys::owned_key`. TypeScript's twin is
//! src/lib/frontmatterYaml.ts; scripts/fixtures/parity.json
//! (`aiBodyEditCases`, `localAiAllowedCases`) holds the two to one verdict.
//!
//! The frontmatter is any file's, so nothing here builds a YAML tree: the
//! parser's events are walked once, iteratively, and only the root mapping's
//! keys are read. Key identity is "a scalar whose text is the key"; a repeat
//! is counted for the one key asked about and nothing else, so neither
//! library's own duplicate or number rules decide anything (Codex review of
//! PR #303, items 3, 5 and 6).

use yaml_rust2::parser::Parser;
use yaml_rust2::Event;

/// The most frontmatter read, in UTF-8 bytes, and the deepest nesting
/// accepted; past either the frontmatter is refused, which denies.
pub(super) const DECODE_MAX_BYTES: usize = 64 * 1024;
pub(super) const DECODE_MAX_DEPTH: usize = 64;
/// The longest quoted key decoded on its own line. The longest escaped
/// spelling of a permission key (`\U0000005f` for each of 16 characters) is
/// 160 bytes; a longer quoted key can't be one, and isn't parsed.
pub(super) const QUOTED_KEY_MAX_BYTES: usize = 256;

/// Characters the two YAML parsers (yaml-rust2 here, `yaml` in TypeScript)
/// could read differently: C0 and C1 controls other than tab and the line
/// feed between lines, and U+FEFF.
pub(super) fn undecidable(c: char) -> bool {
    (c < ' ' && c != '\t' && c != '\n') || ('\u{7f}'..='\u{9f}').contains(&c) || c == '\u{feff}'
}

/// What the frontmatter, read as YAML, says about one key.
#[derive(Debug, PartialEq)]
pub(super) enum Decoded {
    /// The key's value in the root mapping as its source text (a scalar's
    /// text; `\0` for a list, a map, or an alias), None when absent.
    Value(Option<String>),
    /// Over budget, an alias as a root key, the key twice, more than one
    /// document, an undecidable character, or unreadable even with the values
    /// of plain keys blanked: nothing can be decided, so it denies.
    Refused,
}

/// The deepest `[`/`{` nesting in the text, counted without regard to YAML
/// (quotes included), so both runtimes bound a parser before it runs.
fn bracket_depth(text: &str) -> usize {
    let (mut depth, mut deepest) = (0usize, 0usize);
    for c in text.chars() {
        match c {
            '[' | '{' => {
                depth += 1;
                deepest = deepest.max(depth);
            }
            ']' | '}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    deepest
}

/// One pass over the parser's events: None when the text won't parse.
fn read_root(block: &str, key: &str) -> Option<Decoded> {
    let mut parser = Parser::new_from_str(block);
    let (mut depth, mut deepest, mut documents) = (0usize, 0usize, 0usize);
    let mut root_is_map = false;
    let mut at_key = true;
    let mut ours = false;
    let mut alias_key = false;
    let mut found: Vec<String> = Vec::new();
    loop {
        let (event, _) = parser.next_token().ok()?;
        // a node that starts directly inside the root mapping is its key or
        // its value, alternately
        let top = depth == 1 && root_is_map;
        let text = match &event {
            Event::Scalar(text, ..) => Some(text.clone()),
            _ => None,
        };
        let starts_node = matches!(event, Event::Scalar(..) | Event::Alias(_) | Event::SequenceStart(..) | Event::MappingStart(..));
        if top && starts_node {
            if at_key {
                alias_key |= matches!(event, Event::Alias(_));
                ours = text.as_deref() == Some(key);
            } else if ours {
                found.push(text.unwrap_or_else(|| "\u{0}".to_string()));
            }
            at_key = !at_key;
        }
        match event {
            Event::StreamEnd => break,
            Event::DocumentStart => documents += 1,
            Event::SequenceStart(..) | Event::MappingStart(..) => {
                if depth == 0 {
                    root_is_map = matches!(event, Event::MappingStart(..));
                }
                depth += 1;
                deepest = deepest.max(depth);
            }
            Event::SequenceEnd | Event::MappingEnd => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    Some(if documents > 1 || deepest > DECODE_MAX_DEPTH || alias_key || found.len() > 1 {
        Decoded::Refused
    } else {
        Decoded::Value(found.pop())
    })
}

/// A key of letters, digits, `_`, `.` and `-` (never a flow map's `{s`).
fn plain_word(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_') && name.chars().all(|c| c.is_ascii_alphanumeric() || "_.-".contains(c))
}

/// A plain top-level line of a key other than a permission key, with its
/// value dropped (`summary: Plan: phase two` → `summary:`); every other line
/// as it is. The organizer writes `summary:` and `links:` unquoted, so this
/// is the only tolerance unreadable frontmatter gets.
fn blank_plain_value(line: &str) -> String {
    match super::frontmatter_field(line) {
        Some((spelled, _)) if spelled.canonical && plain_word(&spelled.name) && !super::PERMISSION_KEYS.contains(&spelled.name.as_str()) => format!("{}:", spelled.name),
        _ => line.to_string(),
    }
}

/// The value of `key` in the root mapping. Frontmatter that won't parse is
/// read once more with the values of plain non-permission keys blanked;
/// still unreadable, it is refused. TypeScript's twin: `decodedValue`.
pub(super) fn decoded_value<S: AsRef<str>>(fields: &[S], key: &str) -> Decoded {
    let lines: Vec<&str> = fields.iter().map(|line| line.as_ref().trim_end_matches('\r')).collect();
    let block = lines.join("\n");
    if block.len() > DECODE_MAX_BYTES || bracket_depth(&block) > DECODE_MAX_DEPTH {
        return Decoded::Refused;
    }
    if !block.chars().any(undecidable) {
        if let Some(decoded) = read_root(&block, key) {
            return decoded;
        }
    }
    let blanked = lines.iter().map(|line| blank_plain_value(line)).collect::<Vec<_>>().join("\n");
    if blanked.chars().any(undecidable) {
        return Decoded::Refused;
    }
    read_root(&blanked, key).unwrap_or(Decoded::Refused)
}

/// A quoted key's text as YAML decodes it (`"ai_edit"` is ai_edit);
/// None when it won't decode or is longer than [`QUOTED_KEY_MAX_BYTES`].
pub(super) fn decode_quoted_key(token: &str) -> Option<String> {
    if token.len() > QUOTED_KEY_MAX_BYTES {
        return None;
    }
    let mut parser = Parser::new_from_str(token);
    loop {
        match parser.next_token().ok()?.0 {
            Event::Scalar(text, ..) => return Some(text),
            Event::StreamEnd | Event::Alias(_) | Event::SequenceStart(..) | Event::MappingStart(..) => return None,
            _ => {}
        }
    }
}
