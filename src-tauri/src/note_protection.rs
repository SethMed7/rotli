//! A note's protection, read the way the app enforces it, and the one rule a
//! rewrite obeys: protection may tighten, never loosen (review 2026-11-20:
//! several writers replaced a note's text and silently dropped `locked`,
//! `secure` or a chat's `secureContext`). Each flag is read by the same reader
//! on both sides, so a line that comes back unchanged always passes, and only
//! a change in what the app would do counts as loosening.

use crate::ai_edit_policy::{body_edit, BodyEdit};
use crate::corpus::{locked_field, parse_document, secure_field};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Protection {
    pub(crate) locked: bool,
    pub(crate) secure: bool,
    pub(crate) secure_context: bool,
    /// `local_ai_allowed`: 0 denied, 1 follows the vault, 2 granted.
    local_ai: u8,
    /// Who may edit the body (`locked`, `ai_edit`, `created_by` decide).
    body_edit: BodyEdit,
}

pub(crate) fn protection(text: &str) -> Protection {
    let fm = parse_document(text).0.unwrap_or_default();
    let foreign = &fm.foreign;
    Protection {
        locked: foreign.iter().any(|l| locked_field(l) == Some(true)),
        secure: foreign.iter().any(|l| secure_field(l) == Some(true)),
        secure_context: crate::protection_mark::marked(text, "secureContext"),
        local_ai: match crate::frontmatter_keys::local_ai_allowed(foreign) {
            Some(false) => 0,
            None => 1,
            Some(true) => 2,
        },
        body_edit: body_edit(foreign),
    }
}

/// The protections `new` gives up that `old` had, by key.
pub(crate) fn loosened(old: &str, new: &str) -> Vec<&'static str> {
    let (a, b) = (protection(old), protection(new));
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
    if b.body_edit == BodyEdit::Allowed && a.body_edit != BodyEdit::Allowed {
        out.push("ai_edit");
    }
    out
}

/// Refuse a rewrite of a note (`old` → `new`) that loosens its protection.
/// `old` is "" for a file that doesn't exist yet.
pub(crate) fn require_not_looser(old: &str, new: &str) -> Result<(), String> {
    let keys = loosened(old, new);
    if keys.is_empty() {
        return Ok(());
    }
    Err(format!(
        "refused: this write would remove the note's protection ({}); change it from the note's own controls",
        keys.join(", ")
    ))
}

/// `next` with every protection `old` had put back, through `set_line(text,
/// key, value)`, the writer's own frontmatter edit: what a chat rewrite does,
/// so a re-save keeps its flags and denials (review 2026-11-20). A new grant
/// `old` never had is left for `require_not_looser` to refuse.
pub(crate) fn keep_protection(old: &str, next: &str, set_line: fn(&str, &str, &str) -> String) -> String {
    let had = protection(old);
    let mut out = next.to_string();
    let restores: [(fn(&Protection, &Protection) -> bool, &str, &str); 5] = [
        (|had, now| had.secure_context && !now.secure_context, "secureContext", "true"),
        (|had, now| had.secure && !now.secure, "secure", "true"),
        (|had, now| had.locked && !now.locked, "locked", "true"),
        (|had, now| had.local_ai == 0 && now.local_ai != 0, "local_ai_allowed", "false"),
        (
            |had, now| had.body_edit == BodyEdit::Revoked && now.body_edit == BodyEdit::Allowed,
            "ai_edit",
            "false",
        ),
    ];
    for (lost, key, value) in restores {
        if lost(&had, &protection(&out)) {
            out = set_line(&out, key, value);
        }
    }
    out
}

/// Is `path` a note or a board, the files whose text carries protection?
pub(crate) fn is_note_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("excalidraw"))
}

/// The file save lane (`corpus_write_file_bytes`) is for sheets, documents
/// and other binaries. A note or a board carries its protection in its own
/// text, and a raw overwrite dropped `locked`/`secure` without asking (review
/// 2026-11-20), so those save through their own writers.
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
