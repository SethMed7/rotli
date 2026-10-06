//! Who may rewrite a note's BODY on an AI lane (2026-09-29,
//! docs/decisions/2026-09-29-ai-body-edit-permission.md). Two Rotli-owned
//! frontmatter keys decide it, beside `locked`:
//!
//! - `created_by`: stamped once when a chat, an external agent, or the
//!   Librarian creates a note. Absent — every note a person wrote, and every
//!   note from before this rule — means a person wrote it.
//! - `ai_edit`: the person's per-note grant, set only from the note's menu.
//!
//! A locked note refuses every AI. Otherwise `ai_edit: true` allows,
//! `ai_edit: false` refuses, and with no grant only an AI-made note is
//! editable. The Librarian's metadata fields and filing are not body edits;
//! they stay governed by `locked` and `secure` alone. The TypeScript twin is
//! src/lib/aiEditPolicy.ts, pinned by scripts/fixtures/parity.json.

/// The creators whose notes an AI may edit without a grant. Anything else —
/// including a value this build doesn't know — reads as person-written.
pub(crate) const AI_CREATORS: [&str; 3] = ["chat", "agent", "librarian"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Creator {
    Chat,
    Agent,
    Librarian,
}

impl Creator {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Creator::Chat => "chat",
            Creator::Agent => "agent",
            Creator::Librarian => "librarian",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Creator> {
        match value.trim() {
            "chat" => Some(Creator::Chat),
            "agent" => Some(Creator::Agent),
            "librarian" => Some(Creator::Librarian),
            _ => None,
        }
    }

    /// The frontmatter line a new note carries.
    pub(crate) fn line(self) -> String {
        format!("created_by: {}", self.as_str())
    }
}

/// The value of a `created_by:` line, if this is one.
pub(crate) fn created_by_field(line: &str) -> Option<&str> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "created_by").then(|| v.trim())
}

/// The value of an `ai_edit:` line, if this is one. Only a literal `true`
/// grants; a malformed value refuses.
pub(crate) fn ai_edit_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "ai_edit").then(|| v.trim() == "true")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BodyEdit {
    Allowed,
    Locked,
    /// No grant, and a person wrote the note.
    PersonWritten,
    /// The person turned AI editing off for this note.
    Revoked,
}

impl BodyEdit {
    /// The parity fixture's name for this verdict.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            BodyEdit::Allowed => "allowed",
            BodyEdit::Locked => "locked",
            BodyEdit::PersonWritten => "person-written",
            BodyEdit::Revoked => "revoked",
        }
    }

    /// The refusal a chat or agent sees. `None` when the edit may proceed.
    pub(crate) fn refusal(self) -> Option<&'static str> {
        match self {
            BodyEdit::Allowed => None,
            BodyEdit::Locked => {
                Some("This note is locked — no AI may edit it. Unlock it from the note's menu first.")
            }
            BodyEdit::PersonWritten => Some(
                "This note was written by the person, not by an AI, so no AI may rewrite it. They can turn on “Let AI edit” from the note's menu, or you can create a new note instead.",
            ),
            BodyEdit::Revoked => Some(
                "AI editing is turned off for this note. The person can turn “Let AI edit” back on from the note's menu, or you can create a new note instead.",
            ),
        }
    }
}

/// A consented insertion (2026-10-05, `/ai`): the person read the model's text
/// and chose Insert, so it may land in a note they wrote without the standing
/// grant. Their consent covers only the default — a deliberate `ai_edit:
/// false` still refuses, and a locked note refuses every AI.
pub(crate) fn consented_insert_refusal<S: AsRef<str>>(foreign: &[S]) -> Option<&'static str> {
    match body_edit(foreign) {
        BodyEdit::Allowed | BodyEdit::PersonWritten => None,
        verdict => verdict.refusal(),
    }
}

/// Whether `after` is `before` with exactly `text` inserted at one place —
/// nothing of the person's removed or changed. Byte-exact, on char
/// boundaries; an empty insertion is not one.
pub(crate) fn is_pure_insertion(before: &str, after: &str, text: &str) -> bool {
    if text.is_empty() || after.len() != before.len() + text.len() {
        return false;
    }
    let (b, a) = (before.as_bytes(), after.as_bytes());
    let prefix = b.iter().zip(a).take_while(|(x, y)| x == y).count();
    let suffix = b.iter().rev().zip(a.iter().rev()).take_while(|(x, y)| x == y).count();
    // the split point i satisfies before[..i] == after[..i] (i <= prefix) and
    // before[i..] == after[i + len..] (i >= before.len() - suffix)
    // any split in [low, prefix] already has both sides matching (the prefix
    // and suffix counts say so); only the middle must be the accepted text
    let low = before.len().saturating_sub(suffix);
    (low..=prefix.min(before.len())).any(|i| {
        before.is_char_boundary(i)
            && after.is_char_boundary(i)
            && after.is_char_boundary(i + text.len())
            && &after[i..i + text.len()] == text
    })
}

/// The one body-edit verdict, from a note's foreign frontmatter lines.
pub(crate) fn body_edit<S: AsRef<str>>(foreign: &[S]) -> BodyEdit {
    if foreign
        .iter()
        .any(|line| crate::corpus::locked_field(line.as_ref()) == Some(true))
    {
        return BodyEdit::Locked;
    }
    match foreign.iter().find_map(|line| ai_edit_field(line.as_ref())) {
        Some(true) => return BodyEdit::Allowed,
        Some(false) => return BodyEdit::Revoked,
        None => {}
    }
    let ai_made = foreign
        .iter()
        .find_map(|line| created_by_field(line.as_ref()))
        .is_some_and(|creator| AI_CREATORS.contains(&creator));
    if ai_made {
        BodyEdit::Allowed
    } else {
        BodyEdit::PersonWritten
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_note_without_provenance_is_person_written() {
        assert_eq!(body_edit(&["tags: []"]), BodyEdit::PersonWritten);
        assert_eq!(body_edit::<&str>(&[]), BodyEdit::PersonWritten);
    }

    #[test]
    fn ai_made_notes_are_editable_until_the_person_says_otherwise() {
        for creator in AI_CREATORS {
            let line = format!("created_by: {creator}");
            assert_eq!(body_edit(std::slice::from_ref(&line)), BodyEdit::Allowed);
            assert_eq!(
                body_edit(&[line, "ai_edit: false".into()]),
                BodyEdit::Revoked
            );
        }
    }

    #[test]
    fn locked_beats_every_grant() {
        assert_eq!(
            body_edit(&["created_by: chat", "ai_edit: true", "locked: true"]),
            BodyEdit::Locked
        );
    }

    #[test]
    fn a_grant_opens_a_person_written_note_and_a_bad_value_refuses() {
        assert_eq!(body_edit(&["ai_edit: true"]), BodyEdit::Allowed);
        assert_eq!(body_edit(&["ai_edit: yes"]), BodyEdit::Revoked);
        assert_eq!(
            body_edit(&["created_by: someone-else"]),
            BodyEdit::PersonWritten
        );
    }

    #[test]
    fn creator_round_trips_its_line() {
        for creator in [Creator::Chat, Creator::Agent, Creator::Librarian] {
            let line = creator.line();
            assert_eq!(created_by_field(&line).and_then(Creator::parse), Some(creator));
        }
    }

    #[test]
    fn a_consented_insertion_lands_in_a_person_written_note_but_never_past_a_no() {
        assert_eq!(consented_insert_refusal(&["tags: []"]), None);
        assert_eq!(consented_insert_refusal(&["created_by: chat"]), None);
        assert_eq!(consented_insert_refusal(&["ai_edit: true"]), None);
        assert!(consented_insert_refusal(&["ai_edit: false"]).is_some());
        assert!(consented_insert_refusal(&["locked: true", "ai_edit: true"]).is_some());
    }

    #[test]
    fn only_a_pure_insertion_of_the_accepted_text_counts() {
        let before = "# Note\n\nOne.\nTwo.\n";
        // at the start, in the middle, at the end
        assert!(is_pure_insertion(before, &format!("X\n{before}"), "X\n"));
        assert!(is_pure_insertion(before, "# Note\n\nOne.\nNEW\nTwo.\n", "NEW\n"));
        assert!(is_pure_insertion(before, &format!("{before}tail"), "tail"));
        // text that repeats what follows the caret still finds its place
        assert!(is_pure_insertion("aaa", "aaaa", "a"));
        // a deletion, a replacement, a different text, an empty insertion
        assert!(!is_pure_insertion(before, "# Note\n\nTwo.\n", "One.\n"));
        assert!(!is_pure_insertion(before, "# Note\n\nOne!\nNEW\nTwo.\n", "NEW\n"));
        assert!(!is_pure_insertion(before, "# Note\n\nOne.\nNEW\nTwo.\n", "OLD\n"));
        assert!(!is_pure_insertion(before, before, ""));
        // multi-byte text around and inside the insertion
        assert!(is_pure_insertion("café ☕", "café → ☕", "→ "));
        // a long run of the same character stays linear and still finds its place
        let run = "\n".repeat(50_000);
        assert!(is_pure_insertion(&run, &format!("{run}\n"), "\n"));
        // the split falls between characters, never inside one
        assert!(is_pure_insertion("éé", "ééé", "é"));
        assert!(!is_pure_insertion("éé", "éxé", "é"));
    }
}
