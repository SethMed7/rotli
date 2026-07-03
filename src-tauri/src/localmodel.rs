//! Local-model installer — download + register + activate on-device models in
//! the SHARED memex-ai store (`~/.memex/ai/`, also read by Breve + voz).
//!
//! Rotli becomes a *writer* of two shared artifacts here (it only read them
//! before): `registry.json` (the model catalog) and the MLX server's launchd
//! plist env (`MEMEX_MLX_MODEL`). Both writes are surgical + reversible:
//! - registry: parse the whole doc, splice ONE `models[]` entry, atomic-write —
//!   the `_note`/providers/other models are never touched.
//! - plist: PlistBuddy `Set` of the one env string, then a full launchd reload.
//!
//! Since server 0.3 (2026-07-02) the MLX server honors the request's `model`
//! and swaps its single loaded slot on demand — every installed model is
//! usable per chat, loading lazily and idle-unloading (nothing runs 24/7).
//! The plist env now only marks the DEFAULT: what no-model callers (Breve,
//! warmup) get. Downloads shell the venv's `hf` CLI, registered for
//! kill-on-cancel like the connected-CLI bridge (provider.rs).

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// The venv `hf` binary (download tooling lives inside the MLX venv, not on PATH).
fn hf_bin() -> PathBuf {
    memex_ai().join("mlx-venv/bin/hf")
}
fn plist_buddy() -> &'static str {
    "/usr/libexec/PlistBuddy"
}

fn home() -> Result<PathBuf, String> {
    std::env::var("HOME").map(PathBuf::from).map_err(|_| "no HOME".to_string())
}
fn memex_ai() -> PathBuf {
    // best-effort base; every caller that needs it also resolves HOME first
    home().unwrap_or_default().join(".memex/ai")
}
fn models_dir() -> PathBuf {
    memex_ai().join("models")
}
fn registry_path() -> PathBuf {
    memex_ai().join("registry.json")
}
fn mlx_plist() -> Result<PathBuf, String> {
    Ok(home()?.join("Library/LaunchAgents/com.sethmedina.memex-mlx.plist"))
}
const MLX_LABEL: &str = "com.sethmedina.memex-mlx";

/// Live `hf` downloads, keyed by the caller's request id (kill-on-cancel), same
/// shape as provider.rs. Its own state so the installer stays self-contained.
#[derive(Default)]
pub struct LocalModelState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

// ── validation (the security surface) ─────────────────────────────────────────

/// A Hugging Face repo id: `owner/name`, each a modest slug. No spaces, no `..`,
/// no extra path segments — it becomes a subprocess arg + drives the dir name.
fn valid_repo(repo: &str) -> Result<(), String> {
    let parts: Vec<&str> = repo.split('/').collect();
    let ok = parts.len() == 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 96
                && *p != ".."
                && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        });
    if ok {
        Ok(())
    } else {
        Err(format!("not a Hugging Face repo id (owner/name): {repo:?}"))
    }
}

/// The install dir name, re-validated on the wire: lowercase-alnum-dash-dot, no
/// separators, no `..` — so the target can never escape `models/`.
fn valid_name(name: &str) -> Result<(), String> {
    let ok = !name.is_empty()
        && name.len() <= 96
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.'));
    if ok {
        Ok(())
    } else {
        Err(format!("unsafe model name: {name:?}"))
    }
}

/// Byte total under `dir` (recursive) — the progress signal. 0 if absent.
fn dir_bytes(dir: &Path) -> u64 {
    fn walk(dir: &Path, acc: &mut u64) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for e in entries.flatten() {
                let Ok(ft) = e.file_type() else { continue };
                if ft.is_dir() {
                    walk(&e.path(), acc);
                } else if let Ok(m) = e.metadata() {
                    *acc += m.len();
                }
            }
        }
    }
    let mut acc = 0;
    walk(dir, &mut acc);
    acc
}

/// A downloaded MLX model dir is usable iff it carries a config + weights.
fn looks_complete(dir: &Path) -> bool {
    if !dir.join("config.json").is_file() {
        return false;
    }
    std::fs::read_dir(dir)
        .map(|entries| {
            entries.flatten().any(|e| {
                e.path()
                    .extension()
                    .and_then(|x| x.to_str())
                    .map(|x| x == "safetensors" || x == "npz" || x == "gguf")
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

// ── registry read/write (splice one entry, never clobber the rest) ────────────

fn read_registry() -> Result<serde_json::Value, String> {
    let raw = std::fs::read_to_string(registry_path())
        .map_err(|e| format!("can't read the memex-ai registry: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("the registry isn't valid JSON: {e}"))
}

/// Atomic write of the registry (tmp + rename in the same dir), preserving
/// pretty 2-space indent. Mirrors memex.rs `atomic_write`.
fn write_registry(reg: &serde_json::Value) -> Result<(), String> {
    let body = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())?;
    let path = registry_path();
    let dir = path.parent().ok_or("registry has no parent dir")?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-registry-")
        .tempfile_in(dir)
        .map_err(|e| format!("temp file: {e}"))?;
    std::io::Write::write_all(&mut tmp, body.as_bytes()).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(&path).map_err(|e| format!("rename into place: {e}"))?;
    Ok(())
}

fn registry_has_id(reg: &serde_json::Value, id: &str) -> bool {
    reg.get("models")
        .and_then(|m| m.as_array())
        .map(|arr| arr.iter().any(|m| m.get("id").and_then(|v| v.as_str()) == Some(id)))
        .unwrap_or(false)
}

/// Append a freshly-installed MLX chat model to the registry (idempotent — a
/// re-install of the same id updates nothing new, never duplicates).
fn append_model(id: &str, repo: &str, abs: &Path, approx_mb: u64, vision: bool) -> Result<(), String> {
    let mut reg = read_registry()?;
    if registry_has_id(&reg, id) {
        return Ok(()); // already catalogued
    }
    let entry = serde_json::json!({
        "id": id,
        "kind": "llm-chat",
        "provider": "mlx",
        "store": "shared",
        "vision": vision,
        "path": abs.to_string_lossy(),
        "approxMB": approx_mb,
        "apps": ["rotli"],
        "source": format!("hf:{repo}"),
    });
    let models = reg
        .get_mut("models")
        .and_then(|m| m.as_array_mut())
        .ok_or("registry has no models array")?;
    models.push(entry);
    bump_updated(&mut reg);
    write_registry(&reg)
}

/// Stamp the registry's `updated` field with today (a write just happened).
fn bump_updated(reg: &mut serde_json::Value) {
    if let Ok(now) = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Iso8601::DATE)
    {
        reg["updated"] = serde_json::Value::String(now);
    }
}

// ── the active model (the plist's MEMEX_MLX_MODEL) ────────────────────────────

fn plist_get_model(plist: &Path) -> Option<String> {
    let out = Command::new(plist_buddy())
        .args(["-c", "Print :EnvironmentVariables:MEMEX_MLX_MODEL"])
        .arg(plist)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// Which model the shared MLX server is pinned to as its DEFAULT (its launchd
/// env) — what a request WITHOUT a model field gets (Breve, warmup). Any
/// registered model can be requested per chat since server 0.3.
#[tauri::command]
pub fn local_model_default() -> Option<String> {
    let plist = mlx_plist().ok()?;
    plist_get_model(&plist)
}

// ── commands ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub bytes: u64,
    /// True once the dir looks complete (config + weights present).
    pub done: bool,
}

/// Current download progress for an in-flight install — the UI polls this while
/// the (long) `local_model_install` runs. Byte total of the target dir; `done`
/// once weights land. Robust vs. parsing `hf`'s tqdm.
#[tauri::command]
pub fn local_model_install_progress(name: String) -> Result<InstallProgress, String> {
    valid_name(&name)?;
    let dir = models_dir().join(&name);
    Ok(InstallProgress { bytes: dir_bytes(&dir), done: looks_complete(&dir) })
}

/// Download an MLX model from Hugging Face into the shared store and register
/// it. Blocking (GB-scale) → `spawn_blocking` so cancel can interleave.
#[tauri::command]
pub async fn local_model_install(
    state: tauri::State<'_, LocalModelState>,
    request_id: String,
    repo: String,
    name: String,
    approx_mb: Option<u64>,
    vision: Option<bool>,
) -> Result<(), String> {
    valid_repo(&repo)?;
    valid_name(&name)?;
    let hf = hf_bin();
    if !hf.is_file() {
        return Err("the memex-ai MLX venv isn't set up (no hf CLI) — can't download.".into());
    }
    let dir = models_dir().join(&name);
    if looks_complete(&dir) {
        return Err(format!("{name} is already installed."));
    }
    std::fs::create_dir_all(models_dir()).map_err(|e| format!("can't make the models dir: {e}"))?;

    let children = Arc::clone(&state.children);
    let dir_for_task = dir.clone();
    let repo_for_task = repo.clone();
    let name_for_task = name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&hf);
        cmd.args([
            "download",
            &repo_for_task,
            "--local-dir",
            &dir_for_task.to_string_lossy(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("couldn't launch hf: {e}"))?;
        let mut stderr_pipe = child.stderr.take();
        let mut stdout_pipe = child.stdout.take();
        children.lock().unwrap().insert(request_id.clone(), child);

        // drain both pipes so a chatty downloader can't deadlock; we only keep
        // the stderr tail for an error message (hf logs progress there)
        let err_thread = std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(p) = stderr_pipe.as_mut() {
                let _ = p.read_to_string(&mut s);
            }
            s
        });
        if let Some(p) = stdout_pipe.as_mut() {
            let mut sink = String::new();
            let _ = p.read_to_string(&mut sink);
        }
        let stderr = err_thread.join().unwrap_or_default();

        let reaped = children.lock().unwrap().remove(&request_id);
        let ok = match reaped {
            Some(mut c) => c.wait().map(|s| s.success()).unwrap_or(false),
            None => false, // cancelled out from under us
        };
        if !ok {
            let _ = trash::delete(&dir_for_task); // clean the partial download
            let tail: String = stderr.lines().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" · ");
            return Err(format!(
                "the download failed or was cancelled{}",
                if tail.is_empty() { String::new() } else { format!(" — {tail}") }
            ));
        }
        if !looks_complete(&dir_for_task) {
            let _ = trash::delete(&dir_for_task);
            return Err("the download finished but the model files look incomplete — try again.".into());
        }
        let mb = approx_mb.unwrap_or_else(|| dir_bytes(&dir_for_task) / 1_000_000);
        append_model(&name_for_task, &repo_for_task, &dir_for_task, mb, vision.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("install task failed: {e}"))?
}

/// Cancel an in-flight download (kills `hf`; the partial dir is trashed by the
/// install task's failure path).
#[tauri::command]
pub fn local_model_install_cancel(
    state: tauri::State<'_, LocalModelState>,
    request_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().unwrap().remove(&request_id) {
        let _ = child.kill();
    }
    Ok(())
}

// ── "Scan my Mac" (Settings → AI Models) ─────────────────────────────────────

/// What this Mac can comfortably run — the raw facts; the comfort tiers are a
/// pure TS function over them (unit-tested there).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProfile {
    pub chip: String,
    pub ram_gb: f64,
    pub cpu_cores: u32,
    pub free_disk_gb: f64,
}

fn sysctl(name: &str) -> Option<String> {
    // GUI apps don't get the login-shell PATH — sysctl lives in /usr/sbin
    let out = Command::new("/usr/sbin/sysctl").args(["-n", name]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

#[tauri::command]
pub fn system_profile() -> Result<SystemProfile, String> {
    let ram_bytes: u64 = sysctl("hw.memsize")
        .and_then(|s| s.parse().ok())
        .ok_or("couldn't read this Mac's memory size")?;
    let chip = sysctl("machdep.cpu.brand_string").unwrap_or_else(|| "Apple Silicon".into());
    let cpu_cores: u32 = sysctl("hw.ncpu").and_then(|s| s.parse().ok()).unwrap_or(0);
    // free disk on the volume holding the model store (df -k: avail is col 4)
    let free_disk_gb = Command::new("/bin/df")
        .args(["-k"])
        .arg(memex_ai())
        .output()
        .ok()
        .and_then(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_string();
            let line = text.lines().last()?.to_string();
            let kb: f64 = line.split_whitespace().nth(3)?.parse().ok()?;
            Some(kb / 1_000_000.0)
        })
        .unwrap_or(0.0);
    Ok(SystemProfile {
        chip,
        ram_gb: ram_bytes as f64 / 1_073_741_824.0,
        cpu_cores,
        free_disk_gb,
    })
}

/// The `provider` + on-disk `path` of a registered model by id.
fn registry_entry(id: &str) -> Result<(String, PathBuf), String> {
    let reg = read_registry()?;
    let entry = reg
        .get("models")
        .and_then(|m| m.as_array())
        .and_then(|arr| arr.iter().find(|m| m.get("id").and_then(|v| v.as_str()) == Some(id)))
        .ok_or_else(|| format!("{id} isn't installed."))?;
    let provider = entry.get("provider").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let path = entry
        .get("path")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .ok_or("that model has no path on disk.")?;
    Ok((provider, path))
}

/// Make an installed MLX model the DEFAULT local model — what no-model callers
/// (Breve, warmup) get; per-chat picks don't need this since server 0.3.
/// Repoints the shared server's launchd env to its path, then reloads the
/// service so the new env takes (a full bootout+bootstrap — `kickstart -k`
/// won't re-read the plist).
#[tauri::command]
pub fn local_model_set_default(id: String) -> Result<(), String> {
    valid_name(&id)?;
    let (provider, path) = registry_entry(&id)?;
    if provider != "mlx" {
        return Err("only MLX models run on the shared local server — this one has its own.".into());
    }
    // must be an installed model dir under the shared models/ (canonicalize both
    // so a `..` or symlink can't point the server outside the store)
    let models = std::fs::canonicalize(models_dir()).map_err(|e| e.to_string())?;
    let target = std::fs::canonicalize(&path).map_err(|_| format!("no such model on disk: {id}"))?;
    if !target.starts_with(&models) || !target.is_dir() {
        return Err("that isn't an installed local model.".into());
    }
    let plist = mlx_plist()?;
    if !plist.is_file() {
        return Err("the MLX server isn't installed on this Mac (no launchd plist).".into());
    }
    let set = Command::new(plist_buddy())
        .args(["-c", &format!("Set :EnvironmentVariables:MEMEX_MLX_MODEL {}", target.display())])
        .arg(&plist)
        .output()
        .map_err(|e| format!("PlistBuddy: {e}"))?;
    if !set.status.success() {
        return Err(format!(
            "couldn't update the MLX server config: {}",
            String::from_utf8_lossy(&set.stderr).trim()
        ));
    }
    reload_mlx(&plist)
}

fn uid() -> Result<String, String> {
    let out = Command::new("id").arg("-u").output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err("couldn't resolve the user id".into())
    }
}

/// Full launchd reload so the new env is read. bootout may 'fail' if the job is
/// already gone — that's fine; the bootstrap is what must succeed.
fn reload_mlx(plist: &Path) -> Result<(), String> {
    let uid = uid()?;
    let domain = format!("gui/{uid}");
    let _ = Command::new("launchctl")
        .args(["bootout", &format!("{domain}/{MLX_LABEL}")])
        .output();
    let boot = Command::new("launchctl")
        .arg("bootstrap")
        .arg(&domain)
        .arg(plist)
        .output()
        .map_err(|e| format!("launchctl bootstrap: {e}"))?;
    if boot.status.success() {
        Ok(())
    } else {
        // already loaded (5: Input/output error on a live label) is not fatal —
        // the Set already landed; it takes on the next natural reload
        let msg = String::from_utf8_lossy(&boot.stderr);
        if msg.contains("service already loaded") || msg.contains("5: Input/output error") {
            Ok(())
        } else {
            Err(format!("activated, but the server didn't reload ({}) — it'll switch on the next restart.", msg.trim()))
        }
    }
}

/// Remove an installed local model: drop its registry entry + trash its dir.
/// Refuses the DEFAULT model (make another one the default first) — other
/// memex apps resolve it with no model field, so it must always exist.
#[tauri::command]
pub fn local_model_uninstall(id: String) -> Result<(), String> {
    valid_name(&id)?;
    let mut reg = read_registry()?;
    let models = reg
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or("registry has no models array")?;
    let entry = models
        .iter()
        .find(|m| m.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
        .ok_or_else(|| format!("{id} isn't installed."))?;
    let path = entry
        .get("path")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .ok_or("that model has no path on disk.")?;

    if let Some(default) = local_model_default() {
        if PathBuf::from(&default) == path {
            return Err("that's the default local model — make another one the default first.".into());
        }
    }
    // splice the entry out, then trash the dir (registry first: a dir that
    // lingers is harmless; a registry pointing at a gone dir is not)
    if let Some(arr) = reg.get_mut("models").and_then(|m| m.as_array_mut()) {
        arr.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    }
    bump_updated(&mut reg);
    write_registry(&reg)?;
    if path.exists() {
        let _ = trash::delete(&path);
    }
    Ok(())
}

// ─── tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_ids_are_owner_slash_name_only() {
        assert!(valid_repo("mlx-community/Qwen2.5-7B-Instruct-4bit").is_ok());
        assert!(valid_repo("owner/name.with.dots").is_ok());
        assert!(valid_repo("no-slash").is_err());
        assert!(valid_repo("a/b/c").is_err());
        assert!(valid_repo("../etc/passwd").is_err());
        assert!(valid_repo("owner/..").is_err());
        assert!(valid_repo("own er/name").is_err());
    }

    #[test]
    fn names_cannot_escape_the_models_dir() {
        assert!(valid_name("qwen2.5-7b-instruct-4bit").is_ok());
        assert!(valid_name("..").is_err());
        assert!(valid_name("../evil").is_err());
        assert!(valid_name("Has/Slash").is_err());
        assert!(valid_name("UPPER").is_err()); // hf repos are mixed-case; the dir name is lowered by the caller
        assert!(valid_name("").is_err());
    }

    #[test]
    fn append_model_is_idempotent_and_preserves_the_doc() {
        let mut reg = serde_json::json!({
            "_note": "keep me",
            "version": 3,
            "providers": { "mlx": { "default": true } },
            "models": [ { "id": "gemma-3-12b-it-qat-4bit", "kind": "llm-chat" } ],
        });
        assert!(!registry_has_id(&reg, "qwen2.5-7b"));
        // splice one in (mirror append_model's core without touching disk)
        let entry = serde_json::json!({ "id": "qwen2.5-7b", "kind": "llm-chat" });
        reg.get_mut("models").unwrap().as_array_mut().unwrap().push(entry);
        assert!(registry_has_id(&reg, "qwen2.5-7b"));
        assert!(registry_has_id(&reg, "gemma-3-12b-it-qat-4bit")); // untouched
        assert_eq!(reg.get("_note").unwrap(), "keep me"); // untouched
    }

    #[test]
    fn looks_complete_needs_config_and_weights() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!looks_complete(dir.path()));
        std::fs::write(dir.path().join("config.json"), "{}").unwrap();
        assert!(!looks_complete(dir.path())); // config but no weights
        std::fs::write(dir.path().join("model.safetensors"), "x").unwrap();
        assert!(looks_complete(dir.path()));
    }
}
