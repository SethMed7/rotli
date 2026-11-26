//! Where debug Breve borrows its delivery settings: the standalone app's vault
//! locations. Split from breve.rs at its size ceiling.

use std::path::PathBuf;

/// The vault locations debug Breve borrows delivery settings from. They are
/// all the standalone app's, so a host build reads none of them.
pub(super) fn dev_production_roots(
    owns_shared_state: bool,
    config_dir: Option<PathBuf>,
    knowledge: Option<PathBuf>,
    home: Option<PathBuf>,
) -> Vec<PathBuf> {
    if !owns_shared_state {
        return Vec::new();
    }
    let mut roots = Vec::new();
    if let Some(config) = config_dir.and_then(|dir| crate::corpus::read_config_path(&dir.join("corpus.json"))) { // vault bind (standalone): a host build returned above
        roots.push(config.corpus.abs_path);
    }
    roots.extend(knowledge);
    if let Some(home) = home {
        roots.push(home.join("memex-vault"));
        roots.push(home.join("Documents/rotli"));
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Debug Breve seeds its delivery settings from the standalone app's
    /// vault locations. A host build reads none of them, not even its own
    /// registry here: every one is a Rotli location.
    #[test]
    fn only_the_standalone_build_reads_rotlis_vault_locations_for_dev() {
        let config = tempfile::tempdir().unwrap();
        std::fs::write(
            config.path().join("corpus.json"),
            serde_json::json!({ "version": 1, "corpus": { "absPath": "/synthetic/notes" } }).to_string(),
        )
        .unwrap();
        let home = PathBuf::from("/Users/someone");
        let read = |owns| {
            dev_production_roots(
                owns,
                Some(config.path().to_path_buf()),
                Some(PathBuf::from("/synthetic/knowledge")),
                Some(home.clone()),
            )
        };
        assert_eq!(
            read(true),
            vec![
                PathBuf::from("/synthetic/notes"),
                PathBuf::from("/synthetic/knowledge"),
                home.join("memex-vault"),
                home.join("Documents/rotli"),
            ]
        );
        assert!(read(false).is_empty());
    }
}
