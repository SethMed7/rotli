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
    (c < ' ' && c != '\t' && c != '\n') || ('\u{7f}'..='\u{9f}').contains(&c) || matches!(c, '\u{feff}' | '\u{2028}' | '\u{2029}')
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

/// What one read of a frontmatter block found: every root key's values as
/// source text (`\0` for a list, a map or an alias), or a refusal that holds
/// for every key (more than one document, nesting past the cap, an alias or
/// a merge key as a root key). One read answers all five settings.
#[derive(Clone)]
enum Root {
    Keys(std::collections::HashMap<String, Vec<String>>),
    Refused,
}

/// One pass over the parser's events: None when the text won't parse.
fn read_root(block: &str) -> Option<Root> {
    let mut parser = Parser::new_from_str(block);
    let (mut depth, mut deepest, mut documents) = (0usize, 0usize, 0usize);
    let mut root_is_map = false;
    let mut at_key = true;
    let mut current: Option<String> = None;
    let mut alias_key = false;
    let mut keys: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
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
                // an alias as a root key, or a merge key (`<<`), could carry
                // any key: refused
                alias_key |= matches!(event, Event::Alias(_)) || text.as_deref() == Some("<<");
                current = text;
            } else if let Some(key) = current.take() {
                keys.entry(key).or_default().push(text.unwrap_or_else(|| "\u{0}".to_string()));
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
    Some(if documents > 1 || deepest > DECODE_MAX_DEPTH || alias_key { Root::Refused } else { Root::Keys(keys) })
}

/// A key a blanked line can spell plainly: no colon-space, comment, quote,
/// or leading YAML sign (so a flow map's `{s` or a quoted key keeps its line).
fn plain_safe(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['{', '[', '&', '*', '!', '|', '>', '%', '@', '`', '#', ',', '?', '-', '"', '\'', ' '])
        && !name.contains(": ")
        && !name.contains(" #")
        && !name.contains(['"', '\'', '\t'])
        && !name.ends_with(':')
}

/// A top-level line of a key other than a permission key, with its value
/// dropped (`summary: Plan: phase two` → `summary:`, `date created:\t2024`
/// → `date created:`); every other line as it is. Values people and the
/// organizer type unquoted are the only tolerance unreadable frontmatter gets.
fn blank_value(line: &str) -> Option<String> {
    // never a line holding a character some parser reads as a line break (a
    // lone CR, U+0085, U+2028/9): blanking would drop the key after it
    // (`x: 1\rsecure: true`); nor a lock or secure line, whose own value
    // decides it (review of PR #303 at e06d292e, items 2 and 3)
    if line.chars().any(undecidable) {
        return None;
    }
    let (name, _) = super::top_level_field(line)?;
    (plain_safe(&name) && !super::read_in_any_spelling(&name)).then(|| format!("{name}:"))
}

/// The most `- ` / `? ` markers starting one line (`- - - a` nests a list per
/// marker without a bracket), counted before any parse, as `[`/`{` are.
fn marker_depth(line: &str) -> usize {
    let mut rest = line.trim_start_matches([' ', '\t']);
    let mut depth = 0;
    while let Some(after) = rest.strip_prefix("- ").or_else(|| rest.strip_prefix("? ")) {
        depth += 1;
        rest = after.trim_start_matches([' ', '\t']);
    }
    depth
}

/// The value of `key` in the root mapping. Before any parse: over budget, a
/// `...` line (a document end the two parsers read differently), or a tab the
/// parsers disagree on is refused, except that a top-level plain key's line
/// holding a tab is blanked. Frontmatter that won't parse is read once more
/// with the values of top-level non-permission keys blanked; still unreadable,
/// it is refused. TypeScript's twin: `decodedValue`.
pub(super) fn decoded_value<S: AsRef<str>>(fields: &[S], key: &str) -> Decoded {
    let lines: Vec<&str> = fields.iter().map(|line| line.as_ref().trim_end_matches('\r')).collect();
    let block = lines.join("\n");
    match read_block_once(&block, &lines) {
        Root::Refused => Decoded::Refused,
        Root::Keys(keys) => match keys.get(key).map(Vec::as_slice) {
            None => Decoded::Value(None),
            Some([value]) => Decoded::Value(Some(value.clone())),
            Some(_) => Decoded::Refused, // the key twice
        },
    }
}

thread_local! {
    /// The last block read and what it held: a note's five settings read it
    /// once, not once each (review of PR #303 at e06d292e, item 5).
    static LAST: std::cell::RefCell<Option<(String, Root)>> = const { std::cell::RefCell::new(None) };
}

fn read_block_once(block: &str, lines: &[&str]) -> Root {
    if let Some(root) = LAST.with(|last| last.borrow().as_ref().filter(|(seen, _)| seen == block).map(|(_, root)| root.clone())) {
        return root;
    }
    let root = read_block(block, lines);
    LAST.with(|last| *last.borrow_mut() = Some((block.to_string(), root.clone())));
    root
}

/// The block read as YAML, before any parse refusing what is over budget, a
/// `...` line, or a tab the parsers disagree on (a top-level plain key's line
/// holding a tab is blanked); then read once more with top-level
/// non-permission values blanked if it won't parse.
fn read_block(block: &str, lines: &[&str]) -> Root {
    if block.len() > DECODE_MAX_BYTES
        || bracket_depth(block) > DECODE_MAX_DEPTH
        || lines.iter().any(|line| marker_depth(line) > DECODE_MAX_DEPTH || line.trim_end() == "...")
    {
        return Root::Refused;
    }
    let mut first = Vec::with_capacity(lines.len());
    for line in lines {
        if line.contains('\t') {
            match blank_value(line) {
                Some(blanked) => first.push(blanked),
                None => return Root::Refused,
            }
        } else {
            first.push(line.to_string());
        }
    }
    let first = first.join("\n");
    if !first.chars().any(undecidable) {
        if let Some(root) = read_root(&first) {
            return root;
        }
    }
    let blanked = lines.iter().map(|line| blank_value(line).unwrap_or_else(|| line.to_string())).collect::<Vec<_>>().join("\n");
    if blanked.chars().any(undecidable) || blanked.contains('\t') {
        return Root::Refused;
    }
    read_root(&blanked).unwrap_or(Root::Refused)
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
