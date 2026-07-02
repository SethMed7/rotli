//! Stage 1 — the memex seam. rotli connects to (or initiates) a memex instance:
//! the shared `identity/ personality/ wiki/ history/ chats/ inbox.md MAP.md` spine that
//! Breve also writes to (for Seth, `~/memex-vault`).
//!
//! MIRROR-NOT-IMPORT (the boundary law, see ~/breve/docs/memex-boundary.md): rotli
//! NEVER imports memex-vault's bun/node engine. It does file I/O here and only ever
//! SHELLS OUT to the brain's own `scripts/validate.ts`. The byte-shape of the files
//! it writes is mirrored in `src/memex/contract.ts` (TS) — this module just lays
//! the bytes down atomically + under an advisory lock (Breve's daemon writes the
//! same tree concurrently).
//!
//! OWNERSHIP: rotli writes ONLY `chats/` and the `wiki/_inbox/` note staging (v3.5).
//! `inbox.md` is NOT a rotli write surface (#96, audit 2026-07 — nothing ever appended
//! it; captures stage in `wiki/_inbox/`; Breve owns its own inbox.md appends; rotli only
//! scaffolds the file when initiating a NEW memex). `identity/`, `personality/`,
//! `history/`, `MAP.md`, the CURATED rest
//! of `wiki/`, and every control file are NEVER written — `assert_writable` refuses, regardless of what
//! the frontend sends (the hard guard behind the TS `canWrite` gate), and the ROOT itself
//! must be a registered one (`registered_root`, #20 — the webview can never point these
//! commands at an arbitrary path). The active-instance registry lives OUTSIDE any corpus,
//! in the app config dir, so a connected brain is never littered with rotli wiring.

use std::collections::HashSet;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use uuid::Uuid;

/// The memex contract version rotli is built against — MUST match
/// `src/memex/contract.ts` `CONTRACT_VERSION` exactly (the lockstep test below
/// pins it; #24, audit 2026-07: the two sides drifted 3.6 vs 3.7 and Rust's
/// verdict is the effective one — a 3.7 brain silently opened read-only).
/// v3.7 adds the AI Filer lane (additive frontmatter keys only). rotli still
/// WRITES to a v3.4 brain (the chat/inbox shape is unchanged), so the supported
/// band is `[MIN_CONTRACT, CONTRACT_VERSION]`.
const CONTRACT_VERSION: &str = "3.7";
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
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-memex-")
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

/// How long a lockfile must sit untouched before it counts as STALE and is
/// reclaimed — WELL ABOVE the ~10s max wait (#42, audit 2026-07: when the two
/// were equal, a live >10s holder had its lockfile deleted out from under it).
const LOCK_STALE: Duration = Duration::from_millis(30_000);

/// A short advisory lock around a read-modify-write (mirrors conversations.ts
/// `withFileLock`: O_EXCL lockfile, ~10s ceiling, stale-lock reclaim). Breve's
/// daemon writes the same tree rotli does (e.g. both merge `memex.json`) — this
/// serializes them. FAIL-CLOSED (#42): if the lock can't be acquired within the
/// ceiling the write is REFUSED — never run the read-modify-write unserialized.
fn with_file_lock<T>(target: &Path, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    with_file_lock_attempts(target, 200, f) // 200 × 50ms ≈ the ~10s ceiling
}

fn with_file_lock_attempts<T>(
    target: &Path,
    attempts: u32,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock = PathBuf::from(format!("{}.lock", target.to_string_lossy()));
    let mut held = false;
    for _ in 0..attempts {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => {
                held = true;
                break;
            }
            Err(_) => {
                if let Ok(modified) = fs::metadata(&lock).and_then(|m| m.modified()) {
                    if modified.elapsed().map(|d| d > LOCK_STALE).unwrap_or(false) {
                        let _ = fs::remove_file(&lock);
                        continue;
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    if !held {
        return Err(format!(
            "another writer is holding {} — try again in a moment",
            lock.display()
        ));
    }
    let result = f();
    let _ = fs::remove_file(&lock);
    result
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
}

fn assert_writable(rel: &str) -> Result<(), String> {
    if is_writable(rel) {
        Ok(())
    } else {
        Err(format!(
            "rotli only writes chats and wiki/_inbox staging here — the rest of memex-vault's memory is read-only (refused: {rel})"
        ))
    }
}

/// A chat slug must be a plain filename (it comes from `slugify`, but never trust
/// the wire): lowercase alphanumerics + dashes only, no separators, no `..`.
fn safe_slug(slug: &str) -> Result<String, String> {
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
        Ok(rd) => !rd
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_str().map(|n| !n.starts_with('.')).unwrap_or(true)),
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
    /// "chats+inbox" | "read-only"
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
            v["apps"]["rotli"] = serde_json::json!({ "role": "chat-system", "connectedAt": now_iso() });
            let json = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())? + "\n";
            atomic_write(memex_path, &json)?;
        }
        Ok(())
    })
}

// ─── bun resolution (for the validate.ts shell-out) ────────────────────────────

fn find_bun() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(format!("{home}/.bun/bin/bun"));
        if p.exists() {
            return p;
        }
    }
    for c in ["/opt/homebrew/bin/bun", "/usr/local/bin/bun"] {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("bun") // last resort: rely on PATH
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
fn registered_root(app: &tauri::AppHandle, root: &str) -> Result<PathBuf, String> {
    let cfg = crate::corpus::ensure_corpus_config(app);
    let mut roots: Vec<PathBuf> = vec![cfg.corpus.abs_path];
    roots.extend(cfg.brains.into_iter().map(|b| b.abs_path));
    roots.extend(cfg.folders.into_iter().map(|f| f.abs_path));
    let want = PathBuf::from(root);
    if root_among(&roots, &want) {
        fs::canonicalize(&want).map_err(|e| format!("bad memex root {root}: {e}"))
    } else {
        Err(format!("not a registered memex root: {root}"))
    }
}

// ─── commands ──────────────────────────────────────────────────────────────────

/// Scan the likely places for an existing memex (so first-run can offer "merge"):
/// `~/memex-vault`, `$MEMEX_KNOWLEDGE`, and any already-registered instance. Only
/// dirs that are a real memex (valid `mx_` memex.json) are returned.
#[tauri::command]
pub fn memex_detect(app: tauri::AppHandle) -> Result<Vec<DetectedMemex>, String> {
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
        if d.kind == "memex" {
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
    let rd = |n: &str| fs::read_to_string(root.join(n)).unwrap_or_default();
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

fn read_at(root: &Path, rel: &str) -> Result<String, String> {
    if rel.contains("..") || rel.starts_with('/') {
        return Err("bad path".into());
    }
    Ok(fs::read_to_string(root.join(rel)).unwrap_or_default())
}

/// Frontmatter scalar lookup (mirrors conversations.ts `fm`; line-based so it's
/// safe on any UTF-8 — frontmatter sits in the first handful of lines).
fn fm(text: &str, key: &str) -> String {
    let want = format!("{key}:");
    for line in text.lines().take(20) {
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
}

/// List the named chats in `chats/` (read-only; mirrors conversations.ts listChats).
#[tauri::command]
pub fn memex_list_chats(app: tauri::AppHandle, root: String) -> Result<Vec<ChatSummary>, String> {
    let root = registered_root(&app, &root)?;
    list_chats_at(&root)
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
            let text = fs::read_to_string(&p).unwrap_or_default();
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

/// What `corpus.rs` needs to register a connected brain in `corpus.json` — the
/// memex-specific half of connecting (validate it's a real memex, stamp
/// `apps.rotli` when in-range, derive perms/mode). The unified model keeps brains
/// in `corpus.json`, so this returns the data instead of touching any registry.
pub struct BrainConnect {
    pub memex_id: String,
    pub label: String,
    pub mode: Option<String>,
    /// "chats+inbox" | "read-only"
    pub perms: String,
}

/// Validate + stamp a folder for use as a connected brain. Mirrors `memex_connect`
/// minus the instance registry: refuses a non-memex, stamps `apps.rotli` only when
/// the contract is in rotli's band, and returns the id/label/mode/perms.
pub fn prepare_brain_connect(path: &Path) -> Result<BrainConnect, String> {
    let card = detect_one(path);
    if card.kind != "memex" {
        return Err("That folder isn't a memex (no valid memex.json with an mx_ id).".into());
    }
    let memex_id = card.memex_id.clone().ok_or("memex.json has no id")?;
    let in_range = contract_ok(card.contract.as_deref());
    let mode = card.users_json.as_deref().map(parse_mode_raw);
    let perms = if in_range { "chats+inbox" } else { "read-only" };
    // additive stamp only when we're allowed to write (in-range contract)
    if in_range {
        stamp_rotli(&path.join("memex.json"))?;
    }
    Ok(BrainConnect {
        memex_id,
        label: card.label,
        mode,
        perms: perms.to_string(),
    })
}

/// Read-only view of a folder AS a brain (no stamp, no side effects):
/// `Some((memex_id, perms))` when it's a memex, else `None`. Lets the corpus
/// module tell the UI whether the corpus itself is a brain and with what perms.
pub fn brain_view(path: &Path) -> Option<(String, String)> {
    let card = detect_one(path);
    if card.kind != "memex" {
        return None;
    }
    let id = card.memex_id?;
    let perms = if contract_ok(card.contract.as_deref()) {
        "chats+inbox"
    } else {
        "read-only"
    };
    Some((id, perms.to_string()))
}

/// Scaffold a FRESH memex at `root` (empty/fresh only) — the v3.6 spine + a new
/// `mx_` memex.json stamped with `apps.rotli`. Returns the new memex id. Drives
/// onboarding's "create a new brain" path; refuses a non-empty folder.
pub fn scaffold_memex(root: &Path) -> Result<String, String> {
    if root.exists() && !dir_has_no_real_entries(root) {
        return Err("Pick an empty folder — rotli starts a fresh brain there.".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    for d in [
        "identity",
        "personality",
        "wiki",
        "wiki/_inbox",
        "history",
        "chats",
        "storage",
        "archive",
        "trash",
    ] {
        fs::create_dir_all(root.join(d)).map_err(|e| e.to_string())?;
    }
    atomic_write(&root.join("inbox.md"), &format!("# Inbox\n\n{INBOX_MARK}\n"))?;
    atomic_write(&root.join("MAP.md"), "# MAP\n\nThe index of this memex.\n")?;
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

/// A tiny mirror of the contract's fail-closed access-mode rule, for the registry
/// snapshot only (the authoritative parse is TS `parseAccessMode`).
fn parse_mode_raw(users_json: &str) -> String {
    match serde_json::from_str::<Value>(users_json) {
        Ok(v) if v.get("users").map(|u| u.is_array()).unwrap_or(false)
            && v.get("primary").map(|p| p.is_string()).unwrap_or(false) =>
        {
            match v.get("mode").and_then(|m| m.as_str()).map(|s| s.trim().to_lowercase()) {
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
) -> Result<String, String> {
    let root = registered_root(&app, &root)?;
    write_chat_at(&root, &slug, &contents)
}

fn write_chat_at(root: &Path, slug: &str, contents: &str) -> Result<String, String> {
    let safe = safe_slug(slug)?;
    let rel = format!("chats/{safe}.md");
    assert_writable(&rel)?;
    let chats = root.join("chats");
    fs::create_dir_all(&chats).map_err(|e| e.to_string())?;
    let path = chats.join(format!("{safe}.md"));
    with_file_lock(&path, || atomic_write(&path, contents))?;
    Ok(path.to_string_lossy().to_string())
}

/// Write a brand-new note (full v3.5 bytes composed by TS) into the `wiki/_inbox/`
/// staging area as `<stem>.md`. The stem is `<slug>-<id6>` from the TS `noteStem`;
/// `safe_slug` re-validates it on the wire (lowercase-alnum-dash, no separators, no
/// `..`) so the frontend can never escape the staging dir. Atomic + under the lock,
/// exactly like a chat write. The ROOT must be registered (#20). A later phase's
/// local LLM classifies + `git mv`s the note out to `wiki/<area>/`; rotli only
/// ever writes the staging copy.
#[tauri::command]
pub fn memex_write_note(
    app: tauri::AppHandle,
    root: String,
    stem: String,
    contents: String,
) -> Result<String, String> {
    let root = registered_root(&app, &root)?;
    write_note_at(&root, &stem, &contents)
}

fn write_note_at(root: &Path, stem: &str, contents: &str) -> Result<String, String> {
    let safe = safe_slug(stem)?;
    let rel = format!("wiki/_inbox/{safe}.md");
    assert_writable(&rel)?;
    let dir = root.join("wiki").join("_inbox");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{safe}.md"));
    with_file_lock(&path, || atomic_write(&path, contents))?;
    Ok(path.to_string_lossy().to_string())
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

/// Shell out to the brain's own `scripts/validate.ts` (mirror-not-import: we exec
/// it by path, never load it). Degrades to "skipped" if bun / the script is absent.
/// The ROOT must be registered (#20) — this execs a script FROM the target tree.
#[tauri::command]
pub fn memex_validate(app: tauri::AppHandle, root: String) -> Result<ValidateReport, String> {
    let root = registered_root(&app, &root)?;
    let script = root.join("scripts").join("validate.ts");
    if !script.exists() {
        return Ok(ValidateReport {
            ok: true,
            skipped: true,
            stdout: "no scripts/validate.ts here — validation skipped".into(),
            errors: 0,
            warnings: 0,
        });
    }
    let out = std::process::Command::new(find_bun())
        .arg(&script)
        .current_dir(&root)
        .output();
    let out = match out {
        Ok(o) => o,
        Err(_) => {
            return Ok(ValidateReport {
                ok: true,
                skipped: true,
                stdout: "bun not found — validation skipped".into(),
                errors: 0,
                warnings: 0,
            })
        }
    };
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let errors = combined.matches('✗').count() as u32;
    let warnings = combined.matches('⚠').count() as u32;
    Ok(ValidateReport {
        ok: out.status.success(),
        skipped: false,
        stdout: combined,
        errors,
        warnings,
    })
}

/// Native folder picker that returns a path WITHOUT moving anything (for
/// "Connect to existing…" / "New separate brain…").
#[tauri::command]
pub fn memex_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Choose a memex folder")
        .blocking_pick_folder();
    match picked {
        Some(fp) => Ok(Some(
            fp.into_path()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string(),
        )),
        None => Ok(None),
    }
}

// ─── tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
        // refuses to scaffold over a non-empty folder
        assert!(scaffold_memex(&root).is_err());
    }

    #[test]
    fn write_guard_allows_only_chats_and_wiki_inbox() {
        assert!(is_writable("chats/foo.md"));
        assert!(is_writable("chats"));
        // inbox.md is NOT a rotli write surface (#96, audit 2026-07) — nothing ever
        // appended it; the dead allowance was narrowed out of the gate.
        assert!(!is_writable("inbox.md"));
        // wiki/_inbox staging (v3.5) is writable; the curated rest of wiki/ is not.
        assert!(is_writable("wiki/_inbox"));
        assert!(is_writable("wiki/_inbox/pricing-decision-01jtes.md"));
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
        assert!(contract_ok(Some("3.7"))); // the Filer-lane contract / the ceiling (#24)
        assert!(!contract_ok(Some("3.3"))); // below the floor
        assert!(!contract_ok(Some("3.8"))); // above the ceiling
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
        let r = with_file_lock_attempts(&target, 3, || {
            ran = true;
            Ok(())
        });
        assert!(r.is_err(), "non-acquisition must be an Err, not a fallthrough");
        assert!(!ran, "the closure must NOT run without the lock");
        assert!(lock.exists(), "a live holder's lockfile is never dispossessed");

        // once the holder releases, the same write goes through and cleans up
        std::fs::remove_file(&lock).unwrap();
        let r = with_file_lock_attempts(&target, 3, || Ok(42));
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
        assert!(!root_among(&roots, b.path()), "an unregistered dir is refused");
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
        assert!(read_at(dir.path(), "../etc/passwd").is_err());
        assert!(read_at(dir.path(), "/abs").is_err());
        // a missing-but-safe rel reads as "", never an error
        assert_eq!(read_at(dir.path(), "nope.md").unwrap(), "");
    }

    #[test]
    fn write_note_lands_in_wiki_inbox_and_refuses_bad_stems() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let stem = "pricing-decision-01jtes";
        let body = "---\nid: 01JTEST\n---\n# Pricing decision\n";
        let path = write_note_at(root, stem, body).unwrap();
        assert!(path.ends_with("wiki/_inbox/pricing-decision-01jtes.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        // a stem with a path separator / traversal / caps is rejected by safe_slug
        assert!(write_note_at(root, "../escape", "x").is_err());
        assert!(write_note_at(root, "a/b", "x").is_err());
        assert!(write_note_at(root, "Caps", "x").is_err());
    }

    #[test]
    fn safe_slug_rejects_path_tricks() {
        assert_eq!(safe_slug("rotli-architecture").unwrap(), "rotli-architecture");
        assert!(safe_slug("../etc/passwd").is_err());
        assert!(safe_slug("a/b").is_err());
        assert!(safe_slug("Caps").is_err());
        assert!(safe_slug("").is_err());
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
