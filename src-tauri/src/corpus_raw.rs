//! Raw mounts: a file macOS hands Rotli from Finder (Open With, a Quick Action,
//! a Dock drop) opens in a tab WITHOUT joining a vault (docs/design/
//! open-in-rotli.md, stage 1; owner decisions 2026-10-13: edit in place, write
//! nothing else). The file's folder becomes a temporary corpus root that:
//!
//! - sees ONLY the opened file — its siblings are never walked, listed, read,
//!   or offered to AI;
//! - is adopted (`keeps_as_written`, `compose_for`, no file moves, no
//!   Librarian), so the person's edits are the only bytes that change;
//! - keeps every `.rotli/` sidecar (index, Main, views, journal) in a private
//!   folder outside the person's folder, through `guard_rel`;
//! - refuses what would add or move files there: Trash/Archive moves, new notes
//!   beside it, and marking it secure (that writes `.gitignore`).
//!
//! The root id IS the grant: only paths the OS handed Rotli are ever mounted,
//! and nothing the webview sends can name an outside path.

use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use super::*;

/// The prefix every raw mount's root id carries (`finder_<hash>`). Parity
/// fixture `rawRootPrefix` pins the TS copy (`RAW_ROOT_PREFIX` in src/state/paneVaults.ts).
pub(crate) const RAW_ROOT_PREFIX: &str = "finder_";

pub(crate) struct RawMount {
    /// Where this mount's `.rotli/` lives — never inside the person's folder.
    pub(super) sidecar: PathBuf,
    /// The top-level names this mount may see (the one opened file).
    pub(super) only: HashSet<String>,
}

impl RawMount {
    /// `guard_rel` for a raw mount: a `.rotli/…` path is redirected into the
    /// private sidecar, the opened file resolves as usual (`None`), and every
    /// other path — a sibling, the folder itself — is refused, whoever asks.
    pub(super) fn guard(&self, rel: &str) -> Option<Result<PathBuf, String>> {
        if self.only.contains(rel) {
            return None;
        }
        let rest = if rel == DOT_DIR {
            Some("")
        } else {
            rel.strip_prefix(DOT_DIR).and_then(|rest| rest.strip_prefix('/'))
        };
        Some(match rest {
            Some("") => Ok(self.sidecar.clone()),
            Some(rest) => crate::containment::resolve_beneath(&self.sidecar, Path::new(rest)),
            None => Err("Only the file you opened from Finder is open here.".into()),
        })
    }
}

/// Refuse an action a raw mount must never take in the person's folder.
pub(super) fn refuse_in_raw(store: &CorpusStore, what: &str) -> Result<(), String> {
    match store.raw {
        Some(_) => Err(format!(
            "A file opened from Finder stays exactly where it is — Rotli doesn't {what} it. Copy it into a vault first."
        )),
        None => Ok(()),
    }
}

/// The stable root id for an opened file's path.
pub(crate) fn raw_root_id(file: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    file.hash(&mut hasher);
    format!("{RAW_ROOT_PREFIX}{:016x}", hasher.finish())
}

impl CorpusStore {
    /// Mount one file the OS handed Rotli. `sidecar_base` is Rotli's own
    /// cache folder; the mount's `.rotli/` lives beneath it. The file must be
    /// a regular file (symlinks resolved).
    pub fn open_raw_file(file: &Path, sidecar_base: &Path) -> Result<Self, String> {
        let file = fs::canonicalize(file).map_err(|e| format!("open {}: {e}", file.display()))?;
        if !file.is_file() {
            return Err("Rotli opens a file here, not a folder".into());
        }
        let name = file
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("this file's name can't be read")?
            .to_string();
        let root = file.parent().ok_or("this file has no folder")?.to_path_buf();
        let sidecar = sidecar_base.join(raw_root_id(&file));
        fs::create_dir_all(&sidecar).map_err(|e| format!("create {}: {e}", sidecar.display()))?;
        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::LegacyRotli,
            band_read_only: false,
            perms_read_only: false,
            adopted: true,
            raw: Some(RawMount { sidecar, only: HashSet::from([name]) }),
            list_cache: None,
            search_index: None,
        };
        store.load_index();
        Ok(store)
    }

    /// The one file a raw mount shows (its path from the mount), if this is one.
    pub fn raw_file(&self) -> Option<&str> {
        self.raw.as_ref().and_then(|raw| raw.only.iter().next()).map(String::as_str)
    }

    /// The id and open kind (`note` | `board` | `file`) of the one file a raw
    /// mount shows: a note's id is its index id, a board's or file's is its path.
    pub fn raw_item(&mut self) -> Result<(String, &'static str), String> {
        let rel = self.raw_file().ok_or("not a file opened from Finder")?.to_string();
        for meta in self.list()?.notes {
            let found = match meta.kind {
                NoteKind::Note => self.path_of(&meta.id).is_ok_and(|path| path == rel),
                _ => meta.id == rel,
            };
            if found {
                let kind = match meta.kind {
                    NoteKind::Note => "note",
                    NoteKind::Board => "board",
                    NoteKind::File => "file",
                };
                return Ok((meta.id, kind));
            }
        }
        // a file the walk doesn't list still previews by its path
        Ok((rel, "file"))
    }
}

#[cfg(test)]
#[path = "corpus_raw_tests.rs"]
mod tests;
