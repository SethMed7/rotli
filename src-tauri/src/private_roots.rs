//! Folders that never become a notes root: private application, credential and
//! agent-runtime state. If one became a writable corpus root, the ordinary
//! file APIs could rewrite credentials, CLI configuration, or the local-model
//! registry. The app (`reject_privileged_root`) and a host build's command
//! line (`app_identity::claim_new_vault`) share this one list.

use std::path::{Path, PathBuf};

/// The refusal's one sentence.
pub(crate) const OVERLAPS: &str = "That folder overlaps private application, credential, or agent-runtime state and cannot be used as a notes root.";

/// Refuse a canonical `candidate` that overlaps a private subtree of `home`
/// (canonical) or one of this app's own folders, or that is `home` or holds it.
pub(crate) fn refuse_overlap(
    candidate: &Path,
    home: Option<&Path>,
    app_dirs: impl IntoIterator<Item = PathBuf>,
) -> Result<(), String> {
    let mut protected = Vec::new();
    let mut forbidden_home_or_ancestor = false;
    if let Some(home) = home {
        protected.extend(
            [
                ".memex",
                ".codex",
                ".claude",
                ".ssh",
                ".gnupg",
                ".aws",
                ".config",
                ".breve-secrets",
                "Library/Keychains",
            ]
            .into_iter()
            .map(|relative| home.join(relative)),
        );
        // Selecting HOME (or one of its ancestors) intersects every protected
        // child even when the child has not been created yet. Ordinary folders
        // below HOME remain valid unless they overlap a named private subtree.
        forbidden_home_or_ancestor = candidate == home || home.starts_with(candidate);
    }
    protected.extend(app_dirs);
    if forbidden_home_or_ancestor || overlaps_any(candidate, &protected) {
        return Err(OVERLAPS.into());
    }
    Ok(())
}

fn overlaps_any(candidate: &Path, protected: &[PathBuf]) -> bool {
    protected
        .iter()
        .any(|path| candidate.starts_with(path) || path.starts_with(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpus_roots_cannot_contain_or_live_inside_agent_trust_state() {
        let protected = vec![PathBuf::from("/Users/example/.memex")];
        assert!(overlaps_any(Path::new("/Users/example"), &protected));
        assert!(overlaps_any(Path::new("/Users/example/.memex/ai"), &protected));
        assert!(!overlaps_any(Path::new("/Users/example/Notes"), &protected));
    }
}
