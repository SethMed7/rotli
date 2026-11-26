//! One process per support folder under a host ID, and how `rotli open`
//! reaches it (docs/architecture/host-seams.md, "One process per support
//! folder").
//!
//! A host build's launch sets registry files aside and settles the scratch
//! vault in its support folder, so two processes on one folder would rewrite
//! each other's state mid-session. Before anything else runs, `launch()` takes
//! an exclusive `flock` on `<support>/instance/lock` and keeps it for the
//! process's life. The kernel drops a `flock` when its descriptor closes, a
//! crash or `kill -9` included, so a holder that is gone leaves no stale lock;
//! Rust opens files close-on-exec, so no child process inherits it. A second
//! process that can't take it runs no launch setup: it nudges the holder and
//! exits 75 (`ALREADY_RUNNING`).
//!
//! The nudge is a file the holder watches, `<support>/instance/nudge`: it
//! carries no request, since `rotli open`'s request already sits in the
//! mailbox. On a nudge the holder does what a Reopen does for `open`: it shows
//! the main window and tells the webview to consume the mailbox.
//!
//! The standalone build takes no lock and keeps `open -a rotli`.

use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

/// Exit status of a second process on a support folder that another process
/// holds (sysexits `EX_TEMPFAIL`): it ran no launch setup. The same status
/// whether or not its nudge was written; stderr says which.
pub(crate) const ALREADY_RUNNING: i32 = 75;
/// Exit status when the lock can't be taken safely (sysexits `EX_CANTCREAT`,
/// as for an unsafe scratch vault or registry).
const UNSAFE: i32 = 73;

pub(crate) const FOLDER: &str = "instance";
pub(crate) const LOCK: &str = "lock";
const NUDGE: &str = "nudge";

/// How long a launch waits out a brief holder (a `rotli open` probe, or a
/// relaunch whose parent is still exiting) before it calls itself second.
pub(crate) const LAUNCH_RETRIES: u32 = 40;
const RETRY_GAP: Duration = Duration::from_millis(50);

pub(crate) const NOT_IN_APP: &str =
    "This command isn't running from inside the app's bundle, so it can't tell which app to open. Run the command the app installed, or open the app first.";

/// The lock, held while this value lives.
#[derive(Debug)]
pub(crate) struct InstanceLock {
    _file: File,
    support: PathBuf,
    folder: PathBuf,
}

impl InstanceLock {
    pub(crate) fn folder(&self) -> &Path {
        &self.folder
    }
}

#[derive(Debug)]
pub(crate) enum Claim {
    Held(InstanceLock),
    Busy,
}

/// The lock this process holds for its whole life (a host build only).
static HELD: OnceLock<InstanceLock> = OnceLock::new();

/// Whether a path is a link, without following it.
fn is_link(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

/// `<support>/instance`, a private real folder. A support folder that is a
/// link is refused before anything is written, as the scratch vault refuses
/// it. Anything else at the instance path (a link, a file) is set aside, the
/// entry itself and never its target.
fn instance_folder(support: &Path) -> Result<PathBuf, String> {
    if is_link(support) {
        return Err(format!("{} is a link, so it isn't this app's support folder", support.display()));
    }
    std::fs::create_dir_all(support).map_err(|e| format!("make the support folder {} ({e})", support.display()))?;
    let folder = support.join(FOLDER);
    match std::fs::symlink_metadata(&folder) {
        Ok(meta) if meta.is_dir() => {}
        Ok(_) => {
            crate::app_identity::set_aside(&folder)?;
            make_folder(&folder)?;
        }
        Err(_) => make_folder(&folder)?,
    }
    make_private(&folder, true).map_err(|e| format!("{} ({e})", folder.display()))?;
    Ok(folder)
}

/// Set `path`'s mode through a descriptor opened without following a link,
/// so a link swapped in after the checks above is refused, never chmodded.
fn make_private(path: &Path, folder: bool) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let flags = if folder { libc::O_NOFOLLOW | libc::O_DIRECTORY } else { libc::O_NOFOLLOW };
        // raw read (outside-vault): opened only to set the mode of an instance file or folder
        let opened = OpenOptions::new().read(true).custom_flags(flags).open(path)?;
        opened.set_permissions(std::fs::Permissions::from_mode(if folder { 0o700 } else { 0o600 }))?;
    }
    #[cfg(not(unix))]
    let _ = (path, folder);
    Ok(())
}

fn make_folder(folder: &Path) -> Result<(), String> {
    match std::fs::create_dir(folder) {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => {
            Err(format!("make the instance folder {} ({e})", folder.display()))
        }
        _ if !std::fs::symlink_metadata(folder).is_ok_and(|meta| meta.is_dir()) => {
            Err(format!("the instance folder {} is no longer a folder", folder.display()))
        }
        _ => Ok(()),
    }
}

/// Open the lock file without following a link at its name.
fn open_lock(path: &Path, create: bool) -> std::io::Result<File> {
    // raw read (outside-vault): the support folder's lock file, never read or written, only locked
    let mut options = OpenOptions::new();
    options.read(true);
    if create {
        options.write(true).create(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

/// The lock file, as a regular file. Anything else at its name is set aside
/// first. A regular lock file is never renamed or removed: another process
/// may hold it.
fn lock_file(folder: &Path) -> Result<File, String> {
    let path = folder.join(LOCK);
    if std::fs::symlink_metadata(&path).is_ok_and(|meta| !meta.is_file()) {
        crate::app_identity::set_aside(&path)?;
    }
    let file = open_lock(&path, true).map_err(|e| format!("open {} ({e})", path.display()))?;
    // the mode on create applies only to a new file; an older one is tightened too
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("{} ({e})", path.display()))?;
    }
    Ok(file)
}

/// Take the lock on `support`, retrying `retries` times while another
/// descriptor holds it. `Busy` means another process holds it now.
pub(crate) fn try_claim_with(support: &Path, retries: u32) -> Result<Claim, String> {
    let folder = instance_folder(support)?;
    let file = lock_file(&folder)?;
    for attempt in 0..=retries {
        match file.try_lock() {
            Ok(()) => return Ok(Claim::Held(InstanceLock { _file: file, support: support.to_path_buf(), folder })),
            Err(std::fs::TryLockError::WouldBlock) if attempt < retries => std::thread::sleep(RETRY_GAP),
            Err(std::fs::TryLockError::WouldBlock) => return Ok(Claim::Busy),
            Err(std::fs::TryLockError::Error(e)) => return Err(format!("lock {} ({e})", folder.join(LOCK).display())),
        }
    }
    Ok(Claim::Busy)
}

/// `None` for the standalone ID, which takes no lock and touches nothing.
pub(crate) fn claim_for_identity(identifier: &str, support: &Path, retries: u32) -> Result<Option<Claim>, String> {
    if crate::app_identity::owns_shared_state_for(identifier) {
        return Ok(None);
    }
    try_claim_with(support, retries).map(Some)
}

/// Whether another process holds `support`'s lock. Writes nothing: no lock
/// file means no holder. It takes a shared lock for an instant, which a
/// launch at that moment waits out (`LAUNCH_RETRIES`).
pub(crate) fn holder_running(support: &Path) -> bool {
    if is_link(support) || is_link(&support.join(FOLDER)) {
        return false;
    }
    let Ok(file) = open_lock(&support.join(FOLDER).join(LOCK), false) else {
        return false;
    };
    matches!(file.try_lock_shared(), Err(std::fs::TryLockError::WouldBlock))
}

/// Tell the holder of `support` to come forward and read the mailbox.
pub(crate) fn nudge(support: &Path) -> Result<(), String> {
    let folder = support.join(FOLDER);
    if is_link(support) || !std::fs::symlink_metadata(&folder).is_ok_and(|meta| meta.is_dir()) {
        return Err(format!("{} isn't this app's instance folder", folder.display()));
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos());
    crate::fsutil::atomic_write(&folder.join(NUDGE), &format!("{} {stamp}\n", std::process::id()), ".nudge-")
}

/// Call `on_nudge` whenever the nudge file in `folder` is written. Tests use
/// the polling backend, as `corpus_watch` does: sandboxed test processes don't
/// receive FSEvents reliably.
pub(crate) fn watch_nudges(folder: &Path, on_nudge: impl Fn() + Send + 'static) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let handler = move |res| {
        let _ = tx.send(res);
    };
    #[cfg(test)]
    let mut watcher = notify::PollWatcher::new(handler, notify::Config::default().with_poll_interval(Duration::from_millis(50)))
        .map_err(|e| e.to_string())?;
    #[cfg(not(test))]
    let mut watcher = notify::recommended_watcher(handler).map_err(|e| e.to_string())?;
    watcher.watch(folder, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    std::thread::Builder::new()
        .name("rotli-instance-nudge".into())
        .spawn(move || {
            let _keep_alive = watcher;
            while let Ok(res) = rx.recv() {
                let Ok(event) = res else { continue };
                let nudged = !event.kind.is_access()
                    && !event.kind.is_remove()
                    && event.paths.iter().any(|path| path.file_name() == Some(NUDGE.as_ref()));
                if !nudged {
                    continue;
                }
                // one burst (temp write, rename) is one nudge
                while rx.recv_timeout(Duration::from_millis(100)).is_ok() {}
                on_nudge();
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// This build's support folder from HOME, before Tauri exists. Setup checks
/// that Tauri's own answer is the same folder (`confirm_support_folder`).
fn support_at_home() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").filter(|home| !home.is_empty()).ok_or("HOME is not set")?;
    Ok(crate::app_identity::support_dir(Path::new(&home)))
}

/// Whether a launch whose Tauri context names `configured` takes the lock:
/// a host build compiled for that same ID. A binary whose context names
/// another ID (a stale build cache) takes none and writes nothing here; setup
/// stops it with 78, so it never nudges the real app or exits 75.
pub(crate) fn takes_lock(configured: &str) -> bool {
    !crate::app_identity::owns_shared_state() && crate::app_identity::matches_runtime(configured)
}

/// First thing in `launch()`, before the Tauri builder: a host build takes
/// its lock or stops. A second process nudges the holder and exits 75; a lock
/// that can't be taken safely exits 73, a home whose file system has no
/// `flock` (some network homes) included. The standalone build returns at once.
pub(crate) fn hold_at_launch(configured: &str) {
    if !takes_lock(configured) {
        return;
    }
    let unsafe_lock = |error: String| -> ! {
        eprintln!("rotli: the instance lock is not safe to take ({error})");
        std::process::exit(UNSAFE);
    };
    let support = support_at_home().unwrap_or_else(|error| unsafe_lock(error));
    match claim_for_identity(crate::app_identity::APP_IDENTIFIER, &support, LAUNCH_RETRIES) {
        Ok(Some(Claim::Held(lock))) => {
            let _ = HELD.set(lock);
        }
        Ok(Some(Claim::Busy)) => {
            let told = match nudge(&support) {
                Ok(()) => "it was asked to come forward".to_string(),
                Err(error) => format!("it couldn't be asked to come forward: {error}"),
            };
            eprintln!(
                "rotli: another instance already runs on {}; {told}. This one exits without starting.",
                support.display()
            );
            std::process::exit(ALREADY_RUNNING);
        }
        Ok(None) => {}
        Err(error) => unsafe_lock(error),
    }
}

/// In setup, before the scratch vault: the folder Tauri calls this app's
/// support folder must be the one `hold_at_launch` locked, or the lock
/// protects nothing. Exits 73 on a mismatch.
pub(crate) fn confirm_support_folder(app: &tauri::AppHandle) {
    use tauri::Manager;
    if crate::app_identity::owns_shared_state() {
        return;
    }
    let tauri_support = app.path().app_config_dir().ok();
    let locked = HELD.get().map(|lock| lock.support.clone());
    if tauri_support.is_none() || tauri_support != locked {
        eprintln!("rotli: the support folder ({tauri_support:?}) is not the one this process locked ({locked:?})");
        std::process::exit(UNSAFE);
    }
}

/// A host build's holder: a nudge shows the main window and tells the webview
/// to consume the `rotli open` mailbox, as a Reopen does in the standalone
/// build. Best effort: without the watcher, a request waits for the next
/// activation or launch.
pub(crate) fn listen(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let Some(lock) = HELD.get() else { return };
    let handle = app.clone();
    if let Err(error) = watch_nudges(lock.folder(), move || {
        crate::summon::SummonIntent::ShowMain.perform(&handle);
        let _ = handle.emit_to("main", "rotli:open-request", ());
    }) {
        eprintln!("rotli: a second launch or `rotli open` can't reach this instance ({error})");
    }
}

/// The `.app` an executable runs from: exactly `X.app/Contents/MacOS/<bin>`.
pub(crate) fn app_bundle_of(exe: &Path) -> Option<PathBuf> {
    exe.parent()
        .filter(|parent| parent.file_name() == Some("MacOS".as_ref()))
        .and_then(Path::parent)
        .filter(|parent| parent.file_name() == Some("Contents".as_ref()))
        .and_then(Path::parent)
        .filter(|parent| parent.extension() == Some("app".as_ref()))
        .map(Path::to_path_buf)
}

/// How `rotli open` brings the app forward.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OpenPlan {
    /// `open <args>`.
    Launch(Vec<OsString>),
    /// An instance holds the lock: nudge it and launch nothing.
    Nudge,
}

/// The standalone build keeps its historical `open -a rotli`. A host build
/// nudges a running instance; with none, it opens the bundle this binary sits
/// in, never `open -b <ID>` (Launch Services can pick another build with the
/// same ID); a binary outside an `.app` refuses rather than guess.
pub(crate) fn plan_for(standalone: bool, holder_running: bool, exe: &Path) -> Result<OpenPlan, String> {
    if standalone {
        return Ok(OpenPlan::Launch(vec!["-a".into(), "rotli".into()]));
    }
    if holder_running {
        return Ok(OpenPlan::Nudge);
    }
    let bundle = app_bundle_of(exe).ok_or(NOT_IN_APP)?;
    Ok(OpenPlan::Launch(vec!["-a".into(), bundle.into_os_string()]))
}

/// This process's plan. Only a host build reads HOME and its own path.
pub(crate) fn open_plan() -> Result<OpenPlan, String> {
    if crate::app_identity::owns_shared_state() {
        return plan_for(true, false, Path::new(""));
    }
    let holder = holder_running(&support_at_home()?);
    let exe = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|e| format!("locate this command ({e})"))?;
    plan_for(false, holder, &exe)
}

/// Carry out `open_plan`'s answer.
pub(crate) fn bring_forward(plan: OpenPlan) -> Result<(), String> {
    match plan {
        OpenPlan::Nudge => nudge(&support_at_home()?),
        OpenPlan::Launch(args) => {
            let status = std::process::Command::new("open")
                .args(args)
                .status()
                .map_err(|e| format!("launch Rotli: {e}"))?;
            status.success().then_some(()).ok_or_else(|| "macOS could not open the Rotli app".into())
        }
    }
}

#[cfg(test)]
#[path = "single_instance_tests.rs"]
mod tests;
