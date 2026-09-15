//! Rename a Rotli document or sheet (`.docx` / `.xlsx`) in place.
//!
//! Declared as a CHILD of `corpus` (`#[path]` mod in corpus.rs) so it reuses the
//! store's own gates. A document's filename IS its name: the rename keeps the
//! folder and the extension, and refuses a name another file already holds
//! instead of silently minting `name-2.docx`.

use std::fs;
use std::path::Path;

use super::{compose_root_id, split_root_id, validate_component, CorpusState, CorpusStore};

/// The conventional work files a user can name in Rotli. Mirrors the TS
/// `RENAMABLE_FILE_EXTS` (src/services/itemRename.ts) — both refuse the rest.
pub(crate) const RENAMABLE_FILE_EXTS: &[&str] = &["docx", "xlsx"];

/// The requested name → the final filename. A typed matching extension is
/// dropped, path separators flatten to `-`, and the file's own extension is
/// always re-appended, so a document can never lose (or double) `.docx`.
fn renamed_file_name(requested: &str, ext: &str) -> Result<String, String> {
    let trimmed = requested.trim();
    let dotted = format!(".{ext}");
    let stem = if trimmed.to_ascii_lowercase().ends_with(&dotted) {
        &trimmed[..trimmed.len() - dotted.len()]
    } else {
        trimmed
    };
    let stem: String = stem
        .trim()
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':') { '-' } else { c })
        .collect();
    let stem = stem.trim();
    if stem.is_empty() {
        return Err("a document needs a name".into());
    }
    let name = format!("{stem}.{ext}");
    validate_component(&name).map_err(|_| format!("“{stem}” can’t be used as a file name"))?;
    Ok(name)
}

/// True when both paths name one file on disk — a case-only rename on a
/// case-insensitive volume. On a case-sensitive volume `Plan.docx` and
/// `plan.docx` are two files, and the other one must never be replaced.
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            (Ok(_), Err(_)) => true, // nothing at the target to replace
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (a, b);
        false
    }
}

impl CorpusStore {
    /// Rename a document/sheet within its folder. Returns the NEW relpath (its
    /// id), so the caller retargets open tabs and Main/view references.
    pub fn rename_managed_file(&mut self, rel: &str, new_name: &str) -> Result<String, String> {
        let ext = Path::new(rel)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .filter(|value| RENAMABLE_FILE_EXTS.contains(&value.as_str()))
            .ok_or_else(|| format!("only documents and sheets can be renamed here: {rel}"))?;
        let abs = self.guard_rel(rel)?;
        if !abs.is_file() {
            return Err(format!("file not found: {rel}"));
        }
        // the same gate that lets the editor save this file in place
        if !self.storage_office_editable(rel) {
            self.writable(rel)?;
        }
        let name = renamed_file_name(new_name, &ext)?;
        let folder = rel.rsplit_once('/').map(|(f, _)| f).unwrap_or_default();
        let new_rel = if folder.is_empty() {
            name.clone()
        } else {
            format!("{folder}/{name}")
        };
        if new_rel == rel {
            return Ok(new_rel);
        }
        let new_abs = self.guard_rel(&new_rel)?;
        // a case-only change on a case-insensitive disk "exists" as itself
        let case_only = new_rel.to_lowercase() == rel.to_lowercase() && same_file(&abs, &new_abs);
        if !case_only && fs::symlink_metadata(&new_abs).is_ok() {
            return Err(format!("a file named “{name}” already exists here"));
        }
        self.suppress.mark(&abs);
        self.suppress.mark(&new_abs);
        fs::rename(&abs, &new_abs).map_err(|e| format!("rename {rel}: {e}"))?;
        // the one-time first-save backup (`write_file_bytes`) travels with its
        // file; best-effort, and never over a backup the new name already has
        let old_bak = Path::new(&format!("{}.bak", abs.display())).to_path_buf();
        let new_bak = Path::new(&format!("{}.bak", new_abs.display())).to_path_buf();
        if old_bak.is_file() && (case_only || fs::symlink_metadata(&new_bak).is_err()) {
            let _ = fs::rename(&old_bak, &new_bak);
        }
        Ok(new_rel)
    }
}

/// Rename a document or sheet in place; returns its new root-qualified id.
#[tauri::command]
pub fn corpus_rename_managed_file(
    state: tauri::State<'_, CorpusState>,
    id: String,
    name: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let new_rel = state.route(&root, |store| store.rename_managed_file(&rel, &name))?;
    Ok(compose_root_id(&root, &new_rel))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn memex_store() -> (TempDir, CorpusStore) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("memex.json"),
            "{\"id\":\"mx_rename\",\"contract\":\"3.4\",\"apps\":{}}",
        )
        .unwrap();
        for d in ["self", "wiki", "history", "chats", "archive", "trash"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        (dir, store)
    }

    #[test]
    fn a_document_renames_in_place_and_keeps_its_extension() {
        let (_dir, mut store) = memex_store();
        let doc = store
            .create_managed_file("untitled-1.docx", b"docx")
            .unwrap();
        let renamed = store.rename_managed_file(&doc, "Quarterly plan").unwrap();
        assert_eq!(renamed, "storage/rotli/Quarterly plan.docx");
        assert!(!store.root().join(&doc).exists(), "old file is gone");
        assert_eq!(fs::read(store.root().join(&renamed)).unwrap(), b"docx");
        // a typed extension is not doubled; separators flatten; case is kept
        let typed = store.rename_managed_file(&renamed, "Plan.DOCX").unwrap();
        assert_eq!(typed, "storage/rotli/Plan.docx");
        let flat = store.rename_managed_file(&typed, "a/b").unwrap();
        assert_eq!(flat, "storage/rotli/a-b.docx");
        // the same name is a no-op, a case-only change is allowed
        assert_eq!(store.rename_managed_file(&flat, "a-b").unwrap(), flat);
        let cased = store.rename_managed_file(&flat, "A-B").unwrap();
        assert_eq!(cased, "storage/rotli/A-B.docx");
        assert!(store.root().join(&cased).is_file());
        // sheets share the lane
        let sheet = store.create_managed_file("untitled.xlsx", b"xlsx").unwrap();
        assert_eq!(
            store.rename_managed_file(&sheet, "Budget").unwrap(),
            "storage/rotli/Budget.xlsx"
        );
    }

    #[test]
    fn the_first_save_backup_follows_the_renamed_document() {
        let (_dir, mut store) = memex_store();
        let doc = store.create_managed_file("plan.docx", b"v1").unwrap();
        store.write_file_bytes(&doc, b"v2", true).unwrap();
        assert!(store.root().join(format!("{doc}.bak")).is_file());
        let renamed = store.rename_managed_file(&doc, "Roadmap").unwrap();
        assert!(!store.root().join(format!("{doc}.bak")).exists(), "no orphan backup");
        assert_eq!(fs::read(store.root().join(format!("{renamed}.bak"))).unwrap(), b"v1");
        // a backup already holding the new name is never replaced
        let other = store.create_managed_file("draft.docx", b"d1").unwrap();
        store.write_file_bytes(&other, b"d2", true).unwrap();
        fs::write(store.root().join("storage/rotli/Final.docx.bak"), b"keep").unwrap();
        let final_doc = store.rename_managed_file(&other, "Final").unwrap();
        assert_eq!(fs::read(store.root().join(format!("{final_doc}.bak"))).unwrap(), b"keep");
    }

    #[test]
    fn rename_refuses_collisions_blank_names_and_other_files() {
        let (_dir, mut store) = memex_store();
        let a = store.create_managed_file("report.docx", b"a").unwrap();
        let b = store.create_managed_file("draft.docx", b"b").unwrap();
        let err = store.rename_managed_file(&b, "report").unwrap_err();
        assert!(err.contains("already exists"), "{err}");
        assert_eq!(fs::read(store.root().join(&a)).unwrap(), b"a", "never clobbered");
        assert!(store.root().join(&b).is_file(), "refused rename leaves the file");
        assert!(store.rename_managed_file(&b, "   ").is_err());
        assert!(store.rename_managed_file(&b, ".docx").is_err());
        assert!(store.rename_managed_file(&b, ".hidden").is_err());
        assert!(store.rename_managed_file("wiki/note.md", "x").is_err());
        assert!(store
            .rename_managed_file("storage/rotli/missing.docx", "x")
            .is_err());
        assert!(store.rename_managed_file("../escape.docx", "x").is_err());
        store.set_perms_read_only(true);
        assert!(store.rename_managed_file(&b, "blocked").is_err());
        assert!(store.root().join(&b).is_file());
    }
}
