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

/// Is this editor body exactly a chat-memory note Rotli wrote for
/// `chat_slug` (src/chatMemory/model.ts mergeChatMemory on an empty note)?
/// `# Title`, a blank line, `Notes from [[slug]].`, a blank line, then the
/// managed `## Conversation notes` section running to the end. Anything a
/// person added — another section, a changed line — fails the match.
pub(crate) fn is_chat_memory_shape(body: &str, chat_slug: &str) -> bool {
    let Some(rest) = body.strip_prefix("# ") else {
        return false;
    };
    let Some((title, rest)) = rest.split_once('\n') else {
        return false;
    };
    let expected = format!("\nNotes from [[{chat_slug}]].\n\n## Conversation notes");
    match rest.strip_prefix(expected.as_str()) {
        Some(section) => !title.trim().is_empty() && !section.contains("\n## "),
        None => false,
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
    fn only_rotlis_exact_memory_note_shape_matches() {
        let memory = "# Plan\n\nNotes from [[plan-chat]].\n\n## Conversation notes\n\n### Decisions\n- ship\n";
        assert!(is_chat_memory_shape(memory, "plan-chat"));
        assert!(!is_chat_memory_shape(memory, "another-chat"));
        let added = format!("{memory}\n## My own section\nmine\n");
        assert!(!is_chat_memory_shape(&added, "plan-chat"));
        let edited = memory.replace("# Plan\n\n", "# Plan\n\nMy intro.\n\n");
        assert!(!is_chat_memory_shape(&edited, "plan-chat"));
        assert!(!is_chat_memory_shape("# \n\nNotes from [[c]].\n\n## Conversation notes\n", "c"));
    }

    #[test]
    fn creator_round_trips_its_line() {
        for creator in [Creator::Chat, Creator::Agent, Creator::Librarian] {
            let line = creator.line();
            assert_eq!(created_by_field(&line).and_then(Creator::parse), Some(creator));
        }
    }
}
