// Shared atomic-write discipline (one implementation for corpus, memex and
// the local-model registry): temp file in the SAME directory, fsync, rename —
// a reader never sees a torn file and a crash mid-write leaves the old file
// intact. After the rename the parent directory is fsynced best-effort so a
// power loss can't drop the rename itself (a plain crash never could).

use std::io::Write;
use std::path::Path;

pub(crate) fn atomic_write(path: &Path, contents: &str, prefix: &str) -> Result<(), String> {
    atomic_write_bytes(path, contents.as_bytes(), prefix)
}

pub(crate) fn atomic_write_bytes(path: &Path, contents: &[u8], prefix: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(prefix)
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    tmp.write_all(contents)
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    tmp.persist(path)
        .map_err(|e| format!("rename into {}: {e}", path.display()))?;
    // best-effort: the rename is only durable across power loss once the
    // directory entry is synced; a filesystem that refuses dir-fsync is fine.
    if let Ok(d) = std::fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}
