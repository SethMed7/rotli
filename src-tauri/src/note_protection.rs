//! A note's protection, read the way the app enforces it, and the one rule a
//! rewrite obeys: protection may tighten, never loosen (review 2026-11-20:
//! several writers replaced a note's text and silently dropped `locked`,
//! `secure` or a chat's `secureContext`). Each flag is read by the same reader
//! on both sides, so a line that comes back unchanged always passes, and only
//! a change in what the app would do counts as loosening.

use crate::ai_edit_policy::{granted_edit, BodyEdit};
use crate::corpus::{locked_on, parse_document, secure_on};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Protection {
    pub(crate) locked: bool,
    pub(crate) secure: bool,
    pub(crate) secure_context: bool,
    /// `local_ai_allowed`: 0 denied, 1 follows the vault, 2 granted.
    local_ai: u8,
    /// Who may edit the body, by `ai_edit` and `created_by` alone (`locked`
    /// is its own flag above): 0 revoked, 1 person-written, 2 allowed. A
    /// revoked note is stricter than a person's: their consent to one `/ai`
    /// insertion never overrides a deliberate "no".
    body_edit: u8,
}

fn body_rank(foreign: &[String]) -> u8 {
    match granted_edit(foreign) {
        BodyEdit::Revoked | BodyEdit::Locked => 0,
        BodyEdit::PersonWritten => 1,
        BodyEdit::Allowed => 2,
    }
}

pub(crate) fn protection(text: &str) -> Protection {
    protection_read(text, false)
}

/// `chat`: a chat's taint stays fail-closed (an unclosed block reads marked),
/// where a note's unclosed `---` is a horizontal rule (self-review of 306).
fn protection_read(text: &str, chat: bool) -> Protection {
    let fm = parse_document(text).0.unwrap_or_default();
    let foreign = &fm.foreign;
    Protection {
        // the permission line rules (frontmatter_lines.rs), as every reader reads them
        locked: locked_on(foreign),
        secure: secure_on(foreign),
        secure_context: if chat {
            crate::protection_mark::marked(text, "secureContext")
        } else {
            crate::protection_mark::marked_in_closed_block(text, "secureContext")
        },
        local_ai: match crate::frontmatter_keys::local_ai_allowed(foreign) {
            Some(false) => 0,
            None => 1,
            Some(true) => 2,
        },
        body_edit: body_rank(foreign),
    }
}

/// The protections `new` gives up that `old` had, by key.
pub(crate) fn loosened(old: &str, new: &str) -> Vec<&'static str> {
    loosened_read(old, new, false)
}

fn loosened_read(old: &str, new: &str, chat: bool) -> Vec<&'static str> {
    let (a, b) = (protection_read(old, chat), protection_read(new, chat));
    let mut out = Vec::new();
    if a.locked && !b.locked {
        out.push("locked");
    }
    if a.secure && !b.secure {
        out.push("secure");
    }
    if a.secure_context && !b.secure_context {
        out.push("secureContext");
    }
    if b.local_ai > a.local_ai {
        out.push("local_ai_allowed");
    }
    if b.body_edit > a.body_edit {
        out.push("ai_edit");
    }
    out
}

/// Refuse a rewrite of a note (`old` → `new`) that loosens its protection.
/// `old` is "" for a file that doesn't exist yet.
pub(crate) fn require_not_looser(old: &str, new: &str) -> Result<(), String> {
    refuse_loosened(loosened(old, new))
}

/// `require_not_looser` reading the `secureContext` taint fail-closed, the
/// way the AI read gate does: for chat rewrites and every AI or agent write
/// (lane check of 306: a closed-block reading let a local-model edit strip a
/// marker the read gate honoured, opening the note to remote models).
pub(crate) fn require_not_looser_fail_closed(old: &str, new: &str) -> Result<(), String> {
    refuse_loosened(loosened_read(old, new, true))
}

/// A person's save in a Rotli vault rebuilds the metadata block. When the old
/// text had no block the parser sees but the marker reader saw a taint (a
/// leading blank line, an unclosed block), the taint rides into the new block,
/// so the save keeps it instead of being refused (lane check of 306).
pub(crate) fn with_unparsed_taint(existing: &str, had_fence: bool, mut foreign: Vec<String>) -> Vec<String> {
    if !had_fence && crate::protection_mark::marked(existing, "secureContext") {
        foreign.push("secureContext: true".into());
    }
    foreign
}

fn refuse_loosened(keys: Vec<&str>) -> Result<(), String> {
    if keys.is_empty() {
        return Ok(());
    }
    if keys == ["secureContext"] {
        // no control turns this mark off, so don't point at one
        return Err("refused: this note is marked as holding secure content (secureContext), and an edit never removes that mark".into());
    }
    Err(format!(
        "refused: this write would remove the note's protection ({}); change it from the note's own controls",
        keys.join(", ")
    ))
}

/// The keys a person can't loosen from the raw metadata editor either: the
/// ones only Rust writes, and the one-way chat taint. `locked` and `secure`
/// are the person's to type there (review 2026-11-20: a quoted
/// `"ai_edit": false` was dropped by the raw save).
pub(crate) fn require_owned_not_looser(old: &str, new: &str) -> Result<(), String> {
    let keys: Vec<&str> = loosened(old, new).into_iter().filter(|k| !matches!(*k, "locked" | "secure")).collect();
    if keys.is_empty() {
        return Ok(());
    }
    Err(format!("refused: this would remove the note's {} setting; use the note's own controls", keys.join(", ")))
}

/// A frontmatter key or value must stay on its one line: a line break (CR,
/// LF, U+0085, U+2028, U+2029) or other control character in it would write
/// extra metadata lines, `ai_edit: true` among them (review 2026-11-20: a
/// model's tag reached the Filer that way).
pub(crate) fn refuse_line_breaks(text: &str) -> Result<(), String> {
    // a tab breaks no line for any reader, and a hand-typed one must survive an undo
    if text.chars().any(|c| (c.is_control() && c != '\t') || crate::frontmatter_lines::is_break(c)) {
        return Err("refused: a metadata field can't hold a line break or control character".into());
    }
    Ok(())
}

/// A field editor's key and value: each on one line, and the key no spelling
/// of one `owned` by Rotli (`"ai_edit"` is `ai_edit`; review 2026-11-20).
pub(crate) fn refuse_field(key: &str, value: &str, owned: &[&str]) -> Result<(), String> {
    refuse_line_breaks(&format!("{key}{value}"))?;
    let name = crate::frontmatter_keys::frontmatter_field(&format!("{key}:")).map(|(k, _)| k.name);
    match name.filter(|n| owned.contains(&n.as_str())) {
        Some(name) => Err(format!("`{name}` is managed by {}, not editable here", crate::app_identity::product_name())),
        None => Ok(()),
    }
}

/// A setter's honest answer when another line still decides the key (an
/// indented one in a nested map, which setters never touch): nothing is
/// written and the person is told why (review 2026-11-20).
pub(crate) fn took(took: bool, key: &str) -> Result<(), String> {
    took.then_some(()).ok_or_else(|| {
        format!("another `{key}:` line in this note's metadata still decides it; change it in Show file metadata")
    })
}

/// A frontmatter line a setter may replace: a top-level one. An indented line
/// belongs to a block scalar or a nested map, which no setter touches.
pub(crate) fn top_level(line: &str) -> bool {
    !line.starts_with([' ', '\t'])
}

/// One protection a rewrite may have lost: did it (`had`, `now`), and the
/// line that puts it back.
type Restore = (fn(&Protection, &Protection) -> bool, &'static str, &'static str);

/// `next` with every protection `old` had put back, through `set_line(text,
/// key, value)`, the writer's own frontmatter edit: what a chat rewrite does,
/// so a re-save keeps its flags and denials (review 2026-11-20). A new grant
/// `old` never had is left for `require_not_looser` to refuse.
pub(crate) fn keep_protection(old: &str, next: &str, set_line: fn(&str, &str, &str) -> String) -> String {
    let had = protection_read(old, true);
    let mut out = next.to_string();
    let restores: [Restore; 5] = [
        (|had, now| had.secure_context && !now.secure_context, "secureContext", "true"),
        (|had, now| had.secure && !now.secure, "secure", "true"),
        (|had, now| had.locked && !now.locked, "locked", "true"),
        (|had, now| had.local_ai == 0 && now.local_ai != 0, "local_ai_allowed", "false"),
        (
            |had, now| had.body_edit == 0 && now.body_edit > 0,
            "ai_edit",
            "false",
        ),
    ];
    for (lost, key, value) in restores {
        if lost(&had, &protection_read(&out, true)) {
            out = set_line(&out, key, value);
        }
    }
    out
}

/// Is `path` a note or a board, the files with writers of their own?
pub(crate) fn is_note_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("excalidraw"))
}

/// The file save lane (`corpus_write_file_bytes`) is for sheets, documents
/// and other binaries. A note carries its protection in its own frontmatter,
/// and a raw overwrite dropped `locked`/`secure` without asking (review
/// 2026-11-20). A board has no frontmatter (its protection comes from its path
/// or a secure keyword); it is refused here because it saves through
/// `corpus_write_board`, its own revision-checked writer.
pub(crate) fn refuse_note_bytes(rel: &str) -> Result<(), String> {
    if is_note_path(std::path::Path::new(rel)) {
        return Err(format!(
            "refused: the file save is not for notes or boards ({rel}); save it from its editor"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../scripts/fixtures/protection-rule.json")).unwrap()
    }

    #[test]
    fn every_case_of_the_shared_rule() {
        let fixture = fixture();
        for case in fixture["cases"].as_array().unwrap() {
            let text = |key: &str| case[key].as_str().unwrap();
            let want: Vec<&str> = case["loosened"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
            assert_eq!(loosened(text("old"), text("new")), want, "{}", text("name"));
            assert_eq!(require_not_looser(text("old"), text("new")).is_ok(), want.is_empty(), "{}", text("name"));
        }
    }

    #[test]
    fn every_note_path_case() {
        let fixture = fixture();
        for case in fixture["notePaths"].as_array().unwrap() {
            let path = case["path"].as_str().unwrap();
            let note = case["note"].as_bool().unwrap();
            assert_eq!(is_note_path(std::path::Path::new(path)), note, "{path}");
            assert_eq!(refuse_note_bytes(path).is_err(), note, "{path}");
        }
    }
}
