//! Bounded reads and atomic writes for the Breve adapter.
use std::fs;
use std::io::Write;
use std::path::Path;
use serde::{de::DeserializeOwned, Serialize};
use super::MAX_TEXT_BYTES;

/// A Breve file in the vault (a brief, the watchlist, its config) through the
/// checked open: no symlink, no hard link, no special file, and bounded. (An
/// earlier marker called these files "outside any vault"; they are not.)
pub(super) fn read_text(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = crate::fsutil::open_own_file(path).ok()?;
    if file.metadata().ok()?.len() > MAX_TEXT_BYTES {
        return None;
    }
    let mut text = String::new();
    file.take(MAX_TEXT_BYTES).read_to_string(&mut text).ok()?;
    Some(text)
}

pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&read_text(path)?).ok()
}

pub(super) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent for {}", path.display()))?;
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-breve-")
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    tmp.write_all(bytes)
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    tmp.persist(path)
        .map_err(|e| format!("rename into {}: {e}", path.display()))?;
    Ok(())
}

pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let mut out =
        serde_json::to_vec_pretty(value).map_err(|e| format!("encode {}: {e}", path.display()))?;
    out.push(b'\n');
    write_atomic(path, &out)
}

