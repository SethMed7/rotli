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
fn is_link_like(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
fn is_link_like(metadata: &fs::Metadata) -> bool {
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
}
