//! Rotli-owned Breve runtime supervision.
//!
//! The scheduler itself is a Bun process because the migrated Breve jobs are
//! TypeScript/Bash. Rust owns its lifecycle: materialize the versioned runtime
//! into the active corpus, start it only after an explicit takeover marker,
//! restart it after a crash, and terminate it with Rotli.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::memex::find_bun;

pub const MANAGED_DIR: &str = ".rotli/breve";
pub const MANAGED_MARKER: &str = ".rotli/routines/rotli-managed.json";
pub const ROUTINE_CONFIG: &str = ".rotli/routines/config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMarker {
    pub version: u32,
    pub taken_over_at: String,
    pub legacy_root: Option<String>,
}

#[derive(Clone, Default)]
pub struct BreveSupervisor {
    inner: Arc<SupervisorInner>,
}

#[derive(Default)]
struct SupervisorInner {
    stopping: AtomicBool,
    child: Mutex<Option<Child>>,
    root: Mutex<Option<PathBuf>>,
}

fn source_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dev = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../breve-runtime"));
    if cfg!(debug_assertions) && dev.join("scripts/rotli-scheduler.ts").is_file() {
        return Ok(dev);
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve Rotli resources: {e}"))?
        .join("breve-runtime");
    bundled
        .join("scripts/rotli-scheduler.ts")
        .is_file()
        .then_some(bundled)
        .ok_or_else(|| "Rotli's bundled Breve runtime is missing".into())
}

pub(crate) fn copy_tree(source: &Path, target: &Path, overwrite: bool) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("create {}: {e}", target.display()))?;
    for entry in fs::read_dir(source).map_err(|e| format!("read {}: {e}", source.display()))? {
        let entry = entry.map_err(|e| format!("read {} entry: {e}", source.display()))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        let kind = entry
            .file_type()
            .map_err(|e| format!("stat {}: {e}", from.display()))?;
        if kind.is_dir() {
            copy_tree(&from, &to, overwrite)?;
        } else if kind.is_file() && (overwrite || !to.exists()) {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("create {}: {e}", parent.display()))?;
            }
            fs::copy(&from, &to)
                .map_err(|e| format!("copy {} to {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn relocate_legacy_bundle(home: &Path, backup_dir: &Path) -> Result<Option<PathBuf>, String> {
    let source = home.join("legacy-repo.bundle");
    if !source.exists() {
        return Ok(None);
    }
    if !source.is_file() {
        return Err(format!(
            "legacy Breve backup is not a file: {}",
            source.display()
        ));
    }

    fs::create_dir_all(backup_dir).map_err(|e| {
        format!(
            "create Breve backup directory {}: {e}",
            backup_dir.display()
        )
    })?;
    let mut target = backup_dir.join("legacy-repo.bundle");
    let mut suffix = 1;
    while target.exists() {
        target = backup_dir.join(format!("legacy-repo-{suffix}.bundle"));
        suffix += 1;
    }

    if fs::rename(&source, &target).is_err() {
        fs::copy(&source, &target)
            .map_err(|e| format!("copy legacy Breve backup to {}: {e}", target.display()))?;
        fs::remove_file(&source)
            .map_err(|e| format!("remove relocated Breve backup {}: {e}", source.display()))?;
    }
    Ok(Some(target))
}

/// Install/update executable runtime code while preserving mutable data.
/// The vault-agnostic Breve defaults dir (app data, outside every vault):
/// saves mirror INTO it, fresh vault homes seed FROM it — "configurations can
/// be separate but default should be same" (the maintainer, 2026-07-31). Both sides are
/// best-effort: defaults sharing must never fail a save or a vault open.
fn shared_defaults_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("breve-shared-defaults"))
}

pub fn mirror_shared_default(app: &AppHandle, name: &str, source: &Path) {
    let Some(dir) = shared_defaults_dir(app) else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = fs::copy(source, dir.join(name));
}

/// Seed a vault's Breve from the vault-agnostic defaults (the maintainer, 2026-07-31:
/// "configurations can be separate but default should be same") — copy-if-
/// absent only, so a diverged vault keeps its own values forever. Callers
/// control ORDER: at takeover this runs AFTER the legacy migration, so the
/// real legacy files always outrank the shared mirror (review, 2026-07-31).
pub fn seed_shared_defaults(app: &AppHandle, corpus_root: &Path) {
    let home = corpus_root.join(MANAGED_DIR);
    seed_from_shared(app, "recipients.json", &home.join("recipients.json"));
    seed_from_shared(app, "signal.json", &home.join("signal.json"));
    seed_from_shared(app, "config.json", &corpus_root.join(ROUTINE_CONFIG));
}

pub fn seed_from_shared(app: &AppHandle, name: &str, target: &Path) {
    if target.exists() {
        return;
    }
    let Some(shared) = shared_defaults_dir(app).map(|dir| dir.join(name)) else {
        return;
    };
    if !shared.is_file() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(&shared, target);
}

fn breve_install_spawn_error(bun: &Path, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!(
            "Bun is required to install Breve's pinned dependencies but was not found at {}; install Bun and restart Rotli",
            bun.display()
        )
    } else {
        format!(
            "install Breve runtime dependencies with {}: {error}",
            bun.display()
        )
    }
}

const RUNTIME_CODE: &str = "breve-runtime";
const RUNTIME_NEXT: &str = "breve-runtime.next";
const RUNTIME_PREVIOUS: &str = "breve-runtime.previous";

fn path_entry_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn remove_runtime_artifact(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))
    } else if metadata.is_dir() {
        fs::remove_dir_all(path).map_err(|error| format!("remove {}: {error}", path.display()))
    } else {
        Err(format!(
            "refusing unsupported runtime artifact {}",
            path.display()
        ))
    }
}

fn recover_runtime_swap(runtime: &Path) -> Result<(), String> {
    let parent = runtime
        .parent()
        .ok_or_else(|| format!("Breve runtime has no parent: {}", runtime.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    let next = parent.join(RUNTIME_NEXT);
    let previous = parent.join(RUNTIME_PREVIOUS);

    // A crash between the two renames leaves only `previous`; restore it
    // before touching the incomplete candidate. If the new runtime exists, the
    // swap completed and the old duplicate is safe to discard.
    if !path_entry_exists(runtime) && path_entry_exists(&previous) {
        fs::rename(&previous, runtime).map_err(|error| {
            format!(
                "restore interrupted Breve runtime {} to {}: {error}",
                previous.display(),
                runtime.display()
            )
        })?;
    }
    if path_entry_exists(runtime) && path_entry_exists(&previous) {
        remove_runtime_artifact(&previous)?;
    }
    remove_runtime_artifact(&next)
}

fn prepare_runtime_stage(
    source: &Path,
    home: &Path,
    next: &Path,
    bun: &Path,
) -> Result<(), String> {
    fs::create_dir_all(next).map_err(|error| format!("create {}: {error}", next.display()))?;

    copy_tree(&source.join("scripts"), &next.join("scripts"), true)?;
    copy_tree(&source.join("skills"), &next.join("skills"), true)?;
    copy_tree(&source.join("docs"), &next.join("docs"), true)?;
    fs::copy(
        source.join("defaults/package.json"),
        next.join("package.json"),
    )
    .map_err(|error| format!("stage Breve runtime package: {error}"))?;
    fs::copy(source.join("defaults/bun.lock"), next.join("bun.lock"))
        .map_err(|error| format!("stage Breve runtime lockfile: {error}"))?;
    let skill = next.join("skills/breve/SKILL.md");
    if let Ok(text) = fs::read_to_string(&skill) {
        fs::write(
            &skill,
            text.replace("{{BREVE_HOME}}", &home.to_string_lossy()),
        )
        .map_err(|error| format!("materialize {}: {error}", skill.display()))?;
    }

    let install = Command::new(bun)
        .args(["install", "--production", "--frozen-lockfile", "--silent"])
        .current_dir(next)
        .status()
        .map_err(|error| breve_install_spawn_error(bun, &error))?;
    if !install.success() {
        return Err(format!(
            "Breve's frozen dependency install failed with status {install}; the staged runtime was discarded and the existing runtime remains unchanged"
        ));
    }
    Ok(())
}

fn commit_runtime_swap(runtime: &Path, next: &Path, previous: &Path) -> Result<(), String> {
    remove_runtime_artifact(previous)?;
    if path_entry_exists(runtime) {
        fs::rename(runtime, previous).map_err(|error| {
            format!(
                "stage previous Breve runtime {} as {}: {error}",
                runtime.display(),
                previous.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(next, runtime) {
        let rollback = if path_entry_exists(previous) {
            fs::rename(previous, runtime).err()
        } else {
            None
        };
        return Err(match rollback {
            Some(rollback) => format!(
                "activate staged Breve runtime: {error}; restoring the previous runtime also failed: {rollback}"
            ),
            None => format!("activate staged Breve runtime: {error}; the previous runtime was restored"),
        });
    }
    if let Some(parent) = runtime.parent() {
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    // The active directory is now complete. Failure to remove this private
    // duplicate is cleanup debt, not a reason to stop a valid scheduler.
    let _ = remove_runtime_artifact(previous);
    Ok(())
}

#[cfg(unix)]
fn install_runtime_link(home: &Path, runtime: &Path, name: &str) -> Result<(), String> {
    use std::os::unix::fs::symlink;

    let destination = home.join(name);
    let next = home.join(format!(".{name}.next"));
    let previous = home.join(format!(".{name}.previous"));
    if !path_entry_exists(&destination) && path_entry_exists(&previous) {
        fs::rename(&previous, &destination).map_err(|error| {
            format!(
                "restore interrupted Breve runtime link {}: {error}",
                destination.display()
            )
        })?;
    }
    if path_entry_exists(&destination) && path_entry_exists(&previous) {
        remove_runtime_artifact(&previous)?;
    }
    remove_runtime_artifact(&next)?;

    let relative_target = PathBuf::from("..").join(
        runtime
            .file_name()
            .ok_or_else(|| format!("runtime has no file name: {}", runtime.display()))?,
    );
    let relative_target = relative_target.join(name);
    if fs::read_link(&destination).ok().as_deref() == Some(relative_target.as_path()) {
        return Ok(());
    }
    symlink(&relative_target, &next).map_err(|error| {
        format!(
            "stage Breve runtime link {} to {}: {error}",
            next.display(),
            relative_target.display()
        )
    })?;
    if path_entry_exists(&destination) {
        fs::rename(&destination, &previous).map_err(|error| {
            format!(
                "preserve previous Breve runtime entry {}: {error}",
                destination.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&next, &destination) {
        let rollback = if path_entry_exists(&previous) {
            fs::rename(&previous, &destination).err()
        } else {
            None
        };
        return Err(match rollback {
            Some(rollback) => format!(
                "activate Breve runtime link {}: {error}; rollback also failed: {rollback}",
                destination.display()
            ),
            None => format!(
                "activate Breve runtime link {}: {error}; previous entry restored",
                destination.display()
            ),
        });
    }
    let _ = remove_runtime_artifact(&previous);
    Ok(())
}

#[cfg(not(unix))]
fn install_runtime_link(_home: &Path, _runtime: &Path, _name: &str) -> Result<(), String> {
    Err("Breve's managed runtime currently requires filesystem aliases".into())
}

fn install_runtime_links(home: &Path, runtime: &Path) -> Result<(), String> {
    fs::create_dir_all(home).map_err(|error| format!("create {}: {error}", home.display()))?;
    for name in [
        "scripts",
        "skills",
        "docs",
        "node_modules",
        "package.json",
        "bun.lock",
    ] {
        install_runtime_link(home, runtime, name)?;
    }
    Ok(())
}

fn sync_runtime_at(
    source: &Path,
    home: &Path,
    backup_dir: &Path,
    bun: &Path,
) -> Result<PathBuf, String> {
    let parent = home
        .parent()
        .ok_or_else(|| format!("Breve runtime has no parent: {}", home.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    let install_target = parent.join("breve.install");
    crate::fsutil::with_file_lock(&install_target, || {
        let runtime = parent.join(RUNTIME_CODE);
        recover_runtime_swap(&runtime)?;
        relocate_legacy_bundle(home, backup_dir)?;
        let next = parent.join(RUNTIME_NEXT);
        let previous = parent.join(RUNTIME_PREVIOUS);
        if let Err(error) = prepare_runtime_stage(source, home, &next, bun) {
            let _ = remove_runtime_artifact(&next);
            return Err(error);
        }
        // Mutable configuration and scheduler state stay in `home`; defaults
        // are copy-if-absent exactly as before and never enter the code swap.
        // Do this only after the candidate passes its dependency install, so a
        // failed upgrade leaves the existing managed home byte-for-byte alone.
        let prepare_home = (|| {
            copy_tree(&source.join("defaults"), home, false)?;
            for dir in [
                "briefs",
                "logs",
                "signal",
                "signal/transcripts",
                "signal/sessions",
                "signal/queue",
            ] {
                fs::create_dir_all(home.join(dir))
                    .map_err(|error| format!("create Breve {dir}: {error}"))?;
            }
            Ok::<(), String>(())
        })();
        if let Err(error) = prepare_home {
            let _ = remove_runtime_artifact(&next);
            return Err(error);
        }
        commit_runtime_swap(&runtime, &next, &previous)?;
        install_runtime_links(home, &runtime)?;
        Ok(home.to_path_buf())
    })
}

pub fn sync_runtime(app: &AppHandle, corpus_root: &Path) -> Result<PathBuf, String> {
    let source = source_root(app)?;
    let home = corpus_root.join(MANAGED_DIR);
    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve Rotli app data: {e}"))?
        .join("breve-backups");
    let bun = find_bun();
    sync_runtime_at(&source, &home, &backup_dir, &bun)
}

fn scheduler_command(root: &Path) -> Result<Child, String> {
    let home = root.join(MANAGED_DIR);
    let logs = home.join("logs");
    fs::create_dir_all(&logs).map_err(|e| format!("create {}: {e}", logs.display()))?;
    let log_path = logs.join("rotli-supervisor.log");
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("open {}: {e}", log_path.display()))?;
    let stderr = stdout
        .try_clone()
        .map_err(|e| format!("clone scheduler log: {e}"))?;
    let home_dir = std::env::var("HOME").unwrap_or_default();
    let inherited_path = std::env::var("PATH").unwrap_or_default();
    let runtime_path = format!(
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{home_dir}/.bun/bin:{home_dir}/.claude/local:{home_dir}/.local/bin:{inherited_path}"
    );
    let mut command = Command::new(find_bun());
    command
        .arg(home.join("scripts/rotli-scheduler.ts"))
        .current_dir(&home)
        .env("ROTLI_BREVE_HOME", &home)
        .env("ROTLI_BREVE_CODE", root.join(".rotli").join(RUNTIME_CODE))
        .env("ROTLI_BREVE_CONFIG", root.join(ROUTINE_CONFIG))
        .env("ROTLI_BREVE_SKILL", home.join("skills/breve/SKILL.md"))
        // Pin the runtime's knowledge + storage lanes to THIS vault so the
        // brief/audio paths agree with rotli by construction — config.ts
        // honors these over config.local.json, whose example points at
        // ~/memex-storage (review, 2026-07-31: the audio player would be a
        // silent no-op on a default configuration).
        .env("BREVE_KNOWLEDGE", root)
        .env("BREVE_STORAGE", root.join("storage"))
        // The scheduler exits its entire process group if this owner vanishes
        // without a graceful Tauri Exit event (crash, SIGKILL, updater, etc.).
        .env("ROTLI_PARENT_PID", std::process::id().to_string())
        .env("PATH", runtime_path)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // The scheduler and every job/daemon it starts form one process group,
        // so Rotli can stop the entire managed runtime without orphaning Signal.
        command.process_group(0);
    }
    command
        .spawn()
        .map_err(|e| format!("start Rotli Breve scheduler: {e}"))
}

#[cfg(unix)]
fn terminate_group(pid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(unix))]
fn terminate_group(_pid: u32) {}

fn stop_child(child: &mut Child) {
    terminate_group(child.id());
    for _ in 0..20 {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl BreveSupervisor {
    pub fn start(&self, app: &AppHandle, root: PathBuf) -> Result<(), String> {
        // `tauri dev` is a visual/interaction review surface. It must never
        // sync code into the live managed runtime or launch a second scheduler.
        if cfg!(debug_assertions) {
            return Ok(());
        }
        if !root.join(MANAGED_MARKER).is_file() {
            return Ok(());
        }
        let mut slot = self
            .inner
            .child
            .lock()
            .map_err(|_| "Breve supervisor lock poisoned")?;
        if slot.is_some() {
            return Ok(());
        }
        // Keep duplicate/concurrent start calls outside runtime installation.
        // Otherwise one caller could swap the code bundle while the existing
        // scheduler is still spawning jobs from it.
        sync_runtime(app, &root)?;
        self.inner.stopping.store(false, Ordering::SeqCst);
        *self
            .inner
            .root
            .lock()
            .map_err(|_| "Breve root lock poisoned")? = Some(root.clone());
        *slot = Some(scheduler_command(&root)?);
        drop(slot);

        let inner = self.inner.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(5));
            if inner.stopping.load(Ordering::SeqCst) {
                break;
            }
            let mut dead_group = None;
            let needs_restart = match inner.child.lock() {
                Ok(mut slot) => match slot.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(None) => false,
                        Ok(Some(_)) | Err(_) => {
                            dead_group = Some(child.id());
                            *slot = None;
                            true
                        }
                    },
                    None => true,
                },
                Err(_) => break,
            };
            if !needs_restart {
                continue;
            }
            if let Some(pid) = dead_group {
                terminate_group(pid);
            }
            std::thread::sleep(Duration::from_secs(2));
            if inner.stopping.load(Ordering::SeqCst) {
                break;
            }
            let Some(root) = inner.root.lock().ok().and_then(|r| r.clone()) else {
                break;
            };
            if let Ok(mut child) = inner.child.lock() {
                if child.is_none() {
                    *child = scheduler_command(&root).ok();
                }
            }
        });
        Ok(())
    }

    pub fn stop(&self) {
        self.inner.stopping.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.inner.child.lock() {
            if let Some(child) = slot.as_mut() {
                stop_child(child);
            }
            *slot = None;
        }
    }

    pub fn running(&self) -> bool {
        let Ok(mut slot) = self.inner.child.lock() else {
            return false;
        };
        match slot.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) | Err(_) => {
                    *slot = None;
                    false
                }
            },
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn runtime_source(root: &Path, version: &str) {
        for dir in ["scripts", "skills/breve", "docs", "defaults"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        fs::write(
            root.join("scripts/rotli-scheduler.ts"),
            format!("// scheduler {version}"),
        )
        .unwrap();
        fs::write(root.join("scripts/version.ts"), version).unwrap();
        fs::write(root.join("skills/breve/SKILL.md"), "home={{BREVE_HOME}}").unwrap();
        fs::write(root.join("docs/README.md"), version).unwrap();
        fs::write(root.join("defaults/package.json"), "{}").unwrap();
        fs::write(root.join("defaults/bun.lock"), "lock").unwrap();
        fs::write(root.join("defaults/policy.json"), "{}").unwrap();
    }

    #[cfg(unix)]
    fn fake_bun(root: &Path, exit: i32) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join(format!("bun-{exit}"));
        let body = if exit == 0 {
            "#!/bin/sh\nmkdir -p node_modules\nprintf installed > node_modules/proof\nexit 0\n"
                .to_string()
        } else {
            format!("#!/bin/sh\nexit {exit}\n")
        };
        fs::write(&path, body).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[test]
    fn copy_tree_preserves_mutable_defaults_but_updates_code() {
        let source = tempdir().unwrap();
        let target = tempdir().unwrap();
        fs::write(source.path().join("x"), "new").unwrap();
        fs::write(target.path().join("x"), "mine").unwrap();
        copy_tree(source.path(), target.path(), false).unwrap();
        assert_eq!(fs::read_to_string(target.path().join("x")).unwrap(), "mine");
        copy_tree(source.path(), target.path(), true).unwrap();
        assert_eq!(fs::read_to_string(target.path().join("x")).unwrap(), "new");
    }

    #[test]
    fn legacy_bundle_is_relocated_outside_the_managed_memex() {
        let home = tempdir().unwrap();
        let backups = tempdir().unwrap();
        fs::write(home.path().join("legacy-repo.bundle"), b"legacy bytes").unwrap();

        let target = relocate_legacy_bundle(home.path(), backups.path())
            .unwrap()
            .unwrap();

        assert!(!home.path().join("legacy-repo.bundle").exists());
        assert_eq!(fs::read(target).unwrap(), b"legacy bytes");
    }

    #[test]
    fn legacy_bundle_relocation_never_overwrites_an_existing_backup() {
        let home = tempdir().unwrap();
        let backups = tempdir().unwrap();
        fs::write(home.path().join("legacy-repo.bundle"), b"new").unwrap();
        fs::write(backups.path().join("legacy-repo.bundle"), b"existing").unwrap();

        let target = relocate_legacy_bundle(home.path(), backups.path())
            .unwrap()
            .unwrap();

        assert_eq!(target.file_name().unwrap(), "legacy-repo-1.bundle");
        assert_eq!(
            fs::read(backups.path().join("legacy-repo.bundle")).unwrap(),
            b"existing"
        );
        assert_eq!(fs::read(target).unwrap(), b"new");
    }

    #[test]
    fn missing_legacy_bundle_is_a_no_op() {
        let home = tempdir().unwrap();
        let backups = tempdir().unwrap();
        assert!(relocate_legacy_bundle(home.path(), backups.path())
            .unwrap()
            .is_none());
    }

    #[test]
    fn missing_bun_reports_the_breve_requirement_and_recovery() {
        let error = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let message = breve_install_spawn_error(Path::new("/missing/bun"), &error);

        assert!(message.contains("Bun is required to install Breve's pinned dependencies"));
        assert!(message.contains("/missing/bun"));
        assert!(message.contains("install Bun and restart Rotli"));
    }

    #[cfg(unix)]
    #[test]
    fn failed_breve_upgrade_leaves_the_complete_previous_runtime_untouched() {
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        let home = root.path().join("vault/.rotli/breve");
        let backups = root.path().join("backups");
        runtime_source(&source, "new");
        fs::create_dir_all(home.join("scripts")).unwrap();
        fs::write(home.join("scripts/version.ts"), "old").unwrap();
        fs::write(home.join("recipients.json"), "private").unwrap();

        let error =
            sync_runtime_at(&source, &home, &backups, &fake_bun(root.path(), 7)).unwrap_err();

        assert!(error.contains("staged runtime was discarded"), "{error}");
        assert_eq!(
            fs::read_to_string(home.join("scripts/version.ts")).unwrap(),
            "old"
        );
        assert_eq!(
            fs::read_to_string(home.join("recipients.json")).unwrap(),
            "private"
        );
        assert!(!root.path().join("vault/.rotli/breve-runtime.next").exists());
    }

    #[cfg(unix)]
    #[test]
    fn successful_breve_upgrade_atomically_replaces_code_and_preserves_private_state() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        let home = root.path().join("vault/.rotli/breve");
        let backups = root.path().join("backups");
        let canonical_briefs = root.path().join("vault/wiki/reference/briefs");
        runtime_source(&source, "new");
        fs::create_dir_all(home.join("scripts")).unwrap();
        fs::create_dir_all(&canonical_briefs).unwrap();
        fs::write(home.join("scripts/version.ts"), "old").unwrap();
        fs::write(home.join("recipients.json"), "private").unwrap();
        symlink(&canonical_briefs, home.join("briefs")).unwrap();

        sync_runtime_at(&source, &home, &backups, &fake_bun(root.path(), 0)).unwrap();

        assert_eq!(
            fs::read_to_string(home.join("scripts/version.ts")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(home.join("recipients.json")).unwrap(),
            "private"
        );
        assert_eq!(
            fs::read_link(home.join("briefs")).unwrap(),
            canonical_briefs
        );
        assert_eq!(
            fs::read_to_string(home.join("node_modules/proof")).unwrap(),
            "installed"
        );
        assert!(!root
            .path()
            .join("vault/.rotli/breve-runtime.previous")
            .exists());
    }

    #[cfg(unix)]
    #[test]
    fn interrupted_breve_swap_restores_previous_code_before_retrying() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        let rotli = root.path().join("vault/.rotli");
        let home = rotli.join("breve");
        let previous = rotli.join(RUNTIME_PREVIOUS);
        let next = rotli.join(RUNTIME_NEXT);
        runtime_source(&source, "new");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(previous.join("scripts")).unwrap();
        fs::create_dir_all(&next).unwrap();
        fs::write(previous.join("scripts/version.ts"), "old").unwrap();
        fs::write(next.join("partial"), "incomplete").unwrap();
        symlink("../breve-runtime/scripts", home.join("scripts")).unwrap();

        sync_runtime_at(
            &source,
            &home,
            &root.path().join("backups"),
            &fake_bun(root.path(), 9),
        )
        .unwrap_err();

        assert_eq!(
            fs::read_to_string(home.join("scripts/version.ts")).unwrap(),
            "old"
        );
        assert!(!next.exists());
        assert!(!previous.exists());
    }
}
