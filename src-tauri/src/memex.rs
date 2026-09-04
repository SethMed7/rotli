//! Stage 1 — the memex seam. rotli connects to (or initiates) a memex instance:
//! the shared `identity/ personality/ wiki/ history/ chats/ inbox.md MAP.md` spine that
//! Breve also writes to (for the maintainer, `~/memex-vault`).
//!
//! MIRROR-NOT-IMPORT (the boundary law, see breve-runtime/docs/memex-boundary.md): rotli
//! NEVER imports memex-vault's bun/node engine. It does file I/O here and only ever
//! never executes code stored in a memex. The byte-shape of the files
//! it writes is mirrored in `src/memex/contract.ts` (TS) — this module just lays
//! the bytes down atomically + under an advisory lock (Breve's daemon writes the
//! same tree concurrently).
//!
//! OWNERSHIP: rotli writes ONLY `chats/`, the `wiki/_inbox/` note staging (v3.5),
//! and new ordinary notes directly under `wiki/` when the Librarian is disabled.
//! `inbox.md` is NOT a rotli write surface (#96, audit 2026-07 — nothing ever appended
//! it; captures follow the same Librarian-aware note-creation policy; Breve owns
//! its own inbox.md appends; rotli only
//! scaffolds the file when initiating a NEW memex). `identity/`, `personality/`,
//! `history/`, `MAP.md`, the CURATED rest
//! of `wiki/`, and every control file are NEVER written — `assert_writable` refuses, regardless of what
//! the frontend sends (the hard guard behind the TS `canWrite` gate), and the ROOT itself
//! must be a registered one (`registered_root`, #20 — the webview can never point these
//! commands at an arbitrary path). The active-instance registry lives OUTSIDE any corpus,
//! in the app config dir, so a connected brain is never littered with rotli wiring.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::fsutil::with_file_lock;

const FOLDER_AUTHORIZATION_TTL: Duration = Duration::from_secs(5 * 60);

/// Exact folders selected by a native picker. A webview-provided absolute path
/// is never authority by itself; onboarding may reuse one selected path across
/// inspect/review/activate steps for a short, bounded interval.
#[derive(Default)]
pub struct FolderAuthorizations(Mutex<HashMap<PathBuf, Instant>>);

impl FolderAuthorizations {
    pub(crate) fn authorize(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = fs::canonicalize(path)
            .map_err(|e| format!("open selected folder {}: {e}", path.display()))?;
        if !canonical.is_dir() {
            return Err("the selected path is not a folder".into());
        }
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "folder authorization lock poisoned".to_string())?;
        let now = Instant::now();
        grants.retain(|_, issued| now.duration_since(*issued) <= FOLDER_AUTHORIZATION_TTL);
        grants.insert(canonical.clone(), now);
        Ok(canonical)
    }

    pub(crate) fn require(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = fs::canonicalize(path)
            .map_err(|e| format!("open selected folder {}: {e}", path.display()))?;
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "folder authorization lock poisoned".to_string())?;
        let now = Instant::now();
        grants.retain(|_, issued| now.duration_since(*issued) <= FOLDER_AUTHORIZATION_TTL);
        if grants.contains_key(&canonical) {
            Ok(canonical)
        } else {
            Err("this operation requires a folder selected in Rotli's native picker".into())
        }
    }
}

/// The memex contract version rotli is built against — MUST match
/// `src/memex/contract.ts` `CONTRACT_VERSION` exactly (the lockstep test below
/// pins it; #24, audit 2026-07: the two sides drifted 3.6 vs 3.7 and Rust's
/// verdict is the effective one — a 3.7 brain silently opened read-only).
/// v3.8 adds readable filename projections, aliases, and a read-only query
/// grammar on top of v3.7's AI Filer lane. rotli still
/// WRITES to a v3.4 brain (the chat/inbox shape is unchanged), so the supported
/// band is `[MIN_CONTRACT, CONTRACT_VERSION]`.
const CONTRACT_VERSION: &str = "3.8";
const MIN_CONTRACT: &str = "3.4";
/// The inbox sentinel new captures are inserted after (matches memex-vault's inbox.md).
const INBOX_MARK: &str = "<!-- entries below this line -->";

// ─── time ─────────────────────────────────────────────────────────────────────

fn now_iso() -> String {
    let now = OffsetDateTime::now_utc();
    now.replace_nanosecond(0)
        .unwrap_or(now)
        .format(&Rfc3339)
        .unwrap_or_default()
}

// ─── atomic write + advisory lock (mirror conversations.ts) ─────────────────────

/// Temp file in the SAME dir + rename — a concurrent reader never sees a torn file.
fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    crate::fsutil::atomic_write(path, contents, ".rotli-memex-")
}

// ─── the write guard (rotli owns chats/ + wiki/_inbox/, nothing else) ──────────
//
// `inbox.md` is NOT in this lane (#96, audit 2026-07): no rotli code has ever
// appended it — quick captures land as staged notes in wiki/_inbox/ — so the old
// allowance was dead gate surface that could only rot. Breve appends inbox.md
// through its own gate; rotli only creates the file when it INITIATES a brand-new
// memex (the scaffold below, which is initiation, not the write lane).

fn is_writable(rel: &str) -> bool {
    let p = rel.trim_start_matches('/');
    if p.contains("..") {
        return false;
    }
    p == "chats"
        || p.starts_with("chats/")
        // the note staging area (v3.5) — the ONLY writable part of wiki/; the
        // curated rest (wiki/note.md, wiki/projects/…) stays read-only.
        || p == "wiki/_inbox"
        || p.starts_with("wiki/_inbox/")
        // secure notes have a real home INSIDE the Brain, but never enter the
        // organizer's curated area lane. This user-owned path stays gitignored.
        || p == "wiki/_secure"
        || p.starts_with("wiki/_secure/")
}

fn assert_writable(rel: &str) -> Result<(), String> {
    if is_writable(rel) {
        Ok(())
    } else {
        Err(format!(
            "rotli only writes chats, Library intake, and secure notes here — the rest of this vault's reference layer is read-only (refused: {rel})"
        ))
    }
}

/// A chat slug must be a plain filename (it comes from `slugify`, but never trust
/// the wire): lowercase alphanumerics + dashes only, no separators, no `..`.
/// pub(crate): provider.rs pins a chat's image-assets dir by the same slug law.
pub(crate) fn safe_slug(slug: &str) -> Result<String, String> {
    let ok = !slug.is_empty()
        && slug.len() <= 80
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(slug.to_string())
    } else {
        Err(format!("unsafe chat slug: {slug:?}"))
    }
}

// ─── instance detection (the memex.json marker) ────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedMemex {
    pub root: String,
    pub label: String,
    /// "memex" (valid `mx_` memex.json) · "plain" (a dir, no valid memex.json) ·
    /// "fresh" (empty/absent — safe to init).
    pub kind: String,
    pub memex_id: Option<String>,
    pub contract: Option<String>,
    pub has_users_json: bool,
    pub users_json: Option<String>,
}

/// Whether a dir has no NON-hidden entries (ignores `.DS_Store`, `.rotli`, any
/// dotfile) — so a folder with only macOS cruft still counts as empty/"fresh".
fn dir_has_no_real_entries(root: &Path) -> bool {
    match fs::read_dir(root) {
        Ok(rd) => !rd.filter_map(|e| e.ok()).any(|e| {
            e.file_name()
                .to_str()
                .map(|n| !n.starts_with('.'))
                .unwrap_or(true)
        }),
        Err(_) => true,
    }
}

fn detect_one(root: &Path) -> DetectedMemex {
    let label = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("memex")
        .to_string();

    let memex_path = root.join("memex.json");
    let mut memex_id = None;
    let mut contract = None;
    let kind: String;

    if memex_path.exists() {
        match fs::read_to_string(&memex_path)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        {
            Some(v) => {
                let id = v.get("id").and_then(|x| x.as_str()).map(|s| s.to_string());
                contract = v
                    .get("contract")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                if id.as_deref().map(|s| s.starts_with("mx_")).unwrap_or(false) {
                    memex_id = id;
                    kind = "memex".to_string();
                } else {
                    kind = "plain".to_string(); // present but not a valid mx_ id
                }
            }
            None => kind = "plain".to_string(),
        }
    } else if !root.exists() || dir_has_no_real_entries(root) {
        kind = "fresh".to_string();
    } else {
        kind = "plain".to_string();
    }

    let users = root.join("users.json");
    let has_users_json = users.exists();
    let users_json = if has_users_json {
        fs::read_to_string(&users).ok()
    } else {
        None
    };

    DetectedMemex {
        root: root.to_string_lossy().to_string(),
        label,
        kind,
        memex_id,
        contract,
        has_users_json,
        users_json,
    }
}

/// Public probe for the corpus module's "Choose folder…" smart picker — classify
/// a directory as `memex` / `plain` / `fresh` without going through a Tauri command.
pub fn detect_folder(root: &Path) -> DetectedMemex {
    detect_one(root)
}

/// Whether a brain's contract is within rotli's supported band [MIN_CONTRACT,
/// CONTRACT_VERSION]. In-band ⇒ rotli may write (chats/inbox/wiki/_inbox); out of
/// band ⇒ the brain opens read-only (never write a contract rotli wasn't built for).
/// Mirrors the TS `contractInRange` default band.
/// Parse a `"major.minor"` contract into a comparable tuple; non-numeric → None.
fn parse_contract(c: &str) -> Option<(u32, u32)> {
    let mut parts = c.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor))
}

fn contract_ok(contract: Option<&str>) -> bool {
    let Some(c) = contract.and_then(parse_contract) else {
        return false;
    };
    // tuples compare lexicographically: (3,4) ≤ (3,5) ≤ … ≤ (3,7) — the whole band.
    let lo = parse_contract(MIN_CONTRACT).expect("MIN_CONTRACT is valid");
    let hi = parse_contract(CONTRACT_VERSION).expect("CONTRACT_VERSION is valid");
    c >= lo && c <= hi
}

/// Whether the memex at `root` carries a contract inside rotli's supported band —
/// the corpus store consults this AT OPEN so an out-of-band brain refuses every
/// write in Rust, not only in TS (#3, audit 2026-07).
pub(crate) fn contract_in_band_at(root: &Path) -> bool {
    contract_ok(detect_one(root).contract.as_deref())
}

// ─── the instance registry (machine-level, outside any corpus) ─────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanceEntry {
    /// The memex id (`mx_…`) it's bound to.
    pub id: String,
    pub label: String,
    pub abs_path: String,
    pub role: String,
    pub memex_id: Option<String>,
    pub mode: Option<String>,
    /// Stays a raw String (not MemexPerms): this is the read-only LEGACY
    /// registry — only abs_path is ever consumed, and a strict enum here could
    /// drop the whole file from memex_detect over one bad value.
    pub perms: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstanceRegistry {
    pub version: u32,
    pub active_id: Option<String>,
    pub instances: Vec<InstanceEntry>,
}

fn registry_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("memex-instances.json"))
}

pub fn read_registry(app: &tauri::AppHandle) -> InstanceRegistry {
    registry_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

// ─── the additive `apps.rotli` stamp (round-trip raw Value, preserve breve) ────

fn stamp_rotli(memex_path: &Path) -> Result<(), String> {
    with_file_lock(memex_path, || {
        let raw = fs::read_to_string(memex_path).map_err(|e| e.to_string())?;
        let mut v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        if !v.get("apps").map(|a| a.is_object()).unwrap_or(false) {
            v["apps"] = serde_json::json!({});
        }
        if v["apps"].get("rotli").is_none() {
            v["apps"]["rotli"] =
                serde_json::json!({ "role": "chat-system", "connectedAt": now_iso() });
            let json = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n";
            atomic_write(memex_path, &json)?;
        }
        Ok(())
    })
}

// ─── bun resolution (trusted application-owned runtimes only) ────────────────

/// Locate Bun for Rotli-owned Breve and routine entrypoints. Caller-controlled
/// memex scripts must never be passed to this executable.
pub(crate) fn find_bun() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(format!("{home}/.bun/bin/bun"));
        if p.exists() {
            return p;
        }
    }
    for candidate in ["/opt/homebrew/bin/bun", "/usr/local/bin/bun"] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("bun")
}

// ─── the registered-roots guard (#20, audit 2026-07) ───────────────────────────

/// Pure core: whether `want` matches one of `roots` after canonicalization
/// (FSEvents-style `/var` ↔ `/private/var` aliases compare equal). A `want`
/// that can't be canonicalized (doesn't exist) is NOT registered — fail closed.
fn root_among(roots: &[PathBuf], want: &Path) -> bool {
    let Ok(want) = fs::canonicalize(want) else {
        return false;
    };
    roots
        .iter()
        .any(|r| fs::canonicalize(r).map(|c| c == want).unwrap_or(false))
}

/// Resolve a webview-supplied `root` against the REGISTERED roots — the corpus +
/// connected brains + added folders in corpus.json. Every root-taking memex_*
/// command runs this FIRST, so the frontend can never point them at an arbitrary
/// path (`memex_read(root: "/", …)` used to read any file on disk; a crafted
/// write root could plant chats/ inside a curated tree).
/// pub(crate): provider.rs validates the image-assets root through the same gate.
pub(crate) fn registered_root(app: &tauri::AppHandle, root: &str) -> Result<PathBuf, String> {
    let cfg = crate::corpus::ensure_corpus_config(app);
    let mut roots: Vec<PathBuf> = vec![cfg.corpus.abs_path];
    roots.extend(cfg.brains.into_iter().map(|b| b.abs_path));
    roots.extend(cfg.folders.into_iter().map(|f| f.abs_path));
    let want = PathBuf::from(root);
    if root_among(&roots, &want) {
        fs::canonicalize(&want).map_err(|e| format!("bad vault root {root}: {e}"))
    } else {
        Err(format!("not a registered vault root: {root}"))
    }
}

/// Resolve a memex mutation target and independently enforce its configured
/// capability. Being registered makes a root readable/routable; it does not
/// grant the older memex adapter write access. This closes the alternate IPC
/// lane around `CorpusStore::perms_read_only` for connected brains.
fn registered_write_root(app: &tauri::AppHandle, root: &str) -> Result<PathBuf, String> {
    let want = registered_root(app, root)?;
    let cfg = crate::corpus::ensure_corpus_config(app);
    if memex_write_allowed(&cfg, &want) {
        Ok(want)
    } else {
        Err("this vault is read-only for Rotli".into())
    }
}

fn memex_write_allowed(cfg: &crate::corpus::CorpusConfig, want: &Path) -> bool {
    let Ok(want) = fs::canonicalize(want) else {
        return false;
    };
    if fs::canonicalize(&cfg.corpus.abs_path).is_ok_and(|path| path == want) {
        return brain_view(&want).is_some_and(|(_, perms)| !perms.read_only());
    }
    cfg.brains.iter().any(|brain| {
        !brain.perms.read_only()
            && fs::canonicalize(&brain.abs_path).is_ok_and(|path| path == want)
            && brain_view(&want).is_some()
    })
}

// ─── commands ──────────────────────────────────────────────────────────────────

/// Scan the likely places for an existing memex (so first-run can offer "merge"):
/// `~/memex-vault`, `$MEMEX_KNOWLEDGE`, and any already-registered instance. Only
/// dirs that are a real memex (valid `mx_` memex.json) are returned.
#[tauri::command]
pub fn memex_detect(app: tauri::AppHandle) -> Result<Vec<DetectedMemex>, String> {
    // A debug shell is an isolated review workspace. Never enumerate or offer
    // the user's production brains from `tauri dev`.
    if crate::development_read_only(&app) {
        return Ok(Vec::new());
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(&home).join("memex-vault"));
    }
    if let Ok(env) = std::env::var("MEMEX_KNOWLEDGE") {
        if !env.is_empty() {
            roots.push(PathBuf::from(env));
        }
    }
    for inst in read_registry(&app).instances {
        roots.push(PathBuf::from(inst.abs_path));
    }

    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for r in roots {
        let key = fs::canonicalize(&r)
            .unwrap_or_else(|_| r.clone())
            .to_string_lossy()
            .to_string();
        if !seen.insert(key) || !r.exists() {
            continue;
        }
        let d = detect_one(&r);
        // skip demo-only memexes (memex.json `demo: true`) — never offered to connect
        if d.kind == "memex" && !crate::corpus::is_demo_memex(&r) {
            out.push(d);
        }
    }
    Ok(out)
}

// `memex_inspect` (inspect an arbitrary folder) was UNREGISTERED and removed in
// the 2026-07 audit (#68): zero frontend callers — the connect flows go through
// memex_detect / corpus_connect_brain. `detect_one`/`detect_folder` stay.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractRaw {
    pub memex_json: String,
    pub users_json: String,
    pub identities_json: String,
}

/// Raw contract files (TS parses them with the mirror codec).
#[tauri::command]
pub fn memex_read_contract(app: tauri::AppHandle, root: String) -> Result<ContractRaw, String> {
    let root = registered_root(&app, &root)?;
    // read_at's containment applies here too — a symlink planted as a
    // contract file must not read outside the vault (missing files stay "")
    let rd = |n: &str| read_at(&root, n).unwrap_or_default();
    Ok(ContractRaw {
        memex_json: rd("memex.json"),
        users_json: rd("users.json"),
        identities_json: rd("identities.local.json"),
    })
}

/// Read any spine file (rotli reads everything; writes are the gated part).
/// The ROOT must be registered (#20) — the rel-only jail wasn't enough when the
/// root itself came from the webview.
#[tauri::command]
pub fn memex_read(app: tauri::AppHandle, root: String, rel: String) -> Result<String, String> {
    let root = registered_root(&app, &root)?;
    read_at(&root, &rel)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionedChat {
    pub contents: String,
    pub revision: String,
}

/// Read one chat with the revision that must accompany its next full-file
/// replacement. Unlike the generic spine read, a missing chat is an error.
#[tauri::command]
pub fn memex_read_chat(
    app: tauri::AppHandle,
    root: String,
    slug: String,
) -> Result<VersionedChat, String> {
    let root = registered_root(&app, &root)?;
    read_chat_at(&root, &slug)
}

fn read_chat_at(root: &Path, slug: &str) -> Result<VersionedChat, String> {
    let safe = safe_slug(slug)?;
    let rel = format!("chats/{safe}.md");
    let path = crate::containment::resolve_beneath(root, Path::new(&rel))?;
    let bytes = fs::read(&path).map_err(|error| format!("read {rel}: {error}"))?;
    let revision = crate::fsutil::revision(&bytes);
    let contents =
        String::from_utf8(bytes).map_err(|_| format!("chat is not valid UTF-8: {rel}"))?;
    Ok(VersionedChat { contents, revision })
}

fn read_at(root: &Path, rel: &str) -> Result<String, String> {
    // resolve_beneath, not a string `..` check: a symlink planted inside a
    // vault must not carry this read outside the registered root — the same
    // standard every corpus lane already holds (audit 2026-07-29). A missing
    // file still reads as ""; any other failure is a real error, not "empty".
    let abs = crate::containment::resolve_beneath(root, Path::new(rel))?;
    match fs::read_to_string(&abs) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {rel}: {e}")),
    }
}

/// Frontmatter scalar lookup (mirrors conversations.ts `fm`; line-based so it's
/// safe on any UTF-8 — frontmatter sits in the first handful of lines).
/// Read a `key:` value from the FIRST frontmatter block ONLY — a body line can
/// never match (a pasted YAML snippet inside a chat message used to read as the
/// chat's own `pinned:`, and Unpin couldn't clear it because the TS writer is
/// properly block-scoped — reviewer, 2026-07-08). A file that doesn't open with
/// `---` has no frontmatter and yields "". The 40-line cap is a backstop against
/// a pathological unterminated block.
fn fm(text: &str, key: &str) -> String {
    let want = format!("{key}:");
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return String::new();
    }
    for line in lines.take(40) {
        if line.trim_end() == "---" {
            break;
        }
        if let Some(rest) = line.strip_prefix(&want) {
            return rest.trim().to_string();
        }
    }
    String::new()
}

fn unwrap_wikilink(v: &str) -> String {
    v.trim()
        .trim_start_matches("[[")
        .trim_end_matches("]]")
        .trim()
        .to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub slug: String,
    pub title: String,
    pub source: String,
    pub attached_to: String,
    pub path: String,
    /// fs mtime (ms since epoch; 0 when unreadable) — ⌥A summon-chat picks the
    /// most recently touched chat. The listing stays slug-sorted (the sidebar
    /// depends on that order); recency is the CALLER's concern.
    pub modified_ms: u64,
    /// `pinned: true` frontmatter — the sidebar sorts pinned chats first.
    pub pinned: bool,
}

/// List the named chats in `chats/` (read-only; mirrors conversations.ts listChats).
#[tauri::command]
pub fn memex_list_chats(app: tauri::AppHandle, root: String) -> Result<Vec<ChatSummary>, String> {
    let root = registered_root(&app, &root)?;
    list_chats_at(&root)
}

/// The first 41 lines of a file — exactly the window `fm()` can ever read
/// (opening `---` + its 40-line backstop). Chat listings need only
/// title/source/attachedTo/pinned, but transcripts grow unbounded, and
/// read_to_string dragged the whole body in per chat per listing (perf
/// audit 2026-07-30, finding 27). A 32 KiB byte cap backstops pathological
/// single-line files. One deliberate divergence from the old whole-file read:
/// a chat whose BODY is non-UTF-8 used to lose its frontmatter too
/// (read_to_string failed → ""); the head read now returns it, so such a chat
/// gains its real title/pinned instead of the "Untitled" fallback.
fn frontmatter_head(p: &Path) -> String {
    use std::io::{BufRead, BufReader, Read};
    let Ok(f) = fs::File::open(p) else {
        return String::new();
    };
    let mut reader = BufReader::new(f).take(32 * 1024);
    let mut head = String::new();
    let mut line = String::new();
    for _ in 0..41 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(_) => head.push_str(&line),
        }
    }
    head
}

fn list_chats_at(root: &Path) -> Result<Vec<ChatSummary>, String> {
    let dir = root.join("chats");
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("md") {
                continue;
            }
            let slug = p
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if slug.eq_ignore_ascii_case("readme") {
                continue;
            }
            let text = frontmatter_head(&p);
            let modified_ms = fs::metadata(&p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(ChatSummary {
                slug,
                title: fm(&text, "title"),
                source: fm(&text, "source"),
                attached_to: unwrap_wikilink(&fm(&text, "attachedTo")),
                path: p.to_string_lossy().to_string(),
                modified_ms,
                pinned: fm(&text, "pinned") == "true",
            });
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

// `memex_list_dir` (the old READ-ONLY Memory browser's directory listing) was
// UNREGISTERED and removed in the 2026-07 audit (#68): the Memory front folded
// into the corpus tree long ago and no TS caller remained. Re-add from git
// history if a spine browser ever returns.

/// The two access levels rotli grants a connected brain. The serde wire strings
/// are byte-identical to the `MemexPerms` union in src/lib/tauri.ts (parity.json
/// memexPerms) — corpus.json, IPC views, and the set-perms command all carry
/// them. Deserialization is strict: an unknown string is a parse error, never a
/// silently-writable brain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MemexPerms {
    #[serde(rename = "chats+inbox")]
    ChatsInbox,
    #[serde(rename = "read-only")]
    ReadOnly,
}

impl MemexPerms {
    pub fn read_only(self) -> bool {
        self == MemexPerms::ReadOnly
    }

    /// The one place the wire strings are matched by hand — legacy migration
    /// inputs parse through here, fail-closed at the call site.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "chats+inbox" => Some(MemexPerms::ChatsInbox),
            "read-only" => Some(MemexPerms::ReadOnly),
            _ => None,
        }
    }
}

/// What `corpus.rs` needs to register a connected brain in `corpus.json` — the
/// memex-specific half of connecting (validate it's a real memex, stamp
/// `apps.rotli` when in-range, derive perms/mode). The unified model keeps brains
/// in `corpus.json`, so this returns the data instead of touching any registry.
pub struct BrainConnect {
    pub memex_id: String,
    pub label: String,
    pub mode: Option<String>,
    pub perms: MemexPerms,
}

/// Read the metadata needed to retain or connect a vault without changing it.
/// Keeping an outgoing active vault in the switcher must not depend on being
/// able to stamp its marker during the switch.
pub(crate) fn brain_connect_view(path: &Path) -> Result<BrainConnect, String> {
    let card = detect_one(path);
    if card.kind != "memex" {
        return Err("That folder isn't a compatible Rotli vault (its portable format marker is missing or invalid).".into());
    }
    let memex_id = card
        .memex_id
        .clone()
        .ok_or("the vault format marker has no id")?;
    let in_range = contract_ok(card.contract.as_deref());
    let mode = card.users_json.as_deref().map(parse_mode_raw);
    let perms = if in_range {
        MemexPerms::ChatsInbox
    } else {
        MemexPerms::ReadOnly
    };
    Ok(BrainConnect {
        memex_id,
        label: card.label,
        mode,
        perms,
    })
}

/// Validate + stamp a folder for use as a newly connected brain. Mirrors
/// `memex_connect` minus the instance registry: refuses a non-memex, stamps
/// `apps.rotli` only when the contract is in rotli's band, and returns the
/// id/label/mode/perms.
pub fn prepare_brain_connect(path: &Path) -> Result<BrainConnect, String> {
    let meta = brain_connect_view(path)?;
    // additive stamp only when we're allowed to write (in-range contract)
    if meta.perms == MemexPerms::ChatsInbox {
        stamp_rotli(&path.join("memex.json"))?;
    }
    Ok(meta)
}

/// Read-only view of a folder AS a brain (no stamp, no side effects):
/// `Some((memex_id, perms))` when it's a memex, else `None`. Lets the corpus
/// module tell the UI whether the corpus itself is a brain and with what perms.
pub fn brain_view(path: &Path) -> Option<(String, MemexPerms)> {
    let card = detect_one(path);
    if card.kind != "memex" {
        return None;
    }
    let id = card.memex_id?;
    let perms = if contract_ok(card.contract.as_deref()) {
        MemexPerms::ChatsInbox
    } else {
        MemexPerms::ReadOnly
    };
    Some((id, perms))
}

/// The one root-level Markdown note Rotli owns. Keeping it outside `wiki/`
/// makes it a removable first-run note without projecting it into Library.
/// The corpus gate exposes this exact path and no other root document.
pub const WELCOME_PRESET_FILE: &str = "Welcome to Rotli.md";
pub const PRACTICE_PLAYGROUND_VERSION: u32 = 1;
pub const PRACTICE_PLAYGROUND_DIR: &str = "wiki/Playground";

const WELCOME_PRESET_BODY: &str = r#"# Welcome to Rotli

This is a real Markdown note in your vault. Edit it, experiment here, or delete it when you no longer need it.

## Things to try

1. Change this sentence and press **⌘S**.
2. Press **⌘N** to create a note.
3. Press **⌘K** to search notes, files, chats, and actions.
4. Type `/` on an empty line to explore Markdown blocks.
5. Select some text and ask Rotli about it in Chat.
6. Drop an image or file into **Assets**.

## Your vault

- Your files stay in the folder you chose and work in other apps.
- **Library** is where Rotli organizes lasting notes.
- **Assets**, **Archive**, and **Trash** are system views of this same vault.
- This welcome note sits at the vault root, outside Library.

Make it yours.
"#;

/// Scaffold a FRESH memex at `root` (empty/fresh only) — the v3.6 spine, one
/// editable welcome note, and a new `mx_` memex.json stamped with `apps.rotli`.
/// Returns the new memex id. Drives onboarding's "create a new brain" path;
/// refuses a non-empty folder.
pub fn scaffold_memex(root: &Path) -> Result<String, String> {
    if root.exists() && !dir_has_no_real_entries(root) {
        return Err("Pick an empty folder — rotli starts a fresh vault there.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    for d in [
        "identity",
        "personality",
        "wiki",
        "wiki/_inbox",
        "wiki/_secure",
        "history",
        "chats",
        "storage",
        "archive",
        "trash",
    ] {
        fs::create_dir_all(root.join(d)).map_err(|e| e.to_string())?;
    }
    atomic_write(
        &root.join("inbox.md"),
        &format!("# Inbox\n\n{INBOX_MARK}\n"),
    )?;
    atomic_write(
        &root.join("MAP.md"),
        "# MAP\n\nThe index of this Rotli vault.\n",
    )?;
    atomic_write(&root.join(WELCOME_PRESET_FILE), WELCOME_PRESET_BODY)?;
    // the memex is a TEXT tree; binaries live in the gitignored storage/ (referenced
    // by storage: links), and .rotli/ is rotli's rebuildable sidecar.
    atomic_write(&root.join(".gitignore"), "storage/\n.rotli/\n")?;
    let id = format!("mx_{}", Uuid::new_v4());
    let now = now_iso();
    let info = serde_json::json!({
        "id": id,
        "contract": CONTRACT_VERSION,
        "createdAt": now,
        "selfHeal": true,
        "apps": { "rotli": { "role": "chat-system", "connectedAt": now } },
    });
    atomic_write(
        &root.join("memex.json"),
        &(serde_json::to_string_pretty(&info).map_err(|e| e.to_string())? + "\n"),
    )?;
    Ok(id)
}

/// Add the importable Markdown-only lesson folder used by the explicit
/// Practice Vault flow. Ordinary new vaults keep their short welcome.
pub fn scaffold_practice_playground(root: &Path) -> Result<(), String> {
    let playground = root.join(PRACTICE_PLAYGROUND_DIR);
    if playground.exists() {
        return Err("the practice playground already exists".into());
    }
    fs::create_dir_all(&playground).map_err(|e| e.to_string())?;
    atomic_write(
        &playground.join("00 Start Here.md"),
        &format!(
            r#"# Playground — Start Here

Playground edition {PRACTICE_PLAYGROUND_VERSION}. Everything in this folder is ordinary Markdown. Copy the whole `Playground` folder into another vault whenever you want these examples nearby.

## How to use it

1. Open each lesson from Library → Playground.
2. Click the rendered controls, then switch **Aa → Raw markdown** to see the source change.
3. Edit freely. Delete this folder when you are done.

- [[Playground — Tasks and progress]]
- [[Playground — Choices and toggles]]
- [[Playground — Literal syntax]]
"#,
        ),
    )?;
    atomic_write(
        &playground.join("01 Tasks and progress.md"),
        r#"# Playground — Tasks and progress

Type `[]`, `[/]`, or `[x]` and press Space at the start of a line. Rotli adds the portable list marker.

- [ ] Not started
- [/] In progress
- [x] Done

The single task uses your theme accent. Green and red stay reserved for pass/fail results:

- [ ][ ] Did the check pass?
- [True][False] Is the decision binary?
- [True:green][Draw:yellow][False:red] What was the outcome?
"#,
    )?;
    atomic_write(
        &playground.join("02 Choices and toggles.md"),
        r#"# Playground — Choices and toggles

`[#]` is one-of-many. Adjacent circles at the same indentation form one group.

- [#] Small
- [#x] Medium
- [#] Large

`[##]` is choose-many. Each square is independent.

- [##x] Email
- [##] SMS
- [##x] In-app

`[|]` is the compact on/off switch. Words on either side of `|` make a labeled switch.

- [|x] Compact switch
- [True:green|x False:red] Labeled switch
"#,
    )?;
    atomic_write(
        &playground.join("03 Literal syntax.md"),
        r#"# Playground — Literal syntax

Backticks keep examples literal in beautified notes. The backticks disappear, while the source characters stay visible as code text.

- `[#]` creates a single-choice row only when typed outside backticks and followed by Space.
- `[##]` creates a multi-choice row.
- `[True|False]` creates a labeled switch.
- `[True:green][Draw:#E3B341][False:red]` creates colored result buttons.

Custom colors accept strict three- or six-digit hex. Invalid colors remain ordinary Markdown instead of becoming a half-working control.
"#,
    )?;

    let welcome_path = root.join(WELCOME_PRESET_FILE);
    let welcome = fs::read_to_string(&welcome_path).map_err(|e| e.to_string())?;
    atomic_write(
        &welcome_path,
        &format!(
            "{}\n## Practice playground\n\nOpen [[Playground — Start Here]] in Library → Playground for hands-on lessons you can safely edit or delete.\n",
            welcome.trim_end()
        ),
    )
}

/// A tiny mirror of the contract's fail-closed access-mode rule, for the registry
/// snapshot only (the authoritative parse is TS `parseAccessMode`).
fn parse_mode_raw(users_json: &str) -> String {
    match serde_json::from_str::<Value>(users_json) {
        Ok(v)
            if v.get("users").map(|u| u.is_array()).unwrap_or(false)
                && v.get("primary").map(|p| p.is_string()).unwrap_or(false) =>
        {
            match v
                .get("mode")
                .and_then(|m| m.as_str())
                .map(|s| s.trim().to_lowercase())
            {
                Some(m) if m == "local" || m == "open" => m,
                _ => "secure".into(),
            }
        }
        _ => "local".into(),
    }
}

/// Write a chat file (full bytes composed by TS) into `chats/<slug>.md`.
/// The ROOT must be registered (#20) — a crafted root could otherwise plant
/// chats/ inside any tree on disk.
#[tauri::command]
pub fn memex_write_chat(
    app: tauri::AppHandle,
    root: String,
    slug: String,
    contents: String,
    expected_revision: Option<String>,
) -> Result<String, String> {
    let root = registered_write_root(&app, &root)?;
    write_chat_at(&root, &slug, &contents, expected_revision.as_deref())
}

fn write_chat_at(
    root: &Path,
    slug: &str,
    contents: &str,
    expected_revision: Option<&str>,
) -> Result<String, String> {
    let safe = safe_slug(slug)?;
    let rel = format!("chats/{safe}.md");
    assert_writable(&rel)?;
    let chats = root.join("chats");
    fs::create_dir_all(&chats).map_err(|e| e.to_string())?;
    let path = chats.join(format!("{safe}.md"));
    with_file_lock(&path, || {
        let existing = match fs::read(&path) {
            Ok(existing) => Some(existing),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("read existing chat: {error}")),
        };
        match (expected_revision, existing.as_deref()) {
            (None, Some(_)) => {
                return Err(format!(
                    "chat already exists: {safe}; choose another title instead of replacing it"
                ))
            }
            (Some(expected), Some(bytes)) => crate::fsutil::compare_revision(expected, bytes)?,
            (Some(_), None) => return Err(format!("chat no longer exists: {safe}")),
            (None, None) => {}
        }
        let existing_tainted = match existing {
            Some(bytes) => {
                let text = String::from_utf8(bytes)
                    .map_err(|_| format!("existing chat is not valid UTF-8: {safe}"))?;
                chat_secure_context(&text)
            }
            None => false,
        };
        let next = if existing_tainted {
            ensure_chat_secure_context(contents)
        } else {
            contents.to_string()
        };
        atomic_write(&path, &next)
    })?;
    Ok(path.to_string_lossy().to_string())
}

fn chat_frontmatter_bounds(contents: &str) -> Option<(usize, usize, &'static str)> {
    let (start, eol) = if contents.starts_with("---\r\n") {
        (5, "\r\n")
    } else if contents.starts_with("---\n") {
        (4, "\n")
    } else {
        return None;
    };
    let closing = contents[start..].find(&format!("{eol}---"))? + start;
    Some((start, closing, eol))
}

fn chat_secure_context(contents: &str) -> bool {
    let Some((start, end, _)) = chat_frontmatter_bounds(contents) else {
        return false;
    };
    contents[start..end].lines().any(|line| {
        line.split_once(':')
            .is_some_and(|(key, value)| key.trim() == "secureContext" && value.trim() == "true")
    })
}

fn ensure_chat_secure_context(contents: &str) -> String {
    if chat_secure_context(contents) {
        return contents.to_string();
    }
    let Some((start, end, eol)) = chat_frontmatter_bounds(contents) else {
        return format!("---\nsecureContext: true\n---\n\n{contents}");
    };
    let block = &contents[start..end];
    let mut lines: Vec<&str> = block.lines().collect();
    let mut replaced = false;
    for line in &mut lines {
        if line
            .split_once(':')
            .is_some_and(|(key, _)| key.trim() == "secureContext")
        {
            *line = "secureContext: true";
            replaced = true;
        }
    }
    let mut block = lines.join(eol);
    if !replaced {
        if !block.is_empty() {
            block.push_str(eol);
        }
        block.push_str("secureContext: true");
    }
    format!("{}{}{}", &contents[..start], block, &contents[end..])
}

/// The chat-folder manifest — a REBUILDABLE `.rotli` sidecar grouping the flat
/// `chats/` surface into user folders (chats never move on disk; delete the
/// file and the list is simply flat again). Fixed relative path, so there is
/// no traversal surface. Absent reads as "" — TS owns the shape.
fn read_chat_folders_at(root: &Path) -> Result<crate::fsutil::VersionedText, String> {
    let contents = match fs::read_to_string(root.join(".rotli/chat-folders.json")) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("read chat folders: {e}")),
    };
    Ok(crate::fsutil::versioned_text(contents))
}

#[tauri::command]
pub fn memex_chat_folders(
    app: tauri::AppHandle,
    root: String,
) -> Result<crate::fsutil::VersionedText, String> {
    let root = registered_root(&app, &root)?;
    read_chat_folders_at(&root)
}

/// Write the chat-folder manifest. Contents must be valid JSON and index-sized
/// (it's a projection, not a store).
fn write_chat_folders_at(
    root: &Path,
    contents: &str,
    expected_revision: &str,
) -> Result<String, String> {
    if contents.len() > 262_144 {
        return Err(
            "the chat-folders manifest is unexpectedly large — refusing to write it.".into(),
        );
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|e| format!("chat folders must be valid JSON: {e}"))?;
    let dir = root.join(".rotli");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("chat-folders.json");
    with_file_lock(&path, || {
        let current = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(format!("read chat folders: {error}")),
        };
        crate::fsutil::compare_revision(expected_revision, &current)?;
        atomic_write(&path, contents)?;
        Ok(crate::fsutil::revision(contents.as_bytes()))
    })
}

#[tauri::command]
pub fn memex_write_chat_folders(
    app: tauri::AppHandle,
    root: String,
    contents: String,
    expected_revision: String,
) -> Result<String, String> {
    let root = registered_write_root(&app, &root)?;
    write_chat_folders_at(&root, &contents, &expected_revision)
}

/// Rename a chat: `chats/<old>.md` → `chats/<new>.md`. Both slugs are re-validated
/// on the wire (lowercase-alnum-dash, no separators, no `..`), so a crafted slug
/// can never escape `chats/`. Returns the new safe slug the caller re-binds to.
/// The ROOT must be registered (#20).
#[tauri::command]
pub fn memex_rename_chat(
    app: tauri::AppHandle,
    root: String,
    old_slug: String,
    new_slug: String,
) -> Result<String, String> {
    let root = registered_write_root(&app, &root)?;
    let old_safe = safe_slug(&old_slug)?;
    let new_safe = safe_slug(&new_slug)?;
    assert_writable(&format!("chats/{old_safe}.md"))?;
    assert_writable(&format!("chats/{new_safe}.md"))?;
    let chats = root.join("chats");
    let old_path = chats.join(format!("{old_safe}.md"));
    let new_path = chats.join(format!("{new_safe}.md"));
    if !old_path.exists() {
        return Err(format!("chat not found: {old_safe}"));
    }
    if new_safe != old_safe && new_path.exists() {
        return Err(format!("a chat named \"{new_safe}\" already exists"));
    }
    with_file_lock(&old_path, || {
        fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
    })?;
    Ok(new_safe)
}

/// Soft-delete a chat: move `chats/<slug>.md` → `chats/trash/<slug>.md`, a hidden
/// subfolder `list_chats_at` never scans (it reads the top level only), so the chat
/// leaves the sidebar but the file survives — recoverable in Finder. Stays under
/// rotli's writable `chats/` surface. Registered root (#20). (the maintainer #4, 2026-07-08.)
#[tauri::command]
pub fn memex_delete_chat(app: tauri::AppHandle, root: String, slug: String) -> Result<(), String> {
    move_chat_to_bucket(&app, &root, &slug, "trash")
}

/// Archive a chat: the same move, into `chats/archive/` — out of the way, still kept.
#[tauri::command]
pub fn memex_archive_chat(app: tauri::AppHandle, root: String, slug: String) -> Result<(), String> {
    move_chat_to_bucket(&app, &root, &slug, "archive")
}

/// Reveal a chat's markdown file in Finder (`open -R`) — the chat row's
/// "Show in Finder", the same truth-on-disk affordance note rows have.
/// Read-only: registered root (#20) + the safe_slug jail; a missing file
/// errors instead of revealing the parent folder.
#[tauri::command]
pub fn memex_reveal_chat(app: tauri::AppHandle, root: String, slug: String) -> Result<(), String> {
    let root = registered_root(&app, &root)?;
    let safe = safe_slug(&slug)?;
    let path = root.join("chats").join(format!("{safe}.md"));
    if !path.is_file() {
        return Err(format!("chat not found on disk: {safe}"));
    }
    // spawn, don't wait — corpus_reveal_file's shape (a sync command blocks the
    // main thread for as long as it waits; adversarial review, PR #15)
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("reveal: {e}"))?;
    #[cfg(not(target_os = "macos"))]
    let _ = path;
    Ok(())
}

/// Move `chats/<slug>.md` into a hidden `chats/<bucket>/` subfolder (trash/archive).
/// Both ends are writable-gated and `bucket` is a fixed literal, so no slug can
/// escape `chats/`.
fn move_chat_to_bucket(
    app: &tauri::AppHandle,
    root: &str,
    slug: &str,
    bucket: &str,
) -> Result<(), String> {
    let root = registered_write_root(app, root)?;
    let safe = safe_slug(slug)?;
    assert_writable(&format!("chats/{safe}.md"))?;
    assert_writable(&format!("chats/{bucket}/{safe}.md"))?;
    let src = root.join("chats").join(format!("{safe}.md"));
    if !src.exists() {
        return Err(format!("chat not found: {safe}"));
    }
    let dir = root.join("chats").join(bucket);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join(format!("{safe}.md"));
    with_file_lock(&src, || fs::rename(&src, &dst).map_err(|e| e.to_string()))
}

/// Write a brand-new note (full v3.5 bytes composed by TS) into the Librarian's
/// `wiki/_inbox/` staging area, or directly into `wiki/` for a raw vault, as
/// `<slug>.md`. `safe_slug` validates the requested base; a
/// sibling collision becomes `<slug> (2).md`, `<slug> (3).md`, … under one
/// directory-level creation lock. Stable identity remains the frontmatter ULID.
/// Atomic + under the lock, exactly like a chat write. The ROOT must be
/// registered (#20). With the Librarian enabled, its local model later
/// classifies + moves the staged note to `wiki/<area>/`; raw vaults keep the
/// root-level note exactly where Rotli created it.
#[tauri::command]
pub fn memex_write_note(
    app: tauri::AppHandle,
    root: String,
    stem: String,
    contents: String,
) -> Result<String, String> {
    let root = registered_write_root(&app, &root)?;
    let suppress = app
        .state::<crate::corpus::CorpusState>()
        .suppress_set_for_root(&root)?;
    write_note_at_with_suppress(&root, &stem, &contents, Some(&suppress))
}

#[cfg(test)]
fn write_note_at(root: &Path, stem: &str, contents: &str) -> Result<String, String> {
    write_note_at_with_suppress(root, stem, contents, None)
}

fn write_note_at_with_suppress(
    root: &Path,
    stem: &str,
    contents: &str,
    suppress: Option<&crate::corpus::SuppressSet>,
) -> Result<String, String> {
    let safe = safe_slug(stem)?;
    let secure = contents
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---"))
        .is_some_and(|(frontmatter, _)| {
            frontmatter
                .lines()
                .any(|line| line.trim() == "secure: true")
        });
    let librarian_enabled = secure || librarian_enabled_at(root)?;
    let lane = if secure {
        Some("_secure")
    } else if librarian_enabled {
        Some("_inbox")
    } else {
        None
    };
    let dir = lane.map_or_else(|| root.join("wiki"), |lane| root.join("wiki").join(lane));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    with_file_lock(&dir.join(".rotli-note-create"), || {
        let mut file_name = format!("{safe}.md");
        let mut number = 2;
        while dir.join(&file_name).exists() {
            file_name = format!("{safe} ({number}).md");
            number += 1;
        }
        let rel = lane.map_or_else(
            || format!("wiki/{file_name}"),
            |lane| format!("wiki/{lane}/{file_name}"),
        );
        assert_note_creation_writable(&rel, lane.is_none())?;
        let path = dir.join(&file_name);
        if secure {
            let ignore = root.join(".gitignore");
            let existing = fs::read_to_string(&ignore).unwrap_or_default();
            if !existing.lines().any(|line| line.trim() == rel) {
                let mut next = existing;
                if !next.is_empty() && !next.ends_with('\n') {
                    next.push('\n');
                }
                next.push_str(&rel);
                next.push('\n');
                atomic_write(&ignore, &next)?;
            }
        }
        // Invalidate the registered CorpusStore's warm walk cache before the
        // bytes land. The same mark suppresses the watcher echo, exactly as a
        // native CorpusStore write does. A failed write merely causes a safe
        // rescan on the next read.
        if let Some(suppress) = suppress {
            suppress.mark(&path);
        }
        atomic_write(&path, contents)?;
        Ok(path.to_string_lossy().to_string())
    })
}

fn assert_note_creation_writable(rel: &str, raw_root: bool) -> Result<(), String> {
    if !raw_root {
        return assert_writable(rel);
    }
    let file = rel.strip_prefix("wiki/").unwrap_or_default();
    if !file.is_empty() && !file.contains('/') && file.ends_with(".md") {
        Ok(())
    } else {
        Err(format!(
            "raw-vault note creation escaped the wiki root: {rel}"
        ))
    }
}

/// Read the per-vault automation switch at creation time. Missing or malformed
/// settings preserve the established ON default; a genuine I/O error refuses
/// the write because guessing could put a note in the wrong physical lane.
fn librarian_enabled_at(root: &Path) -> Result<bool, String> {
    match fs::read_to_string(root.join(".rotli/settings.json")) {
        Ok(settings) => Ok(serde_json::from_str::<Value>(&settings)
            .ok()
            .and_then(|value| value.get("brainEnabled").and_then(Value::as_bool))
            .unwrap_or(true)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(error) => Err(format!(
            "read Librarian setting before note creation: {error}"
        )),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateReport {
    pub ok: bool,
    pub skipped: bool,
    pub stdout: String,
    pub errors: u32,
    pub warnings: u32,
}

/// Validation must treat the memex as DATA. Older builds executed
/// `scripts/validate.ts` from the selected root with Rotli's inherited
/// environment; a crafted imported vault could therefore run arbitrary code.
/// Until the validator is ported behind a narrow Rust data API, report the
/// check as skipped instead of violating the content/code boundary.
#[tauri::command]
pub async fn memex_validate(app: tauri::AppHandle, root: String) -> Result<ValidateReport, String> {
    tauri::async_runtime::spawn_blocking(move || memex_validate_blocking(&app, &root))
        .await
        .map_err(|e| format!("validate worker failed ({e})"))?
}

fn memex_validate_blocking(app: &tauri::AppHandle, root: &str) -> Result<ValidateReport, String> {
    if crate::development_read_only(app) {
        return Ok(ValidateReport {
            ok: true,
            skipped: true,
            stdout: "production vault validation is disabled in development".into(),
            errors: 0,
            warnings: 0,
        });
    }
    let root = registered_root(app, root)?;
    Ok(safe_validation_report(&root))
}

fn safe_validation_report(root: &Path) -> ValidateReport {
    let has_script = root.join("scripts/validate.ts").is_file();
    ValidateReport {
        ok: true,
        skipped: true,
        stdout: if has_script {
            "Library script not run — Rotli treats files in a vault as untrusted data. Use the vault's own trusted tooling to validate it."
        } else {
            "No built-in safe validator is available for this library yet."
        }
        .into(),
        errors: 0,
        warnings: 0,
    }
}

/// Native folder picker that returns a path WITHOUT moving anything (for
/// "Connect to existing…" / "New separate brain…").
/// ASYNC command (vault-lane pass, 2026-07-31): `blocking_pick_folder` parks
/// the calling thread on a channel while the panel runs — on the main thread
/// that was the beachball. It runs on a worker now (the dialog plugin marshals
/// the panel itself to the main runloop).
#[tauri::command]
pub async fn memex_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let dialog_state = app.state::<crate::NativeDialogOpen>();
        let _native_dialog = dialog_state.begin();
        let mut picker = app
            .dialog()
            .file()
            .set_title("Choose a Rotli vault")
            .set_directory(crate::vault_location::picker_start(&app));
        if let Some(parent) = app.get_webview_window("main") {
            picker = picker.set_parent(&parent);
        }
        let picked = picker.blocking_pick_folder();
        match picked {
            Some(fp) => {
                let path = fp.into_path().map_err(|e| e.to_string())?;
                let canonical = app.state::<FolderAuthorizations>().authorize(&path)?;
                crate::reject_privileged_root(&app, &canonical)?;
                Ok(Some(canonical.to_string_lossy().to_string()))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("picker worker failed ({e})"))?
}

// ─── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Vault isolation (the maintainer, 2026-08-03): every chat listing and write is
    /// rooted — two vaults with the SAME slug never see each other's chats.
    /// (The wire commands add `registered_root` on top; this locks the fs layer.)
    #[test]
    fn chats_never_travel_between_roots() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (tmp.path().join("vault-a"), tmp.path().join("vault-b"));
        for root in [&a, &b] {
            fs::create_dir_all(root.join("chats")).unwrap();
        }
        write_chat_at(&a, "daily", "---\ntitle: A's daily\n---\nbody a\n", None).unwrap();
        write_chat_at(&b, "daily", "---\ntitle: B's daily\n---\nbody b\n", None).unwrap();
        write_chat_at(&a, "only-in-a", "---\ntitle: Only A\n---\n", None).unwrap();

        let list_a = list_chats_at(&a).unwrap();
        let list_b = list_chats_at(&b).unwrap();
        assert_eq!(list_a.len(), 2);
        assert_eq!(list_b.len(), 1);
        assert!(list_a.iter().any(|c| c.title == "A's daily"));
        assert_eq!(list_b[0].title, "B's daily");
        assert!(!list_b.iter().any(|c| c.slug == "only-in-a"));
        // same slug, distinct files — a write in A never touched B
        assert!(fs::read_to_string(a.join("chats/daily.md"))
            .unwrap()
            .contains("body a"));
        assert!(fs::read_to_string(b.join("chats/daily.md"))
            .unwrap()
            .contains("body b"));
        // and a slug cannot traverse out of its root
        assert!(write_chat_at(&a, "../escape", "x", None).is_err());
    }

    #[test]
    fn memex_perms_round_trip_their_wire_strings() {
        for (perms, wire) in [
            (MemexPerms::ChatsInbox, "chats+inbox"),
            (MemexPerms::ReadOnly, "read-only"),
        ] {
            let json = serde_json::to_string(&perms).unwrap();
            assert_eq!(json, format!("\"{wire}\""));
            assert_eq!(serde_json::from_str::<MemexPerms>(&json).unwrap(), perms);
            assert_eq!(MemexPerms::parse(wire), Some(perms));
        }
        // strict: an unknown value is a parse error, never a writable brain
        assert!(serde_json::from_str::<MemexPerms>("\"admin\"").is_err());
        assert_eq!(MemexPerms::parse("admin"), None);
        assert!(MemexPerms::ReadOnly.read_only());
        assert!(!MemexPerms::ChatsInbox.read_only());
    }

    #[test]
    fn every_memex_write_requires_the_roots_rust_configured_capability() {
        use crate::corpus::{ConnectedBrain, CorpusConfig, CorpusRef, CorpusRoot};

        let tmp = tempfile::tempdir().unwrap();
        let primary = tmp.path().join("primary");
        let read_only = tmp.path().join("read-only");
        let writable = tmp.path().join("writable");
        let added_folder = tmp.path().join("added-folder");
        for path in [&primary, &read_only, &writable] {
            scaffold_memex(path).unwrap();
        }
        fs::create_dir_all(&added_folder).unwrap();
        let config = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: primary.clone(),
                adopted: false,
            },
            brains: vec![
                ConnectedBrain {
                    id: "read-only".into(),
                    label: "Read only".into(),
                    abs_path: read_only.clone(),
                    memex_id: None,
                    mode: None,
                    perms: MemexPerms::ReadOnly,
                },
                ConnectedBrain {
                    id: "writable".into(),
                    label: "Writable".into(),
                    abs_path: writable.clone(),
                    memex_id: None,
                    mode: None,
                    perms: MemexPerms::ChatsInbox,
                },
            ],
            folders: vec![CorpusRoot {
                id: "folder".into(),
                label: "Folder".into(),
                abs_path: added_folder.clone(),
                adopted: true,
            }],
            active_brain_id: None,
        };

        assert!(memex_write_allowed(&config, &primary));
        assert!(!memex_write_allowed(&config, &read_only));
        assert!(memex_write_allowed(&config, &writable));
        assert!(!memex_write_allowed(&config, &added_folder));
    }

    #[test]
    fn scaffold_memex_makes_a_valid_brain_on_the_current_contract() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("brain");
        let id = scaffold_memex(&root).unwrap();
        assert!(id.starts_with("mx_"));
        // it reads back as a real memex on the v3.6 contract
        let card = detect_one(&root);
        assert_eq!(card.kind, "memex");
        assert_eq!(card.memex_id.as_deref(), Some(id.as_str()));
        assert_eq!(card.contract.as_deref(), Some(CONTRACT_VERSION));
        // the spine rotli needs exists (incl. its writable wiki/_inbox staging)
        assert!(root.join("wiki/_inbox").is_dir());
        assert!(root.join("identity").is_dir());
        assert!(root.join("storage").is_dir()); // the gitignored binary store
        assert!(root.join("inbox.md").is_file());
        assert!(root.join("MAP.md").is_file());
        let welcome = fs::read_to_string(root.join(WELCOME_PRESET_FILE)).unwrap();
        assert!(welcome.starts_with("# Welcome to Rotli\n"));
        assert!(welcome.contains("## Things to try"));
        assert!(welcome.contains("outside Library"));
        // refuses to scaffold over a non-empty folder
        assert!(scaffold_memex(&root).is_err());
    }

    #[test]
    fn practice_playground_is_a_versioned_importable_markdown_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("practice");
        scaffold_memex(&root).unwrap();
        scaffold_practice_playground(&root).unwrap();

        let playground = root.join(PRACTICE_PLAYGROUND_DIR);
        assert_eq!(fs::read_dir(&playground).unwrap().count(), 4);
        let start = fs::read_to_string(playground.join("00 Start Here.md")).unwrap();
        assert!(start.contains(&format!("Playground edition {PRACTICE_PLAYGROUND_VERSION}")));
        assert!(start.contains("ordinary Markdown"));
        let controls = fs::read_to_string(playground.join("02 Choices and toggles.md")).unwrap();
        assert!(controls.contains("- [#x] Medium"));
        assert!(controls.contains("- [##x] Email"));
        assert!(controls.contains("- [True:green|x False:red] Labeled switch"));
        let literal = fs::read_to_string(playground.join("03 Literal syntax.md")).unwrap();
        assert!(literal.contains("`[#]`"));
        let welcome = fs::read_to_string(root.join(WELCOME_PRESET_FILE)).unwrap();
        assert!(welcome.contains("[[Playground — Start Here]]"));
        assert!(scaffold_practice_playground(&root).is_err());
    }

    #[test]
    fn fm_reads_only_the_first_frontmatter_block() {
        let chat = "---\ntitle: T\npinned: true\n---\n\n# T\n\nbody\n";
        assert_eq!(fm(chat, "title"), "T");
        assert_eq!(fm(chat, "pinned"), "true");
        // a body-line `pinned:` never matches (it used to pin the chat, and Unpin
        // couldn't clear it — the TS writer only touches the frontmatter block)
        let body_only = "---\ntitle: T\n---\n\npinned: true\n";
        assert_eq!(fm(body_only, "pinned"), "");
        // a file that doesn't open with --- has no frontmatter at all
        assert_eq!(fm("title: sneaky\n", "title"), "");
    }

    #[test]
    fn write_guard_allows_owned_chat_staging_and_secure_lanes() {
        assert!(is_writable("chats/foo.md"));
        assert!(is_writable("chats"));
        // inbox.md is NOT a rotli write surface (#96, audit 2026-07) — nothing ever
        // appended it; the dead allowance was narrowed out of the gate.
        assert!(!is_writable("inbox.md"));
        // wiki/_inbox staging (v3.5) is writable; the curated rest of wiki/ is not.
        assert!(is_writable("wiki/_inbox"));
        assert!(is_writable("wiki/_inbox/pricing-decision-01jtes.md"));
        assert!(is_writable("wiki/_secure"));
        assert!(is_writable("wiki/_secure/private-01secure.md"));
        assert!(!is_writable("wiki/note.md"));
        assert!(!is_writable("wiki/projects/x.md"));
        assert!(!is_writable("self/identity.md"));
        assert!(!is_writable("history/2026/x.md"));
        assert!(!is_writable("MAP.md"));
        assert!(!is_writable("memex.json"));
        assert!(!is_writable("chats/../self/x.md"));
        assert!(!is_writable("wiki/_inbox/../note.md"));
    }

    #[test]
    fn contract_ok_accepts_the_band_only() {
        assert!(contract_ok(Some("3.4"))); // memex-vault's memex.json today
        assert!(contract_ok(Some("3.5"))); // mid-band
        assert!(contract_ok(Some("3.6"))); // mid-band
        assert!(contract_ok(Some("3.7"))); // the Filer-lane contract
        assert!(contract_ok(Some("3.8"))); // readable identity + query grammar ceiling
        assert!(!contract_ok(Some("3.3"))); // below the floor
        assert!(!contract_ok(Some("3.9"))); // above the ceiling
        assert!(!contract_ok(Some("4.0"))); // a future major
        assert!(!contract_ok(None));
    }

    /// #24 (audit 2026-07): the Rust band and the TS band (src/memex/contract.ts)
    /// drifted once (3.6 vs 3.7) — Rust's verdict is the effective one, so a 3.7
    /// brain silently opened read-only while every doc claimed support. This
    /// lockstep assertion makes any future drift a test failure on either side.
    #[test]
    fn contract_band_is_in_lockstep_with_contract_ts() {
        let ts_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/memex/contract.ts");
        let ts = std::fs::read_to_string(ts_path).expect("read src/memex/contract.ts");
        assert!(
            ts.contains(&format!("export const CONTRACT_VERSION = \"{CONTRACT_VERSION}\"")),
            "contract.ts CONTRACT_VERSION must equal Rust's {CONTRACT_VERSION} — bump BOTH sides together"
        );
        assert!(
            ts.contains(&format!("export const MIN_CONTRACT = \"{MIN_CONTRACT}\"")),
            "contract.ts MIN_CONTRACT must equal Rust's {MIN_CONTRACT} — bump BOTH sides together"
        );
    }

    /// #42 (audit 2026-07): a lock that can't be acquired must FAIL the write —
    /// never run the read-modify-write unserialized — and a LIVE (fresh) lockfile
    /// must never be reclaimed out from under its holder.
    #[test]
    fn with_file_lock_fails_closed_on_a_held_lock() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("inbox.md");
        let lock = dir.path().join("inbox.md.lock");
        std::fs::write(&lock, "").unwrap(); // a live holder (fresh mtime)
        let mut ran = false;
        let r = crate::fsutil::with_file_lock_attempts(&target, 3, || {
            ran = true;
            Ok(())
        });
        assert!(
            r.is_err(),
            "non-acquisition must be an Err, not a fallthrough"
        );
        assert!(!ran, "the closure must NOT run without the lock");
        assert!(
            lock.exists(),
            "a live holder's lockfile is never dispossessed"
        );

        // once the holder releases, the same write goes through and cleans up
        std::fs::remove_file(&lock).unwrap();
        let r = crate::fsutil::with_file_lock_attempts(&target, 3, || Ok(42));
        assert_eq!(r.unwrap(), 42);
        assert!(!lock.exists(), "the lock is released after the write");
    }

    /// #20 (audit 2026-07): the registered-roots guard's pure core.
    #[test]
    fn root_among_matches_registered_roots_only() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let roots = vec![a.path().to_path_buf()];
        assert!(root_among(&roots, a.path()));
        assert!(
            !root_among(&roots, b.path()),
            "an unregistered dir is refused"
        );
        assert!(
            !root_among(&roots, &a.path().join("missing")),
            "a nonexistent path fails closed"
        );
        // a subdir of a registered root is NOT the root
        let sub = a.path().join("wiki");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(!root_among(&roots, &sub));
    }

    #[test]
    fn read_at_rejects_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        assert!(read_at(&root, "../etc/passwd").is_err());
        assert!(read_at(&root, "/abs").is_err());
        // a missing-but-safe rel reads as "", never an error
        assert_eq!(read_at(&root, "nope.md").unwrap(), "");
    }

    #[test]
    fn read_at_refuses_a_symlink_escape() {
        // a link inside the vault pointing at an outside file must not be
        // followed — the old string-only guard read straight through it
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        let outside = dir.path().join("outside.txt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&outside, "victim").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("sneaky.md")).unwrap();
        let root = std::fs::canonicalize(&root).unwrap();

        let err = read_at(&root, "sneaky.md").unwrap_err();
        assert!(err.contains("symlink"), "must refuse the link: {err}");
        // an honest file beside it still reads
        std::fs::write(root.join("honest.md"), "ok").unwrap();
        assert_eq!(read_at(&root, "honest.md").unwrap(), "ok");
    }

    #[test]
    fn write_note_lands_in_wiki_inbox_and_refuses_bad_stems() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let stem = "pricing-decision";
        let body = "---\nid: 01JTEST\n---\n# Pricing decision\n";
        let path = write_note_at(root, stem, body).unwrap();
        assert!(path.ends_with("wiki/_inbox/pricing-decision.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        let duplicate =
            write_note_at(root, stem, "---\nid: 02JTEST\n---\n# Pricing decision\n").unwrap();
        assert!(duplicate.ends_with("wiki/_inbox/pricing-decision (2).md"));
        // a stem with a path separator / traversal / caps is rejected by safe_slug
        assert!(write_note_at(root, "../escape", "x").is_err());
        assert!(write_note_at(root, "a/b", "x").is_err());
        assert!(write_note_at(root, "Caps", "x").is_err());
    }

    #[test]
    fn write_note_invalidates_a_warm_corpus_cache_before_immediate_readback() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("vault");
        scaffold_memex(&root).unwrap();
        let mut store = crate::corpus::CorpusStore::open(root.clone()).unwrap();
        store.list().unwrap(); // reproduce the stale-cache precondition
        let suppress = store.suppress_set();
        let id = "01J00000000000000000000000";
        let body = format!("---\nid: {id}\n---\n# Conversation note\n");

        write_note_at_with_suppress(&root, "conversation-note", &body, Some(&suppress)).unwrap();

        let note = store
            .read(id)
            .expect("the creating command must make the note immediately readable");
        assert!(note.body.contains("Conversation note"));
    }

    #[test]
    fn raw_vault_note_creation_uses_the_wiki_root_not_librarian_intake() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".rotli")).unwrap();
        std::fs::write(
            root.join(".rotli/settings.json"),
            "{\"brainEnabled\":false}\n",
        )
        .unwrap();
        let body = "---\nid: 01JRAW\n---\n# Plain note\n";

        let path = write_note_at(root, "plain-note", body).unwrap();
        let duplicate = write_note_at(root, "plain-note", body).unwrap();

        assert!(path.ends_with("wiki/plain-note.md"));
        assert!(duplicate.ends_with("wiki/plain-note (2).md"));
        assert!(!root.join("wiki/_inbox/plain-note.md").exists());
        assert_eq!(std::fs::read_to_string(path).unwrap(), body);

        let secure = "---\nid: 01SECURE\nsecure: true\n---\n# Private\n";
        let secure_path = write_note_at(root, "private", secure).unwrap();
        assert!(secure_path.ends_with("wiki/_secure/private.md"));
    }

    #[test]
    fn unreadable_librarian_setting_refuses_only_the_ambiguous_creation_lane() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join(".rotli/settings.json")).unwrap();

        let ordinary = "---\nid: 01JRAW\n---\n# Plain note\n";
        assert!(write_note_at(root, "plain-note", ordinary).is_err());
        assert!(!root.join("wiki/plain-note.md").exists());
        assert!(!root.join("wiki/_inbox/plain-note.md").exists());

        let secure = "---\nid: 01SECURE\nsecure: true\n---\n# Private\n";
        let secure_path = write_note_at(root, "private", secure).unwrap();
        assert!(secure_path.ends_with("wiki/_secure/private.md"));
    }

    #[test]
    fn secure_note_lands_in_brain_secure_home_and_is_gitignored_at_birth() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let body = "---\nid: 01SECURE\nsecure: true\n---\n\n# Private\n";
        let path = write_note_at(root, "private-01secure", body).unwrap();
        assert!(Path::new(&path).is_file());
        assert!(path.ends_with("wiki/_secure/private-01secure.md"));
        let ignored = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignored
            .lines()
            .any(|line| line.trim() == "wiki/_secure/private-01secure.md"));
    }

    #[test]
    fn safe_slug_rejects_path_tricks() {
        assert_eq!(
            safe_slug("rotli-architecture").unwrap(),
            "rotli-architecture"
        );
        assert!(safe_slug("../etc/passwd").is_err());
        assert!(safe_slug("a/b").is_err());
        assert!(safe_slug("Caps").is_err());
        assert!(safe_slug("").is_err());
    }

    #[test]
    fn secure_chat_taint_is_one_way_at_the_rust_write_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        write_chat_at(
            &root,
            "tainted",
            "---\ntitle: Tainted\nsecureContext: true\n---\n\nsecret-derived turn\n",
            None,
        )
        .unwrap();

        let revision = read_chat_at(&root, "tainted").unwrap().revision;

        write_chat_at(
            &root,
            "tainted",
            "---\ntitle: Tainted\n---\n\ncaller omitted the marker\n",
            Some(&revision),
        )
        .unwrap();

        let saved = fs::read_to_string(root.join("chats/tainted.md")).unwrap();
        assert!(saved.contains("secureContext: true"));

        let crlf = "---\r\ntitle: Private\r\nsecureContext: true\r\n---\r\n\r\nsecret\r\n";
        assert!(chat_secure_context(crlf));
        let rewritten = ensure_chat_secure_context(
            "---\r\ntitle: Private\r\nsecureContext: false\r\n---\r\n\r\nsecret\r\n",
        );
        assert!(rewritten.contains("secureContext: true\r\n---"));
    }

    #[test]
    fn chat_create_and_update_never_overwrite_an_existing_or_newer_transcript() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let original = "---\ntitle: Daily\n---\n\nfirst turn\n";
        write_chat_at(&root, "daily", original, None).unwrap();
        let opened = read_chat_at(&root, "daily").unwrap();

        assert!(write_chat_at(&root, "daily", "replacement", None).is_err());
        write_chat_at(
            &root,
            "daily",
            "---\ntitle: Daily\n---\n\nexternal turn\n",
            Some(&opened.revision),
        )
        .unwrap();
        assert!(write_chat_at(&root, "daily", "stale local turn", Some(&opened.revision)).is_err());

        let saved = read_chat_at(&root, "daily").unwrap();
        assert!(saved.contents.contains("external turn"));
        assert!(!saved.contents.contains("stale local turn"));
    }

    #[test]
    fn stale_chat_folder_projection_never_replaces_a_newer_grouping() {
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        let opened = read_chat_folders_at(&root).unwrap();
        let first =
            r#"{"version":1,"folders":[{"id":"work","name":"Work"}],"assignments":{},"order":{}}"#;
        write_chat_folders_at(&root, first, &opened.revision).unwrap();
        let stale =
            r#"{"version":1,"folders":[{"id":"old","name":"Old"}],"assignments":{},"order":{}}"#;
        let error = write_chat_folders_at(&root, stale, &opened.revision).unwrap_err();
        assert!(error.contains("revision conflict"), "{error}");
        assert_eq!(read_chat_folders_at(&root).unwrap().contents, first);
    }

    #[test]
    fn folder_authority_is_exact_and_comes_from_native_selection() {
        let dir = tempfile::tempdir().unwrap();
        let selected = dir.path().join("selected");
        let sibling = dir.path().join("sibling");
        fs::create_dir_all(&selected).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let grants = FolderAuthorizations::default();

        assert!(grants.require(&selected).is_err());
        let canonical = grants.authorize(&selected).unwrap();
        assert_eq!(grants.require(&selected).unwrap(), canonical);
        assert!(grants.require(&sibling).is_err());
    }

    #[test]
    fn library_validation_never_executes_a_script_from_the_memex() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts")).unwrap();
        fs::write(
            dir.path().join("scripts/validate.ts"),
            "await Bun.write('../executed', 'pwned')",
        )
        .unwrap();

        let report = safe_validation_report(dir.path());
        assert!(report.skipped);
        assert!(!dir.path().join("executed").exists());
        assert!(report.stdout.contains("untrusted data"));
    }

    #[test]
    fn parse_mode_raw_is_fail_closed() {
        assert_eq!(parse_mode_raw(""), "local");
        let reg = |m: &str| {
            format!("{{\"version\":2,\"primary\":\"seth\",\"users\":[{{\"name\":\"seth\"}}],\"mode\":\"{m}\"}}")
        };
        assert_eq!(parse_mode_raw(&reg("open")), "open");
        assert_eq!(parse_mode_raw(&reg("secure")), "secure");
        assert_eq!(parse_mode_raw(&reg("banana")), "secure");
        assert_eq!(
            parse_mode_raw("{\"primary\":\"seth\"}"),
            "local",
            "no users array ⇒ no registry ⇒ local"
        );
    }

    #[test]
    fn detect_fresh_dir() {
        let dir = tempfile::tempdir().unwrap();
        let d = detect_one(dir.path());
        assert_eq!(d.kind, "fresh");
        assert!(d.memex_id.is_none());
    }

    #[test]
    fn detect_memex_requires_mx_id() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("memex.json"),
            "{\"id\":\"mx_test123\",\"contract\":\"3.4\",\"apps\":{}}",
        )
        .unwrap();
        let d = detect_one(dir.path());
        assert_eq!(d.kind, "memex");
        assert_eq!(d.memex_id.as_deref(), Some("mx_test123"));
        assert_eq!(d.contract.as_deref(), Some("3.4"));

        // a memex.json without an mx_ id is NOT a memex (never init/connect over it)
        std::fs::write(dir.path().join("memex.json"), "{\"id\":\"nope\"}").unwrap();
        assert_eq!(detect_one(dir.path()).kind, "plain");
    }

    #[test]
    fn stamp_rotli_preserves_other_apps() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("memex.json");
        std::fs::write(
            &p,
            "{\n  \"id\": \"mx_x\",\n  \"contract\": \"3.4\",\n  \"selfHeal\": true,\n  \"apps\": { \"breve\": { \"role\": \"message-platform\", \"connectedAt\": \"t\" } }\n}\n",
        )
        .unwrap();
        stamp_rotli(&p).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["apps"]["breve"]["role"], "message-platform"); // untouched
        assert_eq!(v["apps"]["rotli"]["role"], "chat-system"); // added
        assert_eq!(v["selfHeal"], true); // preserved
        assert_eq!(v["id"], "mx_x"); // preserved
    }
}
