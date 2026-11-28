//! The command line's claim (`app_identity::claim_new_vault_for`), asked as
//! `HOST`, so plain `cargo test`, which CI runs, proves a host's policy.

use super::*;

/// A temp folder, canonical, with a `home` inside it.
fn claim_world() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let base = std::fs::canonicalize(temp.path()).unwrap();
    let home = folder(&base, "home");
    (temp, base, home)
}

fn untouched(folder: &Path) -> bool {
    std::fs::read_dir(folder).unwrap().next().is_none()
}

fn overlap() -> Result<(), String> {
    Err(crate::private_roots::OVERLAPS.to_string())
}

#[test]
fn a_command_line_claim_marks_an_empty_folder_and_keeps_a_marked_one() {
    let (_temp, base, home) = claim_world();
    let notes = folder(&base, "notes");
    std::fs::write(notes.join(".DS_Store"), "").unwrap();
    assert_eq!(claim_new_vault_for(HOST, &home, &notes), Ok(()));
    assert!(claimed_by(&notes, HOST));
    std::fs::write(notes.join("note.md"), "# Synthetic\n").unwrap();
    assert_eq!(claim_new_vault_for(HOST, &home, &notes), Ok(()), "its own vault stays its own");
    let standalone = folder(&base, "standalone");
    assert_eq!(claim_new_vault_for(STANDALONE_IDENTIFIER, &home, &standalone), Ok(()));
    assert!(untouched(&standalone), "the standalone build marks nothing");
}

#[test]
fn a_command_line_claim_leaves_a_folder_with_files_and_an_unmarked_vault() {
    let (_temp, base, home) = claim_world();
    let ledger = folder(&base, "ledger");
    std::fs::write(ledger.join("totals.csv"), "synthetic").unwrap();
    assert_eq!(claim_new_vault_for(HOST, &home, &ledger), Err(NOT_EMPTY.to_string()));
    assert!(!ledger.join(".rotli").exists());
    let theirs = folder(&base, "theirs");
    make_vault(&theirs);
    assert_eq!(claim_new_vault_for(HOST, &home, &theirs), existing_vault_refusal());
    assert!(!theirs.join(BOUND_BY).exists());
}

/// What a second first command meets while the first is still marking (a
/// `.rotli/` with no mark file yet): refused, nothing written; once the mark
/// is there, it passes.
#[test]
fn a_command_line_claim_refuses_a_half_made_mark_until_it_lands() {
    let (_temp, base, home) = claim_world();
    let notes = folder(&base, "notes");
    let marks = folder(&notes, BOUND_BY);
    assert_eq!(claim_new_vault_for(HOST, &home, &notes), existing_vault_refusal());
    assert!(untouched(&marks));
    std::fs::write(marks.join(HOST), "").unwrap();
    assert_eq!(claim_new_vault_for(HOST, &home, &notes), Ok(()));
}

#[test]
fn a_command_line_claim_refuses_private_folders() {
    let (_temp, _base, home) = claim_world();
    let support = support_dir_for(&home, HOST).join("notes");
    // the last is Tauri's `app_data_dir` on Linux
    let private = [home.join(".ssh/notes"), support, home.join(".local/share").join(HOST).join("notes")];
    for path in private {
        std::fs::create_dir_all(&path).unwrap();
        assert_eq!(claim_new_vault_for(HOST, &home, &path), overlap(), "{path:?}");
        assert!(untouched(&path), "{path:?}");
    }
}

/// A private folder that is a link is still private where it leads.
#[cfg(unix)]
#[test]
fn a_command_line_claim_follows_a_linked_private_folder() {
    let (_temp, base, home) = claim_world();
    let target = folder(&base, "dotfiles/keys");
    let link = home.join(".ssh");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let inside = folder(&target, "notes");
    for spelled in [&inside, &link.join("notes")] {
        assert_eq!(claim_new_vault_for(HOST, &home, spelled), overlap(), "{spelled:?}");
    }
    assert!(untouched(&inside));
    // the target itself, empty again, is that private folder
    std::fs::remove_dir(&inside).unwrap();
    assert_eq!(claim_new_vault_for(HOST, &home, &target), overlap());
    assert!(untouched(&target));
}

#[cfg(unix)]
#[test]
fn a_command_line_claim_marks_nothing_under_a_linked_support_folder() {
    let (_temp, base, home) = claim_world();
    let support = support_dir_for(&home, HOST);
    std::fs::create_dir_all(support.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(folder(&base, "elsewhere"), &support).unwrap();
    let notes = folder(&base, "notes");
    let claimed = claim_new_vault_for(HOST, &home, &notes);
    assert!(claimed.as_ref().is_err_and(|error| error.contains("is a link")), "{claimed:?}");
    assert!(untouched(&notes));
}

#[test]
fn a_command_line_claim_allows_its_own_scratch_vault() {
    let (_temp, _base, home) = claim_world();
    let scratch = folder(&support_dir_for(&home, HOST), "Scratch vault");
    assert_eq!(claim_new_vault_for(HOST, &home, &scratch), Ok(()));
    assert!(claimed_by(&scratch, HOST));
}
