//! The corpus file watcher (split out of corpus.rs, 2026-10-12): external
//! changes fire once per quiet burst; Rotli's own writes, dot-files, and
//! dependency folders never do.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use super::{is_skipped_dir, normalized_watch_path, SuppressSet};

const DEBOUNCE: Duration = Duration::from_millis(300);

/// A watcher's mailbox: an fs event, or `None` = stop now.
type WatchMsg = Option<notify::Result<notify::Event>>;

/// Every running watcher's root and mailbox, so removing a vault stops its
/// watcher at once instead of on its next fs event (review of PR 199).
static WATCHERS: Mutex<Vec<(PathBuf, Sender<WatchMsg>)>> = Mutex::new(Vec::new());

/// Stop every watcher on `root` (the vault left the registry).
pub(crate) fn stop_watching(root: &Path) {
    let root = normalized_watch_path(root);
    let mut watchers = WATCHERS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    watchers.retain(|(watched, mailbox)| {
        if *watched != root {
            return true;
        }
        let _ = mailbox.send(None);
        false
    });
}

/// Watch the corpus for EXTERNAL changes (a folder dropped in, a note edited
/// in another app) and fire `on_change` once per quiet burst, carrying the
/// burst's relevant paths (deduped) so the organizer daemon can enqueue exactly
/// what changed. `.rotli/`, dot-files and our own in-flight writes (the
/// suppress set) never fire — so they never reach the daemon's queue either.
/// `on_change` answers whether to keep watching: false (the root left the
/// registry) ends the thread and drops the watcher — before, every vault ever
/// switched to kept a watcher for the life of the process (audit 2026-10-12).
pub fn spawn_watcher(
    root: PathBuf,
    suppress: SuppressSet,
    on_change: impl Fn(&[PathBuf]) -> bool + Send + 'static,
) -> notify::Result<()> {
    use notify::{RecursiveMode, Watcher};
    let (tx, rx) = std::sync::mpsc::channel::<WatchMsg>();
    WATCHERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push((normalized_watch_path(&root), tx.clone()));
    let handler = move |res: notify::Result<notify::Event>| {
        let _ = tx.send(Some(res));
    };
    // Sandboxed macOS test processes do not receive FSEvents reliably. The
    // polling backend exercises the same filter/debounce/suppression pipeline;
    // production keeps the native recommended watcher.
    #[cfg(test)]
    let mut watcher = notify::PollWatcher::new(
        handler,
        notify::Config::default().with_poll_interval(Duration::from_millis(100)),
    )?;
    #[cfg(not(test))]
    let mut watcher = notify::recommended_watcher(handler)?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        let _keep_alive = watcher;
        while let Ok(Some(res)) = rx.recv() {
            let mut paths = relevant_paths(&root, &suppress, &res);
            if paths.is_empty() {
                continue;
            }
            // trailing debounce: absorb the burst, fire once when it goes quiet
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(Some(res)) => {
                        paths.extend(relevant_paths(&root, &suppress, &res));
                        continue;
                    }
                    Ok(None) => return,
                    Err(RecvTimeoutError::Timeout) => {
                        paths.sort();
                        paths.dedup();
                        // stale-cache order: bump BEFORE the notify, so the
                        // frontend's refetch can never hit a pre-change cache
                        suppress.bump();
                        if !on_change(&paths) {
                            return;
                        }
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
    Ok(())
}

/// The paths of one fs event that matter (suppress + dot filters applied).
/// Access events never matter.
fn relevant_paths(
    root: &Path,
    suppress: &SuppressSet,
    res: &notify::Result<notify::Event>,
) -> Vec<PathBuf> {
    let Ok(event) = res else { return Vec::new() };
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return Vec::new();
    }
    // A file create/remove updates its parent directory's mtime. Polling and
    // some native backends emit that as a second event carrying only the
    // directory; treating it as content bypasses the exact-file suppress set
    // and makes every app-authored write echo as "external". Metadata-only
    // changes contain no note bytes and never require a corpus refresh.
    if matches!(
        event.kind,
        notify::EventKind::Modify(notify::event::ModifyKind::Metadata(_))
    ) {
        return Vec::new();
    }
    event
        .paths
        .iter()
        .filter(|p| path_relevant(root, suppress, p))
        .cloned()
        .collect()
}

/// The unit-testable core of the watcher's filter.
pub fn path_relevant(root: &Path, suppress: &SuppressSet, path: &Path) -> bool {
    if suppress.contains(path) {
        return false;
    }
    let normalized_root = normalized_watch_path(root);
    let normalized_path = normalized_watch_path(path);
    let Ok(rel) = normalized_path.strip_prefix(&normalized_root) else {
        return false;
    };
    // Main, named views, and chat folders are portable hand-arranged sidecars.
    // Another Rotli process may write them, so every resident window must
    // observe them; every other dot-file remains private runtime state.
    if rel == Path::new(".rotli/main.json")
        || rel == Path::new(".rotli/views.json")
        || rel == Path::new(".rotli/chat-folders.json")
    {
        return true;
    }
    for comp in rel.components() {
        let name = comp.as_os_str().to_string_lossy();
        if name.starts_with('.') || is_skipped_dir(&name) {
            return false; // .rotli/, .DS_Store, .rotli-write-* temp files, node_modules/
        }
    }
    // directories (a dropped folder), .md notes and .excalidraw boards matter;
    // foreign files don't
    match normalized_path.extension() {
        Some(ext) => ext == "md" || ext == "excalidraw" || normalized_path.is_dir(),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use super::super::tests::bare;
    use super::super::SuppressSet;
    use super::{path_relevant, spawn_watcher};

    #[test]
    fn path_relevance_filter() {
        let root = PathBuf::from("/corpus");
        let s = SuppressSet::default();
        assert!(path_relevant(&root, &s, Path::new("/corpus/Work/note.md")));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/Inbox/excalidraw/ideas.excalidraw")
        )); // a board
        assert!(path_relevant(&root, &s, Path::new("/corpus/Dropped"))); // a folder
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/main.json")
        ));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/views.json")
        ));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/chat-folders.json")
        ));
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/index.json")
        ));
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli-write-abc")
        ));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/.DS_Store")));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/photo.png")));
        assert!(!path_relevant(&root, &s, Path::new("/elsewhere/x.md")));
        // a package install inside the vault never re-walks it (RAM review 2026-10-12)
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/node_modules/pkg/README.md")
        ));
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/Projects/app/Node_Modules/pkg")
        ));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/node_modules notes/README.md")
        ));
        let ours = PathBuf::from("/corpus/Work/ours.md");
        s.mark(&ours);
        assert!(
            !path_relevant(&root, &s, &ours),
            "our own write must not echo"
        );
    }

    #[test]
    fn external_change_refreshes_through_the_watcher() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), suppress, move |_paths: &[PathBuf]| {
            counter.fetch_add(1, Ordering::SeqCst);
            true
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up

        let before = store.list().unwrap().notes.len();
        fs::write(root.join("external.md"), "# From another app\n").unwrap();
        // wait for the debounced fire (poll watcher 100ms + debounce 300ms)
        let deadline = Instant::now() + Duration::from_secs(5);
        while fired.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(fired.load(Ordering::SeqCst) >= 1, "watcher never fired");
        assert_eq!(
            store.list().unwrap().notes.len(),
            before + 1,
            "the watcher's bump must refresh the cached walk"
        );
    }

    #[test]
    fn a_watcher_told_to_stop_never_fires_again() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), store.suppress_set(), move |_paths: &[PathBuf]| {
            counter.fetch_add(1, Ordering::SeqCst);
            false // e.g. the vault left the registry
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up
        fs::write(root.join("first.md"), "# first\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while fired.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(fired.load(Ordering::SeqCst), 1, "watcher never fired");
        fs::write(root.join("second.md"), "# second\n").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(fired.load(Ordering::SeqCst), 1, "a stopped watcher fired again");
    }

    #[test]
    fn removing_a_vault_stops_its_watcher_without_waiting_for_an_event() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), store.suppress_set(), move |_paths: &[PathBuf]| {
            counter.fetch_add(1, Ordering::SeqCst);
            true
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up
        super::stop_watching(&root);
        fs::write(root.join("after-removal.md"), "# late\n").unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(fired.load(Ordering::SeqCst), 0, "a stopped watcher fired");
    }

    #[test]
    fn watcher_debounces_external_bursts_and_ignores_our_writes() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(
            root.clone(),
            suppress.clone(),
            move |paths: &[PathBuf]| {
                assert!(!paths.is_empty(), "a fire must carry the burst's paths");
                counter.fetch_add(1, Ordering::SeqCst);
                true
            },
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up

        // a burst of external writes → ONE notification (debounced)
        for i in 0..5 {
            fs::write(root.join(format!("ext-{i}.md")), "# external\n").unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(1500));
        let after_burst = fired.load(Ordering::SeqCst);
        assert!(after_burst >= 1, "external change never reported");
        assert!(
            after_burst <= 2,
            "debounce failed: {after_burst} fires for one burst"
        );

        // our own write (suppressed path) → no new notification
        let ours = root.join("ours.md");
        suppress.mark(&ours);
        fs::write(&ours, "---\nid: x\n---\n\n# ours\n").unwrap();
        std::thread::sleep(Duration::from_millis(900));
        assert_eq!(
            fired.load(Ordering::SeqCst),
            after_burst,
            "our own in-flight write echoed back as external"
        );
    }
}
