//! Rotli Helper's vault lane: ONE folder the person at the keyboard chose,
//! served to a paired Rotli Web page as plain file operations, so a browser
//! without the File System Access API (Zen, Firefox, Brave with its flag off)
//! still writes real files instead of a copy.
//!
//! What the page can and cannot do:
//! - It never names a folder. The root comes from `rotli-helper --vault <dir>`
//!   or from `vault_choose`, which opens the OS's own folder picker for the
//!   user; the page only learns the folder's NAME and a stable id.
//! - Every path is relative to that root and resolved by
//!   `containment::resolve_beneath`: normal components only, no symlink at any
//!   existing component, canonical prefix check. `..`, absolute paths, drive
//!   prefixes, and backslashes are refused before the filesystem is touched.
//! - Symlinks are not followed and not listed (the Mac corpus walk skips them
//!   the same way), so one link cannot widen the served tree.
//! - `.git/` is never written, moved into, or removed.
//! - Writes are atomic (temp file + rename) and optionally revision-gated
//!   (`${mtimeMs}:${size}`, the page's `FolderVaultStore` stamp), so a queued
//!   edit replayed after an outage cannot silently overwrite a newer file.
//!
//! Nothing here touches the network. The secure-prose ledger is warmed from
//! the served vault so `cli_complete`'s `blocked_for_remote` gate guards the
//! notes this vault actually holds.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde_json::{json, Map, Value};

use crate::containment::resolve_beneath;

pub(crate) const CONFIG_FILE: &str = "vault.json";
const WRITE_PREFIX: &str = ".rotli-write-";
/// Build output and history nobody edits from Rotli: never walked or listed.
const SKIPPED_DIRS: [&str; 2] = [".git", "node_modules"];
/// A walk that finds more than this is not a notes vault (a home folder, a
/// drive root); it is refused rather than streamed.
const MAX_WALK_ENTRIES: usize = 200_000;
/// One `vault_read_many` answer's text budget; the page asks again for the rest.
const READ_MANY_BUDGET: usize = 12 * 1024 * 1024;

pub(crate) type Refusal = (u16, String);
pub(crate) type Picker = Box<dyn Fn() -> Result<Option<PathBuf>, String> + Send + Sync>;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct VaultConfig {
    /// Canonical and absolute.
    pub(crate) root: PathBuf,
    /// Minted per root; the page binds to it, so a helper later pointed at a
    /// different folder is caught instead of written into.
    pub(crate) id: String,
}

pub(crate) struct ServedVault {
    config_path: PathBuf,
    /// The config as last read, keyed by the file's mtime: `rotli-helper
    /// --vault` in a terminal rewrites the file and the running helper follows.
    cached: Mutex<(Option<SystemTime>, Option<VaultConfig>)>,
    picker: Picker,
    picking: Mutex<bool>,
}

impl ServedVault {
    pub(crate) fn new(config_dir: &Path, picker: Picker) -> Self {
        let served = Self {
            config_path: config_dir.join(CONFIG_FILE),
            cached: Mutex::new((None, None)),
            picker,
            picking: Mutex::new(false),
        };
        if let Some(config) = served.current() {
            warm_ledger(&config.root);
        }
        served
    }

    /// The vault being served now, re-read when the config file changed.
    pub(crate) fn current(&self) -> Option<VaultConfig> {
        let stamp = fs::metadata(&self.config_path).and_then(|m| m.modified()).ok();
        let mut cached = self.cached.lock().unwrap_or_else(|p| p.into_inner());
        if cached.0 != stamp || (stamp.is_some() && cached.1.is_none()) {
            let config = stamp.and_then(|_| read_config(&self.config_path));
            if config.is_some() && cached.1 != config {
                if let Some(config) = &config {
                    warm_ledger(&config.root);
                }
            }
            *cached = (stamp, config);
        }
        cached.1.clone()
    }

    /// Serve `folder` from now on. The same root keeps its id; a new one
    /// gets a new id, so a page bound to the old vault notices.
    pub(crate) fn choose(&self, folder: &Path) -> Result<VaultConfig, String> {
        let config = choose_config(&self.config_path, folder)?;
        warm_ledger(&config.root);
        let stamp = fs::metadata(&self.config_path).and_then(|m| m.modified()).ok();
        *self.cached.lock().unwrap_or_else(|p| p.into_inner()) = (stamp, Some(config.clone()));
        Ok(config)
    }

    pub(crate) fn dispatch(&self, command: &str, args: &Value) -> Result<Value, Refusal> {
        if command == "vault_choose" {
            return self.pick();
        }
        let Some(config) = self.current() else {
            // info answers "nothing served" so the page can offer the picker
            if command == "vault_info" {
                return Ok(Value::Null);
            }
            return Err((409, "Rotli Helper isn't serving a vault yet — choose one first.".into()));
        };
        let root = config.root.as_path();
        match command {
            "vault_info" => Ok(info(&config)),
            "vault_walk" => walk(root, &path_arg(args, "path")?),
            "vault_list" => list(root, &path_arg(args, "path")?),
            "vault_stat" => stat(root, &path_arg(args, "path")?),
            "vault_read" => read(root, &path_arg(args, "path")?, args.get("encoding").and_then(Value::as_str)),
            "vault_read_many" => read_many(root, args),
            "vault_write" => write(root, args),
            "vault_mkdir" => mkdir(root, &path_arg(args, "path")?),
            "vault_move" => move_file(root, &path_arg(args, "from")?, &path_arg(args, "to")?),
            "vault_remove" => remove(root, &path_arg(args, "path")?),
            _ => Err((404, "unknown command".into())),
        }
    }

    fn pick(&self) -> Result<Value, Refusal> {
        {
            let mut picking = self.picking.lock().unwrap_or_else(|p| p.into_inner());
            if *picking {
                return Err((409, "The folder picker is already open on this computer.".into()));
            }
            *picking = true;
        }
        let chosen = (self.picker)();
        *self.picking.lock().unwrap_or_else(|p| p.into_inner()) = false;
        match chosen.map_err(|e| (500, e))? {
            None => Ok(Value::Null), // the user closed the picker
            Some(folder) => self.choose(&folder).map(|config| info(&config)).map_err(|e| (400, e)),
        }
    }
}

// ── config ────────────────────────────────────────────────────────────────────

fn read_config(path: &Path) -> Option<VaultConfig> {
    let raw: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let root = PathBuf::from(raw.get("root")?.as_str()?);
    let id = raw.get("id")?.as_str()?.to_string();
    // a folder that was moved or deleted is not served; the page says so
    let root = fs::canonicalize(root).ok().filter(|r| r.is_dir())?;
    (!id.is_empty()).then_some(VaultConfig { root, id })
}

/// Validate `folder`, keep the id when it is the root already served, and
/// persist the config owner-only. Shared by `--vault` and `vault_choose`.
pub(crate) fn choose_config(config_path: &Path, folder: &Path) -> Result<VaultConfig, String> {
    let root = fs::canonicalize(folder).map_err(|e| format!("couldn't open {}: {e}", folder.display()))?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    if root.parent().is_none() {
        return Err("a whole drive can't be a vault — choose a folder".into());
    }
    let id = match read_config(config_path) {
        Some(existing) if existing.root == root => existing.id,
        _ => format!("hv_{}", uuid::Uuid::new_v4().simple()),
    };
    let dir = config_path.parent().ok_or("no config directory")?;
    crate::helper_token::ensure_private_dir(dir)?;
    let body = json!({ "root": root.to_string_lossy(), "id": id });
    crate::helper_token::write_private(config_path, &format!("{body:#}\n"))?;
    Ok(VaultConfig { root, id })
}

/// The Mac app's own warm-up, read-only: the ledger then holds this vault's
/// secure prose, so a chat turn that echoes it is refused before any CLI runs.
fn warm_ledger(root: &Path) {
    let warmed = crate::corpus::CorpusStore::open_read_only(root.to_path_buf())
        .and_then(|mut store| store.warm_secure_ledger());
    if let Err(error) = warmed {
        eprintln!("rotli-helper: couldn't read the vault's secure notes: {error}");
    }
}

fn info(config: &VaultConfig) -> Value {
    let name = config.root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    json!({ "name": name, "id": config.id, "empty": folder_is_empty(&config.root) })
}

/// The page's `folderIsEmpty` rule: Finder droppings and `.rotli/` don't count.
fn folder_is_empty(root: &Path) -> bool {
    fs::read_dir(root).is_ok_and(|entries| {
        entries.flatten().all(|e| matches!(e.file_name().to_str(), Some(".DS_Store" | ".rotli")))
    })
}

// ── paths ─────────────────────────────────────────────────────────────────────

/// A vault-relative POSIX path from the page, as components. "" is the root.
/// Refused before any filesystem call: `..`, a drive or root prefix, a
/// backslash or colon inside a name (Windows separators and streams).
pub(crate) fn parse_rel(raw: &str) -> Result<Vec<String>, String> {
    let mut parts = Vec::new();
    for part in raw.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains('\\') || part.contains(':') || part.contains('\0') {
            return Err(format!("not a path inside the vault: {raw}"));
        }
        parts.push(part.to_string());
    }
    // defense in depth: whatever a platform makes of the name, it must stay normal
    let joined: PathBuf = parts.iter().collect();
    if !joined.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("not a path inside the vault: {raw}"));
    }
    Ok(parts)
}

fn path_arg(args: &Value, key: &str) -> Result<Vec<String>, Refusal> {
    let raw = args.get(key).and_then(Value::as_str).ok_or_else(|| (400, format!("\"{key}\" is required")))?;
    parse_rel(raw).map_err(|e| (400, e))
}

fn resolve(root: &Path, rel: &[String]) -> Result<PathBuf, Refusal> {
    let relative: PathBuf = rel.iter().collect();
    resolve_beneath(root, &relative).map_err(|e| (400, e))
}

fn in_git(rel: &[String]) -> bool {
    rel.first().is_some_and(|first| first == ".git")
}

fn refuse_git(rel: &[String]) -> Result<(), Refusal> {
    if in_git(rel) {
        return Err((403, "Rotli never writes inside .git".into()));
    }
    Ok(())
}

fn millis(time: std::io::Result<SystemTime>) -> u64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn stat_json(metadata: &fs::Metadata) -> Value {
    let size = if metadata.is_dir() { 0 } else { metadata.len() };
    json!({ "lastModified": millis(metadata.modified()), "size": size })
}

fn revision_of(path: &Path) -> String {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() => format!("{}:{}", millis(m.modified()), m.len()),
        _ => "0".into(),
    }
}

fn joined(rel: &[String]) -> String {
    rel.join("/")
}

// ── verbs ─────────────────────────────────────────────────────────────────────

/// Every file and directory beneath `rel`, one call: what the page's notes
/// service would otherwise ask for one `stat` at a time.
fn walk(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    let start = resolve(root, rel)?;
    let mut out = Vec::new();
    if fs::symlink_metadata(&start).is_ok_and(|m| m.is_dir()) {
        walk_into(&start, &joined(rel), &mut out)?;
    }
    Ok(Value::Array(out))
}

fn walk_into(dir: &Path, prefix: &str, out: &mut Vec<Value>) -> Result<(), Refusal> {
    let Ok(entries) = fs::read_dir(dir) else { return Ok(()) };
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        // file_type() does not follow links: a symlink is neither, and skipped
        let Ok(kind) = entry.file_type() else { continue };
        let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        if kind.is_dir() {
            if SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            let metadata = entry.metadata().map_err(|e| (500, e.to_string()))?;
            out.push(json!({ "path": path, "kind": "directory", "lastModified": millis(metadata.modified()), "size": 0 }));
            if out.len() > MAX_WALK_ENTRIES {
                return Err((413, "This folder holds too many files to be a notes vault.".into()));
            }
            walk_into(&entry.path(), &path, out)?;
        } else if kind.is_file() {
            let metadata = entry.metadata().map_err(|e| (500, e.to_string()))?;
            out.push(json!({ "path": path, "kind": "file", "lastModified": millis(metadata.modified()), "size": metadata.len() }));
            if out.len() > MAX_WALK_ENTRIES {
                return Err((413, "This folder holds too many files to be a notes vault.".into()));
            }
        }
    }
    Ok(())
}

fn list(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    let dir = resolve(root, rel)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(json!([])) };
    let mut out: Vec<(String, &str)> = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() && !SKIPPED_DIRS.contains(&name.as_str()) {
            out.push((name, "directory"));
        } else if kind.is_file() {
            out.push((name, "file"));
        }
    }
    out.sort();
    Ok(Value::Array(out.into_iter().map(|(name, kind)| json!({ "name": name, "kind": kind })).collect()))
}

fn stat(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    let path = resolve(root, rel)?;
    match fs::symlink_metadata(&path) {
        Ok(m) if m.is_file() || m.is_dir() => Ok(stat_json(&m)),
        _ => Ok(Value::Null),
    }
}

fn read(root: &Path, rel: &[String], encoding: Option<&str>) -> Result<Value, Refusal> {
    let path = resolve(root, rel)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == ErrorKind::NotFound => return Err((404, format!("no such file: {}", joined(rel)))),
        Err(e) => return Err((500, format!("couldn't read {}: {e}", joined(rel)))),
    };
    Ok(Value::String(if encoding == Some("base64") {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }))
}

/// Many texts in one answer, up to a budget; `more` lists what didn't fit.
fn read_many(root: &Path, args: &Value) -> Result<Value, Refusal> {
    let paths = args.get("paths").and_then(Value::as_array).ok_or((400, "\"paths\" is required".to_string()))?;
    let mut files = Map::new();
    let mut more = Vec::new();
    let mut spent = 0usize;
    for raw in paths {
        let raw = raw.as_str().ok_or((400, "every path must be a string".to_string()))?;
        if spent >= READ_MANY_BUDGET {
            more.push(Value::String(raw.to_string()));
            continue;
        }
        let rel = parse_rel(raw).map_err(|e| (400, e))?;
        let text = match read(root, &rel, None) {
            Ok(Value::String(text)) => Value::String(text),
            Err((404, _)) => Value::Null,
            Err(refusal) => return Err(refusal),
            Ok(_) => Value::Null,
        };
        spent += text.as_str().map_or(0, str::len);
        files.insert(raw.to_string(), text);
    }
    Ok(json!({ "files": files, "more": more }))
}

fn write(root: &Path, args: &Value) -> Result<Value, Refusal> {
    let rel = path_arg(args, "path")?;
    if rel.is_empty() {
        return Err((400, "a file needs a name".into()));
    }
    refuse_git(&rel)?;
    let bytes = match (args.get("text").and_then(Value::as_str), args.get("base64").and_then(Value::as_str)) {
        (Some(text), None) => text.as_bytes().to_vec(),
        (None, Some(encoded)) => base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|_| (400, "\"base64\" is not valid base64".to_string()))?,
        _ => return Err((400, "send exactly one of \"text\" or \"base64\"".into())),
    };
    let target = resolve(root, &rel)?;
    if target.is_dir() {
        return Err((409, format!("a directory already holds {}", joined(&rel))));
    }
    if let Some(expected) = args.get("expectedRevision").and_then(Value::as_str) {
        let current = revision_of(&target);
        if current != expected {
            return Err((409, format!("revision conflict: expected {expected}, found {current}; the file changed on disk")));
        }
    }
    make_parents(root, &rel)?;
    crate::fsutil::atomic_write_bytes(&target, &bytes, WRITE_PREFIX).map_err(|e| (500, e))?;
    let metadata = fs::metadata(&target).map_err(|e| (500, e.to_string()))?;
    Ok(stat_json(&metadata))
}

/// Create the parent chain of `rel`, each level re-resolved so no created
/// directory can land under a symlink.
fn make_parents(root: &Path, rel: &[String]) -> Result<(), Refusal> {
    for depth in 1..rel.len() {
        let dir = resolve(root, &rel[..depth])?;
        match fs::symlink_metadata(&dir) {
            Ok(m) if m.is_dir() => {}
            Ok(_) => return Err((409, format!("a file already holds {}", joined(&rel[..depth])))),
            Err(_) => fs::create_dir(&dir).or_else(|e| if dir.is_dir() { Ok(()) } else { Err(e) }).map_err(|e| (500, format!("couldn't create {}: {e}", joined(&rel[..depth]))))?,
        }
    }
    Ok(())
}

fn mkdir(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    refuse_git(rel)?;
    if rel.is_empty() {
        return Ok(Value::Null);
    }
    let mut full = rel.to_vec();
    full.push(String::new()); // make_parents creates every level above the last
    make_parents(root, &full[..])?;
    Ok(Value::Null)
}

fn move_file(root: &Path, from: &[String], to: &[String]) -> Result<Value, Refusal> {
    refuse_git(from)?;
    refuse_git(to)?;
    if to.is_empty() {
        return Err((400, "a file needs a name".into()));
    }
    if from == to {
        return Ok(Value::Null);
    }
    let source = resolve(root, from)?;
    if !fs::symlink_metadata(&source).is_ok_and(|m| m.is_file()) {
        return Err((404, format!("no such file: {}", joined(from))));
    }
    let target = resolve(root, to)?;
    if target.is_dir() {
        return Err((409, format!("a directory already holds {}", joined(to))));
    }
    make_parents(root, to)?;
    if fs::rename(&source, &target).is_err() {
        // a different volume under the same root: copy, then remove
        fs::copy(&source, &target).map_err(|e| (500, format!("couldn't move {}: {e}", joined(from))))?;
        fs::remove_file(&source).map_err(|e| (500, format!("couldn't remove {}: {e}", joined(from))))?;
    }
    Ok(Value::Null)
}

fn remove(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    refuse_git(rel)?;
    if rel.is_empty() {
        return Err((400, "the vault itself can't be removed".into()));
    }
    let path = resolve(root, rel)?;
    match fs::symlink_metadata(&path) {
        Err(_) => Ok(Value::Null),
        Ok(m) if m.is_dir() => match fs::remove_dir(&path) {
            Ok(()) => Ok(Value::Null),
            Err(_) if fs::read_dir(&path).is_ok_and(|mut e| e.next().is_some()) => {
                Err((409, format!("“{}” isn't empty", rel.last().map_or("", String::as_str))))
            }
            Err(e) => Err((500, e.to_string())),
        },
        Ok(_) => fs::remove_file(&path).map(|()| Value::Null).map_err(|e| (500, e.to_string())),
    }
}

#[cfg(test)]
#[path = "helper_vault_tests.rs"]
mod tests;
