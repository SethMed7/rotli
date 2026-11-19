//! Filesystem containment for paths below a registered corpus root.
//!
//! String-only `..` checks are insufficient: an otherwise-valid relative path
//! can cross the boundary through a symlink in any writable lane. This module
//! resolves one component at a time with `symlink_metadata` (which never follows
//! the component being inspected), rejects links, and canonicalizes every
//! existing component back to the already-canonical registered root. Missing
//! trailing components are allowed so the same primitive can guard creates.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

#[cfg(unix)]
pub(crate) fn is_link_like(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
pub(crate) fn is_link_like(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

pub(crate) fn resolve_beneath(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if !root.is_absolute() {
        return Err("registered corpus root must be absolute".into());
    }

    let mut current = root.to_path_buf();
    let mut missing_parent = false;
    for component in relative.components() {
        let name = match component {
            Component::Normal(name) => name,
            _ => {
                return Err(format!(
                    "path must stay relative to the corpus: {}",
                    relative.display()
                ))
            }
        };
        current.push(name);

        if missing_parent {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(metadata) => {
                if is_link_like(&metadata) {
                    return Err(format!(
                        "refusing symlink inside the corpus: {}",
                        relative.display()
                    ));
                }
                let canonical = fs::canonicalize(&current)
                    .map_err(|error| format!("canonicalize {}: {error}", current.display()))?;
                if !canonical.starts_with(root) {
                    return Err(format!(
                        "path escapes the registered corpus root: {}",
                        relative.display()
                    ));
                }
            }
            Err(error) if error.kind() == ErrorKind::NotFound => missing_parent = true,
            Err(error) => return Err(format!("inspect {}: {error}", current.display())),
        }
    }
    Ok(current)
}

/// How [`open_sidecar`] opens its file.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Sidecar {
    Read,
    /// Creates the folders and the file when missing.
    Append,
}

/// Open a Rotli sidecar file below `root` (`.rotli/librarian/proposals.jsonl`).
/// `resolve_beneath` checks a path and the open follows later, so a folder
/// swapped for a link in between was followed; here, on Unix, each folder is
/// opened through the one before it (`openat`, `O_NOFOLLOW | O_DIRECTORY`),
/// starting from the canonical root, and nothing is looked up by path twice.
/// The file itself must be a plain file with one name: a hard link passes
/// O_NOFOLLOW and every path check, yet reads and writes a file elsewhere.
/// `Ok(None)` when a read finds nothing there yet.
pub(crate) fn open_sidecar(root: &Path, relative: &Path, mode: Sidecar) -> Result<Option<fs::File>, String> {
    let root = fs::canonicalize(root).map_err(|error| format!("vault: {error}"))?;
    let file = match open_beneath(&root, relative, mode)? {
        Some(file) => file,
        None => return Ok(None),
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("inspect {}: {error}", relative.display()))?;
    #[cfg(unix)]
    let extra_names = std::os::unix::fs::MetadataExt::nlink(&metadata) != 1;
    #[cfg(not(unix))]
    let extra_names = false;
    if !metadata.is_file() || extra_names {
        return Err(format!(
            "refusing {}: not a plain file of its own (a hard link or special file)",
            relative.display()
        ));
    }
    Ok(Some(file))
}

#[cfg(unix)]
fn open_beneath(root: &Path, relative: &Path, mode: Sidecar) -> Result<Option<fs::File>, String> {
    use rustix::fs::{mkdirat, open, openat, Mode, OFlags};
    use rustix::io::Errno;
    let mut names = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(name) => names.push(name),
            _ => return Err(format!("path must stay relative to the corpus: {}", relative.display())),
        }
    }
    let Some((file_name, folders)) = names.split_last() else {
        return Err("a sidecar needs a file name".into());
    };
    let failed = |error: Errno| match error {
        // what O_NOFOLLOW answers for a link (ENOTDIR for one where a folder was asked)
        Errno::LOOP | Errno::NOTDIR | Errno::MLINK => {
            format!("refusing symlink inside the corpus: {}", relative.display())
        }
        _ => format!("open {}: {error}", relative.display()),
    };
    let folder_flags = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC;
    let mut folder = open(root, folder_flags, Mode::empty()).map_err(failed)?;
    for name in folders {
        folder = match openat(&folder, *name, folder_flags, Mode::empty()) {
            Ok(next) => next,
            Err(Errno::NOENT) if mode == Sidecar::Append => {
                match mkdirat(&folder, *name, Mode::from_raw_mode(0o777)) {
                    Ok(()) | Err(Errno::EXIST) => {}
                    Err(error) => return Err(failed(error)),
                }
                openat(&folder, *name, folder_flags, Mode::empty()).map_err(failed)?
            }
            Err(Errno::NOENT) => return Ok(None),
            Err(error) => return Err(failed(error)),
        };
    }
    // NONBLOCK so a planted FIFO can't stall the open before it is refused
    let flags = OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    let flags = match mode {
        Sidecar::Read => flags | OFlags::RDONLY,
        Sidecar::Append => flags | OFlags::WRONLY | OFlags::APPEND | OFlags::CREATE,
    };
    match openat(&folder, *file_name, flags, Mode::from_raw_mode(0o666)) {
        Ok(file) => Ok(Some(fs::File::from(file))),
        Err(Errno::NOENT) if mode == Sidecar::Read => Ok(None),
        Err(error) => Err(failed(error)),
    }
}

/// Elsewhere the path check stays the guard; the race it leaves is the
/// documented residual in docs/architecture/agent-workspace.md.
#[cfg(not(unix))]
fn open_beneath(root: &Path, relative: &Path, mode: Sidecar) -> Result<Option<fs::File>, String> {
    let path = resolve_beneath(root, relative)?;
    if mode == Sidecar::Append {
        if let Some(folder) = path.parent() {
            fs::create_dir_all(folder).map_err(|error| format!("create {}: {error}", relative.display()))?;
        }
        resolve_beneath(root, relative)?;
    }
    // the sidecar opener itself (non-Unix builds only): which checks one link on its descriptor
    let mut options = fs::OpenOptions::new();
    match mode {
        Sidecar::Read => options.read(true),
        Sidecar::Append => options.create(true).append(true),
    };
    match options.open(&path) {
        Ok(file) => Ok(Some(file)),
        Err(error) if error.kind() == ErrorKind::NotFound && mode == Sidecar::Read => Ok(None),
        Err(error) => Err(format!("open {}: {error}", relative.display())),
    }
}

/// A folder's identity (device, inode), read without following a link at its
/// last step, so a server that bound a vault can tell when another folder, or
/// a link, has been put at the same path since. `None` where the platform has
/// no such number (the check is then skipped; see agent-workspace.md).
pub(crate) fn folder_identity(path: &Path) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::symlink_metadata(path)
            .ok()
            .filter(|metadata| metadata.is_dir())
            .map(|metadata| (metadata.dev(), metadata.ino()))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[cfg(unix)]
    fn symlink_dir(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).unwrap();
        true
    }

    #[cfg(windows)]
    fn symlink_dir(target: &Path, link: &Path) -> bool {
        match std::os::windows::fs::symlink_dir(target, link) {
            Ok(()) => true,
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => false,
            Err(error) => panic!("create test symlink: {error}"),
        }
    }

    #[test]
    fn accepts_existing_and_missing_paths_below_the_root() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let root = fs::canonicalize(root).unwrap();

        assert_eq!(
            resolve_beneath(&root, Path::new("wiki/_inbox/new.md")).unwrap(),
            root.join("wiki/_inbox/new.md")
        );
        assert_eq!(
            resolve_beneath(&root, Path::new("new/deep/folder")).unwrap(),
            root.join("new/deep/folder")
        );
    }

    #[test]
    fn rejects_parent_and_absolute_components() {
        let temp = TempDir::new().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        assert!(resolve_beneath(&root, Path::new("../outside")).is_err());
        assert!(resolve_beneath(&root, &root.join("inside")).is_err());
    }

    #[test]
    fn rejects_a_symlink_in_any_existing_component() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        if !symlink_dir(&outside, &root.join("wiki/_inbox")) {
            return; // Windows CI without Developer Mode cannot create test links.
        }
        let root = fs::canonicalize(root).unwrap();

        let error = resolve_beneath(&root, Path::new("wiki/_inbox/new.md")).unwrap_err();
        assert!(error.contains("symlink"));
    }

    #[cfg(unix)]
    #[test]
    fn a_sidecar_is_one_plain_file_reached_without_links() {
        let temp = TempDir::new().unwrap();
        let (root, outside) = (temp.path().join("root"), temp.path().join("outside"));
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(&root).unwrap();
        let rel = Path::new(".rotli/side/file.jsonl");
        assert!(open_sidecar(&root, rel, Sidecar::Read).unwrap().is_none());
        assert!(open_sidecar(&root, rel, Sidecar::Append).unwrap().is_some());
        assert!(open_sidecar(&root, rel, Sidecar::Read).unwrap().is_some());

        fs::hard_link(root.join(rel), outside.join("twin")).unwrap();
        for mode in [Sidecar::Read, Sidecar::Append] {
            assert!(open_sidecar(&root, rel, mode).unwrap_err().contains("plain file"));
        }
        fs::remove_file(outside.join("twin")).unwrap();

        fs::rename(root.join(".rotli/side"), root.join(".rotli/kept")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join(".rotli/side")).unwrap();
        for mode in [Sidecar::Read, Sidecar::Append] {
            assert!(open_sidecar(&root, rel, mode).unwrap_err().contains("symlink"));
        }
        assert!(fs::read_dir(&outside).unwrap().next().is_none());

        let fifo = root.join(".rotli/kept/fifo");
        let c_path = std::ffi::CString::new(fifo.to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        let error = open_sidecar(&root, Path::new(".rotli/kept/fifo"), Sidecar::Read).unwrap_err();
        assert!(error.contains("plain file"), "{error}");
    }
}
