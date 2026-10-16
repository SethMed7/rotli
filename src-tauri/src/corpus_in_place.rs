// Minimal writes for a folder opened in place (Obsidian, ZenNotes, plain
// Markdown). Owner rule 2026-10-13, decision B: Rotli changes only what the
// person asked for there. Their frontmatter lines stay byte-for-byte, Rotli's
// own facts (id, created, updated) are never minted, and a fence is added only
// to hold a line the person asked for (docs/design/
// vault-copy-and-obsidian-compatibility.md).

use super::{parse_document, raw_frontmatter_block, Frontmatter};

/// A note Rotli itself made carries a ULID `id` (every create path mints one).
/// Anything else in a folder opened in place is the person's own note, which
/// Rotli never renames or stamps. Obsidian ids (timestamps, slugs) are not
/// ULIDs, so they stay the person's.
pub(crate) fn rotli_made(fm: &Frontmatter) -> bool {
    fm.id
        .as_deref()
        .is_some_and(|id| ulid::Ulid::from_string(id).is_ok())
}

/// Set (`Some`) or remove (`None`) one top-level frontmatter line, keeping
/// every other byte. A fence is added only to hold a new line, and goes when
/// removal leaves it empty. Keys are matched untrimmed: an indented line
/// belongs to a nested map, not to the top level.
pub(crate) fn with_top_level_line(text: &str, key: &str, value: Option<&str>) -> String {
    let block = raw_frontmatter_block(text);
    let body = &text[block.len()..];
    let nl = if block.contains("\r\n") || (block.is_empty() && text.contains("\r\n")) {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<String> = block.lines().map(str::to_string).collect();
    if !lines.is_empty() {
        lines.remove(0); // opening ---
        lines.pop(); // closing ---
    }
    let is_key = |line: &str| line.split_once(':').is_some_and(|(k, _)| k == key);
    let at = lines.iter().position(|line| is_key(line));
    lines.retain(|line| !is_key(line));
    if let Some(value) = value {
        let line = format!("{key}: {value}");
        // a replaced line keeps its place; a new one goes last
        match at {
            Some(i) => lines.insert(i.min(lines.len()), line),
            None => lines.push(line),
        }
    }
    if lines.is_empty() {
        return body.to_string();
    }
    format!("---{nl}{}{nl}---{nl}{body}", lines.join(nl))
}

/// Add or remove only the secure lines (removal also drops the local-AI
/// override and the secure-origin breadcrumb).
pub(crate) fn with_secure_line_only(text: &str, secure: bool) -> String {
    if secure {
        return with_top_level_line(text, "secure", Some("true"));
    }
    let text = with_top_level_line(text, "secure", None);
    let text = with_top_level_line(&text, "local_ai_allowed", None);
    with_top_level_line(&text, "secure_origin", None)
}

/// What a metadata change looks like in a folder opened in place: compare the
/// note's frontmatter before (`original`) with the one a Rotli action built
/// (`next`), and apply only the keys that differ. `id`, `created`, and
/// `updated` are Rotli's own facts and are never written here.
pub(crate) fn compose_in_place(original: &str, next: &Frontmatter) -> String {
    let before = parse_document(original).0.unwrap_or_default();
    let key_of = |line: &str| line.split_once(':').map(|(k, _)| k.to_string());
    let value_of = |lines: &[String], key: &str| {
        lines
            .iter()
            .rev()
            .find(|line| key_of(line).as_deref() == Some(key))
            .and_then(|line| line.split_once(':').map(|(_, v)| v.trim().to_string()))
    };
    let mut keys: Vec<String> = Vec::new();
    for line in before.foreign.iter().chain(next.foreign.iter()) {
        if let Some(key) = key_of(line) {
            if !key.starts_with(' ') && !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    let mut text = original.to_string();
    for key in keys {
        let old = value_of(&before.foreign, &key);
        let new = value_of(&next.foreign, &key);
        if old != new {
            text = with_top_level_line(&text, &key, new.as_deref());
        }
    }
    if before.pinned.unwrap_or(false) != next.pinned.unwrap_or(false) {
        text = with_top_level_line(&text, "pinned", next.pinned.unwrap_or(false).then_some("true"));
    }
    if before.origin != next.origin {
        text = with_top_level_line(&text, "origin", next.origin.as_deref());
    }
    text
}
