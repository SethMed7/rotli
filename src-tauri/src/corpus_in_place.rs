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
/// removal leaves it empty.
pub(crate) fn with_top_level_line(text: &str, key: &str, value: Option<&str>) -> String {
    let lines: Vec<String> = value.map(|value| vec![format!("{key}: {value}")]).unwrap_or_default();
    with_key_lines(text, key, &lines)
}

/// Replace every span that sets `key` (frontmatter_writes.rs: its line, the
/// lines under it, never block text; a permission or protection key in any
/// spelling) with `replacement`, verbatim, where the first one was; a new key
/// goes last. Every other byte stays.
pub(crate) fn with_key_lines(text: &str, key: &str, replacement: &[String]) -> String {
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
    let at = crate::frontmatter_keys::remove_key(&mut lines, key).unwrap_or(lines.len());
    lines.splice(at..at, replacement.iter().cloned());
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
    // a key by its identity: a permission or protection key in any spelling,
    // any other in its one-line top-level spellings (`locked : false`,
    // `"locked": false` and the action's `locked: true` are one key)
    let identity = |line: &str| {
        crate::frontmatter_keys::frontmatter_field(line)
            .map(|(spelled, _)| spelled.name)
            .filter(|name| crate::frontmatter_keys::read_in_any_spelling(name))
            .or_else(|| crate::frontmatter_keys::top_level_key(line))
    };
    let mut keys: Vec<String> = Vec::new();
    for line in before.foreign.iter().chain(next.foreign.iter()) {
        if let Some(key) = identity(line) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }
    // a key whose lines differ takes the action's lines as the action wrote
    // them: never a line Rotli builds from a decoded value, so a typed
    // `"ai_edit": true` stays typed (and grants nothing), and a lock action's
    // `locked: true` replaces a `"locked": true` it compares equal to (Codex
    // review of PR #303, items 1 and 2)
    let mut text = original.to_string();
    for key in keys {
        let now = crate::frontmatter_keys::key_lines(&next.foreign, &key);
        if crate::frontmatter_keys::key_lines(&before.foreign, &key) != now {
            text = with_key_lines(&text, &key, &now);
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

/// Set (`Some`) or remove (`None`) a Rotli vault note's `view_tag` line,
/// recomposing its frontmatter (moved from corpus.rs; `views_write_unlocked`
/// guards the result like every frontmatter writer).
pub(crate) fn with_view_tag(text: &str, tag: Option<&str>) -> String {
    let (frontmatter, body) = parse_document(text);
    let mut frontmatter = frontmatter.unwrap_or_default();
    frontmatter.foreign.retain(|line| {
        line.split_once(':')
            .is_none_or(|(key, _)| key != key.trim() || key != "view_tag")
    });
    if let Some(tag) = tag {
        frontmatter.foreign.push(format!("view_tag: {tag}"));
    }
    super::compose_document(&frontmatter, body)
}
