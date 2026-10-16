//! The one-time "move your Archive and Trash?" question (decision I, owner
//! 2026-10-15). A copy keeps the person's own top-level `Archive/` and
//! `Trash/` as ordinary folders (decision F), so the Librarian would read the
//! notes in them as live. When the copy has the Librarian on, Rotli asks once
//! whether to move them into its own sinks. Yes moves every file, keeping its
//! name and its place below the folder (`Archive/2024/a.md` →
//! `Archive (Rotli)/2024/a.md`); a note gets the `origin` breadcrumb a normal
//! archive or trash stamps, so Restore can send it back. The emptied person
//! folders are then removed only when nothing is left in them but empty
//! folders and Finder's `.DS_Store` — anything that didn't move (a linked
//! item) keeps its folder. Never in a folder connected in place: the
//! Librarian never runs there.
//!
//! Declared as a CHILD of `corpus` so it reuses the store's own move machinery.

use std::fs;
use std::path::Path;

use serde::Serialize;

use super::{folder_of, CorpusState, CorpusStore};

/// How many files sit in the person's own top-level Archive and Trash.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonSinks {
    pub archive: usize,
    pub trash: usize,
}

const FINDER_CLUTTER: &str = ".DS_Store";

impl CorpusStore {
    /// The person's top-level folder for `role` ("archive" or "trash") —
    /// matched without letter case, never Rotli's own sink.
    fn person_sink(&self, role: &str) -> Option<String> {
        let roles = self.layout.roles()?;
        let own = if role == "archive" { &roles.archive } else { &roles.trash };
        fs::read_dir(&self.root)
            .ok()?
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .find(|name| name.eq_ignore_ascii_case(role) && !name.eq_ignore_ascii_case(own))
    }

    /// The files below `folder`, as vault paths (symlinks never followed).
    fn files_below(&self, folder: &str) -> Vec<String> {
        let mut out = Vec::new();
        let mut stack = vec![folder.to_string()];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(self.root.join(&dir)) else { continue };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                let rel = format!("{dir}/{name}");
                match entry.file_type() {
                    Ok(kind) if kind.is_dir() => stack.push(rel),
                    Ok(kind) if kind.is_file() && name != FINDER_CLUTTER => out.push(rel),
                    _ => {}
                }
            }
        }
        out.sort();
        out
    }

    /// Whether the question applies here: a copy (an imported vault not
    /// connected in place) whose own Archive or Trash holds files.
    pub fn person_sinks(&self) -> Result<Option<PersonSinks>, String> {
        if self.adopted || !self.layout.is_imported() {
            return Ok(None);
        }
        let count = |role| self.person_sink(role).map_or(0, |folder| self.files_below(&folder).len());
        let sinks = PersonSinks { archive: count("archive"), trash: count("trash") };
        Ok((sinks.archive + sinks.trash > 0).then_some(sinks))
    }

    /// Yes: move every file from the person's Archive and Trash into Rotli's.
    /// Returns how many moved.
    pub fn adopt_person_sinks(&mut self) -> Result<PersonSinks, String> {
        self.mutation_allowed()?;
        if self.adopted {
            return Err("A folder connected in place keeps its Archive and Trash as they are.".into());
        }
        let Some(roles) = self.layout.roles() else {
            return Err("Only a copy Rotli made has its own Archive and Trash to move into.".into());
        };
        let mut moved = PersonSinks::default();
        for (role, sink) in [("archive", roles.archive.as_str()), ("trash", roles.trash.as_str())] {
            let Some(folder) = self.person_sink(role) else { continue };
            let mut count = 0;
            for rel in self.files_below(&folder) {
                // `Archive/2024/a.md` → `Archive (Rotli)/2024/a.md`
                let below = folder_of(&rel)[folder.len()..].trim_start_matches('/').to_string();
                let target = if below.is_empty() { sink.to_string() } else { format!("{sink}/{below}") };
                self.writable(&rel)?;
                self.writable(&target)?;
                let path = self.abs(&rel);
                if rel.to_ascii_lowercase().ends_with(".md") {
                    let id = self.wire_id_of(&rel)?;
                    crate::fsutil::with_file_lock(&path, || self.relocate(&id, &rel, &target))?;
                } else {
                    crate::fsutil::with_file_lock(&path, || self.relocate_opaque(&rel, &target))?;
                }
                count += 1;
            }
            remove_if_emptied(&self.root.join(&folder));
            if role == "archive" {
                moved.archive = count;
            } else {
                moved.trash = count;
            }
        }
        Ok(moved)
    }
}

/// Remove `dir` only when nothing is left below it but empty folders and
/// `.DS_Store` files. Anything else keeps the folder (and its parents).
fn remove_if_emptied(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    let mut empty = true;
    for entry in entries.flatten() {
        let name = entry.file_name();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => empty &= remove_if_emptied(&entry.path()),
            Ok(kind) if kind.is_file() && name == FINDER_CLUTTER => {}
            _ => empty = false,
        }
    }
    if empty {
        let _ = fs::remove_file(dir.join(FINDER_CLUTTER));
        empty = fs::remove_dir(dir).is_ok();
    }
    empty
}

/// The question's facts for the active vault: `null` when it doesn't apply.
#[tauri::command]
pub fn corpus_person_sinks(state: tauri::State<'_, CorpusState>) -> Result<Option<PersonSinks>, String> {
    state.route(super::DEFAULT_ROOT_ID, |store| store.person_sinks())
}

/// Yes: move the person's Archive and Trash into Rotli's in the active vault.
#[tauri::command]
pub fn corpus_adopt_person_sinks(state: tauri::State<'_, CorpusState>) -> Result<PersonSinks, String> {
    state.route(super::DEFAULT_ROOT_ID, |store| store.adopt_person_sinks())
}

#[cfg(test)]
#[path = "corpus_person_sinks_tests.rs"]
mod tests;
