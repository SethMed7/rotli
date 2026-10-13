//! Content checks before an external workspace agent sees an ordinary file's
//! title, path, or count. The workspace treats every agent as remote.

use super::*;

impl Workspace {
    pub(super) fn file_visible_to_remote(&mut self, rel: &str) -> bool {
        if !self.store.agent_listable(rel) || self.store.file_is_protected(rel) {
            return false;
        }
        let Ok(path) = self.store.file_for_ai(rel, false) else {
            return false;
        };
        let Ok(metadata) = fs::metadata(&path) else {
            return false;
        };
        if metadata.len() > 16 * 1024 * 1024 {
            return false;
        }
        let Ok(bytes) = fs::read(path) else {
            return false;
        };
        let ext = Path::new(rel)
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let text = if crate::corpus::DOCX_PACKAGE_EXTS.contains(&ext.as_str()) {
            crate::ai_files::docx_text(&bytes)
        } else if crate::corpus::SHEET_PACKAGE_EXTS.contains(&ext.as_str()) {
            crate::ai_files::xlsx_text(&bytes)
        } else {
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        };
        text.is_ok_and(|text| !crate::secret::blocked_for_remote(&text))
    }
}
