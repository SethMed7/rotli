//! The store side of the Librarian rules (crate::librarian_rules owns the
//! pure rules and the name matcher): reading the rules from this vault's
//! settings, the name check the corpus gates call beside the body detector,
//! and the batch that protects notes already named with a secure keyword.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses
//! the store's own gates and the secure flow (ignore before move).

use std::fs;

use super::{
    editor_body, parse_document, secure_field, title_of, CorpusState, CorpusStore, Layout,
};

impl CorpusStore {
    /// The Librarian rules (librarian_rules.rs) from this vault's settings —
    /// the defaults when the file is missing or unreadable.
    pub(crate) fn librarian_rules(&self) -> crate::librarian_rules::LibrarianRules {
        self.dot_read("settings")
            .map(|settings| crate::librarian_rules::parse_rules(&settings))
            .unwrap_or_default()
    }

    /// Is this note named with one of the vault's secure keywords? Its title or
    /// file name only — never the body, never a model (Librarian rules).
    pub(super) fn secure_by_name(&self, title: &str, rel: &str) -> bool {
        self.layout == Layout::Memex
            && crate::librarian_rules::secure_by_name(
                title,
                rel,
                &self.librarian_rules().secure_keywords,
            )
    }

    /// Protect every Library note already named with a secure keyword (the
    /// Librarian rules): a title/file-name scan, no model, each note moved
    /// through the same ignore-before-move flow as the note menu's Secure.
    /// Returns how many notes it protected.
    pub(crate) fn secure_by_keywords(&mut self) -> Result<usize, String> {
        self.mutation_allowed()?;
        if self.layout != Layout::Memex || self.librarian_rules().secure_keywords.is_empty() {
            return Ok(0);
        }
        let mut rels: Vec<String> = self
            .index
            .values()
            .filter(|rel| {
                rel.starts_with("wiki/")
                    && !rel.starts_with("wiki/_secure/")
                    && rel.ends_with(".md")
            })
            .cloned()
            .collect();
        rels.sort();
        let mut protected = 0;
        for rel in rels {
            let Ok(text) = fs::read_to_string(self.abs(&rel)) else {
                continue;
            };
            let (fm, raw) = parse_document(&text);
            let Some(fm) = fm else { continue };
            if fm.foreign.iter().any(|l| secure_field(l) == Some(true)) {
                continue;
            }
            if self.secure_by_name(&title_of(editor_body(raw)), &rel) {
                self.set_secure(&rel, true)?;
                protected += 1;
            }
        }
        Ok(protected)
    }
}

/// Protect every note already named with a secure keyword (Settings →
/// Librarian → Rules). Title/file-name scan only; returns how many it moved.
#[tauri::command]
pub fn corpus_secure_by_keywords(
    state: tauri::State<'_, CorpusState>,
    organizer: tauri::State<'_, crate::organizer::OrganizerState>,
) -> Result<usize, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    let moved = state.route(&default_id, |s| s.secure_by_keywords())?;
    if moved > 0 {
        organizer.0.nudge_sweep();
    }
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use tempfile::TempDir;

    use super::super::CorpusStore;

    fn seed(root: &Path) {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("memex.json"),
            r#"{"id":"mx_rules0001","contract":"3.4","apps":{}}"#,
        )
        .unwrap();
        for d in ["self", "wiki", "history", "chats", "archive", "trash"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        fs::write(root.join("inbox.md"), "# Inbox\n\n").unwrap();
    }

    // the Librarian rules (librarian_rules.rs): secure keywords match the NAME
    // only and protect at birth, on save, and by the batch; People groups are
    // the one nesting file_note allows, and only for groups the rules name.
    #[test]
    fn librarian_rules_protect_by_name_and_file_people_groups() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        store
            .dot_write(
                "settings",
                r#"{"librarianRules":{"secureKeywords":["bank"]}}"#,
            )
            .unwrap();

        // born secure: a new note whose title carries a keyword
        let born = store
            .create("wiki/_inbox", "# Bank login\n\nnotes")
            .unwrap();
        assert!(store
            .path_of(&born.id)
            .unwrap()
            .starts_with("wiki/_secure/"));

        // a save that renames a note to a keyword protects it at once
        let plain = store.create("wiki/_inbox", "# Groceries\n\neggs").unwrap();
        let saved = store.write(&plain.id, "# Bank statements\n\neggs").unwrap();
        let rel = store.path_of(&plain.id).unwrap();
        assert!(rel.starts_with("wiki/_secure/"), "moved on save: {rel}");
        assert_eq!(saved.disk_folder_id, "wiki/_secure");
        assert!(fs::read_to_string(root.join(".gitignore"))
            .unwrap()
            .contains(&rel));
        assert!(store.read_for_ai(&plain.id, false).is_err());

        // whole words of the name only: never "Riverbank", never the body
        let river = store
            .create(
                "wiki/_inbox",
                "# Riverbank walk\n\nsat by the bank of the river",
            )
            .unwrap();
        assert!(store
            .path_of(&river.id)
            .unwrap()
            .starts_with("wiki/_inbox/"));
        assert!(store.read_for_ai(&river.id, false).is_ok());

        // a keyword added later: refused remote by name at once, moved by the batch
        let later = store
            .create("wiki/_inbox", "# Tax return 2025\n\nforms")
            .unwrap();
        store
            .dot_write(
                "settings",
                r#"{"librarianRules":{"secureKeywords":["bank","tax return"]}}"#,
            )
            .unwrap();
        assert!(store.read_for_ai(&later.id, false).is_err());
        assert_eq!(store.secure_by_keywords().unwrap(), 1);
        assert!(store
            .path_of(&later.id)
            .unwrap()
            .starts_with("wiki/_secure/"));
        assert_eq!(
            store.secure_by_keywords().unwrap(),
            0,
            "a second pass finds nothing"
        );

        // People groups: the default groups; the folder is created on filing
        let maya = store
            .create("wiki/_inbox", "# Maya Chen\n\nmet at the meetup")
            .unwrap();
        store
            .set_ai_field(&maya.id, "area", "PEOPLE/FRIENDS")
            .unwrap();
        let filed = store.file_note(&maya.id).unwrap();
        assert_eq!(filed.disk_folder_id, "wiki/People/Friends");
        store.filer_move(&maya.id, "wiki/_inbox").unwrap();
        for bad in ["People/Rivals", "Archive/Family", "People/Family/Cousins"] {
            store.set_ai_field(&maya.id, "area", bad).unwrap();
            assert!(store.file_note(&maya.id).is_err(), "{bad} must be refused");
        }
        // one People folder in the simple mode
        store
            .dot_write(
                "settings",
                r#"{"librarianRules":{"people":{"mode":"simple","groups":["Family"]}}}"#,
            )
            .unwrap();
        store
            .set_ai_field(&maya.id, "area", "People/Friends")
            .unwrap();
        assert!(store.file_note(&maya.id).is_err());
    }
}
