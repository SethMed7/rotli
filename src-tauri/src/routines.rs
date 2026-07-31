//! Rotli-owned Breve runtime supervision.
//!
//! The scheduler itself is a Bun process because the migrated Breve jobs are
//! TypeScript/Bash. Rust owns its lifecycle: materialize the versioned runtime
//! into the active corpus, start it only after an explicit takeover marker,
//! restart it after a crash, and terminate it with Rotli.

use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
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
        let kind = entry.file_type().map_err(|e| format!("stat {}: {e}", from.display()))?;
        if kind.is_dir() {
            copy_tree(&from, &to, overwrite)?;
        } else if kind.is_file() && (overwrite || !to.exists()) {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
            }
            fs::copy(&from, &to).map_err(|e| format!("copy {} to {}: {e}", from.display(), to.display()))?;
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
        return Err(format!("legacy Breve backup is not a file: {}", source.display()));
    }

    fs::create_dir_all(backup_dir)
        .map_err(|e| format!("create Breve backup directory {}: {e}", backup_dir.display()))?;
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
/// be separate but default should be same" (Seth, 2026-07-31). Both sides are
/// best-effort: defaults sharing must never fail a save or a vault open.
fn shared_defaults_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("breve-shared-defaults"))
}

pub fn mirror_shared_default(app: &AppHandle, name: &str, source: &Path) {
    let Some(dir) = shared_defaults_dir(app) else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = fs::copy(source, dir.join(name));
}

/// Seed a vault's Breve from the vault-agnostic defaults (Seth, 2026-07-31:
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
    let Some(shared) = shared_defaults_dir(app).map(|dir| dir.join(name)) else { return };
    if !shared.is_file() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::copy(&shared, target);
}

pub fn sync_runtime(app: &AppHandle, corpus_root: &Path) -> Result<PathBuf, String> {
    let source = source_root(app)?;
    let home = corpus_root.join(MANAGED_DIR);
    let backup_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve Rotli app data: {e}"))?
        .join("breve-backups");
    relocate_legacy_bundle(&home, &backup_dir)?;
    copy_tree(&source.join("scripts"), &home.join("scripts"), true)?;
    copy_tree(&source.join("skills"), &home.join("skills"), true)?;
    copy_tree(&source.join("docs"), &home.join("docs"), true)?;
    copy_tree(&source.join("defaults"), &home, false)?;
    fs::copy(source.join("defaults/package.json"), home.join("package.json"))
        .map_err(|e| format!("update Breve runtime package: {e}"))?;
    for dir in ["briefs", "logs", "signal", "signal/transcripts", "signal/sessions", "signal/queue"] {
        fs::create_dir_all(home.join(dir)).map_err(|e| format!("create Breve {dir}: {e}"))?;
    }
    let skill = home.join("skills/breve/SKILL.md");
    if let Ok(text) = fs::read_to_string(&skill) {
        fs::write(&skill, text.replace("{{BREVE_HOME}}", &home.to_string_lossy()))
            .map_err(|e| format!("materialize {}: {e}", skill.display()))?;
    }
    let install = Command::new(find_bun())
        .args(["install", "--production", "--silent"])
        .current_dir(&home)
        .status()
        .map_err(|e| format!("install Breve runtime dependencies: {e}"))?;
    if !install.success() && !home.join("node_modules").is_dir() {
        return Err("Breve runtime dependencies could not be installed".into());
    }
    Ok(home)
}

fn scheduler_command(root: &Path) -> Result<Child, String> {
    let home = root.join(MANAGED_DIR);
    let logs = home.join("logs");
    fs::create_dir_all(&logs).map_err(|e| format!("create {}: {e}", logs.display()))?;
    let log_path = logs.join("rotli-supervisor.log");
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path)
        .map_err(|e| format!("open {}: {e}", log_path.display()))?;
    let stderr = stdout.try_clone().map_err(|e| format!("clone scheduler log: {e}"))?;
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
    command.spawn().map_err(|e| format!("start Rotli Breve scheduler: {e}"))
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
        sync_runtime(app, &root)?;
        let mut slot = self.inner.child.lock().map_err(|_| "Breve supervisor lock poisoned")?;
        if slot.is_some() {
            return Ok(());
        }
        self.inner.stopping.store(false, Ordering::SeqCst);
        *self.inner.root.lock().map_err(|_| "Breve root lock poisoned")? = Some(root.clone());
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
            let Some(root) = inner.root.lock().ok().and_then(|r| r.clone()) else { break };
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
        let Ok(mut slot) = self.inner.child.lock() else { return false };
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

        let target = relocate_legacy_bundle(home.path(), backups.path()).unwrap().unwrap();

        assert!(!home.path().join("legacy-repo.bundle").exists());
        assert_eq!(fs::read(target).unwrap(), b"legacy bytes");
    }

    #[test]
    fn legacy_bundle_relocation_never_overwrites_an_existing_backup() {
        let home = tempdir().unwrap();
        let backups = tempdir().unwrap();
        fs::write(home.path().join("legacy-repo.bundle"), b"new").unwrap();
        fs::write(backups.path().join("legacy-repo.bundle"), b"existing").unwrap();

        let target = relocate_legacy_bundle(home.path(), backups.path()).unwrap().unwrap();

        assert_eq!(target.file_name().unwrap(), "legacy-repo-1.bundle");
        assert_eq!(fs::read(backups.path().join("legacy-repo.bundle")).unwrap(), b"existing");
        assert_eq!(fs::read(target).unwrap(), b"new");
    }

    #[test]
    fn missing_legacy_bundle_is_a_no_op() {
        let home = tempdir().unwrap();
        let backups = tempdir().unwrap();
        assert!(relocate_legacy_bundle(home.path(), backups.path()).unwrap().is_none());
    }
}
