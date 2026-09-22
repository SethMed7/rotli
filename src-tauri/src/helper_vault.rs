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
//! - No `.git` directory, at any depth and in any letter case, is ever
//!   written, moved into or out of, or removed.
//! - A root that CONTAINS the helper's own directory (`~/.rotli-helper`, e.g.
//!   the home folder) is refused, so the page can never rewrite the config
//!   that names the root, or read the pairing token.
//! - Every verb names the vault id the page bound to; a helper since pointed
//!   at another folder refuses before touching disk (409 "vault changed").
//! - Writes are atomic (temp file + rename), taken under the SAME `.lock`
//!   sidecar the desktop app's writes hold (`fsutil::with_file_lock`), and
//!   revision-gated: by content (`fnv1a64`, the desktop's own revision) when
//!   the page knows the text it edited, else by `${mtimeMs}:${size}`. Moves
//!   never replace an existing file.
//!
//! Residual (documented, not defended): the checks resolve a path, then the
//! operation reopens it. Another process running as the same user that swaps
//! a folder inside the vault for a symlink in that instant could redirect one
//! operation — but such a process can already read and write everything the
//! user can; the page itself has no way to create a link.
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
use serde_json::{json, Value};

use crate::containment::resolve_beneath;

pub(crate) const CONFIG_FILE: &str = "vault.json";
const WRITE_PREFIX: &str = ".rotli-write-";
/// Build output and history nobody edits from Rotli: never walked or listed
/// (compared without letter case: `.GIT` on a case-insensitive disk is `.git`).
const SKIPPED_DIRS: [&str; 2] = [".git", "node_modules"];

fn skipped_dir(name: &str) -> bool {
    SKIPPED_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(name))
}
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
        if command != "vault_info" {
            let bound = args.get("vaultId").and_then(Value::as_str).unwrap_or_default();
            if bound != config.id {
                return Err((409, "vault changed: Rotli Helper now serves a different folder than this page opened".into()));
            }
        }
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
            "vault_remove" => remove(root, &path_arg(args, "path")?, args),
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
    if contains_helper_dir(&root, path) {
        return None; // a hand-edited or tampered config never serves the helper's own files
    }
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
    if contains_helper_dir(&root, config_path) {
        return Err(format!(
            "{} holds Rotli Helper's own settings — choose the folder your notes are in, not one above it",
            root.display()
        ));
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

/// True when `root` is, or contains, the directory the helper's config lives
/// in: serving it would let the page rewrite the config (and so the root) or
/// read the pairing token.
fn contains_helper_dir(root: &Path, config_path: &Path) -> bool {
    let Some(dir) = config_path.parent() else { return true };
    let dir = fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    dir.starts_with(root)
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

fn is_git(name: &str) -> bool {
    name.eq_ignore_ascii_case(".git")
}

fn in_git(rel: &[String]) -> bool {
    rel.iter().any(|part| is_git(part))
}

fn refuse_git(rel: &[String]) -> Result<(), Refusal> {
    if in_git(rel) {
        return Err((403, "Rotli never writes inside .git".into()));
    }
    // `<file>.lock` is the desktop writers' lock sidecar: a page that could
    // create one could stall every desktop save of that file
    if rel.last().is_some_and(|name| name.to_ascii_lowercase().ends_with(".lock")) {
        return Err((403, "lock files belong to Rotli's writers".into()));
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

/// The gate every mutation of an existing file shares: by content
/// (`expectedContent`, the desktop's fnv1a64) when the page knows the text,
/// else by `${mtimeMs}:${size}` (`expectedRevision`). Some(message) when the
/// file on disk is not the one the page decided against. Call under the lock.
fn stale_revision(path: &Path, args: &Value) -> Result<Option<String>, String> {
    let conflict = |found: String| Some(format!("revision conflict: the file changed on disk ({found})"));
    if let Some(content) = args.get("expectedContent").and_then(Value::as_str) {
        let current = if path.is_file() { crate::fsutil::file_revision(path)? } else { "0".into() };
        return Ok(if current == content { None } else { conflict(current) });
    }
    if let Some(expected) = args.get("expectedRevision").and_then(Value::as_str) {
        let current = revision_of(path);
        return Ok(if current == expected { None } else { conflict(current) });
    }
    // no gate at all: fine for creating a file, never for replacing or
    // deleting one — a client that doesn't say what it saw can't clobber
    if path.is_file() {
        return Ok(Some("revision conflict: replacing or deleting a file needs expectedContent or expectedRevision".into()));
    }
    Ok(None)
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
    make_parents(root, &rel)?;
    // the desktop app's writers hold this same lock: compare and replace as one step
    crate::fsutil::with_file_lock(&target, || {
        if let Some(stale) = stale_revision(&target, args)? {
            return Err(stale);
        }
        crate::fsutil::atomic_write_bytes(&target, &bytes, WRITE_PREFIX)
    })
    .map_err(|e| (if e.starts_with("revision conflict") { 409 } else { 500 }, e))?;
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
    // "a.md" → "A.md" on a case-insensitive disk names the SAME file: a
    // plain rename changes its spelling; a copy-then-delete would lose it
    let case_only = joined(from).eq_ignore_ascii_case(&joined(to));
    if !case_only && fs::symlink_metadata(&target).is_ok() {
        // never replace: a stale listing must not destroy the note already there
        return Err((409, format!("{} already exists", joined(to))));
    }
    make_parents(root, to)?;
    // the source's lock (the desktop's writers hold it too) spans publish AND
    // unlink, so a newer version written in between can't be the one removed
    crate::fsutil::with_file_lock(&source, || {
        if case_only {
            return fs::rename(&source, &target).map_err(|e| format!("couldn't rename {}: {e}", joined(from)));
        }
        publish_no_replace(&source, &target)?;
        fs::remove_file(&source).map_err(|e| format!("couldn't remove {}: {e}", joined(from)))
    })
    .map(|()| Value::Null)
    .map_err(|e| (if e.starts_with("already exists") { 409 } else { 500 }, e))
}

/// Make `target` the source's content without ever replacing a file already
/// there. Same volume: a hard link (fails if `target` exists). Across
/// volumes: a complete temp copy beside the target, then published with
/// `persist_noclobber` — a failed copy never leaves a partial note behind.
fn publish_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    let already = || format!("already exists: {}", target.display());
    match fs::hard_link(source, target) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => return Err(already()),
        Err(_) => {}
    }
    let dir = target.parent().ok_or("no parent folder")?;
    let mut tmp = tempfile::Builder::new()
        .prefix(WRITE_PREFIX)
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    std::io::copy(&mut input, tmp.as_file_mut()).map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist_noclobber(target).map(|_| ()).map_err(|e| {
        if e.error.kind() == ErrorKind::AlreadyExists { already() } else { e.error.to_string() }
    })
}

fn remove(root: &Path, rel: &[String], args: &Value) -> Result<Value, Refusal> {
    refuse_git(rel)?;
    if rel.is_empty() {
        return Err((400, "the vault itself can't be removed".into()));
    }
    let path = resolve(root, rel)?;
    // a folder removal never deletes a file that has since taken its name
    if path.is_file() && args.get("directory").and_then(Value::as_bool) == Some(true) {
        return Err((409, format!("{} is a file now, not a folder", joined(rel))));
    }
    // a delete decided against an older version of a FILE must not remove a
    // newer one (an outage replay, or the desktop app writing meanwhile)
    if path.is_file() {
        return crate::fsutil::with_file_lock(&path, || {
            if let Some(stale) = stale_revision(&path, args)? {
                return Err(stale);
            }
            fs::remove_file(&path).map_err(|e| e.to_string())
        })
        .map(|()| Value::Null)
        .map_err(|e| (if e.starts_with("revision conflict") { 409 } else { 500 }, e));
    }
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

#[path = "helper_vault_read.rs"]
mod read_verbs;
use read_verbs::{list, read, read_many, stat, walk};

#[cfg(test)]
#[path = "helper_vault_tests.rs"]
mod tests;
