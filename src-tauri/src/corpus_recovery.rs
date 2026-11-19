//! A note made in one create that answers with exactly what it wrote, and a
//! recovery note's identity (eighth review of pull request 267).
//!
//! The app used to create a note and then read it back for its revision; a
//! writer in between made the app certify the other writer's bytes as its
//! own. `create_with` answers from the create itself: the words, and the
//! revision of the very bytes it wrote.
//!
//! A recovery note (a conflict copy) was found again by its words, which could
//! adopt an unrelated note with the same text, miss a secure copy Rust had
//! routed to the secure home, or treat a failed look-up as "absent". Now the
//! app makes one id per event and the create writes it into the note's
//! metadata (`recovery: <id>`). Asked again with that id, the create gives
//! back the note it made, after checking it carries the protection asked for;
//! a look-up that can't read answers with an error, never "absent".

use std::fs;

use serde::Serialize;

use super::{note_row, parse_document, CorpusStore, NoteMeta};

/// What `corpus_create` answers: the note, and the words and revision of what
/// it wrote (or found, for a recovery event).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedNote {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub body: String,
    pub revision: String,
}

impl CorpusStore {
    /// Create a note: protection, the AI lock and (for a recovery note) its
    /// event id are written in the one create.
    pub(crate) fn create_with(
        &mut self,
        folder_id: &str,
        body: &str,
        secure: bool,
        locked: bool,
        creator: Option<crate::ai_edit_policy::Creator>,
        recovery: Option<&str>,
    ) -> Result<CreatedNote, String> {
        if let Some(event) = recovery {
            if event.is_empty() || !event.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                return Err(format!("a recovery event id is letters, digits and dashes: {event:?}"));
            }
            if let Some(found) = self.recovery_note(folder_id, event)? {
                let doc = self.read(&found.meta.id)?;
                if (secure && !doc.secure) || doc.locked != locked {
                    return Err(format!(
                        "the recovery note made for this event doesn't carry the protection asked for ({})",
                        found.meta.id
                    ));
                }
                return Ok(CreatedNote { body: doc.body, revision: doc.revision, ..found });
            }
        }
        let marker = recovery.map(|event| format!("recovery: {event}"));
        let mut lines: Vec<&str> = Vec::new();
        if locked {
            lines.push("locked: true");
        }
        if let Some(line) = &marker {
            lines.push(line);
        }
        let (meta, revision) = self.create_marked(folder_id, body, secure, creator, &lines)?;
        Ok(CreatedNote { meta, body: body.to_string(), revision })
    }

    /// The note an earlier create made for `event`, from the disk itself (the
    /// walk's cache can predate that create): every folder a create for
    /// `folder_id` can land in. A folder or file it can't read is an error.
    fn recovery_note(&mut self, folder_id: &str, event: &str) -> Result<Option<CreatedNote>, String> {
        let wanted = format!("recovery: {event}");
        let mut homes = vec![folder_id.to_string(), "Secure notes".to_string(), "wiki/_secure".to_string()];
        homes.push(self.layout.intake_dir().to_string());
        if let Some(sub) = folder_id.strip_prefix("Secure notes/") {
            homes.push(format!("Secure notes/{sub}"));
        }
        homes.sort();
        homes.dedup();
        for home in homes {
            let dir = self.root().join(&home);
            // a folder that doesn't exist holds no copy; any other error is
            // "can't tell", never "no copy there" (ninth review)
            let entries = match fs::read_dir(&dir) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("look for a recovery note in {home}: {error}")),
            };
            for entry in entries {
                let path = entry.map_err(|e| format!("look for a recovery note in {home}: {e}"))?.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let text = crate::fsutil::read_own_text(&path)
                    .map_err(|e| format!("look for a recovery note in {}: {e}", path.display()))?;
                let (fm, raw) = parse_document(&text);
                let Some(fm) = fm else { continue };
                if !fm.foreign.iter().any(|line| line.trim() == wanted) {
                    continue;
                }
                let Some(id) = fm.id.clone() else { continue };
                let rel = path
                    .strip_prefix(self.root())
                    .map_err(|_| "a recovery note outside the vault".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                let body = super::editor_body(raw);
                let meta = note_row(self.layout, id, &rel, &path, &fm, body);
                return Ok(Some(CreatedNote { meta, body: body.to_string(), revision: String::new() }));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::super::tests::bare;

    /// An unreadable folder is "can't tell", never "no copy there": the
    /// create refuses instead of making a second copy (ninth review).
    #[test]
    fn an_unreadable_home_refuses_rather_than_making_another_copy() {
        let (_dir, mut store) = bare();
        let first = store.create_with("Inbox", "# Plan (unsaved edits)\n\nmine", false, false, None, Some("e-9")).unwrap();
        let inbox = store.root().join("Inbox");
        std::fs::set_permissions(&inbox, std::fs::Permissions::from_mode(0o300)).unwrap();
        let again = store.create_with("Inbox", "# Plan (unsaved edits)\n\nmine", false, false, None, Some("e-9"));
        std::fs::set_permissions(&inbox, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(again.is_err(), "an unreadable folder must not read as absent: {again:?}");
        let again = store.create_with("Inbox", "# Plan (unsaved edits)\n\nmine", false, false, None, Some("e-9")).unwrap();
        assert_eq!(again.meta.id, first.meta.id);
    }
}
