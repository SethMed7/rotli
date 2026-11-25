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

fn owns_shared_state_for(identifier: &str) -> bool {
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

fn scratch_vault_for(support: &Path, identifier: &str) -> Option<PathBuf> {
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

/// The scratch path is this build's only while it is a real folder directly
/// inside a real support folder: never a link, a file, or a folder reached
/// through one. Before this build has a registry it has bound nothing, so the
/// folder must also be empty: anything already in it was put there by
/// someone else.
fn scratch_state(support: &Path, registry_exists: bool) -> ScratchState {
    let scratch = support.join(SCRATCH_VAULT);
    let Ok(meta) = std::fs::symlink_metadata(&scratch) else {
        return ScratchState::Missing;
    };
    let real_support = std::fs::symlink_metadata(support).is_ok_and(|m| m.is_dir());
    if !real_support || !meta.is_dir() {
        return ScratchState::Untrusted;
    }
    let directly_inside = std::fs::canonicalize(&scratch)
        .ok()
        .zip(std::fs::canonicalize(support).ok())
        .is_some_and(|(scratch, support)| scratch.parent() == Some(support.as_path()));
    let made_here = registry_exists || std::fs::read_dir(&scratch).is_ok_and(|mut entries| entries.next().is_none());
    if directly_inside && made_here { ScratchState::Trusted } else { ScratchState::Untrusted }
}

/// The scratch vault as this build may own it: canonical, and only while it
/// is a real folder directly inside a real support folder. A link there
/// (to a person's vault, say) is never this build's.
fn trusted_scratch_in(support: &Path) -> Option<PathBuf> {
    (scratch_state(support, true) == ScratchState::Trusted)
        .then(|| std::fs::canonicalize(support.join(SCRATCH_VAULT)).ok())
        .flatten()
}

/// A free name beside the scratch vault for whatever stood in its place.
fn set_aside_name(support: &Path) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    (0..)
        .map(|n| match n {
            0 => support.join(format!("{SCRATCH_VAULT} (set aside {stamp})")),
            n => support.join(format!("{SCRATCH_VAULT} (set aside {stamp}-{n})")),
        })
        .find(|path| std::fs::symlink_metadata(path).is_err())
        .expect("an unbounded range yields a free name")
}

/// Make the scratch path safe to bind before anything reads it. An untrusted
/// entry (a link, a file, a folder this build didn't make) is renamed aside:
/// the entry itself, so a link's target is never touched. Then, on a first
/// run, a fresh empty folder takes its place. `Err` means nothing may bind
/// the scratch path this launch.
fn settle_scratch_in(support: &Path, registry_exists: bool) -> Result<(), String> {
    let scratch = support.join(SCRATCH_VAULT);
    if std::fs::symlink_metadata(support).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err(format!("{} is a link, so no scratch vault in it is this app's", support.display()));
    }
    let state = scratch_state(support, registry_exists);
    if state == ScratchState::Trusted {
        return Ok(());
    }
    if state == ScratchState::Untrusted {
        let aside = set_aside_name(support);
        std::fs::rename(&scratch, &aside)
            .map_err(|e| format!("could not set {} aside ({e})", scratch.display()))?;
    }
    if registry_exists && state == ScratchState::Missing {
        return Ok(()); // a person who moved on from the scratch vault keeps it gone
    }
    std::fs::create_dir_all(support).map_err(|e| format!("create {} ({e})", support.display()))?;
    std::fs::create_dir(&scratch).map_err(|e| format!("create {} ({e})", scratch.display()))?;
    match scratch_state(support, false) {
        ScratchState::Trusted => Ok(()),
        _ => Err(format!("{} changed while it was being made", scratch.display())),
    }
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

/// Whether `folder`, or a folder it sits in, holds a vault `owned` doesn't
/// name. `folder` must be canonical.
fn inside_unowned_vault(folder: &Path, owned: &[PathBuf]) -> bool {
    folder.ancestors().any(|dir| holds_vault(dir) && !owned.iter().any(|own| own == dir))
}

/// The first vault at or below `root` that `owned` doesn't name. A link to a
/// folder is followed once: it counts as a hit when its target is, sits in,
/// or holds a vault. `Err` when the walk can't finish within `limit` folders.
/// An unreadable folder is skipped: this app can't read a vault through it
/// either.
fn unowned_vault_below(root: &Path, owned: &[PathBuf], limit: usize) -> Result<Option<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut followed = std::collections::HashSet::new();
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        seen += 1;
        if seen > limit {
            return Err(TOO_LARGE.into());
        }
        if dir != root && holds_vault(&dir) && !owned.contains(&dir) {
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
                if inside_unowned_vault(&target, owned) {
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
/// vault, sits inside one, or holds one, unless that vault is one this build
/// itself made or chose (`owned`: canonical paths from its own registry and
/// its scratch vault). `candidate` must already be canonical.
pub(crate) fn refuse_existing_vault_for(identifier: &str, candidate: &Path, owned: &[PathBuf]) -> Result<(), String> {
    refuse_existing_vault_within(identifier, candidate, owned, DESCENDANT_FOLDER_LIMIT)
}

fn refuse_existing_vault_within(
    identifier: &str,
    candidate: &Path,
    owned: &[PathBuf],
    limit: usize,
) -> Result<(), String> {
    if owns_shared_state_for(identifier) {
        return Ok(());
    }
    let refused = || Err(words().existing_vault.clone());
    if inside_unowned_vault(candidate, owned) {
        return refused();
    }
    match unowned_vault_below(candidate, owned, limit)? {
        Some(_) => refused(),
        None => Ok(()),
    }
}

/// This build's vault refusal (`refuse_existing_vault_for`). `owned` is only
/// asked for in a host build, so the standalone build never reads more than it
/// did before; an error reading it refuses.
pub(crate) fn refuse_existing_vault(
    candidate: &Path,
    owned: impl FnOnce() -> Result<Vec<PathBuf>, String>,
) -> Result<(), String> {
    if owns_shared_state() {
        return Ok(());
    }
    refuse_existing_vault_for(APP_IDENTIFIER, candidate, &owned()?)
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
/// (`settle_scratch_in`): a fresh install comes up on a new, empty folder
/// that this build made, without a person choosing a folder and without ever
/// looking at another app's registry. The first-run probe (`configured_at`)
/// then finds it and the migration binds it. `Err` means the scratch path
/// could not be made safe, and the caller must stop.
pub(crate) fn ensure_scratch_vault(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if owns_shared_state() {
        return Ok(());
    }
    let support = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let registry_exists = crate::corpus::corpus_config_file(app).is_some_and(|file| file.exists());
    settle_scratch_in(&support, registry_exists)
}

/// The folders this build itself bound as notes, canonical: its scratch vault
/// and every root in its own registry. A host build's vault refusal
/// (`app_identity::refuse_existing_vault`) lets these through. A registry that
/// exists but can't be read is an error, so the refusal holds instead.
pub(crate) fn owned_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    owned_roots_from(owned_scratch_vault(app), crate::corpus::corpus_config_file(app))
}

/// Whether a stored path now reaches its folder through a link a person can
/// make. The operating system's own links (`/var`, `/tmp` on macOS, owned by
/// root) don't count.
fn reached_through_link(path: &Path) -> bool {
    path.ancestors().any(|part| {
        std::fs::symlink_metadata(part).is_ok_and(|meta| {
            #[cfg(unix)]
            let made_by_a_person = std::os::unix::fs::MetadataExt::uid(&meta) != 0;
            #[cfg(not(unix))]
            let made_by_a_person = true;
            meta.file_type().is_symlink() && made_by_a_person
        })
    })
}

/// `owned_roots` from a scratch vault (already trusted) and a registry file,
/// for the headless CLI too, which has no app handle
/// (`app_identity::refuse_pinned_root`). A registry root that now resolves
/// through a link owns nothing: the folder behind it was not the one bound.
pub(crate) fn owned_roots_from(scratch: Option<PathBuf>, registry: Option<PathBuf>) -> Result<Vec<PathBuf>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(file) = registry.filter(|file| file.exists()) {
        let config = crate::corpus::read_config_path(&file)
            .ok_or_else(|| format!("Rotli couldn't read {}, so it won't open another folder yet.", file.display()))?;
        roots.push(config.corpus.abs_path);
        roots.extend(config.brains.into_iter().map(|brain| brain.abs_path));
        roots.extend(config.folders.into_iter().map(|folder| folder.abs_path));
    }
    let registered = roots.into_iter().filter(|root| !reached_through_link(root));
    Ok(scratch.into_iter().chain(registered.filter_map(|root| std::fs::canonicalize(root).ok())).collect())
}

/// The headless CLI's `ROTLI_CORPUS_ROOT` pin, under the same refusal as a
/// folder picked in the app. A host build's own roots come from its own
/// registry (`workspace::production_config_path`) and its scratch vault.
pub(crate) fn refuse_pinned_root(path: &Path) -> Result<(), String> {
    if owns_shared_state() {
        return Ok(());
    }
    let candidate = std::fs::canonicalize(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    refuse_existing_vault(&candidate, || {
        let home = std::env::var("HOME").map_err(|_| "HOME is unavailable")?;
        let support = support_dir(Path::new(&home));
        owned_roots_from(trusted_scratch_in(&support), Some(crate::workspace::production_config_path()?))
    })
}

#[cfg(test)]
#[path = "app_identity_tests.rs"]
mod tests;
