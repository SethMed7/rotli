//! The organizer's model prompts, as a type (third review of pull request
//! 267, 2026-11-09). The organizer sends a model what `run_cycle` hands its
//! transport, and a transport takes only a `ModelPrompt`. A `ModelPrompt` is
//! made only here, only from a `Cleared` note, and a `Cleared` note only by
//! `clear`: a snapshot read once through the checked open (`snapshot_note`,
//! which refuses a hard link) that is neither locked nor secure (flagged, in a
//! secure home, secret-shaped anywhere in the file, or secure by name). So a
//! prompt built from a note the policy refused does not compile.
//!
//! What else rides a prompt is gated the same way where it is made: an area's
//! description comes from its index note only when `clear` passes it
//! (`area_vocab`), and link candidates are the stems of cleared notes
//! (`list_peers`). The filing rules are the person's own settings.
//!
//! A tripwire, not a proof: `NoteSnapshot` is built in exactly one place
//! (`snapshot_note`); a source test (`a_note_snapshot_is_built_only_by_the_checked_read`)
//! fails when another literal appears.

use super::{NoteSnapshot, BODY_BUDGET};

/// Text the organizer may send to a model. Made only in this module.
pub(crate) struct ModelPrompt(String);

impl ModelPrompt {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// A note the organizer's policy cleared for a model. Made only by `clear`.
pub(super) struct Cleared<'a>(&'a NoteSnapshot);

/// The gate: `snapshot` when no model may be refused it, else None.
pub(super) fn clear(snapshot: &NoteSnapshot) -> Option<Cleared<'_>> {
    (!snapshot.locked && !snapshot.secure).then_some(Cleared(snapshot))
}

impl Cleared<'_> {
    pub(super) fn note(&self) -> &NoteSnapshot {
        self.0
    }
}

/// What a model call goes through: the local model or a connected lane in the
/// app, a fake in tests. Any `Fn(&str)` is one, but `run_cycle` can hand it
/// only a `ModelPrompt`.
pub(crate) trait ModelTransport {
    fn send(&self, prompt: &ModelPrompt) -> Result<String, String>;
}

impl<F: Fn(&str) -> Result<String, String>> ModelTransport for F {
    fn send(&self, prompt: &ModelPrompt) -> Result<String, String> {
        self(prompt.as_str())
    }
}

/// The note's own part of a prompt: its title and the start of its body.
fn note_part(s: &NoteSnapshot) -> String {
    let body: String = s.body.chars().take(BODY_BUDGET).collect();
    format!("\nNote title: {}\n\nNote body:\n{}\n", s.title, body.trim())
}

/// Job A prompt — single-shot, JSON-instructed, meant for temp 0. The body is
/// truncated to a budget; classify needs the gist, not the whole document.
/// `filing` is the person's own rules (plain sentences), followed when they apply.
pub(super) fn classify(note: &Cleared, vocab: &[(String, String)], filing: &[String]) -> ModelPrompt {
    let s = note.0;
    let mut p = String::from(
        "You file notes in a personal knowledge base. Pick the ONE best area for this note. \
         An `Area/Folder` entry is a folder inside that area: pick the most specific one that fits.\n\nAreas:\n",
    );
    for (name, desc) in vocab {
        if desc.is_empty() {
            p.push_str(&format!("- {name}\n"));
        } else {
            p.push_str(&format!("- {name}: {desc}\n"));
        }
    }
    p.push_str(&crate::librarian_rules::filing_prompt(filing));
    p.push_str(
        "\nAnswer with ONLY a JSON object, no prose:\n{\"area\": \"<one area name above, or none>\", \"confidence\": <number 0 to 1>}\n",
    );
    if let Some(tags) = s.fields.get("tags").filter(|t| !t.is_empty() && t.as_str() != "[]") {
        p.push_str(&format!("\nExisting tags: {tags}\n"));
    }
    p.push_str(&note_part(s));
    ModelPrompt(p)
}

/// Job B prompt — single-shot, JSON-instructed, temp 0. Links are constrained
/// to the pre-ranked candidate list (the model never invents a note).
pub(super) fn enrich(note: &Cleared, candidates: &[String]) -> ModelPrompt {
    let mut p = String::from(
        "You annotate notes in a personal knowledge base. Write a one-line summary, \
         a few short lowercase topic tags, and pick genuinely related notes ONLY \
         from the candidate list (an empty list is fine).\n",
    );
    if candidates.is_empty() {
        p.push_str("\nRelated-note candidates: none.\n");
    } else {
        p.push_str("\nRelated-note candidates:\n");
        for c in candidates {
            p.push_str(&format!("- {c}\n"));
        }
    }
    p.push_str(
        "\nAnswer with ONLY a JSON object, no prose:\n{\"summary\": \"<one line>\", \"tags\": [\"<tag>\", ...], \"links\": [\"<candidate>\", ...]}\n",
    );
    p.push_str(&note_part(note.0));
    ModelPrompt(p)
}
