//! Stage 1 — the memex seam. rotli connects to (or initiates) a memex instance:
//! the shared `self/ wiki/ history/ chats/ inbox.md MAP.md` spine that Breve also
//! writes to (for Seth, `~/memex-vault`).
//!
//! MIRROR-NOT-IMPORT (the boundary law, see ~/breve/docs/memex-boundary.md): rotli
//! NEVER imports memex-vault's bun/node engine. It does file I/O here and only ever
//! SHELLS OUT to the brain's own `scripts/validate.ts`. The byte-shape of the files
//! it writes is mirrored in `src/memex/contract.ts` (TS) — this module just lays
//! the bytes down atomically + under an advisory lock (Breve's daemon writes the
//! same tree concurrently).
//!
//! OWNERSHIP: rotli writes ONLY `chats/`, the `wiki/_inbox/` note staging (v3.5), and
//! appends `inbox.md`. `self/`, `history/`, `MAP.md`, the CURATED rest of `wiki/`, and
//! every control file are NEVER written — `assert_writable` refuses, regardless of what
//! the frontend sends (the hard guard behind the TS `canWrite` gate). The active-instance
//! registry lives OUTSIDE any corpus, in the app config dir, so a connected brain is
//! never littered with rotli wiring.

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

/// The memex contract version rotli is built against (mirrors memex-vault's
/// `CONTRACT_VERSION` and `src/memex/contract.ts`). rotli writes the v3.5 note
/// contract but still WRITES to a v3.4 brain (the chat/inbox shape is unchanged),
/// so the supported band is `[MIN_CONTRACT, CONTRACT_VERSION]`.
const CONTRACT_VERSION: &str = "3.5";
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

/// A short advisory lock around a read-modify-write (mirrors conversations.ts
/// `withFileLock`: O_EXCL lockfile, ~10s ceiling, stale-lock reclaim). Breve's
/// daemon and rotli both append `inbox.md` / merge `memex.json` — this serializes them.
fn with_file_lock<T>(target: &Path, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let lock = PathBuf::from(format!("{}.lock", target.to_string_lossy()));
    let mut held = false;
    for _ in 0..200 {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(_) => {
                held = true;
                break;
            }
            Err(_) => {
                if let Ok(modified) = fs::metadata(&lock).and_then(|m| m.modified()) {
                    if modified
                        .elapsed()
                        .map(|d| d > Duration::from_millis(10_000))
                        .unwrap_or(false)
                    {
                        let _ = fs::remove_file(&lock);
                        continue;
                    }
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    let result = f();
    if held {
        let _ = fs::remove_file(&lock);
    }
    result
}

// ─── the write guard (rotli owns chats/ + inbox.md + wiki/_inbox/, nothing else) ─

fn is_writable(rel: &str) -> bool {
    let p = rel.trim_start_matches('/');
    if p.contains("..") {
        return false;
    }
    p == "inbox.md"
        || p == "chats"
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
            "rotli only writes chats, inbox, and wiki/_inbox staging here — the rest of memex-vault's memory is read-only (refused: {rel})"
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
    } else if !root.exists()
        || fs::read_dir(root)
            .map(|mut d| d.next().is_none())
            .unwrap_or(true)
    {
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

/// Whether a brain's contract is within rotli's supported band [MIN_CONTRACT,
/// CONTRACT_VERSION]. In-band ⇒ rotli may write (chats/inbox/wiki/_inbox); out of
/// band ⇒ the brain opens read-only (never write a contract rotli wasn't built for).
/// Mirrors the TS `contractInRange` default band.
fn contract_ok(contract: Option<&str>) -> bool {
    matches!(contract, Some(c) if c == MIN_CONTRACT || c == CONTRACT_VERSION)
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

fn write_registry(app: &tauri::AppHandle, reg: &InstanceRegistry) -> Result<(), String> {
    let f = registry_file(app).ok_or("no app config dir")?;
    if let Some(p) = f.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(reg).map_err(|e| e.to_string())? + "\n";
    atomic_write(&f, &json)
}

fn upsert_instance(
    app: &tauri::AppHandle,
    entry: InstanceEntry,
    make_active: bool,
) -> Result<InstanceEntry, String> {
    let mut reg = read_registry(app);
    if reg.version == 0 {
        reg.version = 1;
    }
    reg.instances.retain(|i| i.abs_path != entry.abs_path);
    reg.instances.push(entry.clone());
    if make_active || reg.active_id.is_none() {
        reg.active_id = Some(entry.id.clone());
    }
    write_registry(app, &reg)?;
    Ok(entry)
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

// ─── inbox insert (after the sentinel, else EOF) ───────────────────────────────

fn insert_inbox(existing: &str, line: &str) -> String {
    if let Some(idx) = existing.find(INBOX_MARK) {
        let after = idx + INBOX_MARK.len();
        let nl = existing[after..]
            .find('\n')
            .map(|n| after + n + 1)
            .unwrap_or(existing.len());
        let mut s = String::with_capacity(existing.len() + line.len());
        s.push_str(&existing[..nl]);
        s.push_str(line);
        s.push_str(&existing[nl..]);
        s
    } else {
        let mut s = existing.to_string();
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(line);
        s
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

/// Inspect one folder (after the user picks it in "Connect to existing…").
#[tauri::command]
pub fn memex_inspect(path: String) -> Result<DetectedMemex, String> {
    Ok(detect_one(&PathBuf::from(path)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractRaw {
    pub memex_json: String,
    pub users_json: String,
    pub identities_json: String,
}

/// Raw contract files (TS parses them with the mirror codec).
#[tauri::command]
pub fn memex_read_contract(root: String) -> Result<ContractRaw, String> {
    let root = PathBuf::from(root);
    let rd = |n: &str| fs::read_to_string(root.join(n)).unwrap_or_default();
    Ok(ContractRaw {
        memex_json: rd("memex.json"),
        users_json: rd("users.json"),
        identities_json: rd("identities.local.json"),
    })
}

/// Read any spine file (rotli reads everything; writes are the gated part).
#[tauri::command]
pub fn memex_read(root: String, rel: String) -> Result<String, String> {
    if rel.contains("..") || rel.starts_with('/') {
        return Err("bad path".into());
    }
    Ok(fs::read_to_string(PathBuf::from(root).join(&rel)).unwrap_or_default())
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
}

/// List the named chats in `chats/` (read-only; mirrors conversations.ts listChats).
#[tauri::command]
pub fn memex_list_chats(root: String) -> Result<Vec<ChatSummary>, String> {
    let dir = PathBuf::from(root).join("chats");
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
            out.push(ChatSummary {
                slug,
                title: fm(&text, "title"),
                source: fm(&text, "source"),
                attached_to: unwrap_wikilink(&fm(&text, "attachedTo")),
                path: p.to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub rel: String,
    pub is_dir: bool,
}

/// List one spine directory for the READ-ONLY Memory browser: subdirectories +
/// `*.md` files only (dotfiles and other files skipped), dirs-first then
/// case-insensitive alpha. Missing dir ⇒ `[]`. Rel is jailed (no `..`, no leading
/// `/`) — Memory only ever reads, never writes, so this is a pure traversal.
#[tauri::command]
pub fn memex_list_dir(root: String, rel: String) -> Result<Vec<DirEntry>, String> {
    if rel.contains("..") || rel.starts_with('/') {
        return Err("bad path".into());
    }
    let dir = PathBuf::from(root).join(&rel);
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = match e.file_name().into_string() {
                Ok(n) => n,
                Err(_) => continue,
            };
            if name.starts_with('.') {
                continue; // skip dotfiles
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir && !name.to_lowercase().ends_with(".md") {
                continue; // only subdirs + .md files
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            out.push(DirEntry {
                name,
                rel: child_rel,
                is_dir,
            });
        }
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

/// INIT a fresh memex at an empty folder (the "Separate" / brand-new path).
#[tauri::command]
pub fn memex_init(
    app: tauri::AppHandle,
    path: String,
    label: String,
) -> Result<InstanceEntry, String> {
    let root = PathBuf::from(&path);
    if root.exists() {
        if fs::read_dir(&root)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
        {
            return Err("Pick an empty folder — rotli starts a fresh brain there.".into());
        }
    } else {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }

    for d in ["self", "wiki", "history", "chats", "archive", "trash"] {
        fs::create_dir_all(root.join(d)).map_err(|e| e.to_string())?;
    }
    atomic_write(
        &root.join("inbox.md"),
        &format!("# Inbox\n\n{INBOX_MARK}\n"),
    )?;
    atomic_write(&root.join("MAP.md"), "# MAP\n\nThe index of this memex.\n")?;

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

    let entry = InstanceEntry {
        id: id.clone(),
        label,
        abs_path: root.to_string_lossy().to_string(),
        role: "chat-system".into(),
        memex_id: Some(id),
        mode: Some("local".into()),
        perms: "chats+inbox".into(),
    };
    upsert_instance(&app, entry, true)
}

/// CONNECT to an existing memex (the "Merge" path): additive `apps.rotli` stamp,
/// pin/contract checks, register. Refuses anything that isn't a real memex.
#[tauri::command]
pub fn memex_connect(
    app: tauri::AppHandle,
    path: String,
    label: String,
) -> Result<InstanceEntry, String> {
    let root = PathBuf::from(&path);
    let card = detect_one(&root);
    if card.kind != "memex" {
        return Err("That folder isn't a memex (no valid memex.json with an mx_ id).".into());
    }
    let memex_id = card
        .memex_id
        .clone()
        .ok_or("memex.json has no id")?;

    // pin check: if we already registered this root under a different id, refuse
    if let Some(prev) = read_registry(&app)
        .instances
        .into_iter()
        .find(|i| i.abs_path == card.root)
    {
        if let Some(pinned) = prev.memex_id {
            if pinned != memex_id {
                return Err(
                    "This folder is a different memex than the one rotli connected to — refusing.".into(),
                );
            }
        }
    }

    let in_range = contract_ok(card.contract.as_deref());
    let mode = card.users_json.as_deref().map(parse_mode_raw);
    let perms = if in_range { "chats+inbox" } else { "read-only" };

    // additive stamp only when we're allowed to write (in-range contract)
    if in_range {
        stamp_rotli(&root.join("memex.json"))?;
    }

    let entry = InstanceEntry {
        id: memex_id.clone(),
        label,
        abs_path: card.root,
        role: "chat-system".into(),
        memex_id: Some(memex_id),
        mode,
        perms: perms.into(),
    };
    upsert_instance(&app, entry, true)
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
#[tauri::command]
pub fn memex_write_chat(root: String, slug: String, contents: String) -> Result<String, String> {
    let root = PathBuf::from(root);
    let safe = safe_slug(&slug)?;
    let rel = format!("chats/{safe}.md");
    assert_writable(&rel)?;
    let chats = root.join("chats");
    fs::create_dir_all(&chats).map_err(|e| e.to_string())?;
    let path = chats.join(format!("{safe}.md"));
    with_file_lock(&path, || atomic_write(&path, &contents))?;
    Ok(path.to_string_lossy().to_string())
}

/// Write a brand-new note (full v3.5 bytes composed by TS) into the `wiki/_inbox/`
/// staging area as `<stem>.md`. The stem is `<slug>-<id6>` from the TS `noteStem`;
/// `safe_slug` re-validates it on the wire (lowercase-alnum-dash, no separators, no
/// `..`) so the frontend can never escape the staging dir. Atomic + under the lock,
/// exactly like a chat write. A later phase's local LLM classifies + `git mv`s the
/// note out to `wiki/<area>/`; rotli only ever writes the staging copy.
#[tauri::command]
pub fn memex_write_note(root: String, stem: String, contents: String) -> Result<String, String> {
    let root = PathBuf::from(root);
    let safe = safe_slug(&stem)?;
    let rel = format!("wiki/_inbox/{safe}.md");
    assert_writable(&rel)?;
    let dir = root.join("wiki").join("_inbox");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{safe}.md"));
    with_file_lock(&path, || atomic_write(&path, &contents))?;
    Ok(path.to_string_lossy().to_string())
}

/// Append a capture line to `inbox.md` (after the sentinel), under the lock.
#[tauri::command]
pub fn memex_append_inbox(root: String, line: String) -> Result<(), String> {
    assert_writable("inbox.md")?;
    let path = PathBuf::from(root).join("inbox.md");
    with_file_lock(&path, || {
        let existing = fs::read_to_string(&path).unwrap_or_default();
        atomic_write(&path, &insert_inbox(&existing, &line))
    })
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
#[tauri::command]
pub fn memex_validate(root: String) -> Result<ValidateReport, String> {
    let root = PathBuf::from(root);
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

#[tauri::command]
pub fn memex_list_instances(app: tauri::AppHandle) -> Result<InstanceRegistry, String> {
    Ok(read_registry(&app))
}

#[tauri::command]
pub fn memex_set_active(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut reg = read_registry(&app);
    if !reg.instances.iter().any(|i| i.id == id) {
        return Err(format!("no such instance: {id}"));
    }
    reg.active_id = Some(id);
    write_registry(&app, &reg)
}

#[tauri::command]
pub fn memex_set_perms(app: tauri::AppHandle, id: String, perms: String) -> Result<(), String> {
    if perms != "chats+inbox" && perms != "read-only" {
        return Err(format!("bad perms: {perms}"));
    }
    let mut reg = read_registry(&app);
    let inst = reg
        .instances
        .iter_mut()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("no such instance: {id}"))?;
    inst.perms = perms;
    write_registry(&app, &reg)
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
    fn write_guard_allows_only_chats_inbox_and_wiki_inbox() {
        assert!(is_writable("chats/foo.md"));
        assert!(is_writable("chats"));
        assert!(is_writable("inbox.md"));
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
        assert!(contract_ok(Some("3.5"))); // a bumped card / a rotli-init'd brain
        assert!(!contract_ok(Some("3.3")));
        assert!(!contract_ok(Some("3.6")));
        assert!(!contract_ok(None));
    }

    #[test]
    fn write_note_lands_in_wiki_inbox_and_refuses_bad_stems() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let stem = "pricing-decision-01jtes";
        let body = "---\nid: 01JTEST\n---\n# Pricing decision\n";
        let path = memex_write_note(root.clone(), stem.into(), body.into()).unwrap();
        assert!(path.ends_with("wiki/_inbox/pricing-decision-01jtes.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        // a stem with a path separator / traversal / caps is rejected by safe_slug
        assert!(memex_write_note(root.clone(), "../escape".into(), "x".into()).is_err());
        assert!(memex_write_note(root.clone(), "a/b".into(), "x".into()).is_err());
        assert!(memex_write_note(root, "Caps".into(), "x".into()).is_err());
    }

    #[test]
    fn list_dir_rejects_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert!(memex_list_dir(root.clone(), "../etc".into()).is_err());
        assert!(memex_list_dir(root.clone(), "wiki/../..".into()).is_err());
        assert!(memex_list_dir(root.clone(), "/abs".into()).is_err());
        // a missing-but-safe rel reads as an empty listing, never an error
        assert_eq!(
            memex_list_dir(root, "nope".into()).unwrap().len(),
            0
        );
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
    fn inbox_inserts_after_the_sentinel() {
        let existing = format!("# Inbox\n\n{INBOX_MARK}\n- old\n");
        let out = insert_inbox(&existing, "- new\n");
        assert_eq!(out, format!("# Inbox\n\n{INBOX_MARK}\n- new\n- old\n"));
    }

    #[test]
    fn inbox_appends_when_no_sentinel() {
        assert_eq!(insert_inbox("- a\n", "- b\n"), "- a\n- b\n");
        assert_eq!(insert_inbox("", "- b\n"), "- b\n");
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
