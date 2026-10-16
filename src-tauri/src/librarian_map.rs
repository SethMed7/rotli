//! Where the Librarian works in a vault: which notes it reads, which are still
//! unfiled, which folders are areas, and where each area's `_index.md` lives.
//! A Rotli vault keeps all of it under `wiki/`; a copy Rotli made of someone's
//! folder (slice 4c, docs/design/vault-copy-and-obsidian-compatibility.md)
//! keeps the person's own tree. The organizer asks this map and never names a
//! folder itself, so the Librarian does the same work in both — only the
//! places differ.

use std::path::Path;

use crate::corpus::Layout;
use crate::vault_roles::FolderRoles;

/// The Templates folder (1.3.0) — byte-identical to TEMPLATES_BRAIN_FOLDER in
/// src/services/templates.ts (parity.json templatesBrainFolder). The notes in it
/// are the user's saved layouts for `/template`: placeholders, not knowledge. So
/// the daemon never files a capture INTO it (it is no area), never enriches what
/// is in it, and writes no `_index.md` there. It stays an ordinary, visible
/// folder to everything else.
pub(crate) const TEMPLATES_BRAIN_FOLDER: &str = "wiki/Templates";

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LibrarianMap {
    RotliVault,
    /// A copy: the role map's folders are Rotli's, and the folders Obsidian's
    /// settings name for templates and attachments hold nothing to file.
    Copy {
        roles: &'static FolderRoles,
        set_aside: Vec<String>,
    },
}

impl LibrarianMap {
    /// The map for the vault at `root`, read from its marker like
    /// `Layout::of_vault`. Lock-free: the organizer reads it beside its notes.
    pub(crate) fn at(root: &Path) -> Self {
        match Layout::of_vault(root) {
            Layout::Imported(roles) => Self::Copy {
                roles,
                set_aside: obsidian_set_aside(root),
            },
            _ => Self::RotliVault,
        }
    }

    /// The folder every walk starts from ("" = the vault's root).
    pub(crate) fn walk_root(&self) -> &'static str {
        match self {
            Self::RotliVault => "wiki",
            Self::Copy { .. } => "",
        }
    }

    /// Whether a note is the Librarian's input. `_index.md` is its own output,
    /// dot components are sidecar/temp plumbing, and templates are not knowledge.
    pub(crate) fn is_candidate(&self, rel: &str) -> bool {
        if !rel.ends_with(".md")
            || rel.rsplit('/').next() == Some("_index.md")
            || rel.split('/').any(|c| c.starts_with('.'))
        {
            return false;
        }
        match self {
            // `wiki/README.md` is the pinned human trust artifact (§3.4)
            Self::RotliVault => {
                rel.starts_with("wiki/") && rel != "wiki/README.md" && !under(rel, TEMPLATES_BRAIN_FOLDER)
            }
            Self::Copy { roles, set_aside } => !rotli_owned(roles, rel)
                && !set_aside.iter().any(|folder| under(rel, folder)),
        }
    }

    /// Whether a candidate is still unfiled, so Classify files it: anything in
    /// the inbox, and in a copy a note at the vault's root too.
    pub(crate) fn is_unfiled(&self, rel: &str) -> bool {
        match self {
            Self::RotliVault => rel.starts_with("wiki/_inbox/"),
            Self::Copy { roles, .. } => !rel.contains('/') || under(rel, &roles.inbox),
        }
    }

    /// The folder an area is, as a corpus-relative path.
    pub(crate) fn area_dir(&self, area: &str) -> String {
        match self {
            Self::RotliVault => format!("wiki/{area}"),
            Self::Copy { .. } => area.to_string(),
        }
    }

    pub(crate) fn index_rel(&self, area: &str) -> String {
        format!("{}/_index.md", self.area_dir(area))
    }

    /// The area names, sorted. A Rotli vault's areas are the folders under
    /// `wiki/` (never `_inbox`, underscore or dot names, or Templates); a
    /// copy's are the person's top-level folders that hold a note the
    /// Librarian reads, never the inbox.
    pub(crate) fn areas(&self, root: &Path) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(root.join(self.walk_root())) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter(|n| !n.starts_with('.'))
            .filter(|n| match self {
                Self::RotliVault => {
                    !n.starts_with('_') && format!("wiki/{n}") != TEMPLATES_BRAIN_FOLDER
                }
                Self::Copy { roles, .. } => n != &roles.inbox && {
                    let mut notes = Vec::new();
                    collect_md(root, n, &mut notes);
                    notes.iter().any(|rel| self.is_candidate(rel))
                },
            })
            .collect();
        names.sort();
        names
    }

    /// Every Librarian input note in the vault, lock-free.
    pub(crate) fn candidates(&self, root: &Path) -> Vec<String> {
        self.candidates_in(root, self.walk_root())
    }

    /// Every Librarian input note in one area.
    pub(crate) fn area_candidates(&self, root: &Path, area: &str) -> Vec<String> {
        self.candidates_in(root, &self.area_dir(area))
    }

    fn candidates_in(&self, root: &Path, folder: &str) -> Vec<String> {
        let mut rels = Vec::new();
        collect_md(root, folder, &mut rels);
        rels.retain(|rel| self.is_candidate(rel));
        rels
    }
}

fn under(rel: &str, folder: &str) -> bool {
    rel.strip_prefix(folder).is_some_and(|rest| rest.starts_with('/'))
}

/// Rotli's own folders in a copy (its Archive, Trash, chats, storage) hold
/// nothing the Librarian files or enriches.
fn rotli_owned(roles: &FolderRoles, rel: &str) -> bool {
    [&roles.archive, &roles.trash, &roles.chats, &roles.storage]
        .iter()
        .any(|folder| under(rel, folder))
}

/// The vault folders Obsidian's settings name for templates
/// (`.obsidian/templates.json` `folder`) and attachments (`.obsidian/app.json`
/// `attachmentFolderPath`). An attachment path starting with `./` is relative
/// to each note, not one folder, so it names nothing here.
fn obsidian_set_aside(root: &Path) -> Vec<String> {
    let setting = |file: &str, key: &str| -> Option<String> {
        let text = std::fs::read_to_string(root.join(".obsidian").join(file)).ok()?;
        let value: serde_json::Value = serde_json::from_str(&text).ok()?;
        let path = value.get(key)?.as_str()?.trim();
        if path.starts_with("./") || path == "." {
            return None;
        }
        let path = path.trim_matches('/');
        (!path.is_empty() && !path.split('/').any(|c| c == "..")).then(|| path.to_string())
    };
    [
        setting("templates.json", "folder"),
        setting("app.json", "attachmentFolderPath"),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Every `.md` file under `prefix` ("" = the root), skipping dot entries.
pub(crate) fn collect_md(root: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(root.join(prefix)) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect_md(root, &rel, out),
            Ok(t) if t.is_file() && name.ends_with(".md") => out.push(rel),
            _ => {}
        }
    }
}

#[cfg(test)]
#[path = "librarian_map_tests.rs"]
mod tests;
