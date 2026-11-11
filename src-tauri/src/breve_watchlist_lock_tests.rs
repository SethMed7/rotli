//! System audit 2026-09-02 §6 #5: Breve's watchlist write read the note,
//! merged, and wrote with no lock, so an editor or agent save landing in
//! between was overwritten. The test holds the note's lock and checks that the
//! write waits for it, then merges over what the other writer left.

use super::*;
use std::time::Duration;

#[test]
fn a_watchlist_write_waits_for_a_writer_holding_the_note() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let path = root.join(WATCHLIST_FILE);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "---\nsummary: kept\n---\n# Watchlist\n\n- opened\n").unwrap();

    let held = crate::fsutil::lock_file(&path).unwrap();
    let writing = {
        let root = root.clone();
        std::thread::spawn(move || write_watchlist_at(&root, "# Watchlist\n\n- from Breve\n"))
    };
    std::thread::sleep(Duration::from_millis(400));
    assert!(
        fs::read_to_string(&path).unwrap().contains("- opened"),
        "Breve wrote while another writer held the note"
    );
    // the other writer changes the frontmatter, then lets go
    fs::write(&path, "---\nsummary: edited meanwhile\n---\n# Watchlist\n\n- opened\n").unwrap();
    drop(held);
    writing.join().unwrap().unwrap();
    let written = fs::read_to_string(&path).unwrap();
    assert!(written.contains("summary: edited meanwhile"), "{written}");
    assert!(written.contains("- from Breve"), "{written}");
}
