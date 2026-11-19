//! The note lock (split out of corpus.rs, 2026-11-09): every note mutation
//! takes it through `lock_note`, naming the `Authority` it acts for, and that
//! authority's policy is checked inside the lock, right before the change.

use std::path::Path;

use super::{locked_field, parse_document, CorpusStore};

/// Who a note mutation acts for. Every note lock names one (`lock_note`), and
/// its policy is checked inside the lock, right before the change: a check
/// made before waiting for the lock let a writer holding it lock or secure the
/// note meanwhile (second review of PR #267). There is no default.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Authority {
    /// The person, through the app's own controls and person-only commands,
    /// and Rotli's own upkeep for what they did (link rewrites after a move,
    /// a view's tag). By policy their notes are theirs, locked or secure: the
    /// AI rules restrict models and agents, not the person.
    Person,
    /// The Librarian's filer: only inside the Library, and never a locked or
    /// secure note or folder (`filer_writable`), source and destination both.
    Filer,
    /// A model writing through the AI lane: the read gate for that model, and
    /// never a locked note.
    Model { local: bool },
    /// An external agent (the workspace CLI and MCP): the remote read gate,
    /// and never a locked note.
    Agent,
}

/// A held note lock whose authority was checked inside it. Released on drop.
#[must_use]
pub(crate) struct NoteLock(#[allow(dead_code)] crate::fsutil::FileLockGuard);

impl CorpusStore {
    /// What a model or an agent requires of a note it changes, now: the AI
    /// read gate for that reader (a secure note refuses a remote one), and not
    /// locked.
    pub(super) fn ai_may_change(&mut self, rel: &str, model_is_local: bool) -> Result<(), String> {
        let text = self.read_for_ai(rel, model_is_local)?;
        let fm = parse_document(&text).0.unwrap_or_default();
        if fm.foreign.iter().any(|line| locked_field(line) == Some(true)) {
            return Err("note is locked — AI may not change it".into());
        }
        Ok(())
    }

    fn authority_allows(&mut self, rel: &str, dest: Option<&str>, authority: Authority) -> Result<(), String> {
        match authority {
            Authority::Person => Ok(()),
            Authority::Filer => {
                self.filer_writable(rel)?;
                dest.map_or(Ok(()), |dest| self.filer_writable(dest))
            }
            Authority::Model { local } => self.ai_may_change(rel, local),
            Authority::Agent => self.ai_may_change(rel, false),
        }
    }

    /// Take note `rel`'s lock for a change on behalf of `authority`, and check,
    /// inside the lock, that the authority may make it right now (`dest`: a
    /// move's destination folder). The one way a note mutation takes its lock.
    pub(crate) fn lock_note(&mut self, rel: &str, dest: Option<&str>, authority: Authority) -> Result<NoteLock, String> {
        let held = crate::fsutil::lock_file(&self.abs(rel))?;
        self.authority_allows(rel, dest, authority)?;
        Ok(NoteLock(held))
    }

    /// `lock_note` for a note known by its absolute path.
    pub(super) fn lock_note_at(&mut self, path: &Path, authority: Authority) -> Result<NoteLock, String> {
        let rel = path
            .strip_prefix(&self.root)
            .map_err(|_| format!("not in this vault: {}", path.display()))?
            .to_string_lossy()
            .into_owned();
        self.lock_note(&rel, None, authority)
    }
}
