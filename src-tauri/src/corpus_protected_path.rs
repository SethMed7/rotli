//! The one rule an agent lane asks before a vault path, a folder, or a path
//! a row names (its id, its shelf `folderId`) reaches an agent:
//! `protected_path`. A path is protected when any of its components, after
//! normalising and resolving symlinks against the vault root, is a secure
//! home or carries one of the vault's secure keywords, compared the way the
//! Mac's disk compares names (Unicode case folding, NFC/NFD-insensitive).
//!
//! The case-by-case checks it replaces each compared one spelling: an exact
//! lower-case prefix for the secure homes and the leaf name only for the
//! keywords. `wiki/_ſecure`, a keyword on a parent folder, `..`, `\`, or a
//! symlink each walked past them (Codex re-checks of pull request 302,
//! 2026-11-20). The flag is set only on a store a workspace agent opened
//! (`Workspace::open_target`); the app's own store, the Librarian, and the
//! organizer keep their checks unchanged.
//!
//! Declared as a child of `corpus` (`#[path]` mod in corpus.rs).

use super::{lifecycle_disk_folder, CorpusStore, NoteDoc, NoteMeta, SECURE_NOTES_FOLDER};
use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// The secure homes, as vault-relative paths (either layout).
const SECURE_HOMES: [&str; 2] = ["wiki/_secure", SECURE_NOTES_FOLDER];

/// A name folded the way APFS compares names: canonical decomposition, full
/// case folding (`ß` → `ss`, `ſ` → `s`, `ﬃ` → `ffi`, final `ς` → `σ`), then
/// recomposed. Lowering, uppering, and lowering again turns each character
/// into its full fold without a case-folding table.
pub(crate) fn fold(name: &str) -> String {
    name.nfd()
        .flat_map(char::to_lowercase)
        .flat_map(char::to_uppercase)
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .nfc()
        .collect()
}

/// A path's components with `\` read as a separator and empty and `.`
/// components dropped. None when any component is `..`: a path that climbs
/// is never judged safe.
pub(crate) fn components(rel: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    for part in rel.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return None,
            part => parts.push(part.to_string()),
        }
    }
    Some(parts)
}

/// Is `rel` already in the one spelling `components` would give it?
pub(crate) fn is_clean(rel: &str) -> bool {
    components(rel).is_some_and(|parts| parts.join("/") == rel)
}

/// Do these components sit in a secure home, or name a secure keyword in any
/// component? `keywords` are already folded.
fn names_protected(parts: &[String], keywords: &[String]) -> bool {
    let folded: Vec<String> = parts.iter().map(|part| fold(part)).collect();
    let in_home = SECURE_HOMES.iter().any(|home| {
        let home: Vec<String> = home.split('/').map(fold).collect();
        folded.len() >= home.len() && folded[..home.len()] == home[..]
    });
    in_home || folded.iter().any(|name| crate::librarian_rules::secure_by_name(name, name, keywords))
}

/// The vault-relative components `parts` really point at: the longest prefix
/// that exists is resolved through every symlink. None when the resolution
/// fails or lands outside the vault.
fn resolved(root: &Path, parts: &[String]) -> Option<Vec<String>> {
    let real_root = std::fs::canonicalize(root).ok()?;
    let mut existing = parts.len();
    while existing > 0 && std::fs::symlink_metadata(join(root, &parts[..existing])).is_err() {
        existing -= 1;
    }
    let real = std::fs::canonicalize(join(root, &parts[..existing])).ok()?;
    let inside = real.strip_prefix(&real_root).ok()?;
    let mut out: Vec<String> = inside.iter().map(|part| part.to_string_lossy().into_owned()).collect();
    out.extend(parts[existing..].iter().cloned());
    Some(out)
}

fn join(root: &Path, parts: &[String]) -> PathBuf {
    parts.iter().fold(root.to_path_buf(), |path, part| path.join(part))
}

impl CorpusStore {
    /// Mark this store as a workspace agent's: its AI gates then ask
    /// `protected_path` too.
    pub(crate) fn set_agent_lane(&mut self) {
        self.agent_lane = true;
    }

    /// THE rule: may an agent never be shown this vault-relative path, or
    /// anything at or under it? Fails closed: a path that climbs (`..`), a
    /// symlink that can't be resolved or leaves the vault, or keyword settings
    /// that can't be read all answer yes. The spelling given and the path it
    /// resolves to are both judged.
    pub(crate) fn protected_path(&self, rel: &str) -> bool {
        if self.raw.is_some() {
            return true;
        }
        let Some(parts) = components(&lifecycle_disk_folder(self.layout, rel)) else {
            return true;
        };
        if parts.is_empty() {
            return false;
        }
        let Ok(keywords) = self.secure_keywords_for_classification() else {
            return true;
        };
        let keywords: Vec<String> = keywords.iter().map(|keyword| fold(keyword)).collect();
        if names_protected(&parts, &keywords) {
            return true;
        }
        match resolved(&self.root, &parts) {
            Some(real) => names_protected(&real, &keywords),
            None => true,
        }
    }

    /// An agent lane's row, made safe to show: refused when its id is a path
    /// in a protected place; its `folderId` (a shelf from frontmatter) falls
    /// back to the folder the note lives in when the shelf isn't clean or is
    /// protected. Unchanged outside an agent lane.
    pub(crate) fn agent_row(&self, mut row: NoteMeta) -> Option<NoteMeta> {
        if !self.agent_lane {
            return Some(row);
        }
        if row.id.contains(['/', '\\']) && self.protected_path(&row.id) {
            return None;
        }
        row.folder_id = self.agent_folder(&row.folder_id, &row.disk_folder_id)?;
        Some(row)
    }

    /// `agent_row` for a read note.
    pub(crate) fn agent_doc(&self, mut doc: NoteDoc) -> Result<NoteDoc, String> {
        if !self.agent_lane {
            return Ok(doc);
        }
        let refused = || "not available to agents".to_string();
        if doc.id.contains(['/', '\\']) && self.protected_path(&doc.id) {
            return Err(refused());
        }
        doc.folder_id = self.agent_folder(&doc.folder_id, &doc.disk_folder_id).ok_or_else(refused)?;
        Ok(doc)
    }

    fn agent_folder(&self, folder: &str, disk_folder: &str) -> Option<String> {
        if is_clean(folder) && !self.protected_path(folder) {
            return Some(folder.to_string());
        }
        (!self.protected_path(disk_folder)).then(|| disk_folder.to_string())
    }
}

#[cfg(test)]
#[path = "corpus_protected_path_tests.rs"]
mod tests;
