//! Which app this build is. The same shell builds the standalone Rotli
//! (`com.rotli.app`: its own updater, `rotli://`, Keychain, LaunchAgents) and,
//! with a host (`app_host.rs`), an app under another bundle ID. build.rs reads
//! the identifier at build time and this file is its one reader; every path or
//! label that names the bundle ID derives from it.
//!
//! State that is not keyed by the bundle ID (the `rotli` Keychain service, the
//! LaunchAgents, the Finder quick action, the OS-wide shortcuts, `~/.memex/ai`,
//! `~/breve`, the update feed, existing vaults) belongs to the standalone app.
//! Any other identifier fails closed: it never touches that state, and it
//! refuses a folder Rotli already uses as a vault.
//! (docs/architecture/compatibility-and-migrations.md, "One shell, with or
//! without a host")

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The bundle ID as a literal, for `concat!` in `const` paths.
macro_rules! app_identifier {
    () => {
        env!("ROTLI_APP_IDENTIFIER")
    };
}
pub(crate) use app_identifier;

pub(crate) const APP_IDENTIFIER: &str = app_identifier!();
pub(crate) const STANDALONE_IDENTIFIER: &str = "com.rotli.app";

/// The sentences a person reads where a host build declines Rotli's shared
/// state. Rotli's defaults are neutral; a host supplies its own wording
/// (`app_host::AppHost::words`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostWords {
    /// Any refused shared-state action (LaunchAgents, shortcuts, Finder).
    pub shared_state: String,
    /// A Keychain read or write.
    pub no_keychain: String,
    /// A folder that is already a Rotli vault.
    pub existing_vault: String,
}

impl Default for HostWords {
    fn default() -> Self {
        Self {
            shared_state: "This app runs beside Rotli and leaves this to Rotli.".into(),
            no_keychain: "This app doesn't keep keys in the Keychain, so this key can't be saved here. Rotli keeps its own."
                .into(),
            existing_vault: "Rotli already uses this folder as a vault, so this app won't open it. Choose another folder."
                .into(),
        }
    }
}

static HOST_WORDS: OnceLock<HostWords> = OnceLock::new();

/// Set once, by the host entry, before the app starts. A second call is
/// ignored: the wording never changes under a running app.
pub(crate) fn set_host_words(words: HostWords) {
    let _ = HOST_WORDS.set(words);
}

fn words() -> &'static HostWords {
    HOST_WORDS.get_or_init(HostWords::default)
}

/// Shown where a host build refuses shared state.
pub(crate) fn stays_with_rotli() -> String {
    words().shared_state.clone()
}

/// Shown where a host build refuses the Keychain.
pub(crate) fn no_keychain() -> String {
    words().no_keychain.clone()
}

pub(crate) fn owns_shared_state_for(identifier: &str) -> bool {
    identifier == STANDALONE_IDENTIFIER
}

/// True only for the standalone build: the one build allowed to use state
/// that two installed apps would otherwise share.
pub(crate) fn owns_shared_state() -> bool {
    owns_shared_state_for(APP_IDENTIFIER)
}

/// `Err` with the host's sentence in every build but the standalone one.
pub(crate) fn require_shared_state() -> Result<(), String> {
    owns_shared_state().then_some(()).ok_or_else(stays_with_rotli)
}

pub(crate) fn support_dir_for(home: &Path, identifier: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    return home.join("Library/Application Support").join(identifier);
    #[cfg(not(target_os = "macos"))]
    home.join(".config").join(identifier)
}

/// This build's support folder without an app handle (the headless CLI,
/// Antigravity). Tauri's `app_config_dir` is the same folder.
pub(crate) fn support_dir(home: &Path) -> PathBuf {
    support_dir_for(home, APP_IDENTIFIER)
}

const SCRATCH_VAULT: &str = "Scratch vault";

pub(crate) fn scratch_vault_for(support: &Path, identifier: &str) -> Option<PathBuf> {
    (!owns_shared_state_for(identifier)).then(|| support.join(SCRATCH_VAULT))
}

/// Where a fresh host install keeps its notes until the person picks a
/// folder: a throwaway vault inside its own support folder. `None` for the
/// standalone build, which keeps its historical first-run gate.
pub(crate) fn scratch_vault_in(support: &Path) -> Option<PathBuf> {
    scratch_vault_for(support, APP_IDENTIFIER)
}

/// What sits at the scratch path, judged without following a link.
#[derive(Debug, PartialEq, Eq)]
enum ScratchState {
    Missing,
    Trusted,
    Untrusted,
}

/// The scratch path is `identifier`'s only while it is a real folder directly
/// inside a real support folder (never a link, a file, or a folder reached
/// through one) that is empty or carries `identifier`'s mark, and that passes
/// the vault refusal. A registry doesn't vouch for it: anything that writes
/// the support folder writes that too, so a folder moved here (a Rotli vault,
/// say) is never this build's. Nor does the mark alone, which that writer can
/// forge here: a link inside to a Rotli vault still refuses.
fn scratch_state(support: &Path, identifier: &str) -> ScratchState {
    let scratch = support.join(SCRATCH_VAULT);
    let Ok(meta) = std::fs::symlink_metadata(&scratch) else {
        return ScratchState::Missing;
    };
    let real_support = std::fs::symlink_metadata(support).is_ok_and(|m| m.is_dir());
    if !real_support || !meta.is_dir() {
        return ScratchState::Untrusted;
    }
    let canonical = std::fs::canonicalize(&scratch).ok();
    let directly_inside = canonical
        .as_ref()
        .zip(std::fs::canonicalize(support).ok())
        .is_some_and(|(scratch, support)| scratch.parent() == Some(support.as_path()));
    let made_here = claimed_by(&scratch, identifier)
        || std::fs::read_dir(&scratch).is_ok_and(|mut entries| entries.next().is_none());
    let free = canonical.is_some_and(|scratch| refuse_existing_vault_for(identifier, &scratch).is_ok());
    if directly_inside && made_here && free { ScratchState::Trusted } else { ScratchState::Untrusted }
}

/// The scratch vault as `identifier` may own it (`scratch_state`), canonical.
/// A link there (to a person's vault, say) is never this build's.
pub(crate) fn trusted_scratch_for(support: &Path, identifier: &str) -> Option<PathBuf> {
    (scratch_state(support, identifier) == ScratchState::Trusted)
        .then(|| std::fs::canonicalize(support.join(SCRATCH_VAULT)).ok())
        .flatten()
}

fn trusted_scratch_in(support: &Path) -> Option<PathBuf> {
    trusted_scratch_for(support, APP_IDENTIFIER)
}

/// Rename the entry at `path` (never a link's target) to a free name beside
/// it, `<name> (set aside <time>)`.
pub(crate) fn set_aside(path: &Path) -> Result<(), String> {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(format!("{} can't be set aside", path.display()));
    };
    let aside = set_aside_name(dir, &name.to_string_lossy());
    std::fs::rename(path, &aside).map_err(|e| format!("could not set {} aside ({e})", path.display()))
}

/// A free name beside `name` in `dir` for whatever stood in its place.
fn set_aside_name(dir: &Path, name: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    (0..)
        .map(|n| match n {
            0 => dir.join(format!("{name} (set aside {stamp})")),
            n => dir.join(format!("{name} (set aside {stamp}-{n})")),
        })
        .find(|path| std::fs::symlink_metadata(path).is_err())
        .expect("an unbounded range yields a free name")
}

/// Make the scratch path safe to bind before anything reads it. An untrusted
/// entry (a link, a file, a folder this build didn't make) is renamed aside:
/// the entry itself, so a link's target is never touched. Then a fresh folder
/// takes its place, unless a registry exists and the path is simply gone (a
/// person who moved on keeps it gone). The scratch vault left in place
/// carries `identifier`'s mark. `Err` means nothing may bind the scratch path
/// this launch.
pub(crate) fn settle_scratch_for(identifier: &str, support: &Path, registry_exists: bool) -> Result<(), String> {
    let scratch = support.join(SCRATCH_VAULT);
    if std::fs::symlink_metadata(support).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(format!("{} is a link, so no scratch vault in it is this app's", support.display()));
    }
    let state = scratch_state(support, identifier);
    if state == ScratchState::Trusted {
        return claim_for(identifier, &scratch);
    }
    if state == ScratchState::Untrusted {
        set_aside(&scratch)?;
    }
    if registry_exists && state == ScratchState::Missing {
        return Ok(());
    }
    std::fs::create_dir_all(support).map_err(|e| format!("create {} ({e})", support.display()))?;
    std::fs::create_dir(&scratch).map_err(|e| format!("create {} ({e})", scratch.display()))?;
    claim_for(identifier, &scratch)?;
    match scratch_state(support, identifier) {
        ScratchState::Trusted => Ok(()),
        _ => Err(format!("{} changed while it was being made", scratch.display())),
    }
}

/// Where a host build marks a folder it bound as notes, inside the folder
/// itself: a file planted in the support folder can't vouch for a vault.
const BOUND_BY: &str = ".rotli/bound-by";

/// Whether `folder` carries `identifier`'s mark: a regular file under real
/// folders, never through a link.
pub(crate) fn claimed_by(folder: &Path, identifier: &str) -> bool {
    let real_dir = |path: &Path| std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir());
    let marks = folder.join(BOUND_BY);
    real_dir(&folder.join(".rotli"))
        && real_dir(&marks)
        && std::fs::symlink_metadata(marks.join(identifier)).is_ok_and(|meta| meta.is_file())
}

/// Mark `folder` as one `identifier` bound, once it has passed the refusal.
/// The standalone build marks nothing.
pub(crate) fn claim_for(identifier: &str, folder: &Path) -> Result<(), String> {
    if owns_shared_state_for(identifier) || claimed_by(folder, identifier) {
        return Ok(());
    }
    if identifier.is_empty() || identifier.starts_with('.') || identifier.contains(['/', '\\']) {
        return Err(format!("{identifier:?} can't name a mark"));
    }
    let unmarkable = || format!("{} can't be marked as this app's", folder.display());
    for dir in [folder.join(".rotli"), folder.join(BOUND_BY)] {
        match std::fs::symlink_metadata(&dir) {
            Ok(meta) if meta.is_dir() => {}
            Ok(_) => return Err(unmarkable()),
            Err(_) => std::fs::create_dir(&dir).map_err(|e| format!("{} ({e})", unmarkable()))?,
        }
    }
    crate::fsutil::atomic_write_new(&folder.join(BOUND_BY).join(identifier), "", ".bound-by")
        .map_err(|e| format!("{} ({e})", unmarkable()))?;
    claimed_by(folder, identifier).then_some(()).ok_or_else(unmarkable)
}

/// Whether `folder` holds nothing but host marks: a fresh scratch vault,
/// whose first open is still a first run.
pub(crate) fn holds_only_marks(folder: &Path) -> bool {
    let names = |dir: &Path| -> Option<Vec<std::ffi::OsString>> {
        std::fs::symlink_metadata(dir).ok().filter(|meta| meta.is_dir())?;
        Some(std::fs::read_dir(dir).ok()?.flatten().map(|entry| entry.file_name()).collect())
    };
    names(folder).is_some_and(|names| names == [".rotli"])
        && names(&folder.join(".rotli")).is_some_and(|names| names == ["bound-by"])
}

/// `claim_for` this build.
pub(crate) fn claim(folder: &Path) -> Result<(), String> {
    claim_for(APP_IDENTIFIER, folder)
}

/// How `rotli open` brings the app forward. The standalone build keeps its
/// historical `open -a rotli`; a host build names itself by bundle ID, so it
/// never launches the standalone app.
pub(crate) fn open_app_args() -> [&'static str; 2] {
    if owns_shared_state() { ["-a", "rotli"] } else { ["-b", APP_IDENTIFIER] }
}

/// The running app must be the identity this binary was compiled for; a stale
/// build cache, or a host whose Tauri context names another ID, could
/// otherwise give one identity the other's behaviour.
pub(crate) fn matches_runtime(configured: &str) -> bool {
    configured == APP_IDENTIFIER
}

/// Whether this one folder is, or was, a Rotli vault: its `.rotli/` sidecar,
/// a root `memex.json`, or a marker Rotli can still recover.
fn holds_vault(folder: &Path) -> bool {
    folder.join(".rotli").exists()
        || crate::corpus::is_memex_root(folder)
        || crate::vault_marker::refuses_scaffolding(folder)
}

/// How many folders below a candidate are checked for a vault before the
/// check gives up. Giving up refuses: a folder too large to check is not
/// known to be free of a vault.
const DESCENDANT_FOLDER_LIMIT: usize = 50_000;

const TOO_LARGE: &str = "This folder is too large to check for a Rotli vault inside it, so this app won't open it. Choose a smaller folder.";

/// Whether `dir` holds a vault that doesn't carry `identifier`'s mark.
fn unowned_vault(dir: &Path, identifier: &str) -> bool {
    holds_vault(dir) && !claimed_by(dir, identifier)
}

/// Whether `folder`, or a folder it sits in, holds a vault `identifier`
/// doesn't own. `folder` must be canonical.
fn inside_unowned_vault(folder: &Path, identifier: &str) -> bool {
    folder.ancestors().any(|dir| unowned_vault(dir, identifier))
}

/// The first vault at or below `root` that `identifier` doesn't own. A link to a
/// folder is followed once: it counts as a hit when its target is, sits in,
/// or holds a vault. `Err` when the walk can't finish within `limit` folders.
/// An unreadable folder is skipped: this app can't read a vault through it
/// either.
fn unowned_vault_below(root: &Path, identifier: &str, limit: usize) -> Result<Option<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut followed = std::collections::HashSet::new();
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        seen += 1;
        if seen > limit {
            return Err(TOO_LARGE.into());
        }
        if dir != root && unowned_vault(&dir, identifier) {
            return Ok(Some(dir));
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.filter_map(Result::ok) {
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && entry.file_name() != ".rotli" {
                stack.push(entry.path());
            } else if kind.is_symlink() {
                let Ok(target) = std::fs::canonicalize(entry.path()) else { continue };
                if !target.is_dir() || !followed.insert(target.clone()) {
                    continue;
                }
                if inside_unowned_vault(&target, identifier) {
                    return Ok(Some(target));
                }
                stack.push(target);
            }
        }
    }
    Ok(None)
}

/// The vault refusal, for any identity. The standalone build owns every vault
/// and refuses nothing. Any other identity refuses a folder that is a Rotli
/// vault, sits inside one, or holds one, unless that vault carries its own
/// mark (`claim_for`): one it made or chose. Nothing in the support folder
/// vouches for a folder. `candidate` must already be canonical.
pub(crate) fn refuse_existing_vault_for(identifier: &str, candidate: &Path) -> Result<(), String> {
    refuse_existing_vault_within(identifier, candidate, DESCENDANT_FOLDER_LIMIT)
}

fn refuse_existing_vault_within(identifier: &str, candidate: &Path, limit: usize) -> Result<(), String> {
    if owns_shared_state_for(identifier) {
        return Ok(());
    }
    let refused = || Err(existing_vault_refusal());
    if inside_unowned_vault(candidate, identifier) {
        return refused();
    }
    match unowned_vault_below(candidate, identifier, limit)? {
        Some(_) => refused(),
        None => Ok(()),
    }
}

/// The sentence a host build refuses an existing vault with.
pub(crate) fn existing_vault_refusal() -> String {
    words().existing_vault.clone()
}

/// This build's vault refusal (`refuse_existing_vault_for`).
pub(crate) fn refuse_existing_vault(candidate: &Path) -> Result<(), String> {
    refuse_existing_vault_for(APP_IDENTIFIER, candidate)
}

/// Whether a folder an `identifier` build already bound (canonical) is still
/// its own: it carries the mark and sits in no vault it doesn't own. Cheap
/// enough for every helper request; the walk below ran when it was chosen.
pub(crate) fn still_owned_for(identifier: &str, root: &Path) -> bool {
    owns_shared_state_for(identifier) || (claimed_by(root, identifier) && !inside_unowned_vault(root, identifier))
}

/// A host build's throwaway vault (`app_identity::scratch_vault_in`), inside
/// its own support folder; `None` in the standalone build.
pub(crate) fn scratch_vault(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let support = app.path().app_config_dir().ok()?;
    scratch_vault_in(&support)
}

/// The scratch vault only while this build may own it
/// (`trusted_scratch_in`), canonical; `None` in the standalone build.
pub(crate) fn owned_scratch_vault(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let support = app.path().app_config_dir().ok()?;
    scratch_vault_in(&support).and_then(|_| trusted_scratch_in(&support))
}

/// Before anything binds a host build's scratch vault, make it safe to bind
/// (`settle_scratch_for`): a fresh install comes up on a new folder that this
/// build made and marked, without a person choosing a folder and without ever
/// looking at another app's registry. The first-run probe (`configured_at`)
/// then finds it and the first config binds it. `Err` means the scratch path
/// could not be made safe, and the caller must stop.
pub(crate) fn ensure_scratch_vault(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if owns_shared_state() {
        return Ok(());
    }
    let support = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let registry_exists = crate::corpus::corpus_config_file(app).is_some_and(|file| file.exists());
    settle_scratch_for(APP_IDENTIFIER, &support, registry_exists)
}

/// The headless CLI's `ROTLI_CORPUS_ROOT` pin, under the same refusal as a
/// folder picked in the app.
pub(crate) fn refuse_pinned_root(path: &Path) -> Result<(), String> {
    if owns_shared_state() {
        return Ok(());
    }
    let candidate = std::fs::canonicalize(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    refuse_existing_vault(&candidate)
}

/// This build's scratch vault while it may own it, without an app handle
/// (the headless CLI); `None` in the standalone build.
pub(crate) fn trusted_scratch_at_home() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    let support = support_dir(Path::new(&home));
    scratch_vault_in(&support).and_then(|_| trusted_scratch_in(&support))
}

#[cfg(test)]
#[path = "app_identity_tests.rs"]
mod tests;
