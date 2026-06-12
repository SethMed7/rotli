//! Phase 2 — the corpus. Files become real.
//!
//! THE CORPUS LAW: plain `.md` files on the user's Mac are the truth. Folders
//! on disk = folders in the sidebar. Each note carries exactly four facts in a
//! YAML frontmatter block — `id`, `created`, `updated`, `pinned` — added on
//! first edit/create; the title is DERIVED from the first non-empty line,
//! never stored. Foreign frontmatter keys pass through untouched: a note must
//! open cleanly in any other editor, forever.
//!
//! `.rotli/` inside the corpus root holds settings.json, viewstate.json and
//! the id↔path index — all rebuildable. Deleting `.rotli/` loses nothing.
//!
//! Writes are atomic (temp file in the same dir + rename). Deletes go to the
//! OS trash (fallback: `.rotli/trash/`) — never a hard delete. A `notify`
//! watcher (debounced) tells the frontend when the corpus changes under it,
//! ignoring `.rotli/` and our own in-flight writes.

use std::collections::HashMap;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use ulid::Ulid;

// ─── the one place the corpus root is decided ───────────────────────────────

/// `~/Documents/rotli` — the repo occupies `~/rotli`. User-changeable later
/// (a setting will feed `CorpusStore::open` a different root).
pub const CORPUS_DIR_NAME: &str = "rotli";
/// The app-owned, fully rebuildable sidecar folder inside the corpus root.
pub const DOT_DIR: &str = ".rotli";

pub fn default_corpus_root(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    app.path()
        .document_dir()
        .map(|d| d.join(CORPUS_DIR_NAME))
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
            PathBuf::from(home).join("Documents").join(CORPUS_DIR_NAME)
        })
}

// ─── time ────────────────────────────────────────────────────────────────────

fn now_stamp() -> String {
    let now = OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

fn stamp_to_ms(stamp: &str) -> Option<i64> {
    OffsetDateTime::parse(stamp, &Rfc3339)
        .ok()
        .map(|t| (t.unix_timestamp_nanos() / 1_000_000) as i64)
}

/// (created_ms, updated_ms) from file metadata — the fallback for notes that
/// have no frontmatter yet (e.g. a folder of .md dropped into the corpus).
fn file_stamps(abs: &Path) -> (i64, i64) {
    let meta = fs::metadata(abs).ok();
    let to_ms = |t: SystemTime| {
        t.duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(|_| now_ms())
    };
    let modified = meta.as_ref().and_then(|m| m.modified().ok());
    let created = meta.as_ref().and_then(|m| m.created().ok()).or(modified);
    (
        created.map(to_ms).unwrap_or_else(now_ms),
        modified.map(to_ms).unwrap_or_else(now_ms),
    )
}

// ─── frontmatter codec ───────────────────────────────────────────────────────

/// The four facts rotli owns, plus every line it does not (preserved verbatim,
/// in order — never destroyed, never reformatted).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Frontmatter {
    pub id: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub pinned: Option<bool>,
    pub foreign: Vec<String>,
}

/// Split a document into (frontmatter, raw body). Tolerant by design:
/// no fence → no frontmatter, whole text is the body; an unterminated fence is
/// treated as body, not eaten. The returned body is byte-exact.
pub fn parse_document(text: &str) -> (Option<Frontmatter>, &str) {
    let Some(rest) = text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    else {
        return (None, text);
    };
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\n', '\r']) == "---" {
            let head = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return (Some(parse_fields(head)), body);
        }
        offset += line.len();
    }
    (None, text)
}

fn parse_fields(head: &str) -> Frontmatter {
    let mut fm = Frontmatter::default();
    for raw in head.lines() {
        let line = raw.trim_end_matches('\r');
        let known = (|| {
            let (key, value) = line.split_once(':')?;
            let value = value.trim();
            match key {
                "id" if fm.id.is_none() => fm.id = Some(value.to_string()),
                "created" if fm.created.is_none() => fm.created = Some(value.to_string()),
                "updated" if fm.updated.is_none() => fm.updated = Some(value.to_string()),
                "pinned" if fm.pinned.is_none() => fm.pinned = Some(value == "true"),
                _ => return None,
            }
            Some(())
        })();
        if known.is_none() {
            fm.foreign.push(line.to_string());
        }
    }
    fm
}

/// Serialize: our four facts first, then every foreign line verbatim, then the
/// raw body exactly as given (callers pass the separating blank line).
pub fn compose_document(fm: &Frontmatter, raw_body: &str) -> String {
    let mut out = String::with_capacity(raw_body.len() + 128);
    out.push_str("---\n");
    out.push_str(&format!("id: {}\n", fm.id.as_deref().unwrap_or("")));
    out.push_str(&format!("created: {}\n", fm.created.as_deref().unwrap_or("")));
    out.push_str(&format!("updated: {}\n", fm.updated.as_deref().unwrap_or("")));
    out.push_str(&format!("pinned: {}\n", fm.pinned.unwrap_or(false)));
    for line in &fm.foreign {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(raw_body);
    out
}

/// What the editor sees: the raw body minus the single conventional blank line
/// after the fence (the write path adds exactly one back).
fn editor_body(raw: &str) -> &str {
    raw.strip_prefix("\r\n")
        .or_else(|| raw.strip_prefix('\n'))
        .unwrap_or(raw)
}

// ─── title · snippet · slug · filename ───────────────────────────────────────

/// Title = first non-empty line, markdown stripped. NOT stored anywhere.
pub fn title_of(body: &str) -> String {
    body.lines()
        .map(strip_markdown)
        .find(|l| !l.is_empty())
        .unwrap_or_else(|| "Untitled".into())
}

fn strip_markdown(line: &str) -> String {
    let mut s = line.trim();
    loop {
        let before = s;
        s = s.trim_start_matches('#').trim_start();
        if let Some(rest) = s.strip_prefix('>') {
            s = rest.trim_start();
        }
        for marker in ["- ", "* ", "+ ", "[ ] ", "[x] ", "[X] "] {
            if let Some(rest) = s.strip_prefix(marker) {
                s = rest;
            }
        }
        if s == before {
            break;
        }
    }
    let cleaned: String = s.chars().filter(|c| !matches!(c, '*' | '_' | '`')).collect();
    cleaned.trim().to_string()
}

/// First lines after the title, markdown stripped, for list rows (≤140 chars).
pub fn snippet_of(body: &str) -> String {
    let mut past_title = false;
    let mut parts: Vec<String> = Vec::new();
    for line in body.lines() {
        if !past_title {
            if !line.trim().is_empty() {
                past_title = true;
            }
            continue;
        }
        let stripped = strip_markdown(line);
        if !stripped.is_empty() {
            parts.push(stripped);
        }
    }
    parts.join(" ").chars().take(140).collect()
}

pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    for c in title.to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
        }
        if out.len() >= 60 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "untitled".into()
    } else {
        out
    }
}

/// `slug-of-title-` + last 6 of the ulid: stable across same-title notes,
/// human-readable in Finder, renamed (through the index) when the title moves.
fn filename_for(title: &str, id: &str) -> String {
    let tail: String = id.chars().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{}-{}.md", slugify(title), tail.to_lowercase())
}

// ─── wire types (camelCase to match src/types.ts) ────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub id: String,
    pub title: String,
    pub snippet: String,
    /// Relative folder path ("" = corpus root). Folder ids ARE paths.
    pub folder_id: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMeta {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CorpusList {
    pub folders: Vec<FolderMeta>,
    pub notes: Vec<NoteMeta>,
}

/// What Settings → Storage shows: the REAL corpus, not a mock. Root with the
/// home dir shortened to `~`, every folder, every note file (relative paths).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusOverview {
    pub root: String,
    pub folders: Vec<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDoc {
    pub id: String,
    pub folder_id: String,
    /// Frontmatter stripped — what the editor edits.
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
}

// ─── suppress set (our own writes must not echo back as "external") ─────────

const SUPPRESS_TTL: Duration = Duration::from_secs(2);

#[derive(Clone, Default)]
pub struct SuppressSet(Arc<Mutex<HashMap<PathBuf, Instant>>>);

impl SuppressSet {
    pub fn mark(&self, path: &Path) {
        let mut map = self.0.lock().unwrap();
        map.retain(|_, at| at.elapsed() < SUPPRESS_TTL);
        map.insert(path.to_path_buf(), Instant::now());
    }

    pub fn contains(&self, path: &Path) -> bool {
        self.0
            .lock()
            .unwrap()
            .get(path)
            .is_some_and(|at| at.elapsed() < SUPPRESS_TTL)
    }
}

// ─── atomic write ────────────────────────────────────────────────────────────

/// Temp file in the SAME directory + rename: a reader never sees a truncated
/// note, and a crash mid-write leaves the old file intact.
fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-write-")
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    tmp.write_all(contents.as_bytes())
        .map_err(|e| format!("write {}: {e}", path.display()))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    tmp.persist(path)
        .map_err(|e| format!("rename into {}: {e}", path.display()))?;
    Ok(())
}

// ─── the id↔path index (.rotli/index.json — authoritative, rebuildable) ─────

#[derive(Serialize, Deserialize, Default)]
struct IndexFile {
    version: u32,
    /// id → path relative to the corpus root.
    notes: HashMap<String, String>,
}

// ─── the store ───────────────────────────────────────────────────────────────

const WELCOME_BODY: &str = "# Welcome to rotli\n\nThis folder is your corpus — every note is a plain markdown file, right here\non your Mac. Open them in any editor, back them up however you like, keep them\nforever. rotli is just a warm window onto them.\n\nTwo keys to remember:\n\n- **⌥Space** opens rotli from anywhere.\n- **⌥C** catches a thought without breaking stride — it lands here in **Inbox**,\n  ready when you are.\n\nDrop a folder of `.md` files next to this one and it appears in the sidebar.\nThe hidden `.rotli` folder is only an index — delete it any time and rotli\nquietly rebuilds it.\n\nMake yourself at home.\n";

pub struct CorpusStore {
    /// Canonicalized — so watcher event paths (FSEvents resolves symlinks,
    /// e.g. /var → /private/var) compare equal to ours.
    root: PathBuf,
    /// id → relative path. Authoritative for renames; rebuilt from a disk
    /// scan whenever it is missing or stale.
    index: HashMap<String, String>,
    suppress: SuppressSet,
    /// OS trash in production; tests flip this to use `.rotli/trash/` so they
    /// never touch the user's real Trash. Either way: never a hard delete.
    os_trash: bool,
}

impl CorpusStore {
    /// Open (or first-run-initialize) a corpus at `root`.
    pub fn open(root: PathBuf) -> Result<Self, String> {
        let fresh = !root.exists()
            || fs::read_dir(&root).map(|mut d| d.next().is_none()).unwrap_or(false);
        fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        let root = fs::canonicalize(&root)
            .map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        fs::create_dir_all(root.join(DOT_DIR))
            .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;

        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
        };
        store.load_index();
        if fresh {
            store.first_run()?;
        }
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn suppress_set(&self) -> SuppressSet {
        self.suppress.clone()
    }

    /// First run: the corpus is born with Inbox and ONE warm welcome note.
    /// No demo notes on disk — the in-memory demo corpus stays browser-only.
    fn first_run(&mut self) -> Result<(), String> {
        fs::create_dir_all(self.root.join("Inbox"))
            .map_err(|e| format!("create Inbox: {e}"))?;
        self.create("Inbox", WELCOME_BODY)?;
        Ok(())
    }

    fn load_index(&mut self) {
        let path = self.root.join(DOT_DIR).join("index.json");
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(file) = serde_json::from_str::<IndexFile>(&text) {
                self.index = file.notes;
            }
        }
    }

    fn persist_index(&self) {
        let file = IndexFile { version: 1, notes: self.index.clone() };
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            let _ = atomic_write(&self.root.join(DOT_DIR).join("index.json"), &json);
        }
    }

    fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    /// Scan the disk (the truth), reconciling the id↔path index as we go:
    /// frontmatter ids win, then the previous index (keeps frontmatter-less
    /// files stable across runs), then a freshly minted ulid.
    pub fn list(&mut self) -> Result<CorpusList, String> {
        let mut folders: Vec<FolderMeta> = Vec::new();
        let mut notes: Vec<NoteMeta> = Vec::new();
        let reverse: HashMap<String, String> =
            self.index.iter().map(|(id, p)| (p.clone(), id.clone())).collect();
        let mut new_index: HashMap<String, String> = HashMap::new();

        walk(&self.root, "", &reverse, &mut new_index, &mut folders, &mut notes)?;

        if new_index != self.index {
            self.index = new_index;
            self.persist_index();
        }
        folders.sort_by(|a, b| a.id.cmp(&b.id));
        notes.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.updated_at.cmp(&a.updated_at))
                .then(a.id.cmp(&b.id))
        });
        Ok(CorpusList { folders, notes })
    }

    /// Resolve an id through the index; on a miss (stale index, external
    /// move), rebuild from a scan once and retry.
    fn path_of(&mut self, id: &str) -> Result<String, String> {
        if let Some(rel) = self.index.get(id) {
            if self.abs(rel).is_file() {
                return Ok(rel.clone());
            }
        }
        self.list()?;
        self.index
            .get(id)
            .cloned()
            .ok_or_else(|| format!("note not found: {id}"))
    }

    pub fn read(&mut self, id: &str) -> Result<NoteDoc, String> {
        let rel = self.path_of(id)?;
        let abs = self.abs(&rel);
        let text = fs::read_to_string(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        let (fm, raw) = parse_document(&text);
        let body = match &fm {
            Some(_) => editor_body(raw),
            None => raw,
        };
        let (file_created, file_updated) = file_stamps(&abs);
        let fm = fm.unwrap_or_default();
        Ok(NoteDoc {
            id: id.to_string(),
            folder_id: folder_of(&rel),
            body: body.to_string(),
            created_at: fm.created.as_deref().and_then(stamp_to_ms).unwrap_or(file_created),
            updated_at: fm.updated.as_deref().and_then(stamp_to_ms).unwrap_or(file_updated),
            pinned: fm.pinned.unwrap_or(false),
        })
    }

    /// Atomic save. Mints/keeps the four facts (foreign keys ride along
    /// untouched), bumps `updated`, and renames the file — through the index —
    /// when the title moved.
    pub fn write(&mut self, id: &str, body: &str, pinned: bool) -> Result<NoteMeta, String> {
        let rel = self.path_of(id)?;
        let abs = self.abs(&rel);

        let existing = fs::read_to_string(&abs).unwrap_or_default();
        let (old_fm, _) = parse_document(&existing);
        let (file_created, _) = file_stamps(&abs);
        let old_fm = old_fm.unwrap_or_default();
        let created = old_fm
            .created
            .filter(|s| stamp_to_ms(s).is_some())
            .unwrap_or_else(|| ms_to_stamp(file_created));
        let updated = now_stamp();

        let fm = Frontmatter {
            id: Some(id.to_string()),
            created: Some(created.clone()),
            updated: Some(updated.clone()),
            pinned: Some(pinned),
            foreign: old_fm.foreign,
        };
        let text = compose_document(&fm, &format!("\n{body}"));

        let title = title_of(body);
        let folder = folder_of(&rel);
        let current_name = Path::new(&rel)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let desired = filename_for(&title, id);
        let target_rel = if current_name == desired {
            rel.clone()
        } else {
            self.free_filename(&folder, &desired, Some(&rel))
        };
        let target_abs = self.abs(&target_rel);

        self.suppress.mark(&target_abs);
        atomic_write(&target_abs, &text)?;
        if target_abs != abs {
            self.suppress.mark(&abs);
            let _ = fs::remove_file(&abs);
        }
        self.index.insert(id.to_string(), target_rel);
        self.persist_index();

        Ok(NoteMeta {
            id: id.to_string(),
            title,
            snippet: snippet_of(body),
            folder_id: folder,
            created_at: stamp_to_ms(&created).unwrap_or_else(now_ms),
            updated_at: stamp_to_ms(&updated).unwrap_or_else(now_ms),
            pinned,
        })
    }

    pub fn create(&mut self, folder_id: &str, body: &str) -> Result<NoteMeta, String> {
        if !folder_id.is_empty() {
            validate_rel(folder_id)?;
            fs::create_dir_all(self.abs(folder_id))
                .map_err(|e| format!("create folder {folder_id}: {e}"))?;
        }
        let id = Ulid::new().to_string();
        let now = now_stamp();
        let title = title_of(body);
        let rel = self.free_filename(folder_id, &filename_for(&title, &id), None);
        let fm = Frontmatter {
            id: Some(id.clone()),
            created: Some(now.clone()),
            updated: Some(now.clone()),
            pinned: Some(false),
            foreign: Vec::new(),
        };
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write(&abs, &compose_document(&fm, &format!("\n{body}")))?;
        self.index.insert(id.clone(), rel.clone());
        self.persist_index();
        let ms = stamp_to_ms(&now).unwrap_or_else(now_ms);
        Ok(NoteMeta {
            id,
            title,
            snippet: snippet_of(body),
            folder_id: folder_id.to_string(),
            created_at: ms,
            updated_at: ms,
            pinned: false,
        })
    }

    /// Never a hard delete: OS trash first, `.rotli/trash/` as the fallback
    /// (and as the test path — tests must not touch the user's real Trash).
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        let rel = self.path_of(id)?;
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        let trashed = self.os_trash && trash::delete(&abs).is_ok();
        if !trashed {
            let trash_dir = self.root.join(DOT_DIR).join("trash");
            fs::create_dir_all(&trash_dir).map_err(|e| format!("create trash: {e}"))?;
            let name = Path::new(&rel)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("{id}.md"));
            let mut dest = trash_dir.join(&name);
            let mut n = 2;
            while dest.exists() {
                dest = trash_dir.join(format!("{n}-{name}"));
                n += 1;
            }
            fs::rename(&abs, &dest).map_err(|e| format!("trash {rel}: {e}"))?;
        }
        self.index.remove(id);
        self.persist_index();
        Ok(())
    }

    pub fn create_folder(&mut self, name: &str, parent_id: Option<&str>) -> Result<FolderMeta, String> {
        validate_component(name)?;
        let parent = parent_id.filter(|p| !p.is_empty());
        if let Some(p) = parent {
            validate_rel(p)?;
        }
        let rel = match parent {
            Some(p) => format!("{p}/{name}"),
            None => name.to_string(),
        };
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        fs::create_dir_all(&abs).map_err(|e| format!("create folder {rel}: {e}"))?;
        Ok(FolderMeta {
            id: rel,
            name: name.to_string(),
            parent_id: parent.map(str::to_string),
        })
    }

    /// The truthful storage pane: scan the disk (reconciling the index on the
    /// way) and report exactly what exists, with the root pretty-printed.
    pub fn overview(&mut self) -> Result<CorpusOverview, String> {
        let list = self.list()?;
        let folders = list.folders.iter().map(|f| f.id.clone()).collect();
        let mut files: Vec<String> = self.index.values().cloned().collect();
        files.sort();
        let root_str = self.root.display().to_string();
        let root = match std::env::var("HOME") {
            Ok(home) if !home.is_empty() && root_str.starts_with(&home) => {
                format!("~{}", &root_str[home.len()..])
            }
            _ => root_str,
        };
        Ok(CorpusOverview { root, folders, files })
    }

    /// settings.json / viewstate.json / background.json — opaque JSON strings
    /// the frontend owns (background.json carries the custom glass wallpaper
    /// as a data URL, so the uploaded image survives relaunch).
    pub fn dot_read(&self, which: &str) -> Result<String, String> {
        let path = self.root.join(DOT_DIR).join(dot_file(which)?);
        match fs::read_to_string(&path) {
            Ok(s) => Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
            Err(e) => Err(format!("read {which}: {e}")),
        }
    }

    pub fn dot_write(&self, which: &str, contents: &str) -> Result<(), String> {
        atomic_write(&self.root.join(DOT_DIR).join(dot_file(which)?), contents)
    }

    /// First free filename in a folder (the id suffix makes real collisions
    /// rare; this guards the pathological same-slug-same-tail case).
    fn free_filename(&self, folder: &str, desired: &str, keep_rel: Option<&str>) -> String {
        let join = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let mut rel = join(desired);
        let mut n = 2;
        while self.abs(&rel).exists() && keep_rel != Some(rel.as_str()) {
            let stem = desired.trim_end_matches(".md");
            rel = join(&format!("{stem}-{n}.md"));
            n += 1;
        }
        rel
    }
}

fn dot_file(which: &str) -> Result<&'static str, String> {
    match which {
        "settings" => Ok("settings.json"),
        "viewstate" => Ok("viewstate.json"),
        "background" => Ok("background.json"),
        other => Err(format!("unknown settings file: {other}")),
    }
}

fn folder_of(rel: &str) -> String {
    match rel.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    }
}

/// Folder ids come from the frontend — keep them inside the corpus root.
fn validate_rel(rel: &str) -> Result<(), String> {
    if rel.starts_with('/') {
        return Err(format!("folder path must be relative: {rel}"));
    }
    for comp in rel.split('/') {
        validate_component(comp)?;
    }
    Ok(())
}

fn validate_component(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." || name.starts_with('.') || name.contains('/') {
        return Err(format!("invalid folder name: {name:?}"));
    }
    Ok(())
}

/// Recursive scan. Skips dot-entries everywhere (`.rotli`, `.DS_Store`, temp
/// files). Unreadable / non-UTF-8 files are skipped, never fatal.
fn walk(
    root: &Path,
    prefix: &str,
    reverse: &HashMap<String, String>,
    new_index: &mut HashMap<String, String>,
    folders: &mut Vec<FolderMeta>,
    notes: &mut Vec<NoteMeta>,
) -> Result<(), String> {
    let dir = if prefix.is_empty() { root.to_path_buf() } else { root.join(prefix) };
    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| format!("read dir {}: {e}", dir.display()))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(_) => continue,
        };
        if kind.is_dir() {
            folders.push(FolderMeta {
                id: rel.clone(),
                name,
                parent_id: if prefix.is_empty() { None } else { Some(prefix.to_string()) },
            });
            walk(root, &rel, reverse, new_index, folders, notes)?;
        } else if kind.is_file() && name.ends_with(".md") {
            let abs = entry.path();
            let Ok(text) = fs::read_to_string(&abs) else { continue };
            let (fm, raw) = parse_document(&text);
            let body = match &fm {
                Some(_) => editor_body(raw),
                None => raw,
            };
            let fm = fm.unwrap_or_default();
            // identity: frontmatter id → previous index (path-stable for
            // frontmatter-less files) → fresh mint. Duplicate ids (a copied
            // file) never collapse two notes into one.
            let id = fm
                .id
                .filter(|id| !id.is_empty() && !new_index.contains_key(id))
                .or_else(|| reverse.get(&rel).filter(|id| !new_index.contains_key(*id)).cloned())
                .unwrap_or_else(|| Ulid::new().to_string());
            new_index.insert(id.clone(), rel.clone());
            let (file_created, file_updated) = file_stamps(&abs);
            notes.push(NoteMeta {
                id,
                title: title_of(body),
                snippet: snippet_of(body),
                folder_id: prefix.to_string(),
                created_at: fm.created.as_deref().and_then(stamp_to_ms).unwrap_or(file_created),
                updated_at: fm.updated.as_deref().and_then(stamp_to_ms).unwrap_or(file_updated),
                pinned: fm.pinned.unwrap_or(false),
            });
        }
    }
    Ok(())
}

fn ms_to_stamp(ms: i64) -> String {
    OffsetDateTime::from_unix_timestamp_nanos(ms as i128 * 1_000_000)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&Rfc3339)
        .unwrap_or_default()
}

// ─── watcher ─────────────────────────────────────────────────────────────────

const DEBOUNCE: Duration = Duration::from_millis(300);

/// Watch the corpus for EXTERNAL changes (a folder dropped in, a note edited
/// in another app) and fire `on_change` once per quiet burst. `.rotli/`,
/// dot-files and our own in-flight writes (the suppress set) never fire.
pub fn spawn_watcher(
    root: PathBuf,
    suppress: SuppressSet,
    on_change: impl Fn() + Send + 'static,
) -> notify::Result<()> {
    use notify::{RecursiveMode, Watcher};
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let _ = tx.send(res);
    })?;
    watcher.watch(&root, RecursiveMode::Recursive)?;
    std::thread::spawn(move || {
        let _keep_alive = watcher;
        while let Ok(res) = rx.recv() {
            if !event_relevant(&root, &suppress, &res) {
                continue;
            }
            // trailing debounce: absorb the burst, fire once when it goes quiet
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(_) => continue,
                    Err(RecvTimeoutError::Timeout) => {
                        on_change();
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
    Ok(())
}

fn event_relevant(root: &Path, suppress: &SuppressSet, res: &notify::Result<notify::Event>) -> bool {
    let Ok(event) = res else { return false };
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return false;
    }
    event.paths.iter().any(|p| path_relevant(root, suppress, p))
}

/// The unit-testable core of the watcher's filter.
pub fn path_relevant(root: &Path, suppress: &SuppressSet, path: &Path) -> bool {
    if suppress.contains(path) {
        return false;
    }
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    for comp in rel.components() {
        if comp.as_os_str().to_string_lossy().starts_with('.') {
            return false; // .rotli/, .DS_Store, .rotli-write-* temp files
        }
    }
    // directories (a dropped folder) and .md files matter; foreign files don't
    match path.extension() {
        Some(ext) => ext == "md" || path.is_dir(),
        None => true,
    }
}

// ─── tauri state + commands ──────────────────────────────────────────────────

/// `None` when the corpus failed to open (disk error at startup) — commands
/// then return a clean error instead of panicking on missing state.
pub struct CorpusState(pub Mutex<Option<CorpusStore>>);

impl CorpusState {
    fn with<T>(&self, f: impl FnOnce(&mut CorpusStore) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| "corpus lock poisoned".to_string())?;
        let store = guard.as_mut().ok_or_else(|| "corpus unavailable".to_string())?;
        f(store)
    }
}

#[tauri::command]
pub fn corpus_list(state: tauri::State<'_, CorpusState>) -> Result<CorpusList, String> {
    state.with(|s| s.list())
}

#[tauri::command]
pub fn corpus_read(state: tauri::State<'_, CorpusState>, id: String) -> Result<NoteDoc, String> {
    state.with(|s| s.read(&id))
}

#[tauri::command]
pub fn corpus_write(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
    pinned: bool,
) -> Result<NoteMeta, String> {
    state.with(|s| s.write(&id, &body, pinned))
}

#[tauri::command]
pub fn corpus_create(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    body: String,
) -> Result<NoteMeta, String> {
    state.with(|s| s.create(&folder_id, &body))
}

#[tauri::command]
pub fn corpus_delete(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    state.with(|s| s.delete(&id))
}

#[tauri::command]
pub fn corpus_create_folder(
    state: tauri::State<'_, CorpusState>,
    name: String,
    parent_id: Option<String>,
) -> Result<FolderMeta, String> {
    state.with(|s| s.create_folder(&name, parent_id.as_deref()))
}

#[tauri::command]
pub fn corpus_overview(state: tauri::State<'_, CorpusState>) -> Result<CorpusOverview, String> {
    state.with(|s| s.overview())
}

#[tauri::command]
pub fn corpus_settings_read(
    state: tauri::State<'_, CorpusState>,
    file: String,
) -> Result<String, String> {
    state.with(|s| s.dot_read(&file))
}

#[tauri::command]
pub fn corpus_settings_write(
    state: tauri::State<'_, CorpusState>,
    file: String,
    contents: String,
) -> Result<(), String> {
    state.with(|s| s.dot_write(&file, &contents))
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    /// Fresh corpus (first run happens: Inbox + welcome note exist).
    fn fresh() -> (TempDir, CorpusStore) {
        let dir = TempDir::new().unwrap();
        let mut store = CorpusStore::open(dir.path().join("corpus")).unwrap();
        store.os_trash = false; // never touch the real Trash from tests
        (dir, store)
    }

    /// Corpus that skips first-run seeding (root pre-created, non-empty).
    fn bare() -> (TempDir, CorpusStore) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("corpus");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(".keep"), "").unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        (dir, store)
    }

    // ── frontmatter codec ──

    #[test]
    fn frontmatter_round_trip() {
        let text = "---\nid: 01JXF00000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T11:30:00Z\npinned: true\n---\n\n# A note\n\nBody stays byte-exact.\n";
        let (fm, body) = parse_document(text);
        let fm = fm.expect("frontmatter parsed");
        assert_eq!(fm.id.as_deref(), Some("01JXF00000000000000000000A"));
        assert_eq!(fm.created.as_deref(), Some("2026-06-12T10:00:00Z"));
        assert_eq!(fm.updated.as_deref(), Some("2026-06-12T11:30:00Z"));
        assert_eq!(fm.pinned, Some(true));
        assert!(fm.foreign.is_empty());
        assert_eq!(body, "\n# A note\n\nBody stays byte-exact.\n");
        assert_eq!(compose_document(&fm, body), text);
    }

    #[test]
    fn frontmatter_preserves_foreign_keys() {
        // foreign keys (incl. nested yaml + a comment) ride along untouched
        let text = "---\nid: AAAA\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T10:00:00Z\npinned: false\ntags: [alpha, beta]\nmeta:\n  source: web\n# a comment\n---\n\nBody.\n";
        let (fm, body) = parse_document(text);
        let fm = fm.unwrap();
        assert_eq!(
            fm.foreign,
            vec!["tags: [alpha, beta]", "meta:", "  source: web", "# a comment"]
        );
        assert_eq!(compose_document(&fm, body), text);
    }

    #[test]
    fn frontmatter_tolerant_parse() {
        // no fence → all body
        let (fm, body) = parse_document("# Just a note\n");
        assert!(fm.is_none());
        assert_eq!(body, "# Just a note\n");
        // unterminated fence → treated as body, never eaten
        let raw = "---\nid: X\nno closing fence\n";
        let (fm, body) = parse_document(raw);
        assert!(fm.is_none());
        assert_eq!(body, raw);
        // hr at top of a fence-less file is NOT frontmatter… (it is parsed as
        // an empty-ish block only when a closing --- exists; foreign lines survive)
        let (fm, _) = parse_document("---\nwhatever: yes\n---\nbody");
        assert_eq!(fm.unwrap().foreign, vec!["whatever: yes"]);
    }

    #[test]
    fn foreign_keys_survive_a_real_write() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        fs::write(
            root.join("kept.md"),
            "---\nid: 01TESTID000000000000ABCDEF\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\npinned: false\naliases: [old-name]\n---\n\n# Kept\n\nOriginal.\n",
        )
        .unwrap();
        store.list().unwrap();
        let meta = store
            .write("01TESTID000000000000ABCDEF", "# Kept\n\nEdited.\n", true)
            .unwrap();
        assert!(meta.pinned);
        let on_disk = fs::read_to_string(store.root().join(store.index.get("01TESTID000000000000ABCDEF").unwrap())).unwrap();
        assert!(on_disk.contains("aliases: [old-name]"), "foreign key destroyed:\n{on_disk}");
        assert!(on_disk.contains("created: 2026-06-01T00:00:00Z"), "created not preserved");
        assert!(on_disk.contains("pinned: true"));
        assert!(on_disk.ends_with("# Kept\n\nEdited.\n"));
    }

    // ── atomic writes ──

    #[test]
    fn atomic_write_leaves_no_tmp_and_full_content() {
        let (_dir, mut store) = bare();
        let body = format!("# Big note\n\n{}\n", "x".repeat(64 * 1024));
        let meta = store.create("Stuff", &body).unwrap();
        let rel = store.index.get(&meta.id).unwrap().clone();
        let on_disk = fs::read_to_string(store.root().join(&rel)).unwrap();
        assert!(on_disk.ends_with(&body), "truncated or mangled write");
        // the folder holds exactly the one .md — no temp remnants
        let names: Vec<String> = fs::read_dir(store.root().join("Stuff"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names.len(), 1, "temp file left behind: {names:?}");
        assert!(names[0].ends_with(".md"));
    }

    // ── index ──

    #[test]
    fn index_rebuilds_from_disk_scan() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        fs::create_dir_all(root.join("Work")).unwrap();
        fs::write(
            root.join("Work/with-id.md"),
            "---\nid: 01HASID0000000000000ABCDEF\ncreated: 2026-06-10T08:00:00Z\nupdated: 2026-06-10T08:00:00Z\npinned: false\n---\n\n# Has id\n",
        )
        .unwrap();
        fs::write(root.join("Work/no frontmatter.md"), "# Dropped in\n\nFrom outside.\n").unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.notes.len(), 2);
        assert!(list.notes.iter().any(|n| n.id == "01HASID0000000000000ABCDEF"));
        let minted = list.notes.iter().find(|n| n.title == "Dropped in").unwrap().id.clone();

        // minted id is path-stable across runs (persisted in index.json)
        let mut store2 = CorpusStore::open(root.clone()).unwrap();
        store2.os_trash = false;
        let list2 = store2.list().unwrap();
        assert!(list2.notes.iter().any(|n| n.id == minted));

        // delete .rotli entirely → rebuild, zero loss; frontmatter ids survive
        fs::remove_dir_all(root.join(DOT_DIR)).unwrap();
        let mut store3 = CorpusStore::open(root).unwrap();
        store3.os_trash = false;
        let list3 = store3.list().unwrap();
        assert_eq!(list3.notes.len(), 2);
        assert!(list3.notes.iter().any(|n| n.id == "01HASID0000000000000ABCDEF"));
        let doc = store3.read("01HASID0000000000000ABCDEF").unwrap();
        assert_eq!(doc.body, "# Has id\n");
        assert_eq!(doc.folder_id, "Work");
    }

    #[test]
    fn dropped_folder_appears_in_list() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        fs::create_dir_all(root.join("Imported/Deep")).unwrap();
        fs::write(root.join("Imported/Deep/note.md"), "# From outside\n").unwrap();
        let list = store.list().unwrap();
        let ids: Vec<&str> = list.folders.iter().map(|f| f.id.as_str()).collect();
        assert!(ids.contains(&"Imported") && ids.contains(&"Imported/Deep"));
        let deep = list.folders.iter().find(|f| f.id == "Imported/Deep").unwrap();
        assert_eq!(deep.parent_id.as_deref(), Some("Imported"));
        assert!(list.notes.iter().any(|n| n.folder_id == "Imported/Deep"));
    }

    // ── slugs, filenames, renames ──

    #[test]
    fn slugging_and_collisions() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("  ⌥Space — the way in  "), "space-the-way-in");
        assert_eq!(slugify("###"), "untitled");
        assert_eq!(title_of("\n\n## **Bold** _title_\nrest"), "Bold title");
        assert_eq!(title_of("- [x] ship it\n"), "ship it");

        let (_dir, mut store) = bare();
        let a = store.create("", "# Same title\n").unwrap();
        let b = store.create("", "# Same title\n").unwrap();
        let pa = store.index.get(&a.id).unwrap().clone();
        let pb = store.index.get(&b.id).unwrap().clone();
        assert_ne!(pa, pb, "same-title notes must get distinct filenames");
        assert!(pa.starts_with("same-title-") && pa.ends_with(".md"));
    }

    #[test]
    fn title_change_renames_through_the_index() {
        let (_dir, mut store) = bare();
        let meta = store.create("Notes", "# First title\n\nBody.\n").unwrap();
        let before = store.index.get(&meta.id).unwrap().clone();
        assert!(before.contains("first-title-"));

        store.write(&meta.id, "# Second title\n\nBody.\n", false).unwrap();
        let after = store.index.get(&meta.id).unwrap().clone();
        assert!(after.contains("second-title-"), "file not renamed: {after}");
        assert!(!store.root().join(&before).exists(), "old file left behind");
        assert!(store.root().join(&after).is_file());

        // id↔path index stays authoritative: read by the same id still works
        let doc = store.read(&meta.id).unwrap();
        assert_eq!(doc.body, "# Second title\n\nBody.\n");
    }

    // ── full cycle ──

    #[test]
    fn create_read_write_delete_cycle() {
        let (_dir, mut store) = bare();
        let meta = store.create("Inbox", "# Groceries\n\nOlive oil, sourdough.\n").unwrap();
        assert_eq!(meta.title, "Groceries");
        assert_eq!(meta.snippet, "Olive oil, sourdough.");
        assert!(!meta.pinned);

        let doc = store.read(&meta.id).unwrap();
        assert_eq!(doc.body, "# Groceries\n\nOlive oil, sourdough.\n");
        assert_eq!(doc.folder_id, "Inbox");
        assert_eq!(doc.created_at, meta.created_at);

        let updated = store.write(&meta.id, "# Groceries\n\nOlive oil, the good butter.\n", true).unwrap();
        assert!(updated.pinned);
        assert!(updated.updated_at >= meta.updated_at);
        let doc = store.read(&meta.id).unwrap();
        assert!(doc.pinned);
        assert!(doc.body.contains("the good butter"));
        assert_eq!(doc.created_at, meta.created_at, "created must never move");

        // pinned sorts first in list
        store.create("Inbox", "# Unpinned newer\n").unwrap();
        let list = store.list().unwrap();
        assert_eq!(list.notes[0].id, meta.id);

        store.delete(&meta.id).unwrap();
        assert!(store.read(&meta.id).is_err());
        assert!(store.list().unwrap().notes.iter().all(|n| n.id != meta.id));
        // never hard-deleted: it landed in .rotli/trash/
        let trashed: Vec<_> = fs::read_dir(store.root().join(DOT_DIR).join("trash"))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(trashed.len(), 1);
    }

    #[test]
    fn first_run_creates_inbox_and_one_welcome_note() {
        let (_dir, mut store) = fresh();
        assert!(store.root().join("Inbox").is_dir());
        assert!(store.root().join(DOT_DIR).is_dir());
        let list = store.list().unwrap();
        assert_eq!(list.notes.len(), 1, "exactly ONE welcome note, no demo corpus");
        let welcome = &list.notes[0];
        assert_eq!(welcome.folder_id, "Inbox");
        assert_eq!(welcome.title, "Welcome to rotli");
        // it opens cleanly elsewhere: valid fence, body below
        let rel = store.index.get(&welcome.id).unwrap();
        let text = fs::read_to_string(store.root().join(rel)).unwrap();
        assert!(text.starts_with("---\nid: "));
        assert!(text.contains("\n---\n\n# Welcome to rotli"));
        // and the editor sees no frontmatter
        let doc = store.read(&welcome.id).unwrap();
        assert!(doc.body.starts_with("# Welcome to rotli"));
        // opening the same root again is NOT a first run
        drop(store);
        let mut again = CorpusStore::open(_dir.path().join("corpus")).unwrap();
        again.os_trash = false;
        assert_eq!(again.list().unwrap().notes.len(), 1);
    }

    #[test]
    fn pin_persists_across_a_reopen() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        let meta = store.create("Inbox", "# Keep me up top\n").unwrap();
        store.write(&meta.id, "# Keep me up top\n", true).unwrap();
        drop(store);

        let mut again = CorpusStore::open(root).unwrap();
        again.os_trash = false;
        let doc = again.read(&meta.id).unwrap();
        assert!(doc.pinned, "pin lost across quit/relaunch");
        assert_eq!(again.list().unwrap().notes[0].id, meta.id, "pinned must sort first");
    }

    #[test]
    fn overview_reports_what_actually_exists() {
        let (_dir, mut store) = fresh();
        store.create_folder("Work", None).unwrap();
        store.create("Work", "# Plan\n").unwrap();
        let ov = store.overview().unwrap();
        assert!(ov.root.ends_with("corpus"), "root missing: {}", ov.root);
        assert!(ov.folders.contains(&"Inbox".to_string()));
        assert!(ov.folders.contains(&"Work".to_string()));
        assert!(ov.files.iter().any(|f| f.starts_with("Inbox/welcome-to-rotli-")));
        assert!(ov.files.iter().any(|f| f.starts_with("Work/plan-")));
        // .rotli never leaks into the picture
        assert!(ov.folders.iter().all(|f| !f.starts_with('.')));
        assert!(ov.files.iter().all(|f| !f.starts_with('.')));
    }

    #[test]
    fn settings_and_viewstate_are_opaque_json() {
        let (_dir, store) = bare();
        assert_eq!(store.dot_read("settings").unwrap(), "{}");
        store.dot_write("settings", r#"{"theme":"dark"}"#).unwrap();
        assert_eq!(store.dot_read("settings").unwrap(), r#"{"theme":"dark"}"#);
        store.dot_write("viewstate", r#"{"pane":"left"}"#).unwrap();
        assert_eq!(store.dot_read("viewstate").unwrap(), r#"{"pane":"left"}"#);
        store.dot_write("background", r#"{"v":1}"#).unwrap();
        assert_eq!(store.dot_read("background").unwrap(), r#"{"v":1}"#);
        assert!(store.dot_read("passwords").is_err(), "surface stays tight");
    }

    #[test]
    fn folder_ids_are_validated() {
        let (_dir, mut store) = bare();
        assert!(store.create("../escape", "# nope\n").is_err());
        assert!(store.create(".rotli", "# nope\n").is_err());
        assert!(store.create_folder("..", None).is_err());
        assert!(store.create_folder("ok", Some("../up")).is_err());
        let f = store.create_folder("Myela", Some("Work")).unwrap();
        assert_eq!(f.id, "Work/Myela");
        assert_eq!(f.parent_id.as_deref(), Some("Work"));
        assert!(store.root().join("Work/Myela").is_dir());
    }

    // ── watcher ──

    #[test]
    fn suppress_set_marks_and_expires_scope() {
        let s = SuppressSet::default();
        let p = PathBuf::from("/tmp/x.md");
        assert!(!s.contains(&p));
        s.mark(&p);
        assert!(s.contains(&p));
        assert!(!s.contains(Path::new("/tmp/other.md")));
    }

    #[test]
    fn path_relevance_filter() {
        let root = PathBuf::from("/corpus");
        let s = SuppressSet::default();
        assert!(path_relevant(&root, &s, Path::new("/corpus/Work/note.md")));
        assert!(path_relevant(&root, &s, Path::new("/corpus/Dropped"))); // a folder
        assert!(!path_relevant(&root, &s, Path::new("/corpus/.rotli/index.json")));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/.rotli-write-abc")));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/.DS_Store")));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/photo.png")));
        assert!(!path_relevant(&root, &s, Path::new("/elsewhere/x.md")));
        let ours = PathBuf::from("/corpus/Work/ours.md");
        s.mark(&ours);
        assert!(!path_relevant(&root, &s, &ours), "our own write must not echo");
    }

    #[test]
    fn watcher_debounces_external_bursts_and_ignores_our_writes() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), suppress.clone(), move || {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up

        // a burst of external writes → ONE notification (debounced)
        for i in 0..5 {
            fs::write(root.join(format!("ext-{i}.md")), "# external\n").unwrap();
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(1500));
        let after_burst = fired.load(Ordering::SeqCst);
        assert!(after_burst >= 1, "external change never reported");
        assert!(after_burst <= 2, "debounce failed: {after_burst} fires for one burst");

        // our own write (suppressed path) → no new notification
        let ours = root.join("ours.md");
        suppress.mark(&ours);
        fs::write(&ours, "---\nid: x\n---\n\n# ours\n").unwrap();
        std::thread::sleep(Duration::from_millis(900));
        assert_eq!(
            fired.load(Ordering::SeqCst),
            after_burst,
            "our own in-flight write echoed back as external"
        );
    }
}
