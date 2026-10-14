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
    /// The one name a FILE mount may see; `None` for a folder mount, which
    /// sees its whole tree.
    pub(super) only: Option<HashSet<String>>,
}

impl RawMount {
    /// `guard_rel` for a raw mount: a `.rotli/…` path is redirected into the
    /// private sidecar, the opened file resolves as usual (`None`), and every
    /// other path — a sibling, the folder itself — is refused, whoever asks.
    pub(super) fn guard(&self, rel: &str) -> Option<Result<PathBuf, String>> {
        let rest = if rel == DOT_DIR {
            Some("")
        } else {
            rel.strip_prefix(DOT_DIR).and_then(|rest| rest.strip_prefix('/'))
        };
        match (rest, &self.only) {
            (Some(""), _) => Some(Ok(self.sidecar.clone())),
            (Some(rest), _) => Some(crate::containment::resolve_beneath(&self.sidecar, Path::new(rest))),
            (None, Some(only)) if !only.contains(rel) => {
                Some(Err("Only the file you opened from Finder is open here.".into()))
            }
            // the opened file, or anything inside an opened folder
            (None, _) => None,
        }
    }
}

/// Refuse an action a raw mount must never take in the person's folder.
pub(super) fn refuse_in_raw(store: &CorpusStore, what: &str) -> Result<(), String> {
    match &store.raw {
        Some(raw) => Err(format!(
            "{} opened from Finder stays exactly where it is — Rotli doesn't {what} it. Add it as a vault first.",
            if raw.only.is_some() { "A file" } else { "A folder" }
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
        // canonical, so containment checks beneath it compare like with like
        let sidecar = fs::canonicalize(&sidecar).map_err(|e| format!("open {}: {e}", sidecar.display()))?;
        Ok(Self::raw_mount(root, RawMount { sidecar, only: Some(HashSet::from([name])) }))
    }

    /// Mount a folder the OS handed Rotli, whole, for its own window (stage
    /// 2). The same rules as a file mount, over the folder's tree: edits in
    /// place, nothing moved, created, or added, the sidecar in Rotli's cache.
    pub fn open_raw_folder(dir: &Path, sidecar_base: &Path) -> Result<Self, String> {
        let dir = fs::canonicalize(dir).map_err(|e| format!("open {}: {e}", dir.display()))?;
        if !dir.is_dir() {
            return Err("Rotli opens a folder here, not a file".into());
        }
        if dir.parent().is_none() {
            return Err("Rotli can't open the whole disk as a folder".into());
        }
        let sidecar = sidecar_base.join(raw_root_id(&dir));
        fs::create_dir_all(&sidecar).map_err(|e| format!("create {}: {e}", sidecar.display()))?;
        // canonical, so containment checks beneath it compare like with like
        let sidecar = fs::canonicalize(&sidecar).map_err(|e| format!("open {}: {e}", sidecar.display()))?;
        Ok(Self::raw_mount(dir, RawMount { sidecar, only: None }))
    }

    fn raw_mount(root: PathBuf, raw: RawMount) -> Self {
        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::LegacyRotli,
            band_read_only: false,
            perms_read_only: false,
            adopted: true,
            raw: Some(raw),
            list_cache: None,
            search_index: None,
        };
        store.load_index();
        store
    }

    /// The one file a file mount shows (its path from the mount), if this is one.
    pub fn raw_file(&self) -> Option<&str> {
        self.raw.as_ref()?.only.as_ref()?.iter().next().map(String::as_str)
    }

    /// Whether this store is a folder opened from Finder (its own window).
    pub fn is_raw_folder(&self) -> bool {
        self.raw.as_ref().is_some_and(|raw| raw.only.is_none())
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

impl CorpusState {
    /// Forget a Finder mount (its window closed). Vault routes are never touched.
    pub(crate) fn unmount_raw(&self, root_id: &str) -> Result<(), String> {
        let mut reg = self.0.lock().map_err(|_| "corpus lock poisoned".to_string())?;
        if reg.stores.get(root_id).is_some_and(|store| store.raw.is_some()) {
            reg.stores.remove(root_id);
        }
        Ok(())
    }
}

/// A folder window's listing: every folder and item of ONE folder opened from
/// Finder, each id prefixed with its root so it routes back to that mount.
/// Refuses any other root — this is never a way to list a vault.
pub(crate) fn list_raw_folder(state: &CorpusState, root_id: &str) -> Result<CorpusList, String> {
    if !state.route(root_id, |store| Ok(store.is_raw_folder()))? {
        return Err("not a folder opened from Finder".into());
    }
    state.walk_unlocked(root_id)?;
    let list = state.route(root_id, |store| store.list())?;
    let folders = list
        .folders
        .into_iter()
        .map(|folder| FolderMeta {
            id: compose_root_id(root_id, &folder.id),
            name: folder.name,
            parent_id: folder.parent_id.map(|parent| compose_root_id(root_id, &parent)),
        })
        .collect();
    let notes = list
        .notes
        .into_iter()
        .map(|meta| {
            let mut meta = prefix_meta(root_id, meta);
            // a note's id is its index id, which `prefix_meta` leaves bare
            if meta.kind == NoteKind::Note {
                meta.id = compose_root_id(root_id, &meta.id);
            }
            meta
        })
        .collect();
    Ok(CorpusList { folders, notes })
}

#[tauri::command]
pub async fn corpus_list_root(app: tauri::AppHandle, root: String) -> Result<CorpusList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        list_raw_folder(&app.state::<CorpusState>(), &root)
    })
    .await
    .map_err(|e| format!("folder list worker failed ({e})"))?
}

#[cfg(test)]
#[path = "corpus_raw_tests.rs"]
mod tests;
