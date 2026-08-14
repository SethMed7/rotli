// Shared atomic-write discipline (one implementation for corpus, memex and
// the local-model registry): temp file in the SAME directory, fsync, rename —
// a reader never sees a torn file and a crash mid-write leaves the old file
// intact. After the rename the parent directory is fsynced best-effort so a
// power loss can't drop the rename itself (a plain crash never could).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

/// Text plus the opaque content token required by the next replacement. This
/// is shared by small vault projections (Main, views, chat folders) so their
/// callers cannot accidentally treat a stale read as current disk truth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VersionedText {
    pub contents: String,
    pub revision: String,
}

pub(crate) fn versioned_text(contents: String) -> VersionedText {
    VersionedText {
        revision: revision(contents.as_bytes()),
        contents,
    }
}

/// Cross-process advisory lock for one read-modify-write target. Rotli's GUI,
/// CLI, MCP, Librarian, and Breve-facing bridges all use ordinary OS processes,
/// so an in-process mutex alone cannot serialize them. Failure to acquire the
/// lock always refuses the mutation; it never falls through unsafely.
const LOCK_STALE: Duration = Duration::from_secs(30);
const LOCK_ATTEMPTS: u32 = 200;
const LOCK_WAIT: Duration = Duration::from_millis(50);

struct FileLockGuard(PathBuf);

impl Drop for FileLockGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) fn with_file_lock<T>(
    target: &Path,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    with_file_lock_attempts(target, LOCK_ATTEMPTS, f)
}

pub(crate) fn with_file_lock_attempts<T>(
    target: &Path,
    attempts: u32,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock = PathBuf::from(format!("{}.lock", target.to_string_lossy()));
    let mut guard = None;
    for _ in 0..attempts {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
        {
            Ok(mut file) => {
                if let Err(error) = writeln!(file, "{}", std::process::id()) {
                    let _ = std::fs::remove_file(&lock);
                    return Err(format!("initialize lock {}: {error}", lock.display()));
                }
                guard = Some(FileLockGuard(lock.clone()));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if let Ok(modified) = std::fs::metadata(&lock).and_then(|meta| meta.modified()) {
                    if modified.elapsed().is_ok_and(|age| age > LOCK_STALE)
                        && !lock_owner_is_alive(&lock)
                    {
                        let _ = std::fs::remove_file(&lock);
                        continue;
                    }
                }
                std::thread::sleep(LOCK_WAIT);
            }
            Err(error) => {
                return Err(format!("create lock {}: {error}", lock.display()));
            }
        }
    }
    let _guard = guard.ok_or_else(|| {
        format!(
            "another writer is holding {} — try again in a moment",
            lock.display()
        )
    })?;
    f()
}

/// A slow, healthy writer must never have its lock stolen merely because an
/// operation exceeded the stale-age threshold (a first Breve dependency
/// install can legitimately take longer). The PID is advisory crash recovery;
/// failure to prove the owner alive permits the normal stale cleanup.
#[cfg(unix)]
fn lock_owner_is_alive(lock: &Path) -> bool {
    let Some(pid) = std::fs::read_to_string(lock)
        .ok()
        .and_then(|raw| raw.trim().parse::<u32>().ok())
    else {
        return false;
    };
    std::process::Command::new("/bin/kill")
        .args(["-0", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[cfg(not(unix))]
fn lock_owner_is_alive(_lock: &Path) -> bool {
    false
}

/// Opaque content revision shared by every Rotli mutation lane. The hash is a
/// concurrency token, not a security primitive: callers must pass the token
/// returned by the read that supplied the content they edited.
pub(crate) fn revision(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("fnv1a64:{hash:016x}")
}

pub(crate) fn file_revision(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("open {} for revision: {e}", path.display()))?;
    let mut hash = 0xcbf29ce484222325u64;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut chunk)
            .map_err(|e| format!("read {} for revision: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        for byte in &chunk[..read] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    Ok(format!("fnv1a64:{hash:016x}"))
}

pub(crate) fn require_revision(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err("expectedRevision is required; read the item immediately before editing it".into())
    } else {
        Ok(())
    }
}

pub(crate) fn compare_revision(expected: &str, current: &[u8]) -> Result<(), String> {
    require_revision(expected)?;
    let actual = revision(current);
    if expected == actual {
        Ok(())
    } else {
        Err(format!(
            "revision conflict: expected {expected}, found {actual}; the file changed after it was opened"
        ))
    }
}

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
