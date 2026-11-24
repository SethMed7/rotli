//! Content checks before an external workspace agent sees an ordinary file's
//! title, path, or count. The workspace treats every agent as remote.

use super::*;

impl Workspace {
    pub(super) fn remote_meta_visible(&mut self, meta: &NoteMeta) -> bool {
        match meta.kind {
            NoteKind::Note => self.store.read_for_ai(&meta.id, false).is_ok(),
            NoteKind::Board => self.read_board_for_remote(&meta.id).is_ok(),
            NoteKind::File => self.file_visible_to_remote(&meta.id),
        }
    }

    pub(super) fn file_visible_to_remote(&mut self, rel: &str) -> bool {
        file_visible(&mut self.store, rel)
    }
}

/// Whether a remote agent may see this ordinary file at all: the listing's
/// test, which the document bridge asks too, so a document the listing hides
/// answers there exactly as a missing one (review of #311, B4).
pub(crate) fn file_visible(store: &mut CorpusStore, rel: &str) -> bool {
    if !store.agent_listable(rel) || store.protected_path(rel) {
        return false;
    }
    let Ok(path) = store.file_for_ai(rel, false) else {
        return false;
    };
    content_visible(&path)
}

/// The content half of `file_visible`, which needs no store (so the bridge
/// runs it outside the corpus lock): within the size cap, readable as the
/// vault's own file, its text extractable, and nothing secret-shaped. An
/// extractor that panics on the bytes answers "not visible".
pub(crate) fn content_visible(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if metadata.len() > 16 * 1024 * 1024 {
        return false;
    }
    let Ok(bytes) = crate::fsutil::read_own_bytes(path) else {
        return false;
    };
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = std::panic::catch_unwind(|| {
        if crate::corpus::DOCX_PACKAGE_EXTS.contains(&ext.as_str()) {
            crate::ai_files::docx_text(&bytes)
        } else if crate::corpus::SHEET_PACKAGE_EXTS.contains(&ext.as_str()) {
            crate::ai_files::xlsx_text(&bytes)
        } else {
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    });
    text.is_ok_and(|text| text.is_ok_and(|text| !crate::secret::blocked_for_remote(&text)))
}
