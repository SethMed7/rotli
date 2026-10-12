//! The vault lane's READ verbs (walk, list, stat, read, read_many), split
//! from `helper_vault.rs` so each file stays small. Same rules as there:
//! paths resolved beneath the root, symlinks and junctions neither listed
//! nor followed, `.git` and `node_modules` never walked.

use std::fs;
use std::io::{ErrorKind, Read as _};
use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Map, Value};

use super::{joined, millis, parse_rel, resolve, skipped_dir, stat_json, Refusal, MAX_WALK_ENTRIES, READ_MANY_BUDGET, READ_ONE_LIMIT};

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

/// Check size and kind before allocation, then cap the stream too in case
/// another writer grows it after stat. Never open a FIFO or device for reads.
fn read_bytes(root: &Path, rel: &[String], limit: usize) -> Result<Vec<u8>, Refusal> {
    let path = resolve(root, rel)?;
    let io_error = |e: std::io::Error| {
        if e.kind() == ErrorKind::NotFound { (404, format!("no such file: {}", joined(rel))) }
        else { (500, format!("couldn't read {}: {e}", joined(rel))) }
    };
    let check = |metadata: &fs::Metadata| {
        if !metadata.is_file() {
            return Err((400, format!("not a regular file: {}", joined(rel))));
        }
        if metadata.len() > limit as u64 {
            return Err((413, format!("file too large for this read (limit {limit} bytes): {}", joined(rel))));
        }
        Ok(())
    };
    check(&fs::symlink_metadata(&path).map_err(&io_error)?)?;
    let file = fs::File::open(&path).map_err(&io_error)?;
    let metadata = file.metadata().map_err(&io_error)?;
    check(&metadata)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(limit as u64 + 1).read_to_end(&mut bytes).map_err(io_error)?;
    if bytes.len() > limit {
        return Err((413, format!("file too large for this read (limit {limit} bytes): {}", joined(rel))));
    }
    Ok(bytes)
}

pub(super) fn read(root: &Path, rel: &[String], encoding: Option<&str>) -> Result<Value, Refusal> {
    let bytes = read_bytes(root, rel, READ_ONE_LIMIT)?;
    Ok(Value::String(if encoding == Some("base64") {
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    }))
}

/// Unlike a display walk, a security refresh never skips unreadable entries.
/// Use the existing corpus field parsers and secret policy, without building
/// an index or silently dropping unreadable/non-UTF-8 notes.
pub(super) fn refresh_secure_ledger(root: &Path, prompt: Option<&str>) -> Result<bool, Refusal> {
    refresh_into(root, &[], &mut 0, prompt)
}

fn refresh_into(root: &Path, rel: &[String], seen: &mut usize, prompt: Option<&str>) -> Result<bool, Refusal> {
    let dir = resolve(root, rel)?;
    let entries = fs::read_dir(dir).map_err(|e| (500, e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| (500, e.to_string()))?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|e| (500, e.to_string()))?;
        if crate::containment::is_link_like(&metadata) {
            continue;
        }
        *seen += 1;
        if *seen > MAX_WALK_ENTRIES {
            return Err((413, "This folder holds too many files to check its secure notes.".into()));
        }
        let name = entry.file_name().into_string().map_err(|_| (400, "a vault entry has an unreadable name".to_string()))?;
        let mut path = rel.to_vec();
        path.push(name.clone());
        if metadata.is_dir() && !skipped_dir(&name) {
            if refresh_into(root, &path, seen, prompt)? { return Ok(true); }
        } else if metadata.is_file() && Path::new(&name).extension().is_some_and(|ext| {
            ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
        }) {
            // lossy, like the page's own read: one oddly encoded note must not
            // switch chat off, and its markers still read as markers
            let bytes = read_bytes(root, &path, READ_ONE_LIMIT)?;
            let text = String::from_utf8_lossy(&bytes);
            let (frontmatter, body) = crate::corpus::parse_document(&text);
            // the desktop walk's own rule, so the two ledgers can't drift
            let protected = crate::corpus::walked_secure(&frontmatter.unwrap_or_default(), body);
            if protected {
                // Check this body before later notes can evict its hashes.
                // Both direct and ledger checks use secret.rs's same phrases.
                let quoted = prompt.is_some_and(|prompt| crate::secret::quotes_secure_text(prompt, body));
                crate::secret::remember_secure_text(body);
                if quoted { return Ok(true); }
            }
        }
    }
    Ok(false)
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
        let text = match read_bytes(root, &rel, READ_MANY_BUDGET - spent) {
            Ok(bytes) => Value::String(String::from_utf8_lossy(&bytes).into_owned()),
            Err((404, _)) => Value::Null,
            Err((413, _)) => {
                more.push(Value::String(raw.to_string()));
                continue;
            }
            Err(refusal) => return Err(refusal),
        };
        let size = text.as_str().map_or(0, str::len);
        // Lossy UTF-8 replacement can expand the bytes read from disk.
        if size > READ_MANY_BUDGET - spent {
            more.push(Value::String(raw.to_string()));
            continue;
        }
        spent += size;
        files.insert(raw.to_string(), text);
    }
    Ok(json!({ "files": files, "more": more }))
}
