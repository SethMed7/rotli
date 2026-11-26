//! One process per support folder, and how `rotli open` reaches it
//! (single_instance.rs). Every test works in a temporary folder: none reads
//! this machine's HOME, so a host-ID `cargo test` never touches a real
//! support folder.

use super::*;
use crate::app_identity::STANDALONE_IDENTIFIER;

const HOST: &str = "com.example.host";
/// A host's binary inside its bundle, and that bundle.
const BUNDLED: &str = "/Applications/Some Host.app/Contents/MacOS/some-host";
const BUNDLE: &str = "/Applications/Some Host.app";

fn support_in(temp: &tempfile::TempDir) -> PathBuf {
    let support = temp.path().join("support");
    std::fs::create_dir_all(&support).unwrap();
    support
}

fn held(claim: Result<Claim, String>) -> InstanceLock {
    match claim {
        Ok(Claim::Held(lock)) => lock,
        other => panic!("expected the lock, got {other:?}"),
    }
}

/// The reproduction: two launches against one support folder. The second
/// can't take the lock while the first holds it, and takes it once the
/// first is gone (a crash closes the descriptor the same way a drop does).
#[test]
fn a_second_claim_on_one_support_folder_is_refused() {
    let temp = tempfile::tempdir().unwrap();
    let support = support_in(&temp);
    let first = held(try_claim_with(&support, 0));
    assert!(matches!(try_claim_with(&support, 0), Ok(Claim::Busy)), "a second process must not run launch setup");
    drop(first);
    let _next = held(try_claim_with(&support, 0));
}

/// Two support folders are two instances: the lock is per folder, not per ID.
#[test]
fn each_support_folder_has_its_own_lock() {
    let temp = tempfile::tempdir().unwrap();
    let a = temp.path().join("a");
    let b = temp.path().join("b");
    let _a = held(try_claim_with(&a, 0));
    let _b = held(try_claim_with(&b, 0));
}

/// A probe (the CLI asking whether an instance runs) holds the lock for an
/// instant; a launch that meets it retries instead of exiting as a second
/// instance. A relaunch child meets its parent's lock the same way.
#[test]
fn a_launch_waits_out_a_brief_holder() {
    let temp = tempfile::tempdir().unwrap();
    let support = support_in(&temp);
    let brief = held(try_claim_with(&support, 0));
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(120));
        drop(brief);
    });
    let _lock = held(try_claim_with(&support, LAUNCH_RETRIES));
    release.join().unwrap();
}

#[test]
fn the_probe_sees_a_holder_and_creates_nothing() {
    let temp = tempfile::tempdir().unwrap();
    let support = temp.path().join("support");
    assert!(!holder_running(&support));
    assert!(!support.exists(), "the probe writes nothing");
    let lock = held(try_claim_with(&support, 0));
    assert!(holder_running(&support));
    assert!(holder_running(&support), "a probe leaves the holder's lock in place");
    drop(lock);
    assert!(!holder_running(&support), "a holder that is gone leaves no stale lock");
}

/// host-seams: a support folder that is a link is refused before anything
/// is written through it. The lock now runs first, so it refuses first.
#[cfg(unix)]
#[test]
fn a_linked_support_folder_is_refused_before_anything_is_written() {
    let temp = tempfile::tempdir().unwrap();
    let elsewhere = temp.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    let support = temp.path().join("support");
    std::os::unix::fs::symlink(&elsewhere, &support).unwrap();
    assert!(try_claim_with(&support, 0).is_err());
    assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0, "nothing was written to the link's target");
    assert!(!holder_running(&support));
    assert!(nudge(&support).is_err());
}

/// A link planted at the lock (or at its folder) is set aside, never
/// followed: the file it points at is untouched.
#[cfg(unix)]
#[test]
fn a_planted_link_at_the_lock_is_set_aside_not_followed() {
    let temp = tempfile::tempdir().unwrap();
    let support = support_in(&temp);
    let outside = temp.path().join("outside.txt");
    std::fs::write(&outside, "kept").unwrap();
    std::fs::create_dir_all(support.join(FOLDER)).unwrap();
    std::os::unix::fs::symlink(&outside, support.join(FOLDER).join(LOCK)).unwrap();
    let lock = held(try_claim_with(&support, 0));
    assert_eq!(std::fs::read_to_string(&outside).unwrap(), "kept");
    let meta = std::fs::symlink_metadata(support.join(FOLDER).join(LOCK)).unwrap();
    assert!(meta.is_file(), "a real lock file replaced the link");
    drop(lock);

    let other = tempfile::tempdir().unwrap();
    let support = support_in(&other);
    let decoy = other.path().join("decoy");
    std::fs::create_dir_all(&decoy).unwrap();
    std::os::unix::fs::symlink(&decoy, support.join(FOLDER)).unwrap();
    let _lock = held(try_claim_with(&support, 0));
    assert_eq!(std::fs::read_dir(&decoy).unwrap().count(), 0, "nothing was made through the linked folder");
    assert!(std::fs::symlink_metadata(support.join(FOLDER)).unwrap().is_dir());
}

#[cfg(unix)]
#[test]
fn the_instance_folder_is_private() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let support = support_in(&temp);
    let _lock = held(try_claim_with(&support, 0));
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&support.join(FOLDER)), 0o700);
    assert_eq!(mode(&support.join(FOLDER).join(LOCK)), 0o600);
}

/// A nudge (a second launch, or `rotli open` while an instance runs) reaches
/// the holder's watcher. Tests use the polling backend, as corpus_watch does.
#[test]
fn a_nudge_reaches_the_holder() {
    let temp = tempfile::tempdir().unwrap();
    let support = support_in(&temp);
    let lock = held(try_claim_with(&support, 0));
    let (tx, rx) = std::sync::mpsc::channel();
    watch_nudges(lock.folder(), move || {
        let _ = tx.send(());
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(250));
    nudge(&support).unwrap();
    rx.recv_timeout(Duration::from_secs(5)).expect("the holder heard the nudge");
}

/// Only the standalone ID skips the lock, and it touches nothing on disk.
#[test]
fn the_standalone_build_takes_no_lock() {
    let temp = tempfile::tempdir().unwrap();
    let support = temp.path().join("support");
    assert!(claim_for_identity(STANDALONE_IDENTIFIER, &support, 0).unwrap().is_none());
    assert!(!support.exists());
    let host = claim_for_identity(HOST, &support, 0).unwrap();
    assert!(matches!(host, Some(Claim::Held(_))));
    assert!(matches!(claim_for_identity(HOST, &support, 0), Ok(Some(Claim::Busy))));
}

#[test]
fn the_app_bundle_is_found_only_in_the_app_shape() {
    let path = Path::new;
    assert_eq!(app_bundle_of(path(BUNDLED)), Some(PathBuf::from(BUNDLE)));
    for outside in [
        "/usr/local/bin/rotli",
        "/Applications/Some Host.app/Contents/Resources/rotli",
        "/Applications/Some Host/Contents/MacOS/rotli",
        "/Contents/MacOS/rotli",
        "rotli",
    ] {
        assert_eq!(app_bundle_of(path(outside)), None, "{outside}");
    }
}

/// `rotli open`: standalone keeps `open -a rotli` exactly; a host nudges a
/// running instance and launches nothing, or opens its own bundle, never
/// `open -b <ID>` (Launch Services can pick another build with that ID); a
/// binary outside an `.app` refuses.
#[test]
fn rotli_open_plans_by_identity_and_holder() {
    let bundled = Path::new(BUNDLED);
    let loose = Path::new("/usr/local/bin/rotli");
    let standalone = OpenPlan::Launch(vec!["-a".into(), "rotli".into()]);
    for (holder, exe) in [(false, bundled), (true, bundled), (false, loose), (true, loose)] {
        assert_eq!(plan_for(true, holder, exe), Ok(standalone.clone()));
    }
    assert_eq!(plan_for(false, true, bundled), Ok(OpenPlan::Nudge));
    assert_eq!(plan_for(false, true, loose), Ok(OpenPlan::Nudge));
    assert_eq!(
        plan_for(false, false, bundled),
        Ok(OpenPlan::Launch(vec!["-a".into(), BUNDLE.into()]))
    );
    assert_eq!(plan_for(false, false, loose), Err(NOT_IN_APP.to_string()));
    for verdict in [plan_for(false, false, bundled), plan_for(false, true, bundled)] {
        if let Ok(OpenPlan::Launch(args)) = verdict {
            assert!(!args.iter().any(|a| a == "-b"), "a host never opens by bundle ID");
        }
    }
}

/// This build's own answer, without reading HOME: the identity decides.
#[test]
fn this_build_opens_as_its_identity() {
    let standalone = crate::app_identity::owns_shared_state();
    let expected = if standalone { "rotli" } else { BUNDLE };
    assert_eq!(plan_for(standalone, false, Path::new(BUNDLED)), Ok(OpenPlan::Launch(vec!["-a".into(), expected.into()])));
}

fn source(file: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join(file)).unwrap()
}

/// `rotli open` decides how to reach the app before it writes the request,
/// so a refusal leaves nothing queued to fire at a later launch; and no
/// open path names the app by bundle ID.
#[test]
fn rotli_open_plans_before_it_queues() {
    let workspace = source("workspace.rs");
    let start = workspace.find("fn queue_open(").expect("queue_open exists");
    let body = &workspace[start..start + workspace[start..].find("\n    }\n").unwrap()];
    let plan = body.find("single_instance::open_plan()").expect("queue_open plans first");
    assert!(plan < body.find("write_open_request(").unwrap(), "{body}");
    assert!(body.contains("single_instance::bring_forward("), "{body}");
    assert!(!source("app_identity.rs").contains("fn open_app_args("));
}
