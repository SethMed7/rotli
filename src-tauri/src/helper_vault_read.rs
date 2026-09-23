//! The vault lane's READ verbs (walk, list, stat, read, read_many), split
//! from `helper_vault.rs` so each file stays small. Same rules as there:
//! paths resolved beneath the root, symlinks and junctions neither listed
//! nor followed, `.git` and `node_modules` never walked.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Map, Value};

use super::{joined, millis, parse_rel, resolve, skipped_dir, stat_json, Refusal, MAX_WALK_ENTRIES, READ_MANY_BUDGET};

/// Every file and directory beneath `rel`, one call: what the page's notes
/// service would otherwise ask for one `stat` at a time.
pub(super) fn walk(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
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
        // file_type() does not follow links: a symlink is neither, and skipped;
        // a Windows junction can report as a directory, so check the reparse bit too
        let Ok(kind) = entry.file_type() else { continue };
        if fs::symlink_metadata(entry.path()).map_or(true, |m| crate::containment::is_link_like(&m)) {
            continue;
        }
        let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        if kind.is_dir() {
            if skipped_dir(&name) {
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

pub(super) fn list(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    let dir = resolve(root, rel)?;
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(json!([])) };
    let mut out: Vec<(String, &str)> = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
        let Ok(kind) = entry.file_type() else { continue };
        if fs::symlink_metadata(entry.path()).map_or(true, |m| crate::containment::is_link_like(&m)) {
            continue;
        }
        if kind.is_dir() && !skipped_dir(&name) {
            out.push((name, "directory"));
        } else if kind.is_file() {
            out.push((name, "file"));
        }
    }
    out.sort();
    Ok(Value::Array(out.into_iter().map(|(name, kind)| json!({ "name": name, "kind": kind })).collect()))
}

pub(super) fn stat(root: &Path, rel: &[String]) -> Result<Value, Refusal> {
    let path = resolve(root, rel)?;
    match fs::symlink_metadata(&path) {
        Ok(m) if m.is_file() || m.is_dir() => Ok(stat_json(&m)),
        _ => Ok(Value::Null),
    }
}

pub(super) fn read(root: &Path, rel: &[String], encoding: Option<&str>) -> Result<Value, Refusal> {
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
pub(super) fn read_many(root: &Path, args: &Value) -> Result<Value, Refusal> {
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
