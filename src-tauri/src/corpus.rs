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

/// Where the chosen corpus root is remembered — OUTSIDE the corpus (it can
/// move): the app config dir. Missing/empty → fall back to the default root.
fn root_config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("corpus-root.txt"))
}

pub fn read_saved_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let raw = fs::read_to_string(root_config_file(app)?).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

pub fn write_saved_root(app: &tauri::AppHandle, root: &Path) -> std::io::Result<()> {
    let file = root_config_file(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app config dir"))?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(file, root.to_string_lossy().as_bytes())
}

/// Where the chosen MEMEX corpus root is remembered — beside `corpus-root.txt`
/// in the app config dir (Increment 3: the Notes tree can BROWSE a memex
/// instance). Set ⇒ rotli's corpus IS that memex (Layout::Memex); cleared ⇒
/// today's `~/Documents/rotli` legacy chain (Layout::LegacyRotli). Kept distinct
/// from `corpus-root.txt` so relocating the legacy corpus and pointing at a
/// memex are independent, reversible choices.
fn memex_root_config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("corpus-memex-root.txt"))
}

pub fn read_saved_memex_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let raw = fs::read_to_string(memex_root_config_file(app)?).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

pub fn write_saved_memex_root(app: &tauri::AppHandle, root: &Path) -> std::io::Result<()> {
    let file = memex_root_config_file(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app config dir"))?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(file, root.to_string_lossy().as_bytes())
}

/// Forget the memex corpus pointer — rotli falls back to the legacy
/// `~/Documents/rotli` chain. Missing file is a no-op (already legacy).
pub fn clear_saved_memex_root(app: &tauri::AppHandle) -> std::io::Result<()> {
    let Some(file) = memex_root_config_file(app) else {
        return Ok(());
    };
    match fs::remove_file(&file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// The corpus root in effect. Increment 3: when a memex corpus is chosen AND it
/// still exists on disk, the Notes tree browses THAT memex; otherwise today's
/// chain — the saved legacy choice if it still exists, else `~/Documents/rotli`.
pub fn resolve_root(app: &tauri::AppHandle) -> PathBuf {
    // The pointer is honored only while it STILL points at a real memex. If the
    // folder lost its memex.json (a git checkout/rename of smBrain), the pointer
    // is ignored and we fall through to the LEGACY chain (~/Documents/rotli) —
    // never open_legacy on the brain, which would scaffold reserved folders +
    // surface self/history as editable notes.
    if let Some(memex) = read_saved_memex_root(app).filter(|p| is_memex_root(p)) {
        return memex;
    }
    read_saved_root(app)
        .filter(|p| p.exists())
        .unwrap_or_else(|| default_corpus_root(app))
}

/// Move the whole corpus into `new_root` (top-level entries, including
/// `.rotli/`); the caller then persists the new root and relaunches. We refuse
/// a non-empty target and a target inside the current root, so notes are never
/// merged into — or nested under — someone else's files.
pub fn relocate(old_root: &Path, new_root: &Path) -> Result<(), String> {
    if old_root == new_root {
        return Ok(());
    }
    if new_root.starts_with(old_root) {
        return Err("Choose a folder that isn't inside the current notes folder.".into());
    }
    if new_root.exists() {
        let mut entries = fs::read_dir(new_root).map_err(|e| e.to_string())?;
        if entries.next().is_some() {
            return Err("Pick an empty folder — rotli won't merge into existing files.".into());
        }
    } else {
        fs::create_dir_all(new_root).map_err(|e| e.to_string())?;
    }
    for entry in fs::read_dir(old_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let to = new_root.join(entry.file_name());
        fs::rename(entry.path(), &to)
            .map_err(|e| format!("couldn't move {}: {e}", entry.file_name().to_string_lossy()))?;
    }
    Ok(())
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
    /// Where a note CAME FROM before it landed in a hidden root (Archive/Trash).
    /// `Some(folder)` = restore here; `Some("")` = restore to corpus root (a
    /// deliberate, distinct value from absent — `None` means "never moved into
    /// a hidden root, no origin to honor"). Emitted only when `Some(_)`, so
    /// normal notes stay byte-identical. (Seth, 2026-06-13)
    pub origin: Option<String>,
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
                // empty value (`origin:`) stays Some("") — distinct from absent
                "origin" if fm.origin.is_none() => fm.origin = Some(value.to_string()),
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
    // origin emitted ONLY when Some(_) — right after pinned, before foreign —
    // so notes that never entered a hidden root stay byte-identical.
    if let Some(origin) = &fm.origin {
        out.push_str(&format!("origin: {origin}\n"));
    }
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

/// What kind of corpus item this is. Serialized lowercase so the TS side reads
/// `"note"` | `"board"`; `Default` is `Note` so the field is back-compat (a
/// missing `kind` on the wire deserializes — and old TS reads — as a note).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    #[default]
    Note,
    /// An Excalidraw board: a raw `*.excalidraw` scene file, NO frontmatter,
    /// id == its relative path (NOT a ulid, NOT in the `.rotli` index).
    Board,
}

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
    /// Where this note belongs once restored out of a hidden root. Carried only
    /// by notes physically under Archive/Trash; `None` everywhere else.
    pub origin: Option<String>,
    /// "note" (a `.md`) or "board" (a `.excalidraw`). Serde-defaults to note.
    #[serde(default)]
    pub kind: NoteKind,
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
    /// See `NoteMeta::origin`. `corpus_read` returns it so the UI can offer
    /// "restore to <origin>".
    pub origin: Option<String>,
}

/// What `corpus_read_board` returns: the raw Excalidraw scene JSON for a board.
/// Boards have NO frontmatter and their id IS their relative path.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusBoardDoc {
    pub id: String,
    pub folder_id: String,
    /// The raw `.excalidraw` JSON string — the file verbatim.
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A minimal, valid empty Excalidraw scene. New boards start here; it opens
/// blank in excalidraw.com.
const EMPTY_EXCALIDRAW: &str = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"rotli\",\"elements\":[],\"appState\":{},\"files\":{}}";

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

// ─── layout + scope (Increment 3: the corpus can BE a memex instance) ─────────

/// How the corpus root is shaped — decided once at `open()` by probing
/// `root/memex.json` for a valid `mx_` id.
///   • `LegacyRotli` — today's `~/Documents/rotli`: reserved folders, first-run,
///     everything writable. BYTE-IDENTICAL to before Increment 3.
///   • `Memex` — the root IS someone's memex spine (for Seth, `~/smBrain`). Only
///     `chats/` is writable + surfaced read-write; `wiki/` is read-only; `self/`,
///     `history/`, `MAP.md`, `inbox.md` and every control file stay HIDDEN. No
///     reserved folders are scaffolded, no first-run seeding ever runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Memex,
    LegacyRotli,
}

/// Whether `root/memex.json` marks this dir as a real memex (valid `mx_` id).
/// Pure (no app handle) so `open()` and the unit tests can both call it. The
/// detection IDEA mirrors `memex::detect_one`; this is a tiny local probe so
/// corpus.rs never depends on the memex module's wire types.
pub fn is_memex_root(root: &Path) -> bool {
    let text = match fs::read_to_string(root.join("memex.json")) {
        Ok(t) => t,
        Err(_) => return false,
    };
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("id").and_then(|x| x.as_str()).map(str::to_string))
        .map(|id| id.starts_with("mx_"))
        .unwrap_or(false)
}

/// What a relative path is to rotli, given the layout. The Notes tree (walk/list)
/// uses it to decide inclusion + read/write flags; the write gate uses it to
/// refuse forbidden paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    /// A normal, editable note (LegacyRotli: everything; Memex: `chats/**.md`).
    NoteRW,
    /// Surfaced but read-only this increment (Memex: `wiki/**.md`).
    NoteRO,
    /// Never surfaced, never written (Memex: self/history/MAP/inbox + control).
    Hidden,
}

/// The scope predicate. `rel` is a path relative to the corpus root, using `/`
/// separators ("" = the root itself).
///
/// LegacyRotli surfaces everything read-write (today's behavior). Memex surfaces
/// ONLY `wiki/` (read-only) + `chats/` (read-write) and hides the brain's memory
/// (self/history/MAP/inbox) and every smBrain control file. Top-level smBrain
/// docs (STRUCTURE.md, CONFIG.md, …) are `.md`, so this rule — not the dot-filter
/// — is what keeps them out of the Notes tree.
fn surfaced(layout: Layout, rel: &str) -> Surface {
    if layout == Layout::LegacyRotli {
        return Surface::NoteRW;
    }
    let rel = rel.trim_start_matches('/');
    // chats/ — rotli's owned, writable surface (the dir itself + everything under)
    if rel == "chats" || rel.starts_with("chats/") {
        return Surface::NoteRW;
    }
    // wiki/ — browsable folders, read-only this increment
    if rel == "wiki" || rel.starts_with("wiki/") {
        return Surface::NoteRO;
    }
    // everything else inside a memex is hidden from the Notes tree and unwritable:
    // self/ history/ archive/ trash/, MAP.md, inbox.md, and all control files
    // (memex.json, users.json, *.local.json, *.json at root, clients/, scripts/,
    // STRUCTURE/CONFIG/README/CHANGELOG/ASSETS .md, …).
    Surface::Hidden
}

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
    /// How this root is shaped (Increment 3). LegacyRotli = today's behavior in
    /// every respect; Memex gates folders/ownership/scope. Decided at `open()`.
    layout: Layout,
}

impl CorpusStore {
    /// Open (or first-run-initialize) a corpus at `root`. The dispatcher: probe
    /// `root/memex.json` once — a valid `mx_` id routes to the memex path (browse
    /// the spine, never scaffold), anything else to the legacy path (today,
    /// byte-identical).
    pub fn open(root: PathBuf) -> Result<Self, String> {
        // Probe BEFORE create_dir_all so an absent dir reads as "not a memex"
        // (→ legacy first-run), never as a memex over an empty folder.
        if is_memex_root(&root) {
            Self::open_memex(root)
        } else {
            Self::open_legacy(root)
        }
    }

    /// Today's behavior, unchanged: reserved folders + first-run seeding, every
    /// path writable. Layout::LegacyRotli.
    fn open_legacy(root: PathBuf) -> Result<Self, String> {
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
            layout: Layout::LegacyRotli,
        };
        store.load_index();
        // Scaffold the six reserved sidebar destinations every open (idempotent),
        // so existing corpora gain them too. (Seth, 2026-06-13)
        store.ensure_reserved_folders()?;
        if fresh {
            store.first_run()?;
        }
        Ok(store)
    }

    /// The memex path (Increment 3): the root IS a memex spine. Create only the
    /// dot-prefixed `.rotli/` sidecar (walk + smBrain's validate.ts both skip
    /// dot-entries, so it never pollutes the brain) and load the index — but
    /// SKIP `ensure_reserved_folders` and SKIP `first_run`: rotli must never
    /// scaffold its Inbox/Brain/Storage/… inside someone's smBrain. Layout::Memex
    /// then keeps every write off self/history/wiki/MAP/inbox + control files.
    fn open_memex(root: PathBuf) -> Result<Self, String> {
        let root = fs::canonicalize(&root)
            .map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        fs::create_dir_all(root.join(DOT_DIR))
            .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;

        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::Memex,
        };
        store.load_index();
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

    /// The six reserved top-level destinations the sidebar always offers —
    /// Inbox, Brain, Storage, Board, Archive, Trash — scaffolded on disk so they exist
    /// even on a corpus that predates them. Called unconditionally from `open`;
    /// `create_dir_all` is a no-op when a dir is already there, so this is fully
    /// idempotent. Empty reserved dirs surface as zero-note folders via `walk`;
    /// the TS layer decides which double as fixed destinations vs. plain folders.
    /// (Seth, 2026-06-13)
    fn ensure_reserved_folders(&self) -> Result<(), String> {
        for name in ["Inbox", "Brain", "Storage", "Board", "Archive", "Trash"] {
            fs::create_dir_all(self.root.join(name))
                .map_err(|e| format!("create reserved folder {name}: {e}"))?;
        }
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

    /// The ownership choke point (Increment 3). Called at the TOP of every
    /// mutating method, before any disk touch. LegacyRotli → Ok for everything
    /// (today). Memex → Ok ONLY for `chats/**` (and creating the `chats/` dir);
    /// every other path returns a user-facing Err that the TS layer renders.
    /// `rel == ""` is the corpus root — writable only in LegacyRotli.
    fn writable(&self, rel: &str) -> Result<(), String> {
        if self.layout == Layout::LegacyRotli {
            return Ok(());
        }
        match surfaced(self.layout, rel) {
            Surface::NoteRW => Ok(()),
            _ => Err(format!(
                "smBrain's memory is read-only here — rotli only writes chats (refused: {})",
                if rel.is_empty() { "<root>" } else { rel }
            )),
        }
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

        walk(self.layout, &self.root, "", &reverse, &mut new_index, &mut folders, &mut notes)?;

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
        let folder = folder_of(&rel);
        Ok(NoteDoc {
            id: id.to_string(),
            origin: if is_hidden_root(&folder) { fm.origin.clone() } else { None },
            folder_id: folder,
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
        self.writable(&rel)?;
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
            // an edit never changes WHERE a note belongs — carry origin through.
            origin: old_fm.origin,
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
            folder_id: folder.clone(),
            created_at: stamp_to_ms(&created).unwrap_or_else(now_ms),
            updated_at: stamp_to_ms(&updated).unwrap_or_else(now_ms),
            pinned,
            origin: if is_hidden_root(&folder) { fm.origin } else { None },
            kind: NoteKind::Note,
        })
    }

    /// Move a note to `target_folder`, PRESERVING its id (and created stamp,
    /// and order — `updated` is NOT bumped). The origin rule is baked in here so
    /// the never-delete lifecycle is one place:
    ///   • into a hidden root from a visible folder → stamp origin = the folder
    ///     it came from (so Restore knows where home is);
    ///   • out of a hidden root (target visible) when an origin exists → clear
    ///     it (it's home now);
    ///   • otherwise keep whatever origin was there (hidden→hidden, or a plain
    ///     visible→visible move that never had one).
    /// `target_folder == ""` means the corpus root (no validation, no dir).
    /// Filenames collide safely (free_filename); the id is the through-line.
    pub fn move_note(&mut self, id: &str, target_folder: &str) -> Result<NoteMeta, String> {
        let rel = self.path_of(id)?;
        // BOTH ends must be writable: the note's current file (a self/ note may
        // not leave) AND its destination folder (only chats/ accepts notes in a
        // memex). LegacyRotli waves both through.
        self.writable(&rel)?;
        self.writable(target_folder)?;
        let abs = self.abs(&rel);
        let text = fs::read_to_string(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        let (fm, raw) = parse_document(&text);
        let body = match &fm {
            Some(_) => editor_body(raw),
            None => raw,
        }
        .to_string();
        let old_fm = fm.unwrap_or_default();
        let current_folder = folder_of(&rel);

        // ── the origin rule ──
        let into_hidden = is_hidden_root(target_folder);
        let from_hidden = is_hidden_root(&current_folder);
        let origin = if into_hidden && !from_hidden {
            // entering a sink: remember where it lived (root == "")
            Some(current_folder.clone())
        } else if !into_hidden && old_fm.origin.is_some() {
            // restored / moved out of a sink: home now, drop the breadcrumb
            None
        } else {
            old_fm.origin.clone()
        };

        // validate + create the destination (root is "" → neither)
        if !target_folder.is_empty() {
            validate_rel(target_folder)?;
            fs::create_dir_all(self.abs(target_folder))
                .map_err(|e| format!("create folder {target_folder}: {e}"))?;
        }

        // stable identity, fresh-but-collision-safe filename in the new folder
        let title = title_of(&body);
        let desired = filename_for(&title, id);
        let target_rel = self.free_filename(target_folder, &desired, None);
        let target_abs = self.abs(&target_rel);

        // preserve id + created; DO NOT bump updated (order stays put)
        let (file_created, file_updated) = file_stamps(&abs);
        let created = old_fm
            .created
            .clone()
            .filter(|s| stamp_to_ms(s).is_some())
            .unwrap_or_else(|| ms_to_stamp(file_created));
        let updated = old_fm
            .updated
            .clone()
            .filter(|s| stamp_to_ms(s).is_some())
            .unwrap_or_else(|| ms_to_stamp(file_updated));
        let pinned = old_fm.pinned.unwrap_or(false);
        let fm = Frontmatter {
            id: Some(id.to_string()),
            created: Some(created.clone()),
            updated: Some(updated.clone()),
            pinned: Some(pinned),
            origin: origin.clone(),
            foreign: old_fm.foreign,
        };
        let out = compose_document(&fm, &format!("\n{body}"));

        // both paths are OUR writes — neither should echo back as external
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        atomic_write(&target_abs, &out)?;
        if target_abs != abs {
            let _ = fs::remove_file(&abs);
        }
        self.index.insert(id.to_string(), target_rel);
        self.persist_index();

        Ok(NoteMeta {
            id: id.to_string(),
            title,
            snippet: snippet_of(&body),
            folder_id: target_folder.to_string(),
            created_at: stamp_to_ms(&created).unwrap_or(file_created),
            updated_at: stamp_to_ms(&updated).unwrap_or(file_updated),
            pinned,
            origin,
            kind: NoteKind::Note,
        })
    }

    pub fn create(&mut self, folder_id: &str, body: &str) -> Result<NoteMeta, String> {
        self.writable(folder_id)?;
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
            origin: None,
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
            origin: None,
            kind: NoteKind::Note,
        })
    }

    // ─── boards (Excalidraw) ────────────────────────────────────────────────
    // Boards are a parallel surface: raw `*.excalidraw` JSON files, NO
    // frontmatter, id == the relative path, and they bypass the `.rotli` ulid
    // index entirely. The same writable() gate + validate_rel keep them inside
    // the corpus root and out of read-only memex surfaces.

    /// Read a board's raw Excalidraw scene JSON. `id` IS the relative path.
    pub fn read_board(&mut self, id: &str) -> Result<CorpusBoardDoc, String> {
        validate_rel(id)?;
        if !id.ends_with(".excalidraw") {
            return Err(format!("not a board: {id}"));
        }
        // reads honor the same memex scope as writes: never return a board that
        // lives under a hidden root (self/history/MAP/inbox) the listing walk
        // would never surface — this is the only corpus read that could leak one.
        if surfaced(self.layout, id) == Surface::Hidden {
            return Err(format!("not available here: {id}"));
        }
        let abs = self.abs(id);
        if !abs.is_file() {
            return Err(format!("board not found: {id}"));
        }
        let body = fs::read_to_string(&abs).map_err(|e| format!("read {id}: {e}"))?;
        let (created_at, updated_at) = file_stamps(&abs);
        Ok(CorpusBoardDoc {
            id: id.to_string(),
            folder_id: folder_of(id),
            body,
            created_at,
            updated_at,
        })
    }

    /// Save a board's raw scene JSON verbatim (no frontmatter, no index touch).
    pub fn write_board(&mut self, id: &str, body: &str) -> Result<NoteMeta, String> {
        validate_rel(id)?;
        if !id.ends_with(".excalidraw") {
            return Err(format!("not a board: {id}"));
        }
        self.writable(id)?;
        // re-create the parent dir if it vanished under us (e.g. the folder was
        // deleted in Finder while a board tab stayed open) — atomic_write needs
        // the dir to exist, and a debounced save must not silently drop edits.
        let folder = folder_of(id);
        if !folder.is_empty() {
            fs::create_dir_all(self.abs(&folder))
                .map_err(|e| format!("create folder {folder}: {e}"))?;
        }
        let abs = self.abs(id);
        self.suppress.mark(&abs);
        atomic_write(&abs, body)?;
        let (created_at, updated_at) = file_stamps(&abs);
        Ok(NoteMeta {
            id: id.to_string(),
            title: board_title(id),
            snippet: String::new(),
            folder_id: folder_of(id),
            created_at,
            updated_at,
            pinned: false,
            origin: None,
            kind: NoteKind::Board,
        })
    }

    /// Create a new board in `folder_id`. `body` defaults to an empty scene.
    /// Filename is a free `untitled.excalidraw` (collision-safe). id == relpath.
    pub fn create_board(&mut self, folder_id: &str, body: Option<&str>) -> Result<NoteMeta, String> {
        self.writable(folder_id)?;
        if !folder_id.is_empty() {
            validate_rel(folder_id)?;
            fs::create_dir_all(self.abs(folder_id))
                .map_err(|e| format!("create folder {folder_id}: {e}"))?;
        }
        let rel = self.free_board_filename(folder_id, "untitled.excalidraw");
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write(&abs, body.unwrap_or(EMPTY_EXCALIDRAW))?;
        let (created_at, updated_at) = file_stamps(&abs);
        Ok(NoteMeta {
            id: rel.clone(),
            title: board_title(&rel),
            snippet: String::new(),
            folder_id: folder_id.to_string(),
            created_at,
            updated_at,
            pinned: false,
            origin: None,
            kind: NoteKind::Board,
        })
    }

    /// First free `.excalidraw` filename in a folder (boards have no id suffix,
    /// so this is the real collision guard). Mirrors `free_filename` for `.md`.
    fn free_board_filename(&self, folder: &str, desired: &str) -> String {
        let join = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let mut rel = join(desired);
        let mut n = 2;
        while self.abs(&rel).exists() {
            let stem = desired.trim_end_matches(".excalidraw");
            rel = join(&format!("{stem}-{n}.excalidraw"));
            n += 1;
        }
        rel
    }

    /// Delete is now SOFT and reversible: the note slides into the reserved
    /// `Trash` folder (still a real `.md` in the corpus, still openable in any
    /// editor), stamped with where it came from so it can be restored. It NEVER
    /// leaves the corpus — emptying the trash (the hard delete) is `purge`.
    /// (Seth, 2026-06-13)
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        // Soft-delete slides the note into the reserved `Trash` folder. In a
        // memex there is no writable `Trash`, so move_note's target gate refuses
        // it — gate here too so the error is explicit (chats aren't deleted into
        // the brain's sinks this increment).
        let rel = self.path_of(id)?;
        self.writable(&rel)?;
        self.move_note(id, "Trash").map(|_| ())
    }

    /// The ONLY hard delete — a future "Empty Trash". The note actually leaves
    /// the corpus: OS trash first, `.rotli/trash/` as the fallback (and as the
    /// test path — tests must not touch the user's real Trash). No TS wrapper
    /// yet; wired into the invoke_handler so the UI can call it later.
    pub fn purge(&mut self, id: &str) -> Result<(), String> {
        let rel = self.path_of(id)?;
        self.writable(&rel)?;
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
        // Only writable subtrees accept new folders (Memex: under chats/ only).
        self.writable(&rel)?;
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

/// The two never-delete sinks: a folder is a hidden root when it IS Archive or
/// Trash, or lives anywhere beneath one. Moving INTO one stamps an origin;
/// moving back OUT clears it. (Seth, 2026-06-13)
fn is_hidden_root(folder: &str) -> bool {
    folder == "Archive"
        || folder == "Trash"
        || folder.starts_with("Archive/")
        || folder.starts_with("Trash/")
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
    layout: Layout,
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
        // The scope gate (Increment 3): in Memex layout only wiki/ + chats/ are
        // surfaced; self/history/MAP/inbox + every control file are Hidden, so
        // the brain's memory and smBrain's root docs never appear as notes. A
        // Hidden DIRECTORY is not descended into. LegacyRotli surfaces all.
        if surfaced(layout, &rel) == Surface::Hidden {
            continue;
        }
        if kind.is_dir() {
            folders.push(FolderMeta {
                id: rel.clone(),
                name,
                parent_id: if prefix.is_empty() { None } else { Some(prefix.to_string()) },
            });
            walk(layout, root, &rel, reverse, new_index, folders, notes)?;
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
            // only notes physically under a hidden root (Archive/Trash) carry
            // an origin out to the wire; everything else is None.
            let origin = if is_hidden_root(prefix) { fm.origin.clone() } else { None };
            notes.push(NoteMeta {
                id,
                title: title_of(body),
                snippet: snippet_of(body),
                folder_id: prefix.to_string(),
                created_at: fm.created.as_deref().and_then(stamp_to_ms).unwrap_or(file_created),
                updated_at: fm.updated.as_deref().and_then(stamp_to_ms).unwrap_or(file_updated),
                pinned: fm.pinned.unwrap_or(false),
                origin,
                kind: NoteKind::Note,
            });
        } else if kind.is_file() && name.ends_with(".excalidraw") {
            // Boards: a parallel, frontmatter-free, path-as-id surface. NO
            // frontmatter parse, NO `.rotli` ulid index (id IS the relpath),
            // title = the file stem. They live next to `.md` notes in the tree.
            let abs = entry.path();
            let (file_created, file_updated) = file_stamps(&abs);
            notes.push(NoteMeta {
                id: rel.clone(),
                title: board_title(&rel),
                snippet: String::new(),
                folder_id: prefix.to_string(),
                created_at: file_created,
                updated_at: file_updated,
                pinned: false,
                origin: None,
                kind: NoteKind::Board,
            });
        }
    }
    Ok(())
}

/// A board's display title = its filename without the `.excalidraw` extension.
fn board_title(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| rel.to_string())
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
    // directories (a dropped folder), .md notes and .excalidraw boards matter;
    // foreign files don't
    match path.extension() {
        Some(ext) => ext == "md" || ext == "excalidraw" || path.is_dir(),
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

/// Move a note to another folder, preserving its id (Tauri maps the JS
/// `targetFolder` arg to `target_folder`). The origin rule for the hidden
/// Archive/Trash roots is baked into `move_note`.
#[tauri::command]
pub fn corpus_move(
    state: tauri::State<'_, CorpusState>,
    id: String,
    target_folder: String,
) -> Result<NoteMeta, String> {
    state.with(|s| s.move_note(&id, &target_folder))
}

/// The hard delete (a future "Empty Trash") — no TS wrapper yet, but registered
/// so the UI can reach it later.
#[tauri::command]
pub fn corpus_purge(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    state.with(|s| s.purge(&id))
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
pub fn corpus_read_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<CorpusBoardDoc, String> {
    state.with(|s| s.read_board(&id))
}

#[tauri::command]
pub fn corpus_write_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
) -> Result<NoteMeta, String> {
    state.with(|s| s.write_board(&id, &body))
}

/// Create a board in `folderId` (Tauri maps the JS `folderId` arg to
/// `folder_id`). `body` is optional — `None` seeds an empty Excalidraw scene.
#[tauri::command]
pub fn corpus_create_board(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    body: Option<String>,
) -> Result<NoteMeta, String> {
    state.with(|s| s.create_board(&folder_id, body.as_deref()))
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
        // origin ABSENT in this document → None → not emitted → byte-identical
        assert_eq!(fm.origin, None);
        assert_eq!(compose_document(&fm, body), text);
    }

    #[test]
    fn origin_emitted_only_when_some_and_after_pinned() {
        // present → parsed AND emitted right after the pinned line, before foreign
        let with = "---\nid: AAAA\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T11:00:00Z\npinned: false\norigin: Brain\ntags: [a]\n---\n\n# Filed\n";
        let (fm, body) = parse_document(with);
        let fm = fm.unwrap();
        assert_eq!(fm.origin.as_deref(), Some("Brain"));
        assert_eq!(fm.foreign, vec!["tags: [a]"]);
        let out = compose_document(&fm, body);
        assert_eq!(out, with, "origin must round-trip byte-exact after pinned");
        // emitted line sits immediately after pinned and before the foreign key
        let pinned_at = out.find("pinned: false\n").unwrap();
        let origin_at = out.find("origin: Brain\n").unwrap();
        let tags_at = out.find("tags: [a]").unwrap();
        assert!(pinned_at < origin_at && origin_at < tags_at);

        // empty value (`origin:`) is DISTINCT from absent — kept as Some("")
        // (means "restore to corpus root"), still emitted
        let root_origin = "---\nid: B\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T10:00:00Z\npinned: false\norigin: \n---\n\n# At root once\n";
        let (fm, body) = parse_document(root_origin);
        let fm = fm.unwrap();
        assert_eq!(fm.origin.as_deref(), Some(""));
        assert_eq!(compose_document(&fm, body), root_origin);

        // None → never emitted (no stray `origin:` line)
        let absent = "---\nid: C\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T10:00:00Z\npinned: true\n---\n\n# Plain\n";
        let (fm, body) = parse_document(absent);
        let fm = fm.unwrap();
        assert_eq!(fm.origin, None);
        let out = compose_document(&fm, body);
        assert!(!out.contains("origin:"), "absent origin must not be emitted:\n{out}");
        assert_eq!(out, absent);
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

        // delete is now SOFT: the note is NOT gone — it slid into Trash/,
        // still a real file, still readable by the same id, carrying its origin.
        store.delete(&meta.id).unwrap();
        let doc = store.read(&meta.id).unwrap();
        assert!(doc.folder_id.starts_with("Trash"), "soft-deleted note must live under Trash, got {}", doc.folder_id);
        assert_eq!(doc.origin.as_deref(), Some("Inbox"), "origin must remember where it came from");
        assert!(doc.body.contains("the good butter"), "body survives the move");
        // still surfaced by the raw walk — but under Trash, so the TS "normal"
        // view (isHidden) filters it out. The corpus never loses it.
        let list = store.list().unwrap();
        let still = list.notes.iter().find(|n| n.id == meta.id).unwrap();
        assert!(still.folder_id.starts_with("Trash"), "still in the corpus, just under Trash");
        // the file truly lives on disk under Trash/ (never the OS trash / .rotli)
        let rel = store.index.get(&meta.id).unwrap();
        assert!(rel.starts_with("Trash/"), "physical path under Trash: {rel}");
        assert!(store.root().join(rel).is_file());
    }

    // ── boards (Excalidraw): a parallel, path-as-id, frontmatter-free surface ──

    #[test]
    fn board_create_list_read_write_cycle() {
        let (_dir, mut store) = bare();

        // create defaults to an empty scene, lands in the requested folder,
        // id == its relative path, kind == Board.
        let meta = store.create_board("Inbox/excalidraw", None).unwrap();
        assert_eq!(meta.kind, NoteKind::Board);
        assert_eq!(meta.id, "Inbox/excalidraw/untitled.excalidraw");
        assert_eq!(meta.folder_id, "Inbox/excalidraw");
        assert_eq!(meta.title, "untitled");
        assert!(meta.snippet.is_empty());

        // it surfaces in the listing as a board with the same path-id
        let list = store.list().unwrap();
        let board = list.notes.iter().find(|n| n.id == meta.id).unwrap();
        assert_eq!(board.kind, NoteKind::Board);
        assert_eq!(board.folder_id, "Inbox/excalidraw");
        // boards are NOT in the .rotli ulid index (path IS the id)
        assert!(!store.index.contains_key(&meta.id), "boards must bypass the ulid index");

        // read returns the raw JSON body (the empty-scene default)
        let doc = store.read_board(&meta.id).unwrap();
        assert_eq!(doc.id, meta.id);
        assert_eq!(doc.folder_id, "Inbox/excalidraw");
        assert!(doc.body.contains("\"type\":\"excalidraw\""), "default scene JSON: {}", doc.body);

        // write round-trips the raw scene verbatim (no frontmatter added)
        let scene = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"rotli\",\"elements\":[{\"id\":\"a\"}],\"appState\":{},\"files\":{}}";
        let w = store.write_board(&meta.id, scene).unwrap();
        assert_eq!(w.kind, NoteKind::Board);
        let on_disk = fs::read_to_string(store.root().join(&meta.id)).unwrap();
        assert_eq!(on_disk, scene, "board JSON must persist byte-exact, no frontmatter");
        let doc = store.read_board(&meta.id).unwrap();
        assert!(doc.body.contains("\"id\":\"a\""), "round-tripped element survives");

        // a second board in the same folder gets a collision-safe name
        let meta2 = store.create_board("Inbox/excalidraw", None).unwrap();
        assert_eq!(meta2.id, "Inbox/excalidraw/untitled-2.excalidraw");
    }

    #[test]
    fn dropped_board_surfaces_with_board_kind() {
        let (_dir, mut store) = bare();
        // a `.excalidraw` file dropped straight into the corpus (no app help)
        fs::create_dir_all(store.root().join("Notes")).unwrap();
        fs::write(
            store.root().join("Notes/sketch.excalidraw"),
            "{\"type\":\"excalidraw\",\"elements\":[]}",
        )
        .unwrap();
        let list = store.list().unwrap();
        let board = list.notes.iter().find(|n| n.id == "Notes/sketch.excalidraw").unwrap();
        assert_eq!(board.kind, NoteKind::Board);
        assert_eq!(board.title, "sketch");
        assert_eq!(board.folder_id, "Notes");
        assert!(!store.index.contains_key("Notes/sketch.excalidraw"));
    }

    #[test]
    fn read_board_rejects_non_board_and_escape() {
        let (_dir, mut store) = bare();
        assert!(store.read_board("Inbox/note.md").is_err(), "must reject non-.excalidraw");
        assert!(store.read_board("../escape.excalidraw").is_err(), "must reject path escape");
        assert!(store.read_board("Nope/missing.excalidraw").is_err(), "missing file errors");
    }

    // ── the never-delete lifecycle: move · archive · restore ──

    #[test]
    fn move_into_archive_stamps_origin_then_restore_clears_it() {
        let (_dir, mut store) = bare();
        let meta = store.create("Brain", "# A thought\n\nKeep this.\n").unwrap();
        let id = meta.id.clone();
        // fresh out of Brain there is no origin
        assert_eq!(store.read(&id).unwrap().origin, None);

        // into Archive (a hidden root) from Brain → origin = Brain, id preserved
        let archived = store.move_note(&id, "Archive").unwrap();
        assert_eq!(archived.id, id, "id must survive the move");
        assert_eq!(archived.folder_id, "Archive");
        assert_eq!(archived.origin.as_deref(), Some("Brain"));
        let doc = store.read(&id).unwrap();
        assert_eq!(doc.folder_id, "Archive");
        assert_eq!(doc.origin.as_deref(), Some("Brain"));
        assert!(doc.body.contains("Keep this."));
        // the breadcrumb is on disk
        let rel = store.index.get(&id).unwrap();
        assert!(rel.starts_with("Archive/"));
        let on_disk = fs::read_to_string(store.root().join(rel)).unwrap();
        assert!(on_disk.contains("origin: Brain"), "origin not persisted:\n{on_disk}");

        // move back to its origin → origin cleared, lands in Brain
        let restored = store.move_note(&id, "Brain").unwrap();
        assert_eq!(restored.folder_id, "Brain");
        assert_eq!(restored.origin, None, "restore must clear the breadcrumb");
        let doc = store.read(&id).unwrap();
        assert_eq!(doc.folder_id, "Brain");
        assert_eq!(doc.origin, None);
        let rel = store.index.get(&id).unwrap();
        assert!(rel.starts_with("Brain/"));
        let on_disk = fs::read_to_string(store.root().join(rel)).unwrap();
        assert!(!on_disk.contains("origin:"), "origin should be gone after restore:\n{on_disk}");
    }

    #[test]
    fn purge_is_the_only_hard_delete() {
        let (_dir, mut store) = bare();
        let meta = store.create("Inbox", "# Throwaway\n").unwrap();
        // soft-delete first (into Trash), then purge it for real
        store.delete(&meta.id).unwrap();
        assert!(store.read(&meta.id).is_ok(), "still in the corpus after soft delete");
        store.purge(&meta.id).unwrap();
        assert!(store.read(&meta.id).is_err(), "purge removes it from the corpus");
        assert!(store.list().unwrap().notes.iter().all(|n| n.id != meta.id));
        // never a TRUE hard delete in tests: it landed in .rotli/trash/
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
        assert!(path_relevant(&root, &s, Path::new("/corpus/Inbox/excalidraw/ideas.excalidraw"))); // a board
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

    // ── Increment 3: the corpus can BE a memex instance ──

    /// Write a minimal-but-valid memex.json (a real `mx_` id) at `root`, plus the
    /// spine dirs + control files the scope tests probe.
    fn seed_memex(root: &Path) {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("memex.json"),
            "{\"id\":\"mx_test123\",\"contract\":\"3.4\",\"apps\":{}}",
        )
        .unwrap();
        for d in ["self", "wiki", "history", "chats", "archive", "trash"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        fs::write(root.join("inbox.md"), "# Inbox\n").unwrap();
        fs::write(root.join("MAP.md"), "# MAP\n").unwrap();
        fs::write(root.join("STRUCTURE.md"), "# Structure\n").unwrap();
        fs::write(root.join("self/identity.md"), "# Me\n").unwrap();
        fs::write(root.join("wiki/note.md"), "# A wiki note\n").unwrap();
        fs::write(root.join("chats/welcome.md"), "# Welcome chat\n").unwrap();
    }

    #[test]
    fn surfaced_scopes_a_memex_to_wiki_and_chats() {
        let m = Layout::Memex;
        // hidden: the brain's memory + every control/root doc
        assert_eq!(surfaced(m, "STRUCTURE.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "memex.json"), Surface::Hidden);
        assert_eq!(surfaced(m, "self/x.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "inbox.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "MAP.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "history/2026/x.md"), Surface::Hidden);
        // surfaced: chats writable, wiki read-only
        assert_eq!(surfaced(m, "chats/x.md"), Surface::NoteRW);
        assert_eq!(surfaced(m, "chats"), Surface::NoteRW);
        assert_eq!(surfaced(m, "wiki/x.md"), Surface::NoteRO);
        assert_eq!(surfaced(m, "wiki"), Surface::NoteRO);
        // LegacyRotli surfaces everything read-write (today)
        assert_eq!(surfaced(Layout::LegacyRotli, "STRUCTURE.md"), Surface::NoteRW);
        assert_eq!(surfaced(Layout::LegacyRotli, "self/x.md"), Surface::NoteRW);
    }

    #[test]
    fn writable_gate_refuses_the_brain_allows_chats() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // forbidden: self/history/MAP/wiki/inbox + control files + the root
        assert!(store.writable("self/identity.md").is_err());
        assert!(store.writable("history/x.md").is_err());
        assert!(store.writable("MAP.md").is_err());
        assert!(store.writable("wiki/note.md").is_err());
        assert!(store.writable("inbox.md").is_err());
        assert!(store.writable("memex.json").is_err());
        assert!(store.writable("").is_err());
        // allowed: chats and anything under it
        assert!(store.writable("chats").is_ok());
        assert!(store.writable("chats/new.md").is_ok());
    }

    #[test]
    fn board_gating_in_a_memex_matches_notes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // create/write are refused outside the writable chats/ surface…
        assert!(store.create_board("self", None).is_err());
        assert!(store.write_board("self/x.excalidraw", "{}").is_err());
        // …and allowed inside chats/ (rotli's owned surface)
        let meta = store.create_board("chats", None).unwrap();
        assert_eq!(meta.kind, NoteKind::Board);
        assert!(store.read_board(&meta.id).unwrap().body.contains("excalidraw"));

        // read is gated too: a board that physically sits under a hidden root
        // (self/) must NOT be readable, even though its path is well-formed.
        fs::create_dir_all(root.join("self")).unwrap();
        fs::write(root.join("self/secret.excalidraw"), EMPTY_EXCALIDRAW).unwrap();
        assert!(store.read_board("self/secret.excalidraw").is_err());
    }

    #[test]
    fn memex_open_skips_reserved_folders_and_first_run() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // NO rotli reserved folders scaffolded inside someone's smBrain. (We omit
        // Archive/Trash: the memex's own lowercase archive//trash/ sinks already
        // exist and macOS's case-insensitive FS would match them — the scope test
        // below proves they don't SURFACE, which is the real guarantee.)
        for name in ["Inbox", "Brain", "Storage", "Board"] {
            assert!(
                !store.root().join(name).exists(),
                "memex open must not scaffold the reserved folder {name}"
            );
        }
        // and no welcome note seeded into the brain
        let list = store.list().unwrap();
        assert!(
            list.notes.iter().all(|n| n.title != "Welcome to rotli"),
            "first-run welcome note leaked into the memex"
        );

        // the Notes tree shows ONLY wiki/ + chats/ — never self/history/STRUCTURE
        let folder_ids: Vec<&str> = list.folders.iter().map(|f| f.id.as_str()).collect();
        assert!(folder_ids.contains(&"wiki"), "wiki/ should surface as a folder");
        assert!(folder_ids.contains(&"chats"), "chats/ should surface as a folder");
        assert!(!folder_ids.iter().any(|f| f.starts_with("self")), "self/ must stay hidden");
        assert!(!folder_ids.iter().any(|f| f.starts_with("history")), "history/ must stay hidden");
        assert!(!folder_ids.iter().any(|f| f.starts_with("archive")), "archive/ must stay hidden");
        // STRUCTURE.md / inbox.md / MAP.md (root .md docs) never appear as notes
        let folders_of: Vec<&str> = list.notes.iter().map(|n| n.folder_id.as_str()).collect();
        assert!(
            list.notes.iter().all(|n| n.title != "Structure" && n.title != "MAP" && n.title != "Inbox"),
            "a root smBrain doc surfaced as an editable note"
        );
        // every surfaced note lives under wiki/ or chats/, nothing else
        assert!(
            folders_of.iter().all(|f| *f == "wiki" || *f == "chats"),
            "a note outside wiki/+chats/ surfaced: {folders_of:?}"
        );
    }

    #[test]
    fn legacy_open_still_scaffolds_reserved_folders() {
        // a plain (non-memex) dir keeps today's behavior exactly
        let dir = TempDir::new().unwrap();
        let mut store = CorpusStore::open(dir.path().join("corpus")).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::LegacyRotli);
        for name in ["Inbox", "Brain", "Storage", "Board", "Archive", "Trash"] {
            assert!(
                store.root().join(name).is_dir(),
                "legacy open must still scaffold the reserved folder {name}"
            );
        }
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
