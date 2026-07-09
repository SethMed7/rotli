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

use std::collections::{HashMap, HashSet};
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
        // tolerate macOS cruft (.DS_Store) / a stray dotfile — only REAL files block a move
        let has_real = fs::read_dir(new_root)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_str().map(|n| !n.starts_with('.')).unwrap_or(true));
        if has_real {
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

// ─── multi-root: CorpusRoot + the root registry (Track 2, Build Step 1) ───────
//
// THE ID SCHEME (the one law the TS side must mirror): the corpus is becoming
// MULTI-ROOT. A `folderId` (and every note/board id on the wire) is routed by a
// root prefix:
//   • the DEFAULT root keeps BARE ids — "Inbox", "Storage", "Inbox/Work",
//     a ulid, "Notes/sketch.excalidraw" — ZERO migration of existing
//     notes/state. The routing layer is TRANSPARENT for the default root.
//   • a NON-default root prefixes "<rootid>:" — "vault:wiki/foo",
//     "vault:chats/x", "vault:01J…" (a ulid in the vault). The router splits on
//     the FIRST colon into (rootid, rel); a bare id is (default, id).
//
// `:` is a safe router char: `validate_component` forbids it inside a path
// component (added below), so split-once-on-first-colon is unambiguous and a
// folder literally named `a:b` can never collide with the router.

/// The reserved id of the local default root — always registered, always bare.
pub const DEFAULT_ROOT_ID: &str = "default";

/// A registered corpus root. `id` is the stable routing handle ("default",
/// "vault"); `label` is what the sidebar shows ("Vault"); `abs_path` is the
/// resolved absolute directory the store binds to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorpusRoot {
    pub id: String,
    pub label: String,
    pub abs_path: PathBuf,
}

/// The on-disk root registry (`corpus-roots.json` in the app config dir, beside
/// `corpus-root.txt`). Persisted so the set of roots survives relaunch.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RootRegistry {
    pub version: u32,
    pub roots: Vec<CorpusRoot>,
}

impl RootRegistry {
    pub fn get(&self, id: &str) -> Option<&CorpusRoot> {
        self.roots.iter().find(|r| r.id == id)
    }
}

/// The roots to open at startup, in order: always the DEFAULT root (the active
/// corpus = `resolve_corpus`), then one row per CONNECTED BRAIN that is STILL a
/// valid memex (honor-only-while-a-memex; a brain whose folder vanished or lost
/// its `memex.json` is left UNBOUND — no row — exactly the old vault rule). Reads
/// the unified `corpus.json`, migrating the four legacy files into it on first
/// launch (idempotent, non-destructive).
pub fn startup_roots(app: &tauri::AppHandle) -> Vec<CorpusRoot> {
    // demo mode: a single isolated demo memex — the real brains/folders are
    // hidden and corpus.json is never touched (Seth, 2026-07-07).
    if demo_active(app) {
        if let Some(demo) = ensure_demo_memex(app) {
            return vec![CorpusRoot {
                id: DEFAULT_ROOT_ID.to_string(),
                label: "Notes".to_string(),
                abs_path: demo,
            }];
        }
    }
    let cfg = ensure_corpus_config(app);
    let mut out: Vec<CorpusRoot> = vec![CorpusRoot {
        id: DEFAULT_ROOT_ID.to_string(),
        label: "Notes".to_string(),
        abs_path: resolve_corpus(app),
    }];
    for b in &cfg.brains {
        if is_memex_root(&b.abs_path) {
            out.push(CorpusRoot {
                id: b.id.clone(),
                label: b.label.clone(),
                abs_path: b.abs_path.clone(),
            });
        }
    }
    // added plain folders open as LegacyRotli roots (everything writable in place)
    out.extend(cfg.folders.iter().cloned());
    out
}

// ─── the unified corpus model (`corpus.json`) ───────────────────────────────
//
// ONE file replaces corpus-root.txt + corpus-memex-root.txt + corpus-roots.json
// + memex-instances.json. The corpus is THE one folder = your notes = your brain;
// whether it is a memex is DERIVED (`is_memex_root`), never stored, so it can't
// drift. `brains` are connected, read-only-by-default "other brains" (the former
// Vault ∪ memex instances). On first launch the four legacy files migrate in.

/// THE one folder = your notes = your brain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorpusRef {
    pub abs_path: PathBuf,
    // future: `storage_path: Option<PathBuf>` (default `<corpus>/storage`) — the
    // redirectable binary store. Not built yet (rotli writes no binaries).
}

/// A connected "other brain" — a memex rotli reads, with per-brain write perms.
/// `id` is the router slug ("vault" stays reserved for back-compat with the
/// `vault:` sidebar prefix).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedBrain {
    pub id: String,
    pub label: String,
    pub abs_path: PathBuf,
    #[serde(default)]
    pub memex_id: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    /// "chats+inbox" | "read-only"
    pub perms: String,
}

/// The unified on-disk config (`corpus.json` in the app config dir).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusConfig {
    pub version: u32,
    pub corpus: CorpusRef,
    #[serde(default)]
    pub brains: Vec<ConnectedBrain>,
    /// Arbitrary plain folders added to the sidebar (the "add a folder" feature) —
    /// browsable + editable in place, NOT memexes. Distinct from `brains`.
    #[serde(default)]
    pub folders: Vec<CorpusRoot>,
    #[serde(default)]
    pub active_brain_id: Option<String>,
}

fn corpus_config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok().map(|d| d.join("corpus.json"))
}

pub fn read_corpus_config(app: &tauri::AppHandle) -> Option<CorpusConfig> {
    corpus_config_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
}

pub fn write_corpus_config(app: &tauri::AppHandle, cfg: &CorpusConfig) -> Result<(), String> {
    let f = corpus_config_file(app).ok_or("no app config dir")?;
    if let Some(p) = f.parent() {
        fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())? + "\n";
    atomic_write(&f, &json)
}

// ─── demo mode ──────────────────────────────────────────────────────────────
// A fully-isolated SEEDED MEMEX for screenshots/demos, named `memex-demo` and
// living next to the user's real memex (same parent dir). A marker file
// (`demo.on` in app_config_dir) flips it; when set, the app opens memex-demo
// INSTEAD of the real corpus and hides the real brains/folders. The user's
// corpus.json is never read or written — flipping demo off restores everything.
// The demo memex is marked `"demo": true` in its own memex.json, so onboarding /
// memex_detect skip it (it's never offered as a real memex to connect).

/// Bump when the seed content changes so an already-seeded demo memex re-seeds on
/// next activation (Seth, 2026-07-07 — v2 is the public, rotli-about-rotli seed).
const DEMO_SEED_VERSION: &str = "2";

/// The bundled seed content, written into memex-demo on first activation. It is a
/// PUBLIC demo — general, about rotli itself, nothing personal (it ships in
/// screenshots and demos). `.rotli/main.json` seeds a hand-arranged Main so the
/// demo shows the same note reachable two ways: in Main (your view) and in the
/// Brain (where it lives).
const DEMO_SEED: &[(&str, &str)] = &[
    ("memex.json", include_str!("../demo-seed/memex.json")),
    ("MAP.md", include_str!("../demo-seed/MAP.md")),
    ("inbox.md", include_str!("../demo-seed/inbox.md")),
    (".rotli/main.json", include_str!("../demo-seed/main.json")),
    ("wiki/guides/welcome-to-rotli.md", include_str!("../demo-seed/wiki/guides/welcome-to-rotli.md")),
    ("wiki/guides/main-and-the-brain.md", include_str!("../demo-seed/wiki/guides/main-and-the-brain.md")),
    ("wiki/ideas/note-taking-that-lasts.md", include_str!("../demo-seed/wiki/ideas/note-taking-that-lasts.md")),
    ("wiki/reading/local-first-software.md", include_str!("../demo-seed/wiki/reading/local-first-software.md")),
    ("wiki/_inbox/try-quick-capture.md", include_str!("../demo-seed/wiki/_inbox/try-quick-capture.md")),
    ("wiki/_inbox/weekend-project.md", include_str!("../demo-seed/wiki/_inbox/weekend-project.md")),
    ("chats/getting-started.md", include_str!("../demo-seed/chats/getting-started.md")),
];

/// Scaffold the seeded demo memex at `root` (idempotent — overwrites the seed).
pub fn seed_demo_memex(root: &Path) -> Result<(), String> {
    for (rel, content) in DEMO_SEED {
        let path = root.join(rel);
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(&path, content).map_err(|e| format!("seed {rel}: {e}"))?;
    }
    Ok(())
}

/// A memex marked demo-only in its own config (`memex.json` `demo: true`) — hidden
/// from onboarding/detection; only opened while demo mode is on.
pub fn is_demo_memex(root: &Path) -> bool {
    fs::read_to_string(root.join("memex.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("demo").and_then(serde_json::Value::as_bool))
        .unwrap_or(false)
}

fn demo_flag_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_config_dir().ok().map(|d| d.join("demo.on"))
}

/// The demo memex folder — `memex-demo`, a sibling of the user's real corpus.
pub fn demo_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    let parent = read_corpus_config(app)
        .map(|c| c.corpus.abs_path)
        .as_ref()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .or_else(|| std::env::var("HOME").ok().map(PathBuf::from));
    parent.map(|d| d.join("memex-demo"))
}

/// Ensure the demo memex exists + is seeded (idempotent). Re-seeds when the folder
/// isn't a memex yet OR the bundled seed version changed — so shipping new demo
/// content refreshes an already-seeded `memex-demo` on the next activation. A
/// seed-version stamp in `.rotli/` records what's on disk.
fn ensure_demo_memex(app: &tauri::AppHandle) -> Option<PathBuf> {
    let demo = demo_root(app)?;
    let stamp = demo.join(DOT_DIR).join("demo-seed-version");
    let current = fs::read_to_string(&stamp).ok();
    if !is_memex_root(&demo) || current.as_deref() != Some(DEMO_SEED_VERSION) {
        let _ = seed_demo_memex(&demo);
        if let Some(p) = stamp.parent() {
            let _ = fs::create_dir_all(p);
        }
        let _ = fs::write(&stamp, DEMO_SEED_VERSION);
    }
    Some(demo)
}

/// Is demo mode currently on? (the marker file exists)
pub fn demo_active(app: &tauri::AppHandle) -> bool {
    demo_flag_file(app).map(|f| f.exists()).unwrap_or(false)
}

/// Turn demo mode on/off — writes/removes the marker (the caller relaunches).
/// On enable, seeds the demo memex if it isn't there yet.
pub fn set_demo(app: &tauri::AppHandle, on: bool) -> Result<(), String> {
    let f = demo_flag_file(app).ok_or("no app config dir")?;
    if on {
        if let Some(p) = f.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        ensure_demo_memex(app);
        fs::write(&f, b"1").map_err(|e| e.to_string())?;
    } else {
        let _ = fs::remove_file(&f);
    }
    Ok(())
}

/// The active corpus root. Reads `corpus.json`; if its path vanished (or there's
/// no config yet) falls back so the app never opens a dead path. A blank/dead
/// default is the white-screen failure mode — this guard is load-bearing.
pub fn resolve_corpus(app: &tauri::AppHandle) -> PathBuf {
    // demo mode: the seeded demo memex, never the user's real corpus
    if demo_active(app) {
        if let Some(demo) = ensure_demo_memex(app) {
            return demo;
        }
    }
    if let Some(cfg) = read_corpus_config(app) {
        return if cfg.corpus.abs_path.exists() {
            cfg.corpus.abs_path
        } else {
            default_corpus_root(app)
        };
    }
    // No config yet (cold start before migration). Startup's `ensure_corpus_config`
    // writes `corpus.json` — migrating the legacy txt pointers in — before any UI
    // read, so a missing config here just means "use the default".
    default_corpus_root(app)
}

/// Ensure `corpus.json` exists, migrating the four legacy files into it ONCE
/// (idempotent — a no-op once the config exists). Non-destructive: the legacy
/// files are left in place until the retire step.
pub fn ensure_corpus_config(app: &tauri::AppHandle) -> CorpusConfig {
    if let Some(cfg) = read_corpus_config(app) {
        return cfg;
    }
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // A corpus.json that EXISTS but won't parse must NOT be silently re-migrated over
    // (that would drop added folders / re-add forgotten brains / reset the active
    // pick). Preserve the bad file as `.bak` + log, then re-derive from the legacy files.
    let cfg_file = dir.join("corpus.json");
    if cfg_file.exists() {
        eprintln!("rotli: corpus.json is unreadable — preserving it as corpus.json.bak, re-deriving from legacy files");
        let _ = fs::rename(&cfg_file, dir.join("corpus.json.bak"));
    }
    let cfg = migrate_config_at(&dir, &default_corpus_root(app));
    if let Err(e) = write_corpus_config(app, &cfg) {
        eprintln!("rotli: failed to write corpus.json ({e})");
    }
    cfg
}

// The legacy `memex-instances.json` shape, read locally so corpus.rs stays
// decoupled from the memex module's wire types.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LegacyInstances {
    #[serde(default)]
    active_id: Option<String>,
    #[serde(default)]
    instances: Vec<LegacyInstance>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyInstance {
    id: String,
    label: String,
    abs_path: String,
    #[serde(default)]
    memex_id: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    perms: String,
}

fn read_txt_pointer(config_dir: &Path, name: &str) -> Option<PathBuf> {
    let raw = fs::read_to_string(config_dir.join(name)).ok()?;
    let t = raw.trim();
    if t.is_empty() {
        None
    } else {
        Some(PathBuf::from(t))
    }
}

/// Canonicalize for dedup (so `/var` ↔ `/private/var` compare equal); fall back
/// to the path itself when it can't be resolved (e.g. it no longer exists).
fn canon(p: &Path) -> PathBuf {
    fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Slugify `label` into a router-safe id (ascii-lowercase, every run of non-alnum
/// collapsed to a single `-`, ends trimmed), falling back to `fallback` when the
/// slug is empty, then dedup with `-2`, `-3`, … against `taken`. The shared core
/// of the brain + folder id schemes.
fn unique_id(label: &str, fallback: &str, taken: impl Fn(&str) -> bool) -> String {
    let mut base: String = label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    while base.contains("--") {
        base = base.replace("--", "-");
    }
    let base = base.trim_matches('-');
    let base = if base.is_empty() { fallback } else { base };
    if !taken(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let id = format!("{base}-{n}");
        if !taken(&id) {
            return id;
        }
        n += 1;
    }
}

/// A unique, router-safe brain id from a label, keeping `default` reserved.
fn unique_brain_id(brains: &[ConnectedBrain], label: &str) -> String {
    unique_id(label, "brain", |id| {
        id == DEFAULT_ROOT_ID || brains.iter().any(|b| b.id == id)
    })
}

/// The migration core — pure over a config dir + the default corpus path, so it
/// is unit-testable headlessly. Builds the unified `CorpusConfig` from the four
/// legacy files: corpus path by today's precedence; brains = (corpus-roots
/// non-default) ∪ (memex instances) deduped on canonical path (a same-folder
/// merge keeps the corpus-roots id, e.g. "vault", and takes perms/memexId/mode
/// from the instance); active brain mapped from the instance registry's activeId
/// via memexId.
fn migrate_config_at(config_dir: &Path, default_corpus: &Path) -> CorpusConfig {
    let read_roots = || {
        fs::read_to_string(config_dir.join("corpus-roots.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<RootRegistry>(&t).ok())
    };

    let corpus_path = read_txt_pointer(config_dir, "corpus-memex-root.txt")
        .filter(|p| is_memex_root(p))
        .or_else(|| read_txt_pointer(config_dir, "corpus-root.txt").filter(|p| p.exists()))
        .or_else(|| {
            read_roots()
                .and_then(|reg| reg.get(DEFAULT_ROOT_ID).map(|r| r.abs_path.clone()))
                .filter(|p| p.exists())
        })
        .unwrap_or_else(|| default_corpus.to_path_buf());
    let corpus_canon = canon(&corpus_path);

    let mut brains: Vec<ConnectedBrain> = Vec::new();
    let mut folders: Vec<CorpusRoot> = Vec::new();
    if let Some(reg) = read_roots() {
        for r in reg.roots.into_iter().filter(|r| r.id != DEFAULT_ROOT_ID) {
            if canon(&r.abs_path) == corpus_canon {
                continue;
            }
            // a memex → a connected brain (instances merge in below); a plain dir →
            // an added folder (the "add a folder" feature is preserved).
            if is_memex_root(&r.abs_path) {
                brains.push(ConnectedBrain {
                    id: r.id,
                    label: r.label,
                    abs_path: r.abs_path,
                    memex_id: None,
                    mode: None,
                    perms: "read-only".to_string(),
                });
            } else {
                folders.push(r);
            }
        }
    }

    let legacy: LegacyInstances = fs::read_to_string(config_dir.join("memex-instances.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    for inst in &legacy.instances {
        let path = PathBuf::from(&inst.abs_path);
        let pcanon = canon(&path);
        if pcanon == corpus_canon {
            continue;
        }
        let mxid = inst.memex_id.clone().or_else(|| Some(inst.id.clone()));
        if let Some(b) = brains.iter_mut().find(|b| canon(&b.abs_path) == pcanon) {
            b.memex_id = mxid;
            b.mode = inst.mode.clone();
            b.perms = inst.perms.clone();
        } else {
            let id = unique_brain_id(&brains, &inst.label);
            brains.push(ConnectedBrain {
                id,
                label: inst.label.clone(),
                abs_path: path,
                memex_id: mxid,
                mode: inst.mode.clone(),
                perms: inst.perms.clone(),
            });
        }
    }

    let active_brain_id = legacy.active_id.as_ref().and_then(|aid| {
        let inst = legacy.instances.iter().find(|i| &i.id == aid)?;
        let mxid = inst.memex_id.clone().unwrap_or_else(|| inst.id.clone());
        brains
            .iter()
            .find(|b| b.memex_id.as_deref() == Some(mxid.as_str()))
            .map(|b| b.id.clone())
    });

    CorpusConfig {
        version: 1,
        corpus: CorpusRef { abs_path: corpus_path },
        brains,
        folders,
        active_brain_id,
    }
}

// ─── brain + corpus mutators (write ONLY corpus.json) ───────────────────────

/// Repoint the active corpus at `path`. The caller relaunches so it opens.
pub fn set_corpus_path(app: &tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    let target = canon(&path);
    // a folder can't be BOTH the corpus and a brain/added-folder — drop any dup so
    // the same dir never opens as two roots (doubled notes / two watchers).
    let dropped_active = cfg
        .active_brain_id
        .as_deref()
        .and_then(|aid| cfg.brains.iter().find(|b| b.id == aid))
        .map(|b| canon(&b.abs_path) == target)
        .unwrap_or(false);
    cfg.brains.retain(|b| canon(&b.abs_path) != target);
    cfg.folders.retain(|f| canon(&f.abs_path) != target);
    if dropped_active {
        cfg.active_brain_id = cfg.brains.first().map(|b| b.id.clone());
    }
    cfg.corpus = CorpusRef { abs_path: path };
    write_corpus_config(app, &cfg)
}

/// Connect / update a brain. A same-folder upsert PRESERVES the existing id (so
/// "vault" and its `vault:` sidebar prefix survive) and pin-checks the memex id
/// (refuse a different brain at the same path). An empty `brain.id` ⇒ a fresh
/// unique slug from the label.
pub fn upsert_brain(
    app: &tauri::AppHandle,
    brain: ConnectedBrain,
    make_active: bool,
) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    let target = canon(&brain.abs_path);
    if canon(&cfg.corpus.abs_path) == target {
        return Err(
            "That folder is already your notes folder (your brain) — it can't also be a connected brain."
                .into(),
        );
    }
    let existing = cfg.brains.iter().find(|b| canon(&b.abs_path) == target);
    if let (Some(e), Some(new_id)) = (existing, brain.memex_id.as_deref()) {
        if let Some(prev) = e.memex_id.as_deref() {
            if prev != new_id {
                return Err(
                    "This folder is a different memex than the one rotli connected to — refusing."
                        .into(),
                );
            }
        }
    }
    let id = existing.map(|b| b.id.clone()).unwrap_or_else(|| {
        if brain.id.is_empty() {
            unique_brain_id(&cfg.brains, &brain.label)
        } else {
            brain.id.clone()
        }
    });
    let entry = ConnectedBrain { id: id.clone(), ..brain };
    cfg.brains.retain(|b| canon(&b.abs_path) != target);
    cfg.brains.push(entry);
    if make_active || cfg.active_brain_id.is_none() {
        cfg.active_brain_id = Some(id);
    }
    write_corpus_config(app, &cfg)
}

pub fn set_active_brain(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    if !cfg.brains.iter().any(|b| b.id == id) {
        return Err("no such brain".into());
    }
    cfg.active_brain_id = Some(id.to_string());
    write_corpus_config(app, &cfg)
}

pub fn set_brain_perms(app: &tauri::AppHandle, id: &str, perms: &str) -> Result<(), String> {
    if perms != "chats+inbox" && perms != "read-only" {
        return Err(format!("bad perms: {perms}"));
    }
    let mut cfg = ensure_corpus_config(app);
    let b = cfg
        .brains
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or("no such brain")?;
    b.perms = perms.to_string();
    write_corpus_config(app, &cfg)
}

/// A unique, router-safe id for an added folder, over the whole config.
fn unique_folder_id(cfg: &CorpusConfig, label: &str) -> String {
    unique_id(label, "folder", |id| {
        id == DEFAULT_ROOT_ID
            || cfg.brains.iter().any(|b| b.id == id)
            || cfg.folders.iter().any(|f| f.id == id)
    })
}

/// Add an arbitrary plain folder as a sidebar root (the "add a folder" feature).
/// Returns false (no relaunch) when it's already the corpus / a brain / a folder.
pub fn add_folder(app: &tauri::AppHandle, path: PathBuf) -> Result<bool, String> {
    let mut cfg = ensure_corpus_config(app);
    let target = canon(&path);
    if canon(&cfg.corpus.abs_path) == target
        || cfg.brains.iter().any(|b| canon(&b.abs_path) == target)
        || cfg.folders.iter().any(|f| canon(&f.abs_path) == target)
    {
        return Ok(false);
    }
    let label = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("folder")
        .to_string();
    let id = unique_folder_id(&cfg, &label);
    cfg.folders.push(CorpusRoot { id, label, abs_path: path });
    write_corpus_config(app, &cfg)?;
    Ok(true)
}

/// Forget an added folder OR a connected brain by id (never the corpus). If the
/// active brain is forgotten, the active pointer falls to the first remaining.
pub fn forget_root(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    cfg.folders.retain(|f| f.id != id);
    cfg.brains.retain(|b| b.id != id);
    if cfg.active_brain_id.as_deref() == Some(id) {
        cfg.active_brain_id = cfg.brains.first().map(|b| b.id.clone());
    }
    write_corpus_config(app, &cfg)
}

/// Split a wire id into `(root_id, rel)`. A `:` splits ONCE at the first colon
/// (root handle ⟂ path); a bare id routes to the default root unchanged. The
/// `rel` half is RE-VALIDATED (`validate_rel`) unless it is empty (the root
/// itself) or a ulid/board path that the caller validates downstream — here we
/// only reject a colon hiding inside a path component, which the prefix split
/// already removed, so the remaining `rel` is colon-free by construction.
///
/// Examples:
///   "Inbox"            → ("default", "Inbox")
///   "Inbox/Work"       → ("default", "Inbox/Work")
///   "vault:wiki/foo"   → ("vault", "wiki/foo")
///   "vault:"           → ("vault", "")
///   "01J…ULID…"        → ("default", "01J…ULID…")
pub fn split_root_id(folder_id: &str) -> (String, String) {
    match folder_id.split_once(':') {
        Some((root, rel)) => (root.to_string(), rel.to_string()),
        None => (DEFAULT_ROOT_ID.to_string(), folder_id.to_string()),
    }
}

/// Compose a wire id from `(root_id, rel)`. The DEFAULT root emits a BARE rel
/// (the byte-identical gate — no prefix, ever); a non-default root prefixes
/// `<rootid>:`. The inverse of `split_root_id` for the default and non-default
/// cases alike.
pub fn compose_root_id(root_id: &str, rel: &str) -> String {
    if root_id == DEFAULT_ROOT_ID {
        rel.to_string()
    } else {
        format!("{root_id}:{rel}")
    }
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
    // rotli's local notes stamp RFC3339; a memex note (v3.5) stamps a plain
    // YYYY-MM-DD date — parse both so a projected note's frontmatter dates are
    // honored (sort order + created/updated) instead of silently falling back to
    // the file mtime, which a git clone/copy would have reset.
    if let Ok(t) = OffsetDateTime::parse(stamp, &Rfc3339) {
        return Some((t.unix_timestamp_nanos() / 1_000_000) as i64);
    }
    let s = stamp.trim();
    if s.len() == 10 && s.as_bytes()[4] == b'-' && s.as_bytes()[7] == b'-' {
        let y: i32 = s[0..4].parse().ok()?;
        let mo: u8 = s[5..7].parse().ok()?;
        let d: u8 = s[8..10].parse().ok()?;
        let month = time::Month::try_from(mo).ok()?;
        let date = time::Date::from_calendar_date(y, month, d).ok()?;
        let dt = date.with_hms(0, 0, 0).ok()?.assume_utc();
        return Some((dt.unix_timestamp_nanos() / 1_000_000) as i64);
    }
    None
}

/// A plain YYYY-MM-DD date stamp (UTC) — the memex note convention (v3.5). Local
/// notes keep the RFC3339 `now_stamp`; a memex edit bumps `updated` with this so the
/// note stays date-shaped like everything memex-vault writes.
fn today_stamp() -> String {
    let now = OffsetDateTime::now_utc().date();
    format!("{:04}-{:02}-{:02}", now.year(), u8::from(now.month()), now.day())
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

/// A frontmatter line setting the per-note AI lock — `Some(true/false)` when the
/// line is `locked: …`, else `None`. Shared with the organizer daemon, whose
/// locked-skip must read the same line the same way.
pub(crate) fn locked_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "locked").then(|| v.trim() == "true")
}

/// The key of a `key: value` frontmatter line (trimmed), if any.
pub(crate) fn field_key(line: &str) -> Option<&str> {
    line.split_once(':').map(|(k, _)| k.trim())
}

/// Keys rotli owns directly — the metadata-panel editor touches only OTHER
/// (foreign) keys; `locked` goes through set_locked, the rest are derived.
/// v3.7: `owner` promoted to RESERVED (provenance, immutable — not user-editable).
const RESERVED_KEYS: [&str; 8] =
    ["id", "created", "updated", "pinned", "origin", "locked", "secure", "owner"];

/// The metadata keys the AI FILER owns (contract v3.7). Written ONLY via
/// `set_ai_field` / `file_note`; the Filer refuses everything NOT in this set, and
/// these stay disjoint from RESERVED_KEYS (Rust) and the user's `{shelf, reach}` —
/// two actors, two gates, disjoint territories (Seth, 2026-07-01).
const AI_KEYS: [&str; 8] = [
    "area",
    "summary",
    "tags",
    "links",
    "suggested_area",
    "area_confidence",
    "filed_by",
    "filed_at",
];

/// A frontmatter line setting the per-note SECURE flag (`secure: true`).
/// Shared with the organizer daemon (its secure-skip is in-memory, never a write).
pub(crate) fn secure_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "secure").then(|| v.trim() == "true")
}

/// High-signal secret patterns — API keys, private keys, JWTs, SSNs, card numbers.
/// ANY match → the note holds secrets: it's flagged `secure: true`, its content is
/// never sent to a REMOTE model, and its path is gitignored (Seth, 2026-06-29).
/// (Impl lives in `crate::secret` — the single source shared with the web egress guard.)
fn looks_secure(text: &str) -> bool {
    crate::secret::looks_secure(text)
}

/// The note frontmatter the metadata panel reads: the typed facts, the lock state,
/// and every other ("foreign") frontmatter line for display (shelf/reach/area/…).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterView {
    pub id: String,
    pub created: String,
    pub updated: String,
    pub locked: bool,
    pub secure: bool,
    /// The typed pin fact — floats the note to the top of every list (the list
    /// sort is pinned → updated → id). Toggled from the row menu / a hotkey.
    pub pinned: bool,
    pub fields: Vec<String>,
}

/// Size + writability of a surfaced file — the sheet editor's up-front probe.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub len: u64,
    pub writable: bool,
}

/// What the editor sees: the raw body minus the single conventional blank line
/// after the fence (the write path adds exactly one back).
fn editor_body(raw: &str) -> &str {
    raw.strip_prefix("\r\n")
        .or_else(|| raw.strip_prefix('\n'))
        .unwrap_or(raw)
}

/// The verbatim frontmatter slice of a document — fences included, byte-exact,
/// "" when there is none. parse_document already knows where the body starts;
/// the block is simply everything before it. Nothing is parsed or reformatted
/// on the way out (the raw-metadata view renders exactly what's on disk).
pub fn raw_frontmatter_block(text: &str) -> &str {
    let (fm, body) = parse_document(text);
    if fm.is_none() {
        return "";
    }
    &text[..text.len() - body.len()]
}

/// The reserved PROVENANCE keys the raw-metadata editor must never change —
/// contract v3.7: id/owner/created are not user-editable. Everything else in
/// the typed block (updated/pinned/locked/secure/shelf/tags/…) lands as typed.
const RAW_IMMUTABLE_KEYS: [&str; 3] = ["id", "created", "owner"];

/// Rebuild a document from a user-typed raw frontmatter block (the "Show file
/// metadata" editor). The submitted text is taken VERBATIM — line order,
/// spacing, everything — with exactly one correction: the reserved provenance
/// lines (id/owner/created) must match the ORIGINAL file exactly (changed →
/// restored, dropped → re-inserted at the top, invented → removed). The body
/// is byte-exact from disk; only the block between the fences is rebuilt.
/// Tolerant input: with or without the `---` fences, surrounding blank noise
/// trimmed. A bare `---` line INSIDE the block is refused — it would silently
/// truncate the frontmatter on the next parse.
pub fn merge_raw_frontmatter(original: &str, submitted: &str) -> Result<String, String> {
    let (_, body) = parse_document(original);
    let orig_block = raw_frontmatter_block(original);
    // the original block's lines, fences stripped, VERBATIM (never re-serialized
    // through Frontmatter — a hand-formatted `id:  x` line survives untouched)
    let orig_lines: Vec<&str> = if orig_block.is_empty() {
        Vec::new()
    } else {
        let mut v: Vec<&str> = orig_block.lines().collect();
        v.remove(0); // opening ---
        v.pop(); // closing ---
        v
    };

    // unfence the submitted text (the UI shows the fences; a bare key list is
    // accepted too). Blank lines INSIDE the block are kept verbatim.
    let mut lines: Vec<String> = submitted.lines().map(str::to_string).collect();
    while lines.first().is_some_and(|l| l.trim().is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.trim().is_empty()) {
        lines.pop();
    }
    if lines.first().is_some_and(|l| l.trim() == "---") {
        lines.remove(0);
        if lines.last().is_some_and(|l| l.trim() == "---") {
            lines.pop();
        }
    }
    if lines.iter().any(|l| l.trim() == "---") {
        return Err("the metadata block can't contain a bare --- line".into());
    }

    // reserved provenance: the output's id/owner/created lines must be EXACTLY
    // the original's — present ↔ present (same bytes), absent ↔ absent.
    // Reserved-key match mirrors parse_fields EXACTLY (UNtrimmed key): an
    // INDENTED `  created:` under a nested map is a foreign line to the codec,
    // so it must be foreign here too — field_key's trim misclassified it as
    // the top-level reserved line and deleted/replaced it (2026-07-01 review).
    let is_key = |line: &str, key: &str| line.split_once(':').is_some_and(|(k, _)| k == key);
    let mut restore: Vec<&str> = Vec::new();
    for key in RAW_IMMUTABLE_KEYS {
        let orig = orig_lines.iter().copied().find(|l| is_key(l, key));
        let typed = lines.iter().position(|l| is_key(l, key));
        match (orig, typed) {
            (Some(o), Some(i)) => {
                lines[i] = o.to_string();
                // duplicates beyond the first are dropped (keep the restored one)
                let mut seen = 0usize;
                lines.retain(|l| {
                    if is_key(l, key) {
                        seen += 1;
                        seen == 1
                    } else {
                        true
                    }
                });
            }
            // dropped → collect, re-inserted at the top in id/created/owner order
            (Some(o), None) => restore.push(o),
            // invented → a user can't mint provenance; the line goes
            (None, Some(_)) => lines.retain(|l| !is_key(l, key)),
            (None, None) => {}
        }
    }
    for line in restore.into_iter().rev() {
        lines.insert(0, line.to_string());
    }

    // an emptied block: with nothing reserved to restore the fences go too
    if lines.is_empty() {
        return Ok(if orig_block.is_empty() { original.to_string() } else { body.to_string() });
    }
    let mut out = String::with_capacity(body.len() + submitted.len() + 16);
    out.push_str("---\n");
    for l in &lines {
        out.push_str(l);
        out.push('\n');
    }
    out.push_str("---\n");
    out.push_str(body);
    Ok(out)
}

// ─── shelf-projection (v3.5) ─────────────────────────────────────────────────
// The disk is the AI's strict structure; the user's VIEW groups notes by their
// `shelf:` (the folder the human put it in), never by the disk path — so a note
// that physically lives in wiki/ (or wiki/_inbox staging) appears under "Inbox" or
// "Myela/Payments" and the user never feels it lives in wiki/. We read the shelf
// from the PRESERVED foreign frontmatter lines (parse_fields/compose_document stay
// untouched, so the byte-exact round-trip + every frontmatter test is unaffected).

/// The user's shelf(s) from a note's frontmatter — `shelf: [a, b]` (or a bare
/// `shelf: a`). Empty/absent ⇒ `[]`. Read-only; the disk file is never rewritten.
fn shelf_of(fm: &Frontmatter) -> Vec<String> {
    for line in &fm.foreign {
        if let Some(rest) = line.trim_start().strip_prefix("shelf:") {
            let v = rest.trim();
            let inner = v
                .strip_prefix('[')
                .and_then(|s| s.strip_suffix(']'))
                .unwrap_or(v);
            return inner
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
    }
    Vec::new()
}

/// The folder a note is PROJECTED into. In a Memex, a `wiki/` note appears under
/// its PRIMARY shelf (the user's view) when one is set; otherwise it falls back to
/// its disk folder (a curated note with no shelf yet stays where it lives on disk).
/// Everything outside a memex's wiki/, and the whole local corpus, is unaffected.
fn project_folder(layout: Layout, disk_folder: &str, fm: &Frontmatter) -> String {
    if layout == Layout::Memex {
        // storage/ binaries surface under the reserved "Storage" destination
        if disk_folder == "storage" || disk_folder.starts_with("storage/") {
            return "Storage".to_string();
        }
        if disk_folder == "wiki" || disk_folder.starts_with("wiki/") {
            if let Some(primary) = shelf_of(fm).into_iter().next() {
                // the default capture shelf "Inbox" is the ONE Captures surface — route
                // it to the reserved "Board" root the sidebar reads as "Captures" (Seth,
                // 2026-06-30); a real user shelf (Myela/Payments) still projects to it.
                return if primary == "Inbox" { "Board".to_string() } else { primary };
            }
        }
    }
    disk_folder.to_string()
}

/// Synthesize a `FolderMeta` (and every ancestor) for any note `folder_id` that has
/// no backing folder — i.e. a shelf path projected from frontmatter (the dir it
/// physically lives in is wiki/, not the shelf). Idempotent + dedup'd via `known`.
/// A no-op for the local corpus, where every note's folder_id is a walked directory.
fn ensure_backing_folders(folders: &mut Vec<FolderMeta>, notes: &[NoteMeta]) {
    let mut known: HashSet<String> = folders.iter().map(|f| f.id.clone()).collect();
    for n in notes {
        let mut path = n.folder_id.clone();
        while !path.is_empty() && !known.contains(&path) {
            let (parent, name): (Option<String>, String) = match path.rsplit_once('/') {
                Some((p, nm)) => (Some(p.to_string()), nm.to_string()),
                None => (None, path.clone()),
            };
            folders.push(FolderMeta { id: path.clone(), name, parent_id: parent.clone() });
            known.insert(path.clone());
            path = parent.unwrap_or_default();
        }
    }
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
    // `![alt](url)` → alt (or "Image" when the alt is empty) and `[text](url)` →
    // text — a note that STARTS with an image reads as a human title, never the
    // raw markdown (render-only: the .md file is untouched). Images first, then
    // links, in lockstep with derive.ts stripMarkdown.
    let reduced = reduce_md_links(&reduce_md_links(s, true), false);
    let cleaned: String =
        reduced.chars().filter(|c| !matches!(c, '*' | '_' | '`')).collect();
    cleaned.trim().to_string()
}

/// One reduction pass over `[label](url)` spans — `image` selects the `![…](…)`
/// form. The label runs to the FIRST `]`, the url to the FIRST `)` (mirroring
/// the derive.ts regexes `!\[([^\]]*)\]\(([^)]*)\)` / `\[([^\]]*)\]\(([^)]*)\)`
/// — the twins MUST stay in lockstep; derive.test.ts guards it). Malformed
/// spans pass through untouched; an image with an EMPTY alt reads "Image" so a
/// bare `![](…)` never yields an empty title.
fn reduce_md_links(s: &str, image: bool) -> String {
    let b: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        let lb = if image {
            if b[i] == '!' && b.get(i + 1) == Some(&'[') {
                i + 1
            } else {
                out.push(b[i]);
                i += 1;
                continue;
            }
        } else if b[i] == '[' {
            i
        } else {
            out.push(b[i]);
            i += 1;
            continue;
        };
        let Some(rb) = (lb + 1..b.len()).find(|&j| b[j] == ']') else {
            out.push(b[i]);
            i += 1;
            continue;
        };
        if b.get(rb + 1) != Some(&'(') {
            out.push(b[i]);
            i += 1;
            continue;
        }
        let Some(rp) = (rb + 2..b.len()).find(|&j| b[j] == ')') else {
            out.push(b[i]);
            i += 1;
            continue;
        };
        let label: String = b[lb + 1..rb].iter().collect();
        if image && label.is_empty() {
            out.push_str("Image");
        } else {
            out.push_str(&label);
        }
        i = rp + 1;
    }
    out
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

// ─── full-text search (corpus_search) ────────────────────────────────────────

/// One full-text hit on the wire (camelCase → src/types.ts SearchHit). `rank`
/// 0 = title hit (matchStart/matchLen index the TITLE; `snippet` is the stored
/// list snippet), 1 = body hit (offsets index the returned `snippet` window).
/// Offsets are CHAR counts (code points), never bytes/UTF-16 units.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub folder_id: String,
    pub kind: NoteKind,
    pub rank: u8,
    pub snippet: String,
    pub match_start: usize,
    pub match_len: usize,
    pub updated_at: i64,
}

/// The pure core of one hit — what `search_match` derives from a query + note.
pub struct SearchMatch {
    pub rank: u8,
    pub snippet: String,
    pub match_start: usize,
    pub match_len: usize,
}

/// Context chars on each side of a body match in the snippet window.
const SNIPPET_CTX: usize = 60;

/// Per-char case fold: the FIRST char of each lowercase expansion — strictly
/// 1:1, so a char offset in the folded text equals the offset in the original.
/// TS twin: `fold` in src/services/search.ts.
fn fold_chars(s: &str) -> Vec<char> {
    s.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect()
}

/// Char offset of the first occurrence of `needle` in `hay` (both pre-folded).
fn find_ci(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()] == *needle)
}

/// The ranking + snippet grammar (pure, unit-tested). Title match beats body
/// match. A body hit gets a ±60-char window around the FIRST match: newlines
/// flatten to spaces, emphasis chars (`*` `_` `` ` ``) are stripped OUTSIDE the
/// matched span (inside stays verbatim so the offsets always frame exactly what
/// matched), "…" marks a clipped edge. MUST stay in lockstep with searchMatch
/// in src/services/search.ts (search.test.ts mirrors these vectors).
pub fn search_match(
    query: &str,
    title: &str,
    body: &str,
    stored_snippet: &str,
) -> Option<SearchMatch> {
    let q = fold_chars(query.trim());
    if q.is_empty() {
        return None;
    }
    if let Some(i) = find_ci(&fold_chars(title), &q) {
        return Some(SearchMatch {
            rank: 0,
            snippet: stored_snippet.to_string(),
            match_start: i,
            match_len: q.len(),
        });
    }
    let chars: Vec<char> = body.chars().collect();
    let i = find_ci(&fold_chars(body), &q)?;
    let start = i.saturating_sub(SNIPPET_CTX);
    let end = (i + q.len() + SNIPPET_CTX).min(chars.len());
    let mut snippet = String::new();
    let mut match_start = i - start;
    if start > 0 {
        snippet.push('…');
        match_start += 1;
    }
    for (w, &c) in chars[start..end].iter().enumerate() {
        let in_match = w >= i - start && w < i - start + q.len();
        if !in_match && matches!(c, '*' | '_' | '`') {
            if w < i - start {
                match_start -= 1;
            }
            continue;
        }
        snippet.push(if matches!(c, '\n' | '\r' | '\t') { ' ' } else { c });
    }
    if end < chars.len() {
        snippet.push('…');
    }
    Some(SearchMatch { rank: 1, snippet, match_start, match_len: q.len() })
}

/// Trash and its subtree only — the ONE root search never surfaces (Archive
/// stays findable; restore is what resurrects Trash).
fn is_trash_folder(folder: &str) -> bool {
    folder == "Trash" || folder.starts_with("Trash/")
}

/// A memex chats/ transcript — the Chat front (All chats) owns that domain;
/// transcripts never ride note search or note listings. MEMEX layout only:
/// in a plain (LegacyRotli) root there is no Chat front, so a user folder
/// that happens to be named "chats" is just a folder — callers gate on layout.
fn is_chats_folder(folder: &str) -> bool {
    folder == "chats" || folder.starts_with("chats/")
}

/// rank asc (title hits first) → recency desc → id asc (deterministic wire).
fn sort_hits(hits: &mut [SearchHit]) {
    hits.sort_by(|a, b| {
        a.rank
            .cmp(&b.rank)
            .then(b.updated_at.cmp(&a.updated_at))
            .then(a.id.cmp(&b.id))
    });
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

/// Make a dropped file's name safe for a `storage:` link: slugify the STEM
/// (lowercase, non-alnum → single `-`) and keep the lowercased extension. A
/// spaced/exotic name (e.g. macOS "Screenshot 2026-… AM.png") otherwise becomes
/// a `storage:` link that breaks markdown AND the memex asset regex
/// `[A-Za-z0-9._/-]` — the validator then reads it as a broken ref (Seth,
/// 2026-07-03: the recurring Breve check-up failures).
fn sanitize_asset_name(raw: &str) -> String {
    let p = Path::new(raw);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(raw);
    let slug = slugify(stem);
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) if !e.is_empty() => format!("{slug}.{}", e.to_ascii_lowercase()),
        _ => slug,
    }
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
    /// Any other file (image, pdf, txt, …) — surfaced READ-ONLY so the folder
    /// (e.g. Storage) shows what's really in it; id == its relative path. Opened
    /// in the OS default app, never the markdown editor.
    File,
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
    atomic_write_bytes(path, contents.as_bytes())
}

/// The bytes flavor — the spreadsheet editor saves a binary (.xlsx) through the
/// same tempfile+rename discipline, so a crash mid-save never corrupts the workbook.
fn atomic_write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| format!("no parent dir for {}", path.display()))?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".rotli-write-")
        .tempfile_in(dir)
        .map_err(|e| format!("temp file in {}: {e}", dir.display()))?;
    tmp.write_all(contents)
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
///   • `Memex` — the root IS someone's memex spine (for Seth, `~/memex-vault`). Only
///     `chats/` is writable + surfaced read-write; `wiki/` is read-only; `identity/`,
///     `personality/`, `history/`, `MAP.md`, `inbox.md` and every control file stay HIDDEN. No
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
/// (identity/personality/history/MAP/inbox) and every memex-vault control file. Top-level memex-vault
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
    // wiki/_inbox — rotli's note STAGING (v3.5): writable, so a projected note can
    // be edited in place. Must precede the wiki/ rule below (which is read-only).
    if rel == "wiki/_inbox" || rel.starts_with("wiki/_inbox/") {
        return Surface::NoteRW;
    }
    // Archive/ + Trash/ — rotli's LIFECYCLE sinks (capitalized, matching the TS
    // destinations + is_hidden_root). A note the user archives/trashes lands in
    // these rotli-owned dirs at the memex root; they're never the curated
    // knowledge, so lifecycle moves are a sanctioned write lane even in a memex.
    // Without this, archive/trash silently no-op in a memex (Seth, 2026-07-07).
    if is_hidden_root(rel) {
        return Surface::NoteRW;
    }
    // wiki/ — browsable folders; the curated rest is read-only (only _inbox writes)
    if rel == "wiki" || rel.starts_with("wiki/") {
        return Surface::NoteRO;
    }
    // storage/excalidraw/ — the memex's BOARD lane (Seth, 2026-07-07). Excalidraw
    // scenes rotli creates + edits live here, so they're WRITABLE even though the
    // rest of storage/ (foreign binary drops) stays read-only below. Must precede
    // the storage/ rule. A board is rotli's own content, not a foreign asset.
    if rel == "storage/excalidraw" || rel.starts_with("storage/excalidraw/") {
        return Surface::NoteRW;
    }
    // storage/ — the memex's gitignored binary asset store; surfaced READ-ONLY so
    // the Storage front shows your files (projected to the Storage destination,
    // opened in the OS default app). NEVER written via the note path (is_writable
    // refuses it); binaries are written by the storage/ drop command instead.
    if rel == "storage" || rel.starts_with("storage/") {
        return Surface::NoteRO;
    }
    // everything else inside a memex is hidden from the Notes tree and unwritable:
    // identity/ personality/ history/ archive/ trash/, MAP.md, inbox.md, and all control
    // files (memex.json, users.json, *.local.json, *.json at root, clients/,
    // scripts/, STRUCTURE/CONFIG/README/CHANGELOG/ASSETS .md, …).
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
    /// (allow(dead_code): only read by `purge`, whose command was unregistered
    /// in the 2026-07 audit (#68) — both stay for the future "Empty Trash".)
    #[allow(dead_code)]
    os_trash: bool,
    /// How this root is shaped (Increment 3). LegacyRotli = today's behavior in
    /// every respect; Memex gates folders/ownership/scope. Decided at `open()`.
    layout: Layout,
    /// Contract-band verdict, decided at `open_memex` (#3, audit 2026-07): a memex
    /// whose contract is OUTSIDE rotli's supported band opens read-only — never
    /// write a contract rotli wasn't built for. Both write gates consult it.
    band_read_only: bool,
    /// User-set "read-only" perms for a connected brain (corpus.json) — carried
    /// into the store so the Rust gates enforce it, not only the TS `canWrite`
    /// (#3, audit 2026-07). Never cleared below the band verdict.
    perms_read_only: bool,
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
            band_read_only: false,
            perms_read_only: false,
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
    /// dot-prefixed `.rotli/` sidecar (walk + memex-vault's validate.ts both skip
    /// dot-entries, so it never pollutes the brain) and load the index — but
    /// SKIP `ensure_reserved_folders` and SKIP `first_run`: rotli must never
    /// scaffold its Inbox/Vault/Storage/… inside someone's memex-vault. Layout::Memex
    /// then keeps every write off self/history/wiki/MAP/inbox + control files.
    fn open_memex(root: PathBuf) -> Result<Self, String> {
        let root = fs::canonicalize(&root)
            .map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        fs::create_dir_all(root.join(DOT_DIR))
            .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;

        // The contract band decides writability AT OPEN (#3): out-of-band ⇒ every
        // write refused in Rust, matching the TS read-only verdict (brain_view).
        let band_read_only = !crate::memex::contract_in_band_at(&root);
        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::Memex,
            band_read_only,
            perms_read_only: false,
        };
        store.load_index();
        Ok(store)
    }

    /// Apply a connected brain's USER-SET "read-only" perms to the live store —
    /// called at startup (from corpus.json) and when Settings flips the perms.
    /// Only ever narrows on top of the band verdict (band read-only can't be
    /// un-done by generous perms).
    pub fn set_perms_read_only(&mut self, read_only: bool) {
        self.perms_read_only = read_only;
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn suppress_set(&self) -> SuppressSet {
        self.suppress.clone()
    }

    /// Whether this root IS a memex spine — the one territory the organizer
    /// daemon may run over (the Filer lane only exists there, contract v3.7).
    pub fn is_memex(&self) -> bool {
        self.layout == Layout::Memex
    }

    /// Import an external file (a dropped binary) into the store's binary area —
    /// the memex `storage/` (Memex) or the reserved `Storage/` folder (Legacy).
    /// COPIES the source (never moves it), collision-safe, returns the new relative
    /// path. The sanctioned binary-asset write (model.md: a dropped file routes to
    /// storage/) — NOT a note write; it can only ever land in the binary area.
    pub fn import_file(&self, src: &Path) -> Result<String, String> {
        let subdir = match self.layout {
            Layout::Memex => "storage",
            Layout::LegacyRotli => "Storage",
        };
        let raw = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("the dropped file has no readable name")?;
        // slugify the name so the returned `storage:` link is markdown- and
        // validator-safe (no spaces — see sanitize_asset_name).
        let safe = sanitize_asset_name(raw);
        let dir = self.root.join(subdir);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // `safe` is a single clean component; free_name picks the first uncollided
        // rel under the binary subdir and derives its extension.
        let rel = self.free_name(subdir, &safe, None);
        fs::copy(src, self.abs(&rel)).map_err(|e| format!("import {}: {e}", src.display()))?;
        Ok(rel)
    }

    /// Size + user-lane writability of a surfaced file — the sheet editor decides
    /// read-only vs editable UP FRONT (a memex/linked-library file must never offer
    /// a Save it would refuse; a file over the read cap must never be written back
    /// from a truncated parse).
    pub fn file_stat(&self, rel: &str) -> Result<FileStat, String> {
        validate_rel(rel)?;
        let abs = self.abs(rel);
        let meta = fs::metadata(&abs).map_err(|e| format!("stat {rel}: {e}"))?;
        if !meta.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        Ok(FileStat {
            len: meta.len(),
            // an existing storage/ sheet is editable in place (storage_sheet_editable)
            // even though the contract's writable() refuses the storage lane at large
            writable: self.writable(rel).is_ok() || self.storage_sheet_editable(rel),
        })
    }

    /// Overwrite a surfaced FILE's raw bytes — the spreadsheet editor's SAVE lane.
    /// Same per-store `writable()` gate as every user write, PLUS the sanctioned
    /// storage-sheet exception (storage_sheet_editable): an existing `.xlsx`/`.csv`
    /// in a memex's storage/ edits in place, the way storage/excalidraw already does.
    /// Overwrite ONLY — a missing file is an error, never a create (creation goes
    /// through import/new_file_bytes). `bak`: copy the original to `<name>.bak`
    /// once, before the FIRST rotli save — exceljs rewrites the whole workbook and
    /// can drop exotic features (pivots, charts), so the pre-rotli bytes survive.
    pub fn write_file_bytes(&mut self, rel: &str, bytes: &[u8], bak: bool) -> Result<(), String> {
        validate_rel(rel)?;
        // the contract gate — unless this is the sanctioned in-place edit of an
        // existing storage/ sheet (storage_sheet_editable), which the note lanes
        // still refuse. Overwrite-only is preserved by the is_file() check below.
        if !self.storage_sheet_editable(rel) {
            self.writable(rel)?;
        }
        let abs = self.abs(rel);
        if !abs.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        if bak {
            let bak_abs = abs.with_file_name(format!(
                "{}.bak",
                abs.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            ));
            if !bak_abs.exists() {
                fs::copy(&abs, &bak_abs).map_err(|e| format!("backup {rel}: {e}"))?;
            }
        }
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)
    }

    /// Create a NEW file from raw bytes in `folder` — the csv → xlsx convert
    /// writes the sibling workbook here. Collision-safe via free_name (never
    /// clobbers); same writable() gate. Returns the new file's rel path.
    pub fn new_file_bytes(&mut self, folder: &str, name: &str, bytes: &[u8]) -> Result<String, String> {
        if !folder.is_empty() {
            validate_rel(folder)?;
        }
        validate_component(name)?;
        let rel = self.free_name(folder, name, None);
        self.writable(&rel)?;
        if !folder.is_empty() {
            fs::create_dir_all(self.abs(folder)).map_err(|e| format!("create folder {folder}: {e}"))?;
        }
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)?;
        Ok(rel)
    }

    /// Read a note's frontmatter for the metadata panel — the typed facts plus the
    /// lock state and every foreign line (shelf/reach/area/summary/tags/links/…).
    /// Takes a wire id OR a rel path (resolve_note_rel): a `.md` note travels the
    /// wire as its frontmatter ULID, and reading "<root>/<ULID>" off disk was the
    /// metadata panel's "No such file or directory" (Seth, 2026-07-01).
    fn read_frontmatter(&mut self, id_or_rel: &str) -> Result<FrontmatterView, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm_opt, body) = parse_document(&text);
        let mut fm = fm_opt.unwrap_or_default();
        let locked = fm.foreign.iter().any(|l| locked_field(l) == Some(true));
        let mut secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true));
        // auto-flag: secrets detected + not yet marked → set secure:true + gitignore.
        // The detector is the regex pass today; the local LLM refines it later.
        // BEST-EFFORT on this READ path: persist + gitignore, but a write/gitignore
        // hiccup must NEVER break reading the metadata — that left the panel stuck on
        // "Reading…" (Seth, 2026-06-30). We still report secure=true (the safe
        // direction); the explicit set_secure path keeps hard-failing for the user.
        if !secure && looks_secure(body) {
            fm.foreign.push("secure: true".to_string());
            if let Err(e) =
                atomic_write(&path, &compose_document(&fm, body)).and_then(|()| self.gitignore_add(rel))
            {
                eprintln!("auto-secure-flag (read) failed for {rel}: {e}");
            }
            secure = true;
        }
        let fields = fm
            .foreign
            .iter()
            // hide RESERVED keys (locked/secure/owner/…) from the user's editor —
            // they're managed by rotli, not hand-edited (v3.7).
            .filter(|l| !l.trim().is_empty() && field_key(l).map_or(true, |k| !RESERVED_KEYS.contains(&k)))
            .cloned()
            .collect();
        Ok(FrontmatterView {
            id: fm.id.unwrap_or_default(),
            created: fm.created.unwrap_or_default(),
            updated: fm.updated.unwrap_or_default(),
            locked,
            secure,
            pinned: fm.pinned.unwrap_or(false),
            fields,
        })
    }

    /// Toggle the per-note AI lock — a `locked: true` frontmatter line the eventual
    /// AI filer must respect. Preserves the body + every other frontmatter line.
    /// Takes a wire id OR a rel path (resolve_note_rel — same bridge as the filer lane).
    /// SANCTIONED writable() exception (#22): `locked` is a rotli-managed CONTROL
    /// flag, and locking a curated wiki note against the filer must work even
    /// where the user can't edit the note itself.
    fn set_locked(&mut self, id_or_rel: &str, locked: bool) -> Result<(), String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.retain(|l| locked_field(l).is_none());
        if locked {
            fm.foreign.push("locked: true".to_string());
        }
        atomic_write(&path, &compose_document(&fm, body))
    }

    /// Toggle the per-note PIN — the typed `pinned` frontmatter fact that floats
    /// a note to the top of every list (the list sort is pinned → updated → id).
    /// Preserves the body + every other frontmatter line, and — unlike `write` —
    /// does NOT bump `updated`, so pinning never reorders the note by recency.
    /// Takes a wire id OR a rel path (resolve_note_rel). SANCTIONED writable()
    /// exception, like set_locked: `pinned` is a rotli-managed typed fact every
    /// note already carries, so pinning works even on curated notes the user
    /// can't body-edit.
    fn set_pinned(&mut self, id_or_rel: &str, pinned: bool) -> Result<(), String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.pinned = Some(pinned);
        atomic_write(&path, &compose_document(&fm, body))
    }

    /// Set (or, with an empty value, remove) a foreign frontmatter field — the
    /// metadata panel's editor, i.e. the USER lane. Reserved keys AND the AI
    /// Filer's keys are off-limits (#22, audit 2026-07: the two lanes'
    /// territories must stay disjoint in BOTH directions), and the same
    /// `writable()` gate as every editor save applies — the user can't edit
    /// fields on curated wiki notes they can't write. Preserves the body and
    /// every other frontmatter line. Takes a wire id OR a rel path
    /// (resolve_note_rel — same bridge as the filer lane).
    fn set_field(&mut self, id_or_rel: &str, key: &str, value: &str) -> Result<(), String> {
        let key = key.trim();
        if key.is_empty() {
            return Err("a field needs a name".into());
        }
        if RESERVED_KEYS.contains(&key) {
            return Err(format!("`{key}` is managed by rotli, not editable here"));
        }
        if AI_KEYS.contains(&key) {
            return Err(format!("`{key}` belongs to the AI filer — not editable here"));
        }
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.writable(rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.retain(|l| field_key(l) != Some(key));
        let value = value.trim();
        if !value.is_empty() {
            fm.foreign.push(format!("{key}: {value}"));
        }
        self.suppress.mark(&path);
        atomic_write(&path, &compose_document(&fm, body))
    }

    /// The note's frontmatter as RAW TEXT (fences included), byte-exact from
    /// disk; "" when the note has none. The "Show file metadata" view renders
    /// this above the body — the metadata IS the top of the file, not a form.
    fn raw_frontmatter(&mut self, id_or_rel: &str) -> Result<String, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(&rel)).map_err(|e| e.to_string())?;
        Ok(raw_frontmatter_block(&text).to_string())
    }

    /// Write back a user-edited raw frontmatter block. merge_raw_frontmatter
    /// keeps the typed lines verbatim but restores the reserved provenance keys
    /// (id/owner/created) from the file; the body is untouched and `updated` is
    /// NOT bumped (a metadata edit never reorders the list). Gated by the same
    /// user-writability as every editor save — curated wiki/** refuses (v3.7).
    /// Because `secure:` can be typed here, the gitignore stays in step the same
    /// way set_secure keeps it (secure ⇒ gitignored, cleared ⇒ un-ignored).
    fn write_frontmatter_raw(&mut self, id_or_rel: &str, block: &str) -> Result<(), String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        self.writable(&rel)?;
        let path = self.abs(&rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let out = merge_raw_frontmatter(&text, block)?;
        if out == text {
            return Ok(()); // byte-identical — no write, no watcher echo
        }
        let was_secure = |t: &str| {
            parse_document(t)
                .0
                .unwrap_or_default()
                .foreign
                .iter()
                .any(|l| secure_field(l) == Some(true))
        };
        let (before, after) = (was_secure(&text), was_secure(&out));
        self.suppress.mark(&path);
        atomic_write(&path, &out)?;
        if after && !before {
            self.gitignore_add(&rel)?;
        } else if before && !after {
            self.gitignore_remove(&rel)?;
        }
        Ok(())
    }

    /// Append a path to the corpus `.gitignore` (idempotent) — a secure note must
    /// never be pushed when the corpus is a git repo. The write error PROPAGATES: a
    /// note marked secure whose `.gitignore` write failed would silently stay
    /// committable, so set_secure must learn about it (Seth, 2026-06-30 — audit).
    fn gitignore_add(&self, rel: &str) -> Result<(), String> {
        let path = self.root.join(".gitignore");
        let existing = fs::read_to_string(&path).unwrap_or_default();
        if existing.lines().any(|l| l.trim() == rel) {
            return Ok(());
        }
        let mut out = existing;
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(rel);
        out.push('\n');
        atomic_write(&path, &out)
    }

    /// Remove a path from the corpus `.gitignore` — called when a note's secure flag
    /// is cleared, so it isn't left needlessly ignored (the symmetric counterpart of
    /// gitignore_add). No-op when there's no `.gitignore` or the line isn't present.
    fn gitignore_remove(&self, rel: &str) -> Result<(), String> {
        let path = self.root.join(".gitignore");
        let Ok(existing) = fs::read_to_string(&path) else {
            return Ok(());
        };
        if !existing.lines().any(|l| l.trim() == rel) {
            return Ok(());
        }
        let kept: Vec<&str> = existing.lines().filter(|l| l.trim() != rel).collect();
        let mut out = kept.join("\n");
        if !out.is_empty() {
            out.push('\n');
        }
        atomic_write(&path, &out)
    }

    /// Make `.rotli/main.json` git-committable while the rest of `.rotli/` stays
    /// ignored. Unlike the deletable index/settings sidecar, the Main arrangement is
    /// hand-organized user work that should travel with the memex (Seth, 2026-07-01).
    /// A bare `.rotli/` line ignores the whole dir — and git CANNOT re-include a file
    /// under an ignored dir — so narrow it to `.rotli/*` and add `!.rotli/main.json`.
    /// Idempotent; a no-op outside a git corpus.
    fn ensure_main_committable(&self) -> Result<(), String> {
        let path = self.root.join(".gitignore");
        if !path.exists() && !self.root.join(".git").exists() {
            return Ok(());
        }
        let existing = fs::read_to_string(&path).unwrap_or_default();
        let mut lines: Vec<String> = existing.lines().map(str::to_string).collect();
        let mut changed = false;
        for l in lines.iter_mut() {
            if l.trim() == ".rotli/" || l.trim() == ".rotli" {
                *l = ".rotli/*".to_string();
                changed = true;
            }
        }
        if !lines.iter().any(|l| l.trim() == ".rotli/*") {
            lines.push(".rotli/*".to_string());
            changed = true;
        }
        if !lines.iter().any(|l| l.trim() == "!.rotli/main.json") {
            lines.push("!.rotli/main.json".to_string());
            changed = true;
        }
        if changed {
            let mut out = lines.join("\n");
            out.push('\n');
            atomic_write(&path, &out)?;
        }
        Ok(())
    }

    /// Toggle the per-note SECURE flag. When set, the note's path is gitignored so a
    /// pushed vault never leaks it. Preserves the body + every other frontmatter line.
    /// Takes a wire id OR a rel path (resolve_note_rel) — the gitignore line must be
    /// the note's PATH, never its ULID.
    /// SANCTIONED writable() exception (#22): `secure` is a rotli-managed CONTROL
    /// flag (like the auto-flag on the read path) — marking a note secure must
    /// never be refused by the user-lane gate.
    fn set_secure(&mut self, id_or_rel: &str, secure: bool) -> Result<(), String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.retain(|l| secure_field(l).is_none());
        if secure {
            fm.foreign.push("secure: true".to_string());
        }
        atomic_write(&path, &compose_document(&fm, body))?;
        if secure {
            self.gitignore_add(rel)?;
        } else {
            self.gitignore_remove(rel)?;
        }
        Ok(())
    }

    /// Read a note FOR an AI model. A SECURE note (secrets detected) is refused to a
    /// REMOTE model — its content must never leave the device; a local model is fine.
    /// The `secure:` flag is checked first; when it's ABSENT the secret DETECTOR
    /// runs on the body too (#21, audit 2026-07) — the auto-flag only fires when
    /// the metadata panel is opened, so a never-inspected note with detectable
    /// secrets must not slip through on the flag alone.
    /// Takes a wire id OR a rel path (resolve_note_rel — same bridge as the filer lane).
    fn read_for_ai(&mut self, id_or_rel: &str, model_is_local: bool) -> Result<String, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(rel)).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let secure = fm
            .unwrap_or_default()
            .foreign
            .iter()
            .any(|l| secure_field(l) == Some(true))
            || looks_secure(body);
        if secure && !model_is_local {
            return Err(
                "This note is marked secure (it contains secrets) and can't be sent to a remote model — switch to a local model to read it.".into(),
            );
        }
        Ok(text)
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
    /// Inbox, Vault, Storage, Board, Archive, Trash — scaffolded on disk so they
    /// exist even on a corpus that predates them. Called unconditionally from
    /// `open` (LegacyRotli ONLY — `open_memex` skips it, so a memex root is never
    /// scaffolded); `create_dir_all` is a no-op when a dir is already there, so
    /// this is fully idempotent. Empty reserved dirs surface as zero-note folders
    /// via `walk`; the TS layer decides which double as fixed destinations vs.
    /// plain folders.
    ///
    /// Brain → Vault rename (Track 2, 2026-06-24): "Brain" is no longer a
    /// reserved local row — the Vault is now an EXTERNAL root (a memex). An
    /// existing on-disk `Brain/` folder is NEVER moved, renamed, or deleted; it
    /// simply stops being scaffolded and surfaces as a plain folder via `walk`
    /// (Invariant 4 — no data loss). (Seth, 2026-06-13 / 2026-06-24)
    fn ensure_reserved_folders(&self) -> Result<(), String> {
        for name in ["Inbox", "Vault", "Storage", "Board", "Archive", "Trash"] {
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
        // #3 (audit 2026-07): perms + contract band are enforced HERE, not only in
        // the TS canWrite — a user-set read-only brain and an out-of-band contract
        // both refuse every user write.
        if self.band_read_only {
            return Err(
                "this brain's contract is outside the band rotli supports — it opens read-only".into(),
            );
        }
        if self.perms_read_only {
            return Err(
                "this brain is connected read-only — allow writes in Settings → Location first".into(),
            );
        }
        if self.layout == Layout::LegacyRotli {
            return Ok(());
        }
        match surfaced(self.layout, rel) {
            Surface::NoteRW => Ok(()),
            _ => Err(format!(
                "this location is read-only to rotli in a memex — it writes chats, note staging, and boards (refused: {})",
                if rel.is_empty() { "<root>" } else { rel }
            )),
        }
    }

    /// A memex `storage/` binary is contract-read-only (the note lanes never write
    /// it — foreign assets are mirrored, not owned). But a user editing an EXISTING
    /// spreadsheet they dropped there is a deliberate, IN-PLACE overwrite — the same
    /// reasoning that already makes `storage/excalidraw` a writable board lane. This
    /// SANCTIONED exception (Seth, 2026-07-08) lets the sheet editor's Save — and the
    /// file_stat that gates edit mode — overwrite an existing `.xlsx`/`.csv` in
    /// storage. It NEVER widens to: new-file creation (new_file_bytes still refuses
    /// storage), note writes, or any non-sheet file — and it still yields to a
    /// band/perms read-only brain (checked in `writable`, mirrored here).
    fn storage_sheet_editable(&self, rel: &str) -> bool {
        if self.layout != Layout::Memex || self.band_read_only || self.perms_read_only {
            return false;
        }
        // excalidraw is already its own writable lane — this is for foreign sheets.
        if rel == "storage/excalidraw" || rel.starts_with("storage/excalidraw/") {
            return false;
        }
        if rel != "storage" && !rel.starts_with("storage/") {
            return false;
        }
        let ext = Path::new(rel)
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        matches!(ext.as_deref(), Some("xlsx") | Some("csv")) && self.abs(rel).is_file()
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
        // shelf-projection (v3.5): notes re-homed onto a shelf path need that shelf
        // folder (+ ancestors) to exist in the tree. A no-op for the local corpus.
        ensure_backing_folders(&mut folders, &notes);
        folders.sort_by(|a, b| a.id.cmp(&b.id));
        notes.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then(b.updated_at.cmp(&a.updated_at))
                .then(a.id.cmp(&b.id))
        });
        Ok(CorpusList { folders, notes })
    }

    /// Case-insensitive FULL-TEXT search over this root's notes: one `list()`
    /// pass for fresh metas + a body read per note through the index — the same
    /// cost class as a sidebar refresh (list() already re-reads every body).
    /// Scope: kind Note only (boards are scene JSON, files are binary), never
    /// Trash (gone until restored), never a MEMEX root's chats/ (the Chat front
    /// owns transcripts; a plain root's "chats" folder is just a folder and
    /// stays findable) — Archive and staged/wiki/Vault notes stay findable.
    /// `secure:` notes stay in: search is a LOCAL user read (contract v3.7
    /// gates AI reads, not the user's own eyes); bodies are never logged.
    pub fn search(&mut self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let mut hits: Vec<SearchHit> = Vec::new();
        if query.trim().is_empty() {
            return Ok(hits);
        }
        let list = self.list()?;
        for meta in &list.notes {
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || (self.layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let Some(rel) = self.index.get(&meta.id) else { continue };
            let Ok(text) = fs::read_to_string(self.abs(rel)) else { continue };
            let (fm, raw) = parse_document(&text);
            let body = match &fm {
                Some(_) => editor_body(raw),
                None => raw,
            };
            if let Some(m) = search_match(query, &meta.title, body, &meta.snippet) {
                hits.push(SearchHit {
                    id: meta.id.clone(),
                    title: meta.title.clone(),
                    folder_id: meta.folder_id.clone(),
                    kind: meta.kind,
                    rank: m.rank,
                    snippet: m.snippet,
                    match_start: m.match_start,
                    match_len: m.match_len,
                    updated_at: meta.updated_at,
                });
            }
        }
        sort_hits(&mut hits);
        hits.truncate(limit);
        Ok(hits)
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

    /// The ULID→rel bridge: a `.md` note travels the wire as its frontmatter
    /// ULID (boards/files as rel paths), but the Filer's fs-level ops need the
    /// PATH. Accepts either — a rel path passes through, a wire id resolves via
    /// the index. Every filing entry point resolves through here so callers
    /// never have to know which shape they hold (the v0.17 deferral).
    pub fn resolve_note_rel(&mut self, id_or_rel: &str) -> Result<String, String> {
        // the passthrough must validate: this bridge fronts WRITE lanes
        // (set_field / set_locked / write_frontmatter_raw), and in LegacyRotli
        // writable() allows everything — a raw "../…" from the webview must
        // never reach disk outside the root. ULIDs are bare alphanumerics, so
        // the id path is unaffected (an invalid rel just falls to the index).
        if validate_rel(id_or_rel).is_ok() && self.abs(id_or_rel).is_file() {
            return Ok(id_or_rel.to_string());
        }
        self.path_of(id_or_rel)
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
        let disk_folder = folder_of(&rel);
        // origin is a DISK-location fact (Archive/Trash); the wire folder_id is the
        // shelf-projected view — they can differ for a memex wiki note.
        let folder = project_folder(self.layout, &disk_folder, &fm);
        Ok(NoteDoc {
            id: id.to_string(),
            origin: if is_hidden_root(&disk_folder) { fm.origin.clone() } else { None },
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
        // a memex note stays date-shaped (v3.5: updated: YYYY-MM-DD); local notes
        // keep rotli's RFC3339 stamp.
        let updated = if self.layout == Layout::Memex { today_stamp() } else { now_stamp() };

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
        // disk_folder routes the file (rename/free_name/origin); the wire
        // folder_id is the shelf-PROJECTED view, so the optimistic UI update after a
        // save lands the note under its shelf, not wiki/_inbox.
        let disk_folder = folder_of(&rel);
        let folder = project_folder(self.layout, &disk_folder, &fm);
        let current_name = Path::new(&rel)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let desired = filename_for(&title, id);
        let target_rel = if current_name == desired {
            rel.clone()
        } else {
            self.free_name(&disk_folder, &desired, Some(&rel))
        };
        let target_abs = self.abs(&target_rel);

        // #1 (audit 2026-07, CRITICAL): a SECURE note's `.gitignore` line is its
        // PATH — a title rename moves the file, so the line must follow or the
        // secret becomes committable. The NEW line lands BEFORE the file moves:
        // if the `.gitignore` write fails the rename aborts with nothing moved
        // (a "move failed" error must mean nothing moved — the file at a path
        // the ignore doesn't cover, with the index still on the old rel, was
        // the worse failure). A pre-added line for a rename that then fails is
        // a harmless stale entry.
        let is_secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true));
        if target_abs != abs && is_secure {
            self.gitignore_add(&target_rel)?;
        }
        self.suppress.mark(&target_abs);
        atomic_write(&target_abs, &text)?;
        if target_abs != abs {
            self.suppress.mark(&abs);
            let _ = fs::remove_file(&abs);
            // best-effort AFTER the move: a failed removal leaves a harmless
            // stale line, never an unprotected note — and must not report a
            // completed rename as a failure.
            if is_secure {
                let _ = self.gitignore_remove(&rel);
            }
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
            origin: if is_hidden_root(&disk_folder) { fm.origin } else { None },
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
    /// Filenames collide safely (free_name); the id is the through-line.
    pub fn move_note(&mut self, id: &str, target_folder: &str) -> Result<NoteMeta, String> {
        let rel = self.path_of(id)?;
        // BOTH ends must be writable: the note's current file (a self/ note may
        // not leave) AND its destination folder (only chats/ accepts notes in a
        // memex). LegacyRotli waves both through.
        self.writable(&rel)?;
        self.writable(target_folder)?;
        self.relocate(id, &rel, target_folder)
    }

    /// The shared move machinery behind `move_note` (USER gate) and `file_note`
    /// (FILER gate, v3.7): each caller gates BOTH ends first, then relocates here.
    /// fs-atomic, preserves id/created/foreign, does NOT bump `updated`, rewrites
    /// the id→path index.
    fn relocate(&mut self, id: &str, rel: &str, target_folder: &str) -> Result<NoteMeta, String> {
        let abs = self.abs(rel);
        let text = fs::read_to_string(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        let (fm, raw) = parse_document(&text);
        let body = match &fm {
            Some(_) => editor_body(raw),
            None => raw,
        }
        .to_string();
        let old_fm = fm.unwrap_or_default();
        let current_folder = folder_of(rel);

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
        let target_rel = self.free_name(target_folder, &desired, None);
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

        // #1 (audit 2026-07, CRITICAL): a SECURE note's `.gitignore` line is its
        // PATH — every move (user move, archive/trash, filer file/undo) must
        // carry the line along or the secret becomes committable. The NEW line
        // lands BEFORE the file moves: if the `.gitignore` write fails the move
        // aborts with nothing moved (an unwritable `.gitignore` used to fire
        // AFTER the move — the note sat at a path no ignore line covered while
        // the index still pointed at the removed old rel). A pre-added line for
        // a move that then fails is a harmless stale entry.
        let is_secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true));
        if target_abs != abs && is_secure {
            self.gitignore_add(&target_rel)?;
        }
        // both paths are OUR writes — neither should echo back as external
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        atomic_write(&target_abs, &out)?;
        if target_abs != abs {
            let _ = fs::remove_file(&abs);
            // best-effort AFTER the move: a failed removal leaves a harmless
            // stale line, never an unprotected note — and must not report a
            // completed move as a failure.
            if is_secure {
                let _ = self.gitignore_remove(rel);
            }
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

    // ─── the AI FILER — the second, narrower write lane (contract v3.7) ──────────

    /// The FILER's write gate: memex-only, and ONLY the brain (`wiki/**` — both the
    /// `_inbox` staging and the curated areas). Refuses a `locked` note (re-read
    /// FRESH so a lock set between the classify-read and the write is honored). The
    /// USER's `writable()` is unchanged — two disjoint lanes (Seth, 2026-07-01).
    fn filer_writable(&self, rel: &str) -> Result<(), String> {
        if self.layout != Layout::Memex {
            return Err("the filer only runs on a memex".into());
        }
        // #3 (audit 2026-07): the FILER lane honors the same read-only verdicts as
        // the user lane — an out-of-band contract or read-only perms close BOTH.
        if self.band_read_only {
            return Err(
                "this brain's contract is outside the band rotli supports — the filer may not write it".into(),
            );
        }
        if self.perms_read_only {
            return Err("this brain is connected read-only — the filer may not write it".into());
        }
        let rel = rel.trim_start_matches('/');
        if !(rel == "wiki" || rel.starts_with("wiki/")) {
            return Err(format!("the filer may only write the brain (refused: {rel})"));
        }
        let abs = self.abs(rel);
        if abs.is_file() {
            let text = fs::read_to_string(&abs).map_err(|e| e.to_string())?;
            let locked = parse_document(&text)
                .0
                .unwrap_or_default()
                .foreign
                .iter()
                .any(|l| locked_field(l) == Some(true));
            if locked {
                return Err("note is locked — the filer must not touch it".into());
            }
        }
        Ok(())
    }

    /// Set (empty value ⇒ remove) an AI-OWNED frontmatter field — the Filer's
    /// counterpart to `set_field`. Accepts ONLY `AI_KEYS`; refuses reserved and user
    /// keys, so the territories stay disjoint. Gated by `filer_writable`. Takes a
    /// wire id OR a rel path (resolve_note_rel). pub(crate): the organizer daemon
    /// writes through this same gate — no second write primitive.
    pub(crate) fn set_ai_field(&mut self, id_or_rel: &str, key: &str, value: &str) -> Result<(), String> {
        let key = key.trim();
        if !AI_KEYS.contains(&key) {
            return Err(format!("`{key}` is not a filer-writable field"));
        }
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.filer_writable(rel)?;
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.retain(|l| field_key(l) != Some(key));
        let value = value.trim();
        if !value.is_empty() {
            fm.foreign.push(format!("{key}: {value}"));
        }
        self.suppress.mark(&path);
        atomic_write(&path, &compose_document(&fm, body))
    }

    /// Overwrite a per-area generated overview `wiki/<area>/_index.md` — the ONLY
    /// file the Filer writes wholesale (the reserved `_index.md` name can never
    /// clobber a user note). An EMPTY body removes the file instead: undoing the
    /// FIRST applied index rewrite (journal `before` == "" — no file existed)
    /// must restore "no file", not leave a 0-byte generated husk behind. Gated
    /// by `filer_writable`. pub(crate): the organizer daemon's RefreshIndex
    /// applies through this same gate — no second write lane.
    pub(crate) fn write_index(&self, area: &str, body: &str) -> Result<(), String> {
        if area.contains('/') || area.contains("..") || area.trim().is_empty() {
            return Err(format!("invalid area: {area}"));
        }
        let dir = self.abs(&format!("wiki/{area}"));
        let rel = format!("wiki/{area}/_index.md");
        self.filer_writable(&rel)?;
        let path = self.abs(&rel);
        if body.is_empty() {
            self.suppress.mark(&path);
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("remove {rel}: {e}"))?;
            }
            return Ok(());
        }
        fs::create_dir_all(&dir).map_err(|e| format!("create wiki/{area}: {e}"))?;
        self.suppress.mark(&path);
        atomic_write(&path, body)
    }

    /// FILE a note (by wire id or rel path) into the brain per its `area` frontmatter
    /// — the Filer's move (`_inbox/…` or a wrong area → `wiki/<area>/<slug>-<id6>.md`).
    /// Gated by `filer_writable` on BOTH ends; reuses `relocate` (fs-atomic,
    /// preserves id/created/foreign, does NOT bump `updated`). The ulid for the index
    /// comes from the note's own frontmatter.
    pub fn file_note(&mut self, id_or_rel: &str) -> Result<NoteMeta, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(rel)).map_err(|e| format!("read {rel}: {e}"))?;
        let area = parse_document(&text)
            .0
            .unwrap_or_default()
            .foreign
            .iter()
            .find_map(|l| {
                let (k, v) = l.split_once(':')?;
                (k.trim() == "area").then(|| v.trim().to_string())
            })
            .filter(|a| !a.is_empty())
            .ok_or("note has no `area` to file into")?;
        if area.contains('/') || area.contains("..") {
            return Err(format!("invalid area: {area}"));
        }
        self.filer_move(rel, &format!("wiki/{area}"))
    }

    /// The Filer's GENERIC move — powers `file_note` (into `wiki/<area>`), re-filing,
    /// and UNDO (moving a filed note back). Filer-gated on both ends; reuses
    /// `relocate` (fs-atomic, preserves id, doesn't bump `updated`). The ulid comes
    /// from the note's own frontmatter.
    pub fn filer_move(&mut self, id_or_rel: &str, target_folder: &str) -> Result<NoteMeta, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.filer_writable(rel)?;
        self.filer_writable(target_folder)?;
        if folder_of(rel) == target_folder {
            return Err(format!("already in {target_folder}"));
        }
        let text = fs::read_to_string(self.abs(rel)).map_err(|e| format!("read {rel}: {e}"))?;
        let id = parse_document(&text).0.unwrap_or_default().id.ok_or("note has no id")?;
        self.relocate(&id, rel, target_folder)
    }

    /// Append one line to the brain change JOURNAL (`.rotli/brain-journal.jsonl`) —
    /// the frontend-owned audit + undo log. The frontend composes the JSON; Rust just
    /// does the append (in the deletable sidecar, per-machine).
    pub fn journal_append(&self, line: &str) -> Result<(), String> {
        let dir = self.root.join(DOT_DIR);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("brain-journal.jsonl");
        let mut out = fs::read_to_string(&path).unwrap_or_default();
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(line.trim());
        out.push('\n');
        atomic_write(&path, &out)
    }

    /// Read the whole brain journal (`""` when none yet).
    pub fn journal_read(&self) -> Result<String, String> {
        Ok(fs::read_to_string(self.root.join(DOT_DIR).join("brain-journal.jsonl")).unwrap_or_default())
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
        let rel = self.free_name(folder_id, &filename_for(&title, &id), None);
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
        // In a memex, boards live in the storage/excalidraw board lane (writable —
        // see surfaced()). If the caller's folder isn't itself a writable surface,
        // land the board there so ⌘⇧N always saves and every board shares one home
        // (Seth, 2026-07-07).
        let folder_id = if self.layout == Layout::Memex
            && !matches!(surfaced(self.layout, folder_id), Surface::NoteRW)
        {
            "storage/excalidraw"
        } else {
            folder_id
        };
        self.writable(folder_id)?;
        if !folder_id.is_empty() {
            validate_rel(folder_id)?;
            fs::create_dir_all(self.abs(folder_id))
                .map_err(|e| format!("create folder {folder_id}: {e}"))?;
        }
        let rel = self.free_name(folder_id, "untitled.excalidraw", None);
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

    /// Rename a board (`.excalidraw`) inside its own folder. `new_name` is a free
    /// stem (extension optional); path separators are flattened to `-`, the folder
    /// is kept, and the result is collision-guarded. Returns the board's new meta
    /// (its id IS the new relpath). Boards carry no index, so this is a pure file
    /// move + a fresh meta — no id remap to chase elsewhere (Seth, 2026-06-26).
    pub fn rename_board(&mut self, id: &str, new_name: &str) -> Result<NoteMeta, String> {
        if !id.ends_with(".excalidraw") {
            return Err(format!("not a board: {id}"));
        }
        self.writable(id)?;
        let old_abs = self.abs(id);
        if !old_abs.exists() {
            return Err(format!("board not found: {id}"));
        }
        let folder = id.rsplit_once('/').map(|(f, _)| f.to_string()).unwrap_or_default();
        let stem: String = new_name
            .trim()
            .trim_end_matches(".excalidraw")
            .trim()
            .chars()
            .map(|c| if c == '/' || c == '\\' { '-' } else { c })
            .collect();
        let stem = stem.trim().to_string();
        if stem.is_empty() {
            return Err("a board needs a name".into());
        }
        let new_rel = self.free_name(&folder, &format!("{stem}.excalidraw"), None);
        if new_rel == id {
            // same name — nothing to do, return current meta
            let (created_at, updated_at) = file_stamps(&old_abs);
            return Ok(NoteMeta {
                id: id.to_string(),
                title: board_title(id),
                snippet: String::new(),
                folder_id: folder,
                created_at,
                updated_at,
                pinned: false,
                origin: None,
                kind: NoteKind::Board,
            });
        }
        let new_abs = self.abs(&new_rel);
        self.writable(&new_rel)?;
        self.suppress.mark(&old_abs);
        self.suppress.mark(&new_abs);
        fs::rename(&old_abs, &new_abs).map_err(|e| format!("rename board: {e}"))?;
        let (created_at, updated_at) = file_stamps(&new_abs);
        Ok(NoteMeta {
            id: new_rel.clone(),
            title: board_title(&new_rel),
            snippet: String::new(),
            folder_id: folder,
            created_at,
            updated_at,
            pinned: false,
            origin: None,
            kind: NoteKind::Board,
        })
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
    /// test path — tests must not touch the user's real Trash).
    /// (allow(dead_code): its `corpus_purge` command was UNREGISTERED in the
    /// 2026-07 audit (#68) — an exposed, unreachable destructive command is the
    /// wrong default. The method + its test stay for when Empty Trash ships.)
    #[allow(dead_code)]
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

    /// First free relative path in `folder` for `desired` — the collision guard
    /// shared by notes (`.md`), boards (`.excalidraw`), and imported binaries. The
    /// extension is derived from `desired` (its last `.`), so a taken name becomes
    /// `stem-2.ext`, `stem-3.ext`, …. `keep_rel` is a path the caller already owns
    /// (a rename in place), excluded from the collision check. The id suffix makes
    /// real note collisions rare; this guards the same-slug-same-tail case.
    fn free_name(&self, folder: &str, desired: &str, keep_rel: Option<&str>) -> String {
        let join = |name: &str| {
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        };
        let (stem, ext) = match desired.rsplit_once('.') {
            Some((s, e)) if !s.is_empty() => (s, format!(".{e}")),
            _ => (desired, String::new()),
        };
        let mut rel = join(desired);
        let mut n = 2;
        while self.abs(&rel).exists() && keep_rel != Some(rel.as_str()) {
            rel = join(&format!("{stem}-{n}{ext}"));
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
        "main" => Ok("main.json"), // the Main arrangement (committed, unlike the others)
        // Rust-daemon-owned hash state — the frontend never writes it.
        "organizer" => Ok("organizer.json"),
        other => Err(format!("unknown settings file: {other}")),
    }
}

/// The dot-files the WEBVIEW may write via `corpus_settings_write` — a separate
/// whitelist from the read table (#44, audit 2026-07): `organizer` is the
/// daemon's own convergence state (a webview write would wipe its hashes) and
/// `main` must go through `corpus_main_write` (which also keeps it committable).
/// Internal writers (the daemon, corpus_main_write) call `dot_write` directly.
fn user_dot_writable(which: &str) -> Result<(), String> {
    match which {
        "settings" | "viewstate" | "background" => Ok(()),
        "main" => Err("write .rotli/main.json through corpus_main_write".into()),
        "organizer" => Err("`organizer` is the daemon's own state — not writable from the app".into()),
        other => Err(format!("unknown settings file: {other}")),
    }
}

pub(crate) fn folder_of(rel: &str) -> String {
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
    // `:` is the multi-root router char (split_root_id) — it must NEVER appear
    // inside a path component, so a folder literally named "a:b" cannot collide
    // with the "<rootid>:path" wire scheme.
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.contains('/')
        || name.contains(':')
    {
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
        // the brain's memory and memex-vault's root docs never appear as notes. A
        // Hidden DIRECTORY is not descended into. LegacyRotli surfaces all.
        if surfaced(layout, &rel) == Surface::Hidden {
            continue;
        }
        if kind.is_dir() {
            // Memex: the wiki/_inbox staging dir is plumbing, not a folder — its
            // notes are re-homed by their shelf (below), so don't surface it as a
            // browsable folder; still recurse to collect those notes.
            // wiki/_inbox staging + storage/ aren't browsable folder ROWS: their
            // files are re-homed (notes by shelf; storage binaries to Storage).
            let staging =
                layout == Layout::Memex && (rel == "wiki/_inbox" || rel == "storage");
            if !staging {
                folders.push(FolderMeta {
                    id: rel.clone(),
                    name,
                    parent_id: if prefix.is_empty() { None } else { Some(prefix.to_string()) },
                });
            }
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
            // shelf-projection (v3.5): a wiki note appears under its shelf (the
            // user's folder), not its disk path. Computed BEFORE fm.id is moved.
            let folder_id = project_folder(layout, prefix, &fm);
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
                folder_id,
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
        } else if kind.is_file() {
            // Any OTHER file (image, pdf, txt, …): surfaced read-only so a folder
            // like Storage shows what's actually in it. id == its relative path,
            // title = the filename WITH its extension (so "photo.png" reads true).
            let abs = entry.path();
            let (file_created, file_updated) = file_stamps(&abs);
            notes.push(NoteMeta {
                id: rel.clone(),
                title: name,
                snippet: String::new(),
                // a memex storage/ binary re-homes to the Storage destination; a
                // plain-corpus file stays in its own folder.
                folder_id: project_folder(layout, prefix, &Frontmatter::default()),
                created_at: file_created,
                updated_at: file_updated,
                pinned: false,
                origin: None,
                kind: NoteKind::File,
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
/// in another app) and fire `on_change` once per quiet burst, carrying the
/// burst's relevant paths (deduped) so the organizer daemon can enqueue exactly
/// what changed. `.rotli/`, dot-files and our own in-flight writes (the
/// suppress set) never fire — so they never reach the daemon's queue either.
pub fn spawn_watcher(
    root: PathBuf,
    suppress: SuppressSet,
    on_change: impl Fn(&[PathBuf]) + Send + 'static,
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
            let mut paths = relevant_paths(&root, &suppress, &res);
            if paths.is_empty() {
                continue;
            }
            // trailing debounce: absorb the burst, fire once when it goes quiet
            loop {
                match rx.recv_timeout(DEBOUNCE) {
                    Ok(res) => {
                        paths.extend(relevant_paths(&root, &suppress, &res));
                        continue;
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        paths.sort();
                        paths.dedup();
                        on_change(&paths);
                        break;
                    }
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
    Ok(())
}

/// The paths of one fs event that matter (suppress + dot filters applied).
/// Access events never matter.
fn relevant_paths(
    root: &Path,
    suppress: &SuppressSet,
    res: &notify::Result<notify::Event>,
) -> Vec<PathBuf> {
    let Ok(event) = res else { return Vec::new() };
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return Vec::new();
    }
    event.paths.iter().filter(|p| path_relevant(root, suppress, p)).cloned().collect()
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

/// The multi-root registry behind the Tauri state (Track 2, Build Step 1). A
/// map of `root id → CorpusStore` plus the default-root id. The DEFAULT root is
/// always present; non-default roots (the "vault") are added at startup when a
/// bound external root exists.
///
/// The ROUTING LAYER is transparent for the default root: with only the default
/// registered, every command behaves byte-identically to the single-store world
/// and every emitted id stays bare. This is the gate before any second root.
pub struct CorpusRegistry {
    stores: HashMap<String, CorpusStore>,
    default_id: String,
}

impl CorpusRegistry {
    pub fn new(default_id: String) -> Self {
        Self { stores: HashMap::new(), default_id }
    }

    pub fn insert(&mut self, id: String, store: CorpusStore) {
        self.stores.insert(id, store);
    }
}

/// `CorpusState` wraps the registry. Built empty when the corpus failed to open
/// (disk error at startup) — commands then return a clean error instead of
/// panicking on missing state.
pub struct CorpusState(pub Mutex<CorpusRegistry>);

impl CorpusState {
    /// The registry's default root id — the memex the journal/organizer
    /// commands ride (their dot-state lives under ITS `.rotli/`).
    pub(crate) fn default_root_id(&self) -> Result<String, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?
            .default_id
            .clone())
    }

    /// Run `f` against the store named by `root_id` (passing the bare `rel`).
    /// The router: `split_root_id` is applied by the caller; this picks the
    /// store. An unknown root id is a clean error (an UNBOUND vault, a stale
    /// stored id) — never a panic. pub(crate): the organizer daemon's writes
    /// (journal / dot-state / applies) serialize on this same mutex, so the two
    /// journal writers (TS command + daemon) can never interleave a line.
    pub(crate) fn route<T>(
        &self,
        root_id: &str,
        f: impl FnOnce(&mut CorpusStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut reg = self.0.lock().map_err(|_| "corpus lock poisoned".to_string())?;
        let store = reg
            .stores
            .get_mut(root_id)
            .ok_or_else(|| format!("corpus root unavailable: {root_id}"))?;
        f(store)
    }
}

/// Re-prefix a `NoteMeta`'s `folder_id` (and, for boards, its `id`) with the
/// root id so the wire carries a routable id. Default root → bare (no-op).
fn prefix_meta(root_id: &str, mut m: NoteMeta) -> NoteMeta {
    m.folder_id = compose_root_id(root_id, &m.folder_id);
    if m.kind == NoteKind::Board || m.kind == NoteKind::File {
        // a board/file id IS its relative path — prefix it like a folder id so a
        // later read/open routes back to this store
        m.id = compose_root_id(root_id, &m.id);
    }
    m
}

#[tauri::command]
pub fn corpus_list(state: tauri::State<'_, CorpusState>) -> Result<CorpusList, String> {
    // Aggregate across every registered root, prefixing each emitted folder_id /
    // board id via compose_root_id (default bare). Note ulids stay bare for the
    // default root; a non-default root prefixes its ulids too so reads route back.
    let mut reg = state.0.lock().map_err(|_| "corpus lock poisoned".to_string())?;
    let mut ids: Vec<String> = reg.stores.keys().cloned().collect();
    // stable order: default first, then the rest sorted, so the wire is deterministic
    ids.sort();
    if let Some(pos) = ids.iter().position(|i| *i == reg.default_id) {
        let d = ids.remove(pos);
        ids.insert(0, d);
    }
    let mut folders: Vec<FolderMeta> = Vec::new();
    let mut notes: Vec<NoteMeta> = Vec::new();
    for id in ids {
        let store = reg.stores.get_mut(&id).expect("id from keys");
        let list = store.list()?;
        for mut f in list.folders {
            f.parent_id = f.parent_id.map(|p| compose_root_id(&id, &p));
            f.id = compose_root_id(&id, &f.id);
            folders.push(f);
        }
        for mut n in list.notes {
            n = prefix_meta(&id, n);
            if id != reg.default_id && n.kind == NoteKind::Note {
                // a ulid note in a non-default root: prefix the ulid so a later
                // read routes back to this store.
                n.id = compose_root_id(&id, &n.id);
            }
            notes.push(n);
        }
    }
    Ok(CorpusList { folders, notes })
}

/// FULL-TEXT search across every registered root — the same aggregation +
/// id-prefixing discipline as `corpus_list` (default root first, ulids prefixed
/// only for non-default roots so an open routes back). `limit` caps the MERGED
/// result (default 50); hits re-sort rank→recency after the merge.
#[tauri::command]
pub fn corpus_search(
    state: tauri::State<'_, CorpusState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let cap = limit.unwrap_or(50).clamp(1, 200);
    let mut reg = state.0.lock().map_err(|_| "corpus lock poisoned".to_string())?;
    let mut ids: Vec<String> = reg.stores.keys().cloned().collect();
    ids.sort();
    if let Some(pos) = ids.iter().position(|i| *i == reg.default_id) {
        let d = ids.remove(pos);
        ids.insert(0, d);
    }
    let default_id = reg.default_id.clone();
    let mut hits: Vec<SearchHit> = Vec::new();
    for id in ids {
        let store = reg.stores.get_mut(&id).expect("id from keys");
        for mut h in store.search(&query, cap)? {
            h.folder_id = compose_root_id(&id, &h.folder_id);
            if id != default_id {
                h.id = compose_root_id(&id, &h.id);
            }
            hits.push(h);
        }
    }
    sort_hits(&mut hits);
    hits.truncate(cap);
    Ok(hits)
}

#[tauri::command]
pub fn corpus_read(state: tauri::State<'_, CorpusState>, id: String) -> Result<NoteDoc, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.read(&rel)).map(|mut doc| {
        doc.id = compose_root_id(&root, &doc.id);
        doc.folder_id = compose_root_id(&root, &doc.folder_id);
        doc
    })
}

/// Open a surfaced FILE (`NoteKind::File`) in the OS default app — resolve its
/// routed id to an absolute path via the owning store, then `open` it. rotli
/// never reads/writes a non-note file as markdown; this just hands it to the OS.
#[tauri::command]
pub fn corpus_open_file(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    let abs = state.route(&root, |s| Ok(s.root().join(&rel)))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&abs)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = abs;
    Ok(())
}

/// Read a surfaced FILE (kind "file") as TEXT for the in-app text viewer (a Breve
/// `.audio.txt`, a `.csv`, …). Capped at `max_bytes` (default 200 KB) so a huge file
/// can't lock the UI. Lossy UTF-8 so a stray byte renders rather than erroring.
#[tauri::command]
pub fn corpus_file_text(
    state: tauri::State<'_, CorpusState>,
    id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let abs = state.route(&root, |s| Ok(s.root().join(&rel)))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    let cap = max_bytes.unwrap_or(200_000);
    let data = fs::read(&abs).map_err(|e| e.to_string())?;
    let end = data.len().min(cap);
    Ok(String::from_utf8_lossy(&data[..end]).into_owned())
}

/// Read a surfaced FILE as BASE64 — for the in-app viewer to parse a binary that
/// can't ride a lossy UTF-8 read (a `.xlsx` spreadsheet). Capped at `max_bytes`
/// (default 8 MB) so a giant workbook can't lock the UI.
#[tauri::command]
pub fn corpus_file_bytes(
    state: tauri::State<'_, CorpusState>,
    id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    use base64::Engine;
    let (root, rel) = split_root_id(&id);
    let abs = state.route(&root, |s| Ok(s.root().join(&rel)))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    let cap = max_bytes.unwrap_or(8_000_000);
    let data = fs::read(&abs).map_err(|e| e.to_string())?;
    let end = data.len().min(cap);
    Ok(base64::engine::general_purpose::STANDARD.encode(&data[..end]))
}

/// Import a dropped external file into the corpus's binary area (the memex
/// `storage/`, or the local `Storage/` for a plain corpus). `path` is the OS
/// source path from the drag-drop event; rotli COPIES it. Returns the new file's
/// wire id so the caller can reveal/open it.
#[tauri::command]
pub fn corpus_import_file(
    state: tauri::State<'_, CorpusState>,
    root_id: String,
    path: String,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let rel = state.route(&root_id, |s| s.import_file(&src))?;
    Ok(compose_root_id(&root_id, &rel))
}

/// Size + user-lane writability of a surfaced file. The sheet editor probes this
/// before offering edit mode: a read-only root (a memex/linked-library) or a file
/// over the read cap stays a viewer.
#[tauri::command]
pub fn corpus_file_stat(state: tauri::State<'_, CorpusState>, id: String) -> Result<FileStat, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.file_stat(&rel))
}

/// Save a surfaced FILE's bytes back to disk (base64 in) — the spreadsheet
/// editor's explicit Save. Gated by the same writable() lane as every user write.
#[tauri::command]
pub fn corpus_write_file_bytes(
    state: tauri::State<'_, CorpusState>,
    id: String,
    base64: String,
    bak: Option<bool>,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad file payload: {e}"))?;
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.write_file_bytes(&rel, &bytes, bak.unwrap_or(false)))
}

/// Create a NEW file from base64 bytes in `folder_id` (collision-safe) — the
/// csv → xlsx convert. Returns the new file's wire id.
#[tauri::command]
pub fn corpus_new_file_bytes(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    name: String,
    base64: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad file payload: {e}"))?;
    let (root, rel) = split_root_id(&folder_id);
    let new_rel = state.route(&root, |s| s.new_file_bytes(&rel, &name, &bytes))?;
    Ok(compose_root_id(&root, &new_rel))
}

/// Reveal a surfaced file in Finder (`open -R`) — the file surface's dropdown.
#[tauri::command]
pub fn corpus_reveal_file(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    // a NOTE travels the wire as its frontmatter ULID — joining that to the root
    // was never a file, so "Show in Finder" silently failed for every note
    // (Seth, 2026-07-09; the same ULID→rel class as the v0.18.1 filing bug).
    // resolve_note_rel passes real file paths through and maps ids via the index.
    let abs = state.route(&root, |s| {
        let resolved = s.resolve_note_rel(&rel)?;
        Ok(s.root().join(resolved))
    })?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-R")
        .arg(&abs)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = abs;
    Ok(())
}

/// The FIXED allowlist behind "Open with …" — never a caller-supplied binary
/// name (`open -a` runs whatever it's handed). TextEdit/Preview live under
/// /System/Applications on modern macOS, hence the two roots.
const OPEN_WITH_APPS: &[&str] = &["Numbers", "Microsoft Excel", "TextEdit", "Preview", "Safari"];

/// Which of the known "Open with …" apps are actually installed — a cheap
/// exists-check so the dropdown only offers what's there.
#[tauri::command]
pub fn corpus_open_with_apps() -> Vec<String> {
    OPEN_WITH_APPS
        .iter()
        .filter(|name| {
            ["/Applications", "/System/Applications"]
                .iter()
                .any(|dir| Path::new(dir).join(format!("{name}.app")).is_dir())
        })
        .map(|s| s.to_string())
        .collect()
}

/// Open a surfaced file WITH a specific app (`open -a`). The app must be on the
/// allowlist above — the id routes like every other file command.
#[tauri::command]
pub fn corpus_open_file_with(
    state: tauri::State<'_, CorpusState>,
    id: String,
    app: String,
) -> Result<(), String> {
    if !OPEN_WITH_APPS.contains(&app.as_str()) {
        return Err(format!("unknown app: {app}"));
    }
    let (root, rel) = split_root_id(&id);
    let abs = state.route(&root, |s| Ok(s.root().join(&rel)))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("-a")
        .arg(&app)
        .arg(&abs)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (abs, app);
    Ok(())
}

/// Resolve a corpus-relative path (e.g. a `storage:` asset) to its ABSOLUTE path,
/// so the frontend can convertFileSrc() it into an asset-protocol <img> URL.
#[tauri::command]
pub fn corpus_abs(
    state: tauri::State<'_, CorpusState>,
    root_id: String,
    rel: String,
) -> Result<String, String> {
    state.route(&root_id, |s| Ok(s.abs(&rel).to_string_lossy().into_owned()))
}

/// The note's frontmatter for the metadata panel (read-only display + lock state).
#[tauri::command]
pub fn corpus_frontmatter(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<FrontmatterView, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.read_frontmatter(&rel))
}

/// Toggle the per-note AI lock (a `locked: true` frontmatter line).
#[tauri::command]
pub fn corpus_set_locked(
    state: tauri::State<'_, CorpusState>,
    id: String,
    locked: bool,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_locked(&rel, locked))
}

/// Toggle the per-note PIN (the typed `pinned` frontmatter fact) — floats the
/// note to the top of every list. Does not bump `updated`.
#[tauri::command]
pub fn corpus_set_pinned(
    state: tauri::State<'_, CorpusState>,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_pinned(&rel, pinned))
}

/// Set or (empty value) remove a foreign frontmatter field from the metadata panel.
#[tauri::command]
pub fn corpus_set_field(
    state: tauri::State<'_, CorpusState>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_field(&rel, &key, &value))
}

/// The note's frontmatter as RAW TEXT (fences included), verbatim from disk —
/// the "Show file metadata" view renders this above the body. "" when none.
#[tauri::command]
pub fn corpus_raw_frontmatter(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.raw_frontmatter(&rel))
}

/// Write back a user-edited raw frontmatter block. Rust restores the reserved
/// provenance keys (id/owner/created) and refuses notes the user can't write.
#[tauri::command]
pub fn corpus_write_frontmatter_raw(
    state: tauri::State<'_, CorpusState>,
    id: String,
    block: String,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.write_frontmatter_raw(&rel, &block))
}

/// FILER (contract v3.7): set an AI-owned metadata field (area/summary/tags/links/
/// suggested_area/area_confidence/filed_by/filed_at). The Filer's lane — refuses
/// reserved + user keys. No caller yet (Phase 3 wires the manual "file this note").
#[tauri::command]
pub fn corpus_set_ai_field(
    state: tauri::State<'_, CorpusState>,
    id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_ai_field(&rel, &key, &value))
}

/// FILER (v3.7): file a note into the brain per its `area` field (fs-atomic move).
#[tauri::command]
pub fn corpus_file_note(state: tauri::State<'_, CorpusState>, id: String) -> Result<String, String> {
    // returns the note's NEW rel path so the frontend can journal the move.
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| {
        let meta = s.file_note(&rel)?;
        s.path_of(&meta.id)
    })
}

/// Resolve a note's wire id to its current REL PATH — the ULID→rel bridge the
/// manual-filing surfaces use (a `.md` note travels as its frontmatter ULID, but
/// staged-detection and the journal need the path). A rel path passes through.
#[tauri::command]
pub fn corpus_note_path(state: tauri::State<'_, CorpusState>, id: String) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let bare = state.route(&root, |s| s.resolve_note_rel(&rel))?;
    Ok(compose_root_id(&root, &bare))
}

/// FILER (v3.7): (re)write a per-area generated overview `wiki/<area>/_index.md`.
#[tauri::command]
pub fn corpus_write_index(
    state: tauri::State<'_, CorpusState>,
    area: String,
    body: String,
) -> Result<(), String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.write_index(&area, &body))
}

/// FILER (v3.7): move a note to a target folder in the brain — re-file or UNDO a filing.
#[tauri::command]
pub fn corpus_filer_move(
    state: tauri::State<'_, CorpusState>,
    id: String,
    target_folder: String,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.filer_move(&rel, &target_folder))
}

/// Append one JSON line to the brain change journal (`.rotli/brain-journal.jsonl`).
#[tauri::command]
pub fn corpus_journal_append(
    state: tauri::State<'_, CorpusState>,
    organizer: tauri::State<'_, crate::organizer::OrganizerState>,
    line: String,
) -> Result<(), String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.journal_append(&line))?;
    // every frontend Approve/Dismiss/Undo journals through here, and their
    // corpus writes are suppress-marked (no watcher event) — owe the organizer
    // one reconciliation sweep so the index diff catches up. Event-driven: this
    // nudge replaced the daemon's old 15-minute polling sweep.
    organizer.0.nudge_sweep();
    Ok(())
}

/// Read the whole brain change journal (jsonl text; "" when none).
#[tauri::command]
pub fn corpus_journal_read(state: tauri::State<'_, CorpusState>) -> Result<String, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.journal_read())
}

/// Toggle the per-note SECURE flag (secrets detected → never sent remote + gitignored).
#[tauri::command]
pub fn corpus_set_secure(
    state: tauri::State<'_, CorpusState>,
    id: String,
    secure: bool,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_secure(&rel, secure))
}

/// Read a note for an AI model — refused for a SECURE note unless the model is
/// LOCAL. Locality is DERIVED here from the picked model's ENDPOINT (loopback
/// check, #2 audit 2026-07) — the webview passes where the model lives, never a
/// "trust me, it's local" bit.
#[tauri::command]
pub fn corpus_read_ai(
    state: tauri::State<'_, CorpusState>,
    id: String,
    endpoint: String,
) -> Result<String, String> {
    let model_is_local = crate::chat::endpoint_is_local(&endpoint);
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.read_for_ai(&rel, model_is_local))
}

#[tauri::command]
pub fn corpus_write(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
    pinned: bool,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.write(&rel, &body, pinned)).map(|mut m| {
        m = prefix_meta(&root, m);
        if m.kind == NoteKind::Note {
            m.id = compose_root_id(&root, &m.id);
        }
        m
    })
}

#[tauri::command]
pub fn corpus_create(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    body: String,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&folder_id);
    state.route(&root, |s| s.create(&rel, &body)).map(|mut m| {
        m = prefix_meta(&root, m);
        m.id = compose_root_id(&root, &m.id);
        m
    })
}

#[tauri::command]
pub fn corpus_delete(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.delete(&rel))
}

/// Move a note to another folder, preserving its id (Tauri maps the JS
/// `targetFolder` arg to `target_folder`). The origin rule for the hidden
/// Archive/Trash roots is baked into `move_note`. Cross-root moves are not
/// supported this iteration: the note id and the target folder must share a root.
#[tauri::command]
pub fn corpus_move(
    state: tauri::State<'_, CorpusState>,
    id: String,
    target_folder: String,
) -> Result<NoteMeta, String> {
    let (id_root, rel) = split_root_id(&id);
    let (tgt_root, tgt_rel) = split_root_id(&target_folder);
    if id_root != tgt_root {
        return Err("moving a note across roots isn't supported yet".into());
    }
    state.route(&id_root, |s| s.move_note(&rel, &tgt_rel)).map(|mut m| {
        m = prefix_meta(&id_root, m);
        if m.kind == NoteKind::Note {
            m.id = compose_root_id(&id_root, &m.id);
        }
        m
    })
}

/// Rename a board (`.excalidraw`) within its folder. Boards are path-id'd and
/// carry no note index, so the returned meta has the NEW id — the caller swaps
/// the open tab's `boardId` to it (Seth, 2026-06-26).
#[tauri::command]
pub fn corpus_rename_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
    name: String,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.rename_board(&rel, &name)).map(|m| prefix_meta(&root, m))
}

// The `corpus_purge` command (the only hard-delete lane) was UNREGISTERED and
// removed in the 2026-07 audit (#68): an exposed, unreachable destructive command
// is the wrong default. The store's `purge` + its tests stay — re-add the command
// when "Empty Trash" ships a caller.

#[tauri::command]
pub fn corpus_create_folder(
    state: tauri::State<'_, CorpusState>,
    name: String,
    parent_id: Option<String>,
) -> Result<FolderMeta, String> {
    // The root is carried by parent_id (a new top-level folder in a non-default
    // root would be "<rootid>:") — split it; a bare/None parent → default root.
    let (root, parent_rel) = match parent_id.as_deref() {
        Some(p) => {
            let (r, rel) = split_root_id(p);
            (r, Some(rel))
        }
        None => (DEFAULT_ROOT_ID.to_string(), None),
    };
    state
        .route(&root, |s| s.create_folder(&name, parent_rel.as_deref()))
        .map(|mut f| {
            f.parent_id = f.parent_id.map(|p| compose_root_id(&root, &p));
            f.id = compose_root_id(&root, &f.id);
            f
        })
}

#[tauri::command]
pub fn corpus_read_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<CorpusBoardDoc, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.read_board(&rel)).map(|mut doc| {
        doc.id = compose_root_id(&root, &doc.id);
        doc.folder_id = compose_root_id(&root, &doc.folder_id);
        doc
    })
}

#[tauri::command]
pub fn corpus_write_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.write_board(&rel, &body)).map(|m| prefix_meta(&root, m))
}

/// Create a board in `folderId` (Tauri maps the JS `folderId` arg to
/// `folder_id`). `body` is optional — `None` seeds an empty Excalidraw scene.
#[tauri::command]
pub fn corpus_create_board(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    body: Option<String>,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&folder_id);
    state
        .route(&root, |s| s.create_board(&rel, body.as_deref()))
        .map(|m| prefix_meta(&root, m))
}

#[tauri::command]
pub fn corpus_overview(state: tauri::State<'_, CorpusState>) -> Result<CorpusOverview, String> {
    // The Storage pane shows the DEFAULT (local) root — the user's notes folder.
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.overview())
}

/// Demo mode swaps the NOTES memex but must not touch per-machine chrome: the
/// user's look and — crucially — the `onboarded` flag live in settings.json /
/// viewstate.json / background.json, which we keep reading from and writing to the
/// REAL corpus's `.rotli/` so a demo never forces re-onboarding or resets the theme
/// (Seth, 2026-07-07). `main.json` is per-MEMEX (it travels with the notes), so it
/// is deliberately NOT redirected — it still routes to the active (demo) store.
fn demo_machine_dot_path(app: &tauri::AppHandle, file: &str) -> Option<PathBuf> {
    if !demo_active(app) {
        return None;
    }
    if !matches!(file, "settings" | "viewstate" | "background") {
        return None;
    }
    let real = read_corpus_config(app)?.corpus.abs_path;
    let name = dot_file(file).ok()?;
    Some(real.join(DOT_DIR).join(name))
}

#[tauri::command]
pub fn corpus_settings_read(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    file: String,
) -> Result<String, String> {
    // settings/viewstate/background live in the DEFAULT root's `.rotli/` — except in
    // demo mode, where per-machine chrome stays with the user's real corpus (#3).
    if let Some(path) = demo_machine_dot_path(&app, &file) {
        return match fs::read_to_string(&path) {
            Ok(s) => Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
            Err(e) => Err(format!("read {file}: {e}")),
        };
    }
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.dot_read(&file))
}

#[tauri::command]
pub fn corpus_settings_write(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    file: String,
    contents: String,
) -> Result<(), String> {
    // #44: the write whitelist is NARROWER than the read table — `organizer`
    // (daemon-owned) and `main` (corpus_main_write's job) are refused here.
    user_dot_writable(&file)?;
    // demo mode: per-machine chrome writes land on the real corpus, never the demo
    // memex — so tweaking the look mid-demo persists to the user's real config (#3).
    if let Some(path) = demo_machine_dot_path(&app, &file) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        return atomic_write(&path, &contents);
    }
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.dot_write(&file, &contents))
}

/// Write `.rotli/main.json` (the user's durable Main arrangement) AND ensure the
/// corpus `.gitignore` commits it — separate from settings/viewstate, which stay
/// per-machine (Seth, 2026-07-01). Read it back with `corpus_settings_read("main")`.
#[tauri::command]
pub fn corpus_main_write(
    state: tauri::State<'_, CorpusState>,
    contents: String,
) -> Result<(), String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| {
        s.dot_write("main", &contents)?;
        s.ensure_main_committable()
    })
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    /// The load-bearing migration: Seth's live shape (plain `~/Documents/rotli`
    /// corpus + `~/memex-vault` registered BOTH as the `vault` corpus root AND as
    /// the active memex instance) collapses to one corpus + ONE deduped brain that
    /// keeps the `vault` id, carries `chats+inbox`, and stays active.
    #[test]
    fn migration_collapses_double_registration_to_one_brain() {
        let tmp = TempDir::new().unwrap();
        let cfg_dir = tmp.path().join("config");
        let corpus = tmp.path().join("Documents").join("rotli");
        let brain = tmp.path().join("memex-vault");
        fs::create_dir_all(&cfg_dir).unwrap();
        fs::create_dir_all(&corpus).unwrap();
        fs::create_dir_all(&brain).unwrap();
        let mxid = "mx_23e4e1dc-d516-4444-a39a-bc030eb8680b";
        fs::write(
            brain.join("memex.json"),
            format!("{{\"id\":\"{mxid}\",\"contract\":\"3.4\"}}"),
        )
        .unwrap();
        fs::write(
            cfg_dir.join("corpus-roots.json"),
            format!(
                "{{\"version\":0,\"roots\":[{{\"id\":\"default\",\"label\":\"Notes\",\"absPath\":\"{}\"}},{{\"id\":\"vault\",\"label\":\"Vault\",\"absPath\":\"{}\"}}]}}",
                corpus.display(),
                brain.display()
            ),
        )
        .unwrap();
        fs::write(
            cfg_dir.join("memex-instances.json"),
            format!(
                "{{\"version\":1,\"activeId\":\"{mxid}\",\"instances\":[{{\"id\":\"{mxid}\",\"label\":\"memex-vault\",\"absPath\":\"{}\",\"role\":\"chat-system\",\"memexId\":\"{mxid}\",\"mode\":\"secure\",\"perms\":\"chats+inbox\"}}]}}",
                brain.display()
            ),
        )
        .unwrap();

        let cfg = migrate_config_at(&cfg_dir, &corpus);

        assert_eq!(canon(&cfg.corpus.abs_path), canon(&corpus), "corpus stays the plain notes folder");
        assert_eq!(cfg.brains.len(), 1, "double registration deduped to one brain");
        let b = &cfg.brains[0];
        assert_eq!(b.id, "vault", "keeps the vault id so the sidebar prefix stays valid");
        assert_eq!(canon(&b.abs_path), canon(&brain));
        assert_eq!(b.perms, "chats+inbox", "carries write perms from the instance, not read-only");
        assert_eq!(b.memex_id.as_deref(), Some(mxid));
        assert_eq!(b.mode.as_deref(), Some("secure"));
        assert_eq!(cfg.active_brain_id.as_deref(), Some("vault"), "active mapped via memexId");
    }

    /// A brand-new user (empty config dir) gets the default corpus and no brains —
    /// never a blank/dead path.
    #[test]
    fn migration_fresh_user_defaults_to_documents_rotli() {
        let tmp = TempDir::new().unwrap();
        let cfg_dir = tmp.path().join("config");
        let default_corpus = tmp.path().join("Documents").join("rotli");
        fs::create_dir_all(&cfg_dir).unwrap();
        let cfg = migrate_config_at(&cfg_dir, &default_corpus);
        assert_eq!(cfg.corpus.abs_path, default_corpus);
        assert!(cfg.brains.is_empty());
        assert!(cfg.active_brain_id.is_none());
    }

    #[test]
    fn looks_secure_catches_common_secrets() {
        assert!(looks_secure("key: sk-ant-api03-EXAMPLE0EXAMPLE0EXAM"));
        assert!(looks_secure("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIB"));
        assert!(looks_secure("SSN: 078-05-1120"));
        assert!(looks_secure(
            "tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4f"
        ));
        assert!(looks_secure("github_pat_11EXAMPLE0EXAMPLE0EXAM"));
        assert!(looks_secure("AIzaSyExample0Example0Example0Example0E"));
        assert!(looks_secure("card 3782 822463 10005")); // amex grouping
        // plain notes are NOT secure (no false positives on phone/time)
        assert!(!looks_secure("A normal note — groceries, weather, call 555-1234 at 3pm."));
        assert!(!looks_secure("Meeting notes: ship v2, review the gateway flow."));
    }

    #[test]
    fn import_file_copies_into_storage_collision_safe() {
        let (dir, store) = bare(); // LegacyRotli → the local Storage/ folder
        let src = dir.path().join("photo.png");
        fs::write(&src, b"\x89PNG-fake-bytes").unwrap();
        let rel = store.import_file(&src).unwrap();
        assert_eq!(rel, "Storage/photo.png");
        assert!(store.root().join("Storage/photo.png").is_file());
        // a second import of the same name gets a collision-safe suffix
        let rel2 = store.import_file(&src).unwrap();
        assert_eq!(rel2, "Storage/photo-2.png");
        assert!(store.root().join("Storage/photo-2.png").is_file());
        // the source is COPIED, never moved
        assert!(src.is_file());
    }

    #[test]
    fn import_file_slugifies_spaced_names() {
        // a macOS screenshot name (spaces + dots) must become a storage:-safe
        // slug so the ref passes the memex asset regex (Seth, 2026-07-03).
        let (dir, store) = bare();
        let src = dir.path().join("Screenshot 2026-07-03 at 8.59.00 AM.png");
        fs::write(&src, b"png").unwrap();
        let rel = store.import_file(&src).unwrap();
        assert_eq!(rel, "Storage/screenshot-2026-07-03-at-8-59-00-am.png");
        assert!(store.root().join(&rel).is_file());
    }

    #[test]
    fn write_file_bytes_overwrites_with_one_time_bak() {
        let (_dir, mut store) = bare();
        fs::create_dir_all(store.root().join("Storage")).unwrap();
        fs::write(store.root().join("Storage/book.xlsx"), b"original-bytes").unwrap();

        // a missing file is an error — the save lane never creates
        assert!(store.write_file_bytes("Storage/nope.xlsx", b"x", false).is_err());

        store.write_file_bytes("Storage/book.xlsx", b"first-save", true).unwrap();
        assert_eq!(fs::read(store.root().join("Storage/book.xlsx")).unwrap(), b"first-save");
        // .bak holds the PRE-rotli original…
        assert_eq!(fs::read(store.root().join("Storage/book.xlsx.bak")).unwrap(), b"original-bytes");
        // …and a second save never touches it (one-time backup)
        store.write_file_bytes("Storage/book.xlsx", b"second-save", true).unwrap();
        assert_eq!(fs::read(store.root().join("Storage/book.xlsx.bak")).unwrap(), b"original-bytes");
        assert_eq!(fs::read(store.root().join("Storage/book.xlsx")).unwrap(), b"second-save");
    }

    #[test]
    fn file_bytes_lane_respects_memex_read_only() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("storage")).unwrap();
        // a foreign (non-sheet) binary stays fully read-only in the storage lane
        fs::write(root.join("storage/graph.png"), b"pixels").unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let stat = store.file_stat("storage/graph.png").unwrap();
        assert!(!stat.writable);
        assert!(store.write_file_bytes("storage/graph.png", b"edited", true).is_err());
        assert_eq!(fs::read(root.join("storage/graph.png")).unwrap(), b"pixels");
        assert!(!root.join("storage/graph.png.bak").exists(), "a refused save must not leave a .bak");
        // new files refuse too (the csv→xlsx convert can't create in the vault)
        assert!(store.new_file_bytes("storage", "new.xlsx", b"x").is_err());
    }

    #[test]
    fn storage_sheets_are_editable_in_place() {
        // the sanctioned exception (Seth, 2026-07-08): an EXISTING .xlsx/.csv in the
        // memex storage/ can be overwritten in place — but nothing else in storage.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("storage/samples")).unwrap();
        fs::write(root.join("storage/samples/company-overview.xlsx"), b"vault-bytes").unwrap();
        fs::write(root.join("storage/notes.csv"), b"a,b\n").unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        // the probe now offers edit mode, the in-place save lands, the pre-rotli
        // bytes survive as a one-time .bak
        assert!(store.file_stat("storage/samples/company-overview.xlsx").unwrap().writable);
        assert!(store.file_stat("storage/notes.csv").unwrap().writable);
        assert!(store
            .write_file_bytes("storage/samples/company-overview.xlsx", b"edited", true)
            .is_ok());
        assert_eq!(
            fs::read(root.join("storage/samples/company-overview.xlsx")).unwrap(),
            b"edited"
        );
        assert_eq!(
            fs::read(root.join("storage/samples/company-overview.xlsx.bak")).unwrap(),
            b"vault-bytes"
        );

        // still refused: a MISSING sheet (overwrite-only, never a create) and any
        // NEW file in storage (the csv→xlsx convert can't target the vault)
        assert!(store.write_file_bytes("storage/nope.xlsx", b"x", false).is_err());
        assert!(store.new_file_bytes("storage", "fresh.xlsx", b"x").is_err());

        // a read-only-connected brain closes even the storage-sheet lane — the
        // exception must yield to perms, exactly like writable() does
        store.set_perms_read_only(true);
        assert!(!store.file_stat("storage/notes.csv").unwrap().writable);
        assert!(store.write_file_bytes("storage/notes.csv", b"x,y\n", false).is_err());
    }

    #[test]
    fn new_file_bytes_is_collision_safe() {
        let (_dir, mut store) = bare();
        let a = store.new_file_bytes("Storage", "sheet.xlsx", b"one").unwrap();
        assert_eq!(a, "Storage/sheet.xlsx");
        let b = store.new_file_bytes("Storage", "sheet.xlsx", b"two").unwrap();
        assert_eq!(b, "Storage/sheet-2.xlsx");
        assert_eq!(fs::read(store.root().join(&a)).unwrap(), b"one");
        assert_eq!(fs::read(store.root().join(&b)).unwrap(), b"two");
        // stat sees a legacy corpus as writable
        assert!(store.file_stat(&a).unwrap().writable);
    }

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

    // ── raw frontmatter (the "Show file metadata" editor) ──

    #[test]
    fn raw_frontmatter_round_trips_verbatim() {
        // hand-formatted lines (odd spacing, nested yaml, a comment) survive a
        // read → write of the SAME block byte-for-byte — nothing reformats
        let text = "---\nid:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: seth\ntags: [a,  b]\nmeta:\n  source: web\n# a comment\n---\n\n# A note\n\nBody stays byte-exact.\n";
        let block = raw_frontmatter_block(text);
        assert_eq!(block, "---\nid:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: seth\ntags: [a,  b]\nmeta:\n  source: web\n# a comment\n---\n");
        assert_eq!(merge_raw_frontmatter(text, block).unwrap(), text);
        // no frontmatter → empty block; an empty submission leaves the file alone
        assert_eq!(raw_frontmatter_block("# Bare\n"), "");
        assert_eq!(merge_raw_frontmatter("# Bare\n", "").unwrap(), "# Bare\n");
        // a trailing-newline / bare (fence-less) submission lands identically
        let bare = "id:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: seth\ntags: [a,  b]\nmeta:\n  source: web\n# a comment";
        assert_eq!(merge_raw_frontmatter(text, bare).unwrap(), text);
    }

    #[test]
    fn raw_frontmatter_restores_reserved_keeps_typed() {
        let text = "---\nid: 01RAW0000000000000000000B\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T11:00:00Z\npinned: false\nowner: breve\nshelf: Inbox\n---\n\nBody.\n";
        // the user retypes the id, drops created + owner, flips pinned, adds
        // locked/secure/tags — provenance comes back, everything else as typed
        let submitted = "---\nid: HACKED\npinned: true\nlocked: true\nsecure: true\ntags: [x]\nshelf: Projects\n---\n";
        let out = merge_raw_frontmatter(text, submitted).unwrap();
        let (fm, body) = parse_document(&out);
        let fm = fm.unwrap();
        assert_eq!(body, "\nBody.\n", "body must be byte-exact from disk");
        assert_eq!(fm.id.as_deref(), Some("01RAW0000000000000000000B"), "id restored");
        assert_eq!(fm.created.as_deref(), Some("2026-06-12T10:00:00Z"), "created restored");
        assert!(out.contains("owner: breve"), "dropped owner restored:\n{out}");
        assert_eq!(fm.pinned, Some(true), "pinned lands as typed");
        assert!(out.contains("locked: true") && out.contains("secure: true"));
        assert!(out.contains("shelf: Projects") && !out.contains("shelf: Inbox"));
        // updated was dropped by the user — NOT restored (only id/owner/created are)
        assert!(!out.contains("updated:"));

        // a user can't MINT provenance: an invented owner on a note without one goes
        let plain = "---\nid: C\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T10:00:00Z\npinned: false\n---\n\nP.\n";
        let out = merge_raw_frontmatter(plain, "---\nid: C\ncreated: 2026-06-12T10:00:00Z\nowner: me\n---\n").unwrap();
        assert!(!out.contains("owner:"), "invented owner must be dropped:\n{out}");

        // a stray fence line inside the block would truncate it on the next parse
        assert!(merge_raw_frontmatter(plain, "---\nid: C\n---\nsneaky: body\n---\n").is_err());
    }

    #[test]
    fn raw_frontmatter_store_write_is_gated_and_verbatim() {
        // LegacyRotli end-to-end: read the raw block, write it back → unchanged;
        // write a tampered block → provenance restored, typed keys land
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        let original = "---\nid: 01RAWSTORE000000000000000A\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\npinned: false\n---\n\n# Raw\n\nBody.\n";
        fs::write(root.join("raw.md"), original).unwrap();
        store.list().unwrap();
        let id = "01RAWSTORE000000000000000A";
        let block = store.raw_frontmatter(id).unwrap();
        store.write_frontmatter_raw(id, &block).unwrap();
        let rel = store.index.get(id).unwrap().clone();
        assert_eq!(fs::read_to_string(store.root().join(&rel)).unwrap(), original);
        store
            .write_frontmatter_raw(id, "---\nid: FORGED\ncreated: yesterday\ntags: [kept]\n---\n")
            .unwrap();
        let on_disk = fs::read_to_string(store.root().join(&rel)).unwrap();
        assert!(on_disk.contains("id: 01RAWSTORE000000000000000A"), "id restored:\n{on_disk}");
        assert!(on_disk.contains("created: 2026-06-01T00:00:00Z"), "created restored");
        assert!(on_disk.contains("tags: [kept]"), "typed key lands");
        assert!(on_disk.ends_with("\n# Raw\n\nBody.\n"), "body byte-exact:\n{on_disk}");

        // Memex: the curated brain refuses (the USER gate — same as every save);
        // rotli's own chats/ surface accepts
        let dir = TempDir::new().unwrap();
        let brain = dir.path().join("brain");
        seed_memex(&brain);
        let mut mx = CorpusStore::open(brain).unwrap();
        mx.os_trash = false;
        assert!(mx.write_frontmatter_raw("wiki/note.md", "---\ntags: [x]\n---\n").is_err());
        mx.write_frontmatter_raw("chats/welcome.md", "---\ntags: [x]\n---\n").unwrap();
        assert_eq!(mx.raw_frontmatter("chats/welcome.md").unwrap(), "---\ntags: [x]\n---\n");
    }

    #[test]
    fn raw_frontmatter_nested_indented_reserved_lines_stay_foreign() {
        // an INDENTED `  created:` / `  id:` inside a nested map is NOT the
        // reserved top-level line (parse_fields matches UNtrimmed keys) — the
        // merge must keep it verbatim, never dedupe/replace it (2026-07-01)
        let text = "---\nid: 01NEST000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nsource:\n  created: 2020-01-01\n  id: web-123\n  url: https://x\n---\n\nBody.\n";
        let block = raw_frontmatter_block(text);
        // a same-block commit is byte-exact (the nested lines survive the dedupe)
        assert_eq!(merge_raw_frontmatter(text, block).unwrap(), text);
        // adding a key keeps the nested map intact
        let typed = "---\nid: 01NEST000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nsource:\n  created: 2020-01-01\n  id: web-123\n  url: https://x\ntags: [x]\n---\n";
        let out = merge_raw_frontmatter(text, typed).unwrap();
        assert!(out.contains("\n  created: 2020-01-01\n"), "nested created kept:\n{out}");
        assert!(out.contains("\n  id: web-123\n"), "nested id kept:\n{out}");
        assert!(out.contains("tags: [x]"));
        // dropping the TOP-LEVEL provenance restores it up top — the nested
        // lines are not mistaken for it (they used to satisfy the match)
        let dropped = "source:\n  created: 2020-01-01\n  id: web-123\n  url: https://x\n";
        let out = merge_raw_frontmatter(text, dropped).unwrap();
        assert!(
            out.starts_with("---\nid: 01NEST000000000000000000A\ncreated: 2026-06-12T10:00:00Z\n"),
            "top-level provenance restored first:\n{out}"
        );
        assert!(out.contains("\n  id: web-123\n") && out.contains("\n  created: 2020-01-01\n"));
    }

    #[test]
    fn raw_frontmatter_secure_keeps_gitignore_in_step() {
        // the doc contract: `secure:` typed through the raw lane keeps the
        // gitignore in step the same way set_secure does — both directions
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        let original = "---\nid: 01RAWSEC0000000000000000A\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\npinned: false\n---\n\nPlain.\n";
        fs::write(root.join("sec.md"), original).unwrap();
        store.list().unwrap();
        let id = "01RAWSEC0000000000000000A";
        let rel = store.index.get(id).unwrap().clone();
        store
            .write_frontmatter_raw(id, "---\nid: x\ncreated: y\nsecure: true\n---\n")
            .unwrap();
        let ignored = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignored.lines().any(|l| l.trim() == rel), "secure via raw lane must gitignore: {ignored:?}");
        // clearing it un-ignores (the set_secure symmetry)
        store.write_frontmatter_raw(id, "---\n---\n").unwrap();
        let ignored = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(!ignored.lines().any(|l| l.trim() == rel), "cleared secure must un-ignore: {ignored:?}");
        assert!(!fs::read_to_string(root.join(&rel)).unwrap().contains("secure:"));
    }

    #[test]
    fn resolve_note_rel_refuses_traversal() {
        // the passthrough fronts WRITE lanes (write_frontmatter_raw/set_field)
        // and LegacyRotli's writable() allows everything — a "../…" that
        // resolves to a real file outside the root must fail, not write
        let (dir, mut store) = bare();
        fs::write(dir.path().join("outside.md"), "---\n---\nX\n").unwrap();
        assert!(store.abs("../outside.md").is_file(), "test setup: the escape target exists");
        assert!(store.resolve_note_rel("../outside.md").is_err());
        assert!(store.write_frontmatter_raw("../outside.md", "---\npwn: true\n---\n").is_err());
        assert!(!fs::read_to_string(dir.path().join("outside.md")).unwrap().contains("pwn"));
    }

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
    fn strip_markdown_reduces_images_and_links() {
        // raw image markdown never reads as a title (the "images in All notes" leak)
        assert_eq!(title_of("![photo](storage:abc.png)\nrest"), "photo");
        assert_eq!(title_of("![](storage:abc.png)\nrest"), "Image");
        assert_eq!(title_of("[the doc](https://x.y/z)"), "the doc");
        assert_eq!(snippet_of("# T\nsee ![chart](a.png) and [spec](b)"), "see chart and spec");
        // malformed spans pass through untouched
        assert_eq!(title_of("[not a link] (gap)"), "[not a link] (gap)");
        assert_eq!(title_of("![dangling](no close"), "![dangling](no close");
    }

    // ── full-text search (corpus_search) — the pure grammar + the store pass ──

    #[test]
    fn search_match_ranks_title_over_body_with_offsets() {
        // title hit: rank 0, offsets index the TITLE, stored snippet rides through
        let m = search_match("groc", "Groceries", "# Groceries\n\nOlive oil.\n", "Olive oil.")
            .unwrap();
        assert_eq!((m.rank, m.match_start, m.match_len), (0, 0, 4));
        assert_eq!(m.snippet, "Olive oil.");

        // body hit: rank 1, snippet frames the match, offsets index the SNIPPET
        let m = search_match(
            "sourdough",
            "Groceries",
            "# Groceries\n\nOlive oil, sourdough, butter.\n",
            "Olive oil, sourdough, butter.",
        )
        .unwrap();
        assert_eq!(m.rank, 1);
        let chars: Vec<char> = m.snippet.chars().collect();
        let hit: String = chars[m.match_start..m.match_start + m.match_len].iter().collect();
        assert_eq!(hit, "sourdough");

        // case-insensitive both directions; no match / blank query → None
        assert!(search_match("OLIVE", "Groceries", "olive oil", "").is_some());
        assert!(search_match("olive", "Groceries", "OLIVE OIL", "").is_some());
        assert!(search_match("zebra", "Groceries", "olive oil", "").is_none());
        assert!(search_match("   ", "Groceries", "olive oil", "").is_none());
    }

    #[test]
    fn search_match_snippet_window_strips_and_marks_edges() {
        // deep in a long body: ±60 chars of context, "…" on both clipped edges
        let long = format!("{}NEEDLE{}", "a".repeat(100), "b".repeat(100));
        let m = search_match("needle", "T", &long, "").unwrap();
        assert!(m.snippet.starts_with('…') && m.snippet.ends_with('…'));
        let chars: Vec<char> = m.snippet.chars().collect();
        let hit: String = chars[m.match_start..m.match_start + m.match_len].iter().collect();
        assert_eq!(hit, "NEEDLE");
        assert_eq!(chars.len(), 1 + 60 + 6 + 60 + 1);

        // emphasis stripped OUTSIDE the match, newlines flattened — offsets stay true
        let m = search_match("needle", "T", "**bold**\nneedle `x`", "").unwrap();
        let chars: Vec<char> = m.snippet.chars().collect();
        let hit: String = chars[m.match_start..m.match_start + m.match_len].iter().collect();
        assert_eq!(hit, "needle");
        assert!(!m.snippet.contains('*') && !m.snippet.contains('`'));
        assert!(!m.snippet.contains('\n'));
    }

    #[test]
    fn store_search_covers_bodies_ranks_titles_first_and_skips_trash() {
        let (_dir, mut store) = bare();
        let a = store.create("Inbox", "# Wire limit\n\nCall the bank about the cap.\n").unwrap();
        let b = store
            .create("Notes", "# Meeting prep\n\nRaise the wire limit question with finance.\n")
            .unwrap();
        let c = store.create("Inbox", "# Old wire limit note\n\ndead\n").unwrap();
        store.move_note(&c.id, "Trash").unwrap();

        let hits = store.search("wire limit", 50).unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert!(ids.contains(&a.id.as_str()), "title hit found");
        assert!(ids.contains(&b.id.as_str()), "BODY hit found — full-text works");
        assert!(!ids.contains(&c.id.as_str()), "Trash never surfaces in search");
        // title hit outranks the body hit
        assert_eq!(hits[0].id, a.id);
        assert_eq!(hits[0].rank, 0);
        let body_hit = hits.iter().find(|h| h.id == b.id).unwrap();
        assert_eq!(body_hit.rank, 1);
        assert!(body_hit.snippet.contains("wire limit"));
        // blank query is empty, never everything
        assert!(store.search("  ", 50).unwrap().is_empty());
    }

    #[test]
    fn sort_hits_ranks_then_recency_then_id_lockstep() {
        // mirrors sortHits in src/services/search.test.ts — the TS twin asserts
        // this exact vector; a drift here means the shell and the dev surface
        // rank equal-rank hits differently.
        let hit = |id: &str, rank: u8, updated_at: i64| SearchHit {
            id: id.into(),
            title: "t".into(),
            folder_id: "Inbox".into(),
            kind: NoteKind::Note,
            rank,
            snippet: String::new(),
            match_start: 0,
            match_len: 1,
            updated_at,
        };
        let mut hits = vec![hit("old-body", 1, 10), hit("new-body", 1, 20), hit("title", 0, 1)];
        sort_hits(&mut hits);
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, ["title", "new-body", "old-body"], "rank asc → recency desc");
        // the id tie-break: identical rank + recency sorts ascending by id
        let mut ties = vec![hit("b", 1, 5), hit("a", 1, 5)];
        sort_hits(&mut ties);
        assert_eq!(ties[0].id, "a");
        assert_eq!(ties[1].id, "b");
    }

    #[test]
    fn plain_root_search_covers_a_user_folder_named_chats() {
        // LegacyRotli has no Chat front — a folder literally named "chats" is
        // just a folder, and its notes MUST stay findable (only a memex root's
        // chats/ transcripts are excluded).
        let (_dir, mut store) = bare();
        let n = store.create("chats", "# Chat ideas\n\nthe kelpie fragment\n").unwrap();
        let hits = store.search("kelpie", 50).unwrap();
        assert_eq!(hits.len(), 1, "plain-root chats/ note is searchable: {hits:?}");
        assert_eq!(hits[0].id, n.id);
    }

    #[test]
    fn memex_search_covers_staged_and_wiki_but_never_chats() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        fs::write(
            root.join("wiki/_inbox/staged.md"),
            "---\nshelf: Inbox\n---\n\n# Staged capture\n\nthe kelpie fragment\n",
        )
        .unwrap();
        fs::write(root.join("chats/k.md"), "# Chat\n\nthe kelpie fragment too\n").unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;

        // the staged note (projected to "Board") hits; the chat transcript never does
        let hits = store.search("kelpie", 50).unwrap();
        assert_eq!(hits.len(), 1, "staged yes, chats no: {hits:?}");
        assert_eq!(hits[0].folder_id, "Board");
        // curated wiki bodies stay findable (read-only ≠ unsearchable)
        assert!(!store.search("A wiki note", 50).unwrap().is_empty());
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

    #[test]
    fn set_pinned_toggles_without_bumping_updated() {
        let (_dir, mut store) = bare();
        let meta = store.create("Inbox", "# Pin me\n\nBody.\n").unwrap();
        assert!(!meta.pinned, "notes start unpinned");
        let before = store.read_frontmatter(&meta.id).unwrap();
        assert!(!before.pinned);

        // pin: the typed fact flips, `updated` is NOT bumped (a pin never
        // reorders by recency), and the body is untouched.
        store.set_pinned(&meta.id, true).unwrap();
        let after = store.read_frontmatter(&meta.id).unwrap();
        assert!(after.pinned, "pinned reads true");
        assert_eq!(after.updated, before.updated, "pin must not bump updated");
        let doc = store.read(&meta.id).unwrap();
        assert!(doc.pinned);
        assert_eq!(doc.body, "# Pin me\n\nBody.\n", "body untouched by pin");

        // unpin round-trips
        store.set_pinned(&meta.id, false).unwrap();
        assert!(!store.read_frontmatter(&meta.id).unwrap().pinned);

        // takes the wire id OR a rel path (the resolve_note_rel bridge)
        let rel = store.path_of(&meta.id).unwrap();
        store.set_pinned(&rel, true).unwrap();
        assert!(store.read(&meta.id).unwrap().pinned);
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
    fn rename_board_moves_the_file_and_returns_new_id() {
        let (_dir, mut store) = bare();
        let created = store.create_board("Inbox/excalidraw", None).unwrap();
        assert_eq!(created.id, "Inbox/excalidraw/untitled.excalidraw");

        // rename within the folder: id becomes the new relpath, kind stays Board
        let renamed = store.rename_board(&created.id, "My Sketch").unwrap();
        assert_eq!(renamed.id, "Inbox/excalidraw/My Sketch.excalidraw");
        assert_eq!(renamed.kind, NoteKind::Board);
        assert_eq!(renamed.folder_id, "Inbox/excalidraw");
        assert!(!store.root().join(&created.id).exists(), "old file is gone");
        assert!(store.root().join(&renamed.id).exists(), "new file is present");

        // path separators in a name are flattened to '-'; empty names refused
        let flat = store.rename_board(&renamed.id, "a/b").unwrap();
        assert_eq!(flat.id, "Inbox/excalidraw/a-b.excalidraw");
        assert!(store.rename_board(&flat.id, "   ").is_err(), "empty name refused");
        // a non-board id is refused
        assert!(store.rename_board("Inbox/note", "x").is_err());
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

    // contract v3.7 — the FILER lane is disjoint from the USER lane: the user still
    // can't write the curated brain, and the filer can ONLY write the brain, only
    // AI keys, and never a locked note.
    #[test]
    fn filer_lane_is_disjoint_and_files_notes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // USER lane UNCHANGED — still closed to the curated brain.
        assert!(store.writable("wiki/note.md").is_err());
        assert!(store.writable("wiki/Projects/x.md").is_err());

        // FILER lane — the brain is writable, everything else refused.
        assert!(store.filer_writable("wiki").is_ok());
        assert!(store.filer_writable("wiki/Projects").is_ok());
        assert!(store.filer_writable("wiki/_inbox/x.md").is_ok());
        assert!(store.filer_writable("chats/x.md").is_err());
        assert!(store.filer_writable("storage/x.png").is_err());
        assert!(store.filer_writable("").is_err());

        // stage a note in _inbox, then the FILER gives it an area/summary.
        let note = store.create("wiki/_inbox", "# Alazan 84\n\nland deal notes").unwrap();
        let rel = store.path_of(&note.id).unwrap();
        assert!(store.set_ai_field(&rel, "area", "Projects").is_ok());
        assert!(store.set_ai_field(&rel, "summary", "the Alazan 84 land deal").is_ok());
        // the allowlist refuses a USER key, a RESERVED key, and junk.
        assert!(store.set_ai_field(&rel, "shelf", "Inbox").is_err());
        assert!(store.set_ai_field(&rel, "locked", "true").is_err());
        assert!(store.set_ai_field(&rel, "bogus", "x").is_err());

        // a LOCKED note is untouchable by the filer (TOCTOU-safe fresh re-read).
        store.set_locked(&rel, true).unwrap();
        assert!(store.filer_writable(&rel).is_err());
        store.set_locked(&rel, false).unwrap();
        assert!(store.filer_writable(&rel).is_ok());

        // file_note: _inbox → wiki/Projects, id preserved, `updated` NOT bumped.
        let before = store.read_frontmatter(&rel).unwrap();
        let filed = store.file_note(&rel).unwrap();
        assert_eq!(filed.id, note.id);
        assert_eq!(filed.folder_id, "wiki/Projects");
        let new_rel = store.path_of(&note.id).unwrap();
        assert!(new_rel.starts_with("wiki/Projects/"));
        assert_eq!(store.read_frontmatter(&new_rel).unwrap().updated, before.updated);

        // UNDO direction (Phase 3): filer_move the filed note BACK to _inbox staging.
        let back = store.filer_move(&new_rel, "wiki/_inbox").unwrap();
        assert_eq!(back.id, note.id);
        assert_eq!(back.folder_id, "wiki/_inbox");

        // the ULID→rel bridge (v0.18.1): every filing entry point also takes the
        // note's WIRE id (its frontmatter ULID) — the shape the frontend holds.
        let staged_rel = store.path_of(&note.id).unwrap();
        assert_eq!(store.resolve_note_rel(&note.id).unwrap(), staged_rel);
        assert_eq!(store.resolve_note_rel(&staged_rel).unwrap(), staged_rel); // rel passes through
        assert!(store.set_ai_field(&note.id, "area", "Projects").is_ok());
        let refiled = store.file_note(&note.id).unwrap();
        assert_eq!(refiled.id, note.id);
        assert_eq!(refiled.folder_id, "wiki/Projects");
        let refiled_rel = store.path_of(&note.id).unwrap();
        assert!(store.filer_move(&note.id, "wiki/_inbox").is_ok()); // undo by ULID too
        assert!(!store.abs(&refiled_rel).is_file());

        // the METADATA PANEL's commands take the ULID too (the same bridge):
        // before this, corpus_frontmatter → read_frontmatter("<ULID>") was a raw
        // fs read of "<root>/<ULID>" — the panel's "No such file or directory"
        // (Seth's screenshot, 2026-07-01).
        let fm = store.read_frontmatter(&note.id).unwrap();
        assert_eq!(fm.id, note.id);
        store.set_locked(&note.id, true).unwrap();
        assert!(store.read_frontmatter(&note.id).unwrap().locked);
        store.set_locked(&note.id, false).unwrap();
        store.set_field(&note.id, "topic", "land").unwrap();
        assert!(store
            .read_frontmatter(&note.id)
            .unwrap()
            .fields
            .iter()
            .any(|l| field_key(l) == Some("topic")));
        // secure by ULID: the gitignore line must be the note's PATH, never the
        // ULID — and metadata must STILL read (secure only guards REMOTE models).
        store.set_secure(&note.id, true).unwrap();
        let staged = store.path_of(&note.id).unwrap();
        let ignored = fs::read_to_string(store.root.join(".gitignore")).unwrap();
        assert!(ignored.lines().any(|l| l.trim() == staged));
        assert!(!ignored.lines().any(|l| l.trim() == note.id));
        let fm = store.read_frontmatter(&note.id).unwrap();
        assert!(fm.secure);
        assert_eq!(fm.id, note.id);
        // read_for_ai by ULID: a secure note is refused remote, readable locally.
        assert!(store.read_for_ai(&note.id, false).is_err());
        assert!(store.read_for_ai(&note.id, true).is_ok());
        store.set_secure(&note.id, false).unwrap();

        // write_index — the one file the filer overwrites wholesale.
        assert!(store.write_index("Projects", "# Projects\n\n- Alazan 84\n").is_ok());
        assert!(store.abs("wiki/Projects/_index.md").is_file());
        // an EMPTY body removes the file: undoing the FIRST applied index
        // rewrite (journal before == "") restores "no file", not a 0-byte husk
        assert!(store.write_index("Projects", "").is_ok());
        assert!(!store.abs("wiki/Projects/_index.md").exists());
        assert!(store.write_index("Projects", "").is_ok(), "removing a missing index is a no-op");
    }

    /// #1 (audit 2026-07, CRITICAL): a SECURE note's `.gitignore` line is its
    /// PATH — a rename, a user move, and a filer move must all carry it along,
    /// or the flagged secret becomes committable the moment the file moves.
    #[test]
    fn gitignore_follows_a_secure_note_on_rename_move_and_filing() {
        let ignored_lines = |root: &Path| -> Vec<String> {
            fs::read_to_string(root.join(".gitignore"))
                .unwrap_or_default()
                .lines()
                .map(|l| l.trim().to_string())
                .collect()
        };

        // — legacy corpus: title rename (write) + user move (move_note) —
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store.create("Inbox", "# Api key\n\nsk-ant-abcdefghijklmnop123").unwrap();
        store.set_secure(&note.id, true).unwrap();
        let old_rel = store.path_of(&note.id).unwrap();
        assert!(ignored_lines(&store.root).contains(&old_rel));

        // retitle → the file renames; the gitignore line must follow
        store.write(&note.id, "# Rotated key\n\nsk-ant-abcdefghijklmnop123", false).unwrap();
        let renamed_rel = store.path_of(&note.id).unwrap();
        assert_ne!(renamed_rel, old_rel, "the title change renames the file");
        let lines = ignored_lines(&store.root);
        assert!(lines.contains(&renamed_rel), "new path must be ignored: {lines:?}");
        assert!(!lines.contains(&old_rel), "old line must be gone: {lines:?}");

        // user move (Archive) → same discipline
        store.move_note(&note.id, "Archive").unwrap();
        let archived_rel = store.path_of(&note.id).unwrap();
        assert!(archived_rel.starts_with("Archive/"));
        let lines = ignored_lines(&store.root);
        assert!(lines.contains(&archived_rel), "moved path must be ignored: {lines:?}");
        assert!(!lines.contains(&renamed_rel), "pre-move line must be gone: {lines:?}");

        // a NON-secure note's moves never touch the gitignore
        let plain = store.create("Inbox", "# Plain note\n\nnothing secret").unwrap();
        store.move_note(&plain.id, "Archive").unwrap();
        let plain_rel = store.path_of(&plain.id).unwrap();
        assert!(!ignored_lines(&store.root).contains(&plain_rel));

        // — memex corpus: the FILER lane (file_note) moves a secure note too —
        let tmp2 = TempDir::new().unwrap();
        let brain = tmp2.path().join("brain");
        seed_memex(&brain);
        let mut mx = CorpusStore::open(brain).unwrap();
        mx.os_trash = false;
        let staged = mx.create("wiki/_inbox", "# Card\n\n4242-4242-4242-4242").unwrap();
        mx.set_secure(&staged.id, true).unwrap();
        let staged_rel = mx.path_of(&staged.id).unwrap();
        assert!(ignored_lines(&mx.root).contains(&staged_rel));
        mx.set_ai_field(&staged.id, "area", "Projects").unwrap();
        mx.file_note(&staged.id).unwrap();
        let filed_rel = mx.path_of(&staged.id).unwrap();
        assert!(filed_rel.starts_with("wiki/Projects/"));
        let lines = ignored_lines(&mx.root);
        assert!(lines.contains(&filed_rel), "filed path must be ignored: {lines:?}");
        assert!(!lines.contains(&staged_rel), "staging line must be gone: {lines:?}");
    }

    /// Follow-up to #1 (review, 2026-07): the gitignore sync fires BEFORE the
    /// fs move — an unwritable `.gitignore` used to error AFTER the file had
    /// already moved, leaving the secure note at a path no ignore line covered
    /// and the id→path index pointing at the removed old rel ("note not found"
    /// for the rest of the session). Failing first keeps the error honest:
    /// nothing moved, the note still reads, the old ignore line still protects.
    #[test]
    fn gitignore_failure_aborts_a_secure_move_before_anything_moves() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store.create("Inbox", "# Api key\n\nsk-ant-abcdefghijklmnop123").unwrap();
        store.set_secure(&note.id, true).unwrap();
        let old_rel = store.path_of(&note.id).unwrap();

        // make every `.gitignore` write fail: a DIRECTORY at its path can't be
        // read (add sees "") and atomic_write's rename onto it errors
        fs::remove_file(store.root.join(".gitignore")).unwrap();
        fs::create_dir(store.root.join(".gitignore")).unwrap();

        // user move refuses…
        assert!(store.move_note(&note.id, "Archive").is_err());
        // …and NOTHING moved: same rel, file present, note still readable
        assert_eq!(store.path_of(&note.id).unwrap(), old_rel);
        assert!(store.root.join(&old_rel).is_file());
        assert!(store.read(&note.id).is_ok());

        // the title-rename branch of write() holds the same line
        assert!(store.write(&note.id, "# Rotated key\n\nsk-ant-abcdefghijklmnop123", false).is_err());
        assert_eq!(store.path_of(&note.id).unwrap(), old_rel);
        assert!(store.root.join(&old_rel).is_file());

        // a NON-secure note never touches the gitignore — its moves still work
        let plain = store.create("Inbox", "# Plain\n\nnothing secret").unwrap();
        store.move_note(&plain.id, "Archive").unwrap();
        assert!(store.path_of(&plain.id).unwrap().starts_with("Archive/"));
    }

    /// #21 (audit 2026-07): read_for_ai must run the secret DETECTOR when the
    /// `secure:` flag is absent — the auto-flag only fires when the metadata
    /// panel opens, so a never-inspected note with detectable secrets must not
    /// ride to a remote model on the missing flag.
    #[test]
    fn read_for_ai_runs_the_detector_not_just_the_flag() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        // detectable secret, NO secure: flag (the panel was never opened)
        let hot = store.create("Inbox", "# Stripe\n\ncard 4242424242424242").unwrap();
        assert!(store.read_for_ai(&hot.id, false).is_err(), "unflagged secret must refuse remote");
        assert!(store.read_for_ai(&hot.id, true).is_ok(), "a local model may read it");
        // a clean note passes remote
        let clean = store.create("Inbox", "# Groceries\n\neggs, milk").unwrap();
        assert!(store.read_for_ai(&clean.id, false).is_ok());
    }

    /// #22 (audit 2026-07): set_field is the USER lane — it must refuse the AI
    /// filer's keys (disjoint territories, BOTH directions) and honor the same
    /// writable() gate as every editor save.
    #[test]
    fn set_field_refuses_ai_keys_and_honors_the_write_gate() {
        let tmp = TempDir::new().unwrap();
        let brain = tmp.path().join("brain");
        seed_memex(&brain);
        fs::create_dir_all(brain.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(brain).unwrap();
        store.os_trash = false;

        let staged = store.create("wiki/_inbox", "# A staged note\n\nbody").unwrap();
        let rel = store.path_of(&staged.id).unwrap();
        // a user key on a user-writable note: fine
        assert!(store.set_field(&rel, "shelf", "[Inbox]").is_ok());
        // every AI key is refused in the user lane — even where writable() passes
        for key in AI_KEYS {
            assert!(store.set_field(&rel, key, "x").is_err(), "AI key `{key}` must refuse");
        }
        // reserved keys stay refused (existing behavior)
        assert!(store.set_field(&rel, "locked", "true").is_err());
        // the CURATED wiki is not user-writable — set_field must refuse it too
        assert!(store.set_field("wiki/note.md", "topic", "x").is_err());
    }

    /// #3 (audit 2026-07): the contract band and a brain's user-set read-only
    /// perms are enforced by the RUST write gates — both lanes — not only TS.
    #[test]
    fn out_of_band_or_read_only_brain_refuses_writes_in_rust() {
        // a memex on a FUTURE contract rotli wasn't built for → read-only, both lanes
        let tmp = TempDir::new().unwrap();
        let ahead = tmp.path().join("ahead");
        seed_memex(&ahead);
        fs::write(ahead.join("memex.json"), "{\"id\":\"mx_future\",\"contract\":\"9.9\",\"apps\":{}}")
            .unwrap();
        let mut store = CorpusStore::open(ahead).unwrap();
        store.os_trash = false;
        assert!(store.writable("chats/x.md").is_err(), "user lane closed out of band");
        assert!(store.filer_writable("wiki/_inbox").is_err(), "filer lane closed out of band");
        assert!(store.create("chats", "# chat").is_err());

        // in-band brain: open, then user-set read-only perms close both lanes live
        let inband = tmp.path().join("inband");
        seed_memex(&inband);
        let mut store = CorpusStore::open(inband).unwrap();
        store.os_trash = false;
        assert!(store.writable("chats/x.md").is_ok());
        assert!(store.filer_writable("wiki/_inbox").is_ok());
        store.set_perms_read_only(true);
        assert!(store.writable("chats/x.md").is_err(), "read-only perms close the user lane");
        assert!(store.filer_writable("wiki/_inbox").is_err(), "…and the filer lane");
        store.set_perms_read_only(false);
        assert!(store.writable("chats/x.md").is_ok(), "perms can re-open an in-band brain");
    }

    /// #44 (audit 2026-07): the webview's settings-write whitelist is NARROWER
    /// than the read table — the daemon's `organizer.json` and the committed
    /// `main.json` are not writable through corpus_settings_write.
    #[test]
    fn settings_write_whitelist_protects_daemon_and_main_files() {
        assert!(user_dot_writable("settings").is_ok());
        assert!(user_dot_writable("viewstate").is_ok());
        assert!(user_dot_writable("background").is_ok());
        assert!(user_dot_writable("organizer").is_err(), "daemon-owned state");
        assert!(user_dot_writable("main").is_err(), "main goes through corpus_main_write");
        assert!(user_dot_writable("junk").is_err());
        // the READ table still serves all five
        for f in ["settings", "viewstate", "background", "main", "organizer"] {
            assert!(dot_file(f).is_ok());
        }
    }

    #[test]
    fn stamp_to_ms_parses_both_rfc3339_and_date() {
        assert!(stamp_to_ms("2026-06-25T12:00:00Z").is_some());
        // a bare v3.5 date parses to that day at 00:00 UTC
        let a = stamp_to_ms("2026-06-25").unwrap();
        let b = stamp_to_ms("2026-06-25T00:00:00Z").unwrap();
        assert_eq!(a, b);
        assert!(stamp_to_ms("not-a-date").is_none());
        assert!(stamp_to_ms("2026/06/25").is_none()); // wrong separators
    }

    #[test]
    fn editing_a_memex_note_preserves_the_v35_frontmatter_and_bumps_updated() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let rel = "wiki/_inbox/pricing-aa11bb.md";
        fs::write(
            root.join(rel),
            "---\nid: 01ABC\nowner: rotli\ncreated: 2026-06-20\nupdated: 2026-06-20\narea:\nsummary:\ntags: []\nlinks:\nshelf: [Inbox]\nreach: [seth]\n---\n# Pricing\n\noriginal body\n",
        )
        .unwrap();

        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        // the note is reachable by its frontmatter id (indexed via list)
        let _ = store.list().unwrap();
        let meta = store.write("01ABC", "# Pricing\n\nedited body", false).unwrap();
        // the default "Inbox" shelf projects onto the Captures surface ("Board"), not wiki/_inbox
        assert_eq!(meta.folder_id, "Board");

        // the corpus tracks the title in the filename via filename_for = slug-<id6>,
        // the SAME scheme as the v3.5 noteStem — so the file stays in wiki/_inbox with
        // a slug-id6 name (here the id "01ABC" is short, last-6 ⇒ "01abc"). The old
        // name is gone (a rename, never a copy).
        let inbox = root.join("wiki/_inbox");
        let files: Vec<String> = fs::read_dir(&inbox)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".md"))
            .collect();
        assert_eq!(files, vec!["pricing-01abc.md"], "expected one slug-id6 file, got {files:?}");
        let on_disk = fs::read_to_string(inbox.join("pricing-01abc.md")).unwrap();
        let _ = rel; // the original path is gone after the title-tracking rename
        // the v3.5 user + AI metadata rode through untouched (foreign preservation)
        assert!(on_disk.contains("owner: rotli"), "owner lost:\n{on_disk}");
        assert!(on_disk.contains("shelf: [Inbox]"), "shelf lost:\n{on_disk}");
        assert!(on_disk.contains("reach: [seth]"), "reach lost:\n{on_disk}");
        assert!(on_disk.contains("summary:"), "summary lost:\n{on_disk}");
        // created preserved as the original DATE; updated bumped to a DATE (not RFC3339)
        assert!(on_disk.contains("created: 2026-06-20"), "created changed:\n{on_disk}");
        assert!(!on_disk.contains("updated: 2026-06-20"), "updated not bumped:\n{on_disk}");
        let updated_line = on_disk.lines().find(|l| l.starts_with("updated:")).unwrap();
        assert!(!updated_line.contains('T'), "updated should be a date, not RFC3339: {updated_line}");
        // the body changed
        assert!(on_disk.contains("edited body"));
        assert!(!on_disk.contains("original body"));
    }

    #[test]
    fn shelf_of_parses_the_v35_field() {
        let fm = |line: &str| Frontmatter { foreign: vec![line.to_string()], ..Default::default() };
        assert_eq!(shelf_of(&fm("shelf: [Inbox]")), vec!["Inbox"]);
        assert_eq!(shelf_of(&fm("shelf: [Myela/Payments, Work]")), vec!["Myela/Payments", "Work"]);
        assert_eq!(shelf_of(&fm("shelf: Inbox")), vec!["Inbox"]); // bare (no brackets)
        assert_eq!(shelf_of(&fm("shelf: []")), Vec::<String>::new());
        assert_eq!(shelf_of(&Frontmatter::default()), Vec::<String>::new()); // absent
    }

    #[test]
    fn shelf_projection_re_homes_wiki_notes_and_synthesizes_folders() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root); // also writes a shelf-less wiki/note.md
        // a rotli staging note (v3.5): lives in wiki/_inbox, shelf = Inbox
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        fs::write(
            root.join("wiki/_inbox/pricing-aa11bb.md"),
            "---\nid: 01ABC\nowner: rotli\ncreated: 2026-06-25\nupdated: 2026-06-25\nshelf: [Inbox]\nreach: [seth]\n---\n# Pricing\n\nbody\n",
        )
        .unwrap();
        // a note filed to a nested shelf (the LLM's eventual home)
        fs::write(
            root.join("wiki/_inbox/q3-cc22dd.md"),
            "---\nid: 01DEF\nshelf: [Myela/Payments]\nreach: [seth]\n---\n# Q3\n\nbody\n",
        )
        .unwrap();

        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);
        let list = store.list().unwrap();

        let folder_of_note = |id: &str| {
            list.notes.iter().find(|n| n.title == id).map(|n| n.folder_id.clone()).unwrap()
        };
        // staging notes are PROJECTED onto their shelf, not wiki/_inbox. The default
        // "Inbox" shelf routes to the Captures surface ("Board"); a real shelf stays.
        assert_eq!(folder_of_note("Pricing"), "Board");
        assert_eq!(folder_of_note("Q3"), "Myela/Payments");
        // the shelf-less curated note falls back to its disk folder
        assert_eq!(folder_of_note("A wiki note"), "wiki");

        let has = |id: &str| list.folders.iter().any(|f| f.id == id);
        // the shelf folders (+ the nested ancestor) were synthesized — the default
        // "Inbox" shelf lands on "Board" (Captures), a real shelf keeps its path
        assert!(has("Board"));
        assert!(has("Myela"), "the nested shelf's ancestor must exist");
        assert!(has("Myela/Payments"));
        let parent_of = |id: &str| list.folders.iter().find(|f| f.id == id).unwrap().parent_id.clone();
        assert_eq!(parent_of("Myela/Payments"), Some("Myela".to_string()));
        assert_eq!(parent_of("Myela"), None);
        // the wiki/_inbox staging dir is NOT surfaced as a browsable folder
        assert!(!has("wiki/_inbox"));
        // the real wiki folder still exists (curated notes live there)
        assert!(has("wiki"));
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
        // storage/ — the binary asset store: surfaced READ-ONLY (the Storage front),
        // never writable via the note path (writable() refuses NoteRO, asserted below).
        assert_eq!(surfaced(m, "storage"), Surface::NoteRO);
        assert_eq!(surfaced(m, "storage/graph.png"), Surface::NoteRO);
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

        // ⌘⇧N from a non-writable folder (e.g. the hidden self/) no longer FAILS —
        // it lands the board in the storage/excalidraw board lane so a board always
        // saves (Seth, 2026-07-07). write_board takes an explicit path with no such
        // redirect, so a hidden root is still refused outright.
        let staged = store.create_board("self", None).unwrap();
        assert_eq!(staged.kind, NoteKind::Board);
        assert_eq!(staged.folder_id, "storage/excalidraw");
        // …and a board in that lane is EDITABLE (the jorge case: saves succeed).
        assert!(store.write_board(&staged.id, EMPTY_EXCALIDRAW).is_ok());
        assert!(store.writable("storage/other.png").is_err(), "rest of storage stays read-only");
        assert!(store.write_board("self/x.excalidraw", "{}").is_err());
        // …and a board created directly on chats/ (rotli's owned surface) stays there
        let meta = store.create_board("chats", None).unwrap();
        assert_eq!(meta.kind, NoteKind::Board);
        assert_eq!(meta.folder_id, "chats");
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

        // NO rotli reserved folders scaffolded inside someone's memex-vault. (We omit
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
            "a root memex-vault doc surfaced as an editable note"
        );
        // every surfaced note lives under wiki/ or chats/, nothing else
        assert!(
            folders_of.iter().all(|f| *f == "wiki" || *f == "chats"),
            "a note outside wiki/+chats/ surfaced: {folders_of:?}"
        );
    }

    #[test]
    fn legacy_open_still_scaffolds_reserved_folders() {
        // a plain (non-memex) dir keeps today's behavior exactly — except the
        // Brain reserved row became the external Vault (Track 2): we now scaffold
        // "Vault" in its place, never "Brain".
        let dir = TempDir::new().unwrap();
        let mut store = CorpusStore::open(dir.path().join("corpus")).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::LegacyRotli);
        for name in ["Inbox", "Vault", "Storage", "Board", "Archive", "Trash"] {
            assert!(
                store.root().join(name).is_dir(),
                "legacy open must still scaffold the reserved folder {name}"
            );
        }
        // "Brain" is no longer a reserved row — it is NOT scaffolded by rotli.
        assert!(
            !store.root().join("Brain").exists(),
            "Brain must no longer be scaffolded as a reserved row"
        );
    }

    // ── Track 2: multi-root foundation (Build Step 1) ──

    #[test]
    fn split_and_compose_round_trip_the_id_scheme() {
        // bare ids → the default root, unchanged (the byte-identical gate)
        assert_eq!(split_root_id("Inbox"), ("default".into(), "Inbox".into()));
        assert_eq!(split_root_id("Inbox/Work"), ("default".into(), "Inbox/Work".into()));
        assert_eq!(
            split_root_id("01JXF00000000000000000000A"),
            ("default".into(), "01JXF00000000000000000000A".into())
        );
        // a non-default root prefixes "<rootid>:" and splits on the FIRST colon
        assert_eq!(split_root_id("vault:wiki/foo"), ("vault".into(), "wiki/foo".into()));
        assert_eq!(split_root_id("vault:chats/x.md"), ("vault".into(), "chats/x.md".into()));
        assert_eq!(split_root_id("vault:"), ("vault".into(), "".into()));

        // compose: default → BARE (no prefix, ever); non-default → prefixed
        assert_eq!(compose_root_id("default", "Inbox"), "Inbox");
        assert_eq!(compose_root_id("default", "Inbox/Work"), "Inbox/Work");
        assert_eq!(compose_root_id("vault", "wiki/foo"), "vault:wiki/foo");

        // round-trips for the default root are IDENTITY on the wire
        for id in ["Inbox", "Inbox/Work", "Storage", "01JXF00000000000000000000A"] {
            let (r, rel) = split_root_id(id);
            assert_eq!(compose_root_id(&r, &rel), id, "default round-trip must be byte-identical");
        }
    }

    #[test]
    fn colon_is_rejected_inside_a_path_component() {
        // the router char must never be allowed inside a folder name, or a
        // folder literally named "a:b" could collide with "<rootid>:path".
        let (_dir, mut store) = bare();
        assert!(store.create_folder("a:b", None).is_err(), "colon name must be rejected");
        assert!(store.create("a:b", "# nope\n").is_err(), "colon folder must be rejected");
        assert!(validate_component("plain").is_ok());
        assert!(validate_component("has:colon").is_err());
    }

    #[test]
    fn registry_persists_and_resolves_default() {
        // the root registry serializes and the default is always recoverable.
        let mut reg = RootRegistry::default();
        assert!(reg.get(DEFAULT_ROOT_ID).is_none());
        reg.roots.push(CorpusRoot {
            id: DEFAULT_ROOT_ID.to_string(),
            label: "Notes".to_string(),
            abs_path: PathBuf::from("/tmp/rotli2"),
        });
        assert_eq!(reg.roots.len(), 1);
        assert_eq!(reg.get(DEFAULT_ROOT_ID).unwrap().abs_path, PathBuf::from("/tmp/rotli2"));
        // JSON round-trips
        let json = serde_json::to_string(&reg).unwrap();
        let back: RootRegistry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.roots, reg.roots);
    }

    #[test]
    fn ensure_reserved_never_runs_for_a_memex_root() {
        // a NON-default / memex root (a TempDir fake memex) must never get the
        // local reserved scaffold — Invariant 2. Proven structurally: open_memex
        // skips ensure_reserved_folders, so NONE of the local reserved rows
        // (incl. the renamed "Vault") are created inside the memex.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);
        for name in ["Inbox", "Vault", "Storage", "Board"] {
            assert!(
                !store.root().join(name).exists(),
                "memex/non-default root must NEVER scaffold the reserved folder {name}"
            );
        }
    }

    #[test]
    fn brain_to_vault_rename_never_touches_an_existing_brain_folder() {
        // Invariant 4: a pre-existing on-disk Brain/ with a note is NOT moved,
        // renamed, or deleted by the rename — it survives as a plain folder.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("corpus");
        fs::create_dir_all(root.join("Brain")).unwrap();
        fs::write(
            root.join("Brain/kept.md"),
            "---\nid: 01BRAINKEEP000000000000AAA\ncreated: 2026-06-01T00:00:00Z\nupdated: 2026-06-01T00:00:00Z\npinned: false\n---\n\n# A Brain note\n",
        )
        .unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        // the Brain folder + its note still exist on disk after open
        assert!(store.root().join("Brain").is_dir(), "existing Brain folder must survive");
        assert!(store.root().join("Brain/kept.md").is_file(), "the note must survive");
        // and it surfaces as a plain folder in the listing (no data loss)
        let list = store.list().unwrap();
        assert!(list.folders.iter().any(|f| f.id == "Brain"), "Brain surfaces as a plain folder");
        let note = list.notes.iter().find(|n| n.id == "01BRAINKEEP000000000000AAA").unwrap();
        assert_eq!(note.folder_id, "Brain");
    }

    /// Mirror of `corpus_list`'s aggregation, run directly against a registry so
    /// the routing/prefixing layer is unit-testable without a Tauri State. Keep
    /// in lockstep with `corpus_list`.
    fn aggregate(reg: &mut CorpusRegistry) -> CorpusList {
        let mut ids: Vec<String> = reg.stores.keys().cloned().collect();
        ids.sort();
        if let Some(pos) = ids.iter().position(|i| *i == reg.default_id) {
            let d = ids.remove(pos);
            ids.insert(0, d);
        }
        let mut folders: Vec<FolderMeta> = Vec::new();
        let mut notes: Vec<NoteMeta> = Vec::new();
        for id in ids {
            let store = reg.stores.get_mut(&id).unwrap();
            let list = store.list().unwrap();
            for mut f in list.folders {
                f.parent_id = f.parent_id.map(|p| compose_root_id(&id, &p));
                f.id = compose_root_id(&id, &f.id);
                folders.push(f);
            }
            for mut n in list.notes {
                n = prefix_meta(&id, n);
                if id != reg.default_id && n.kind == NoteKind::Note {
                    n.id = compose_root_id(&id, &n.id);
                }
                notes.push(n);
            }
        }
        CorpusList { folders, notes }
    }

    #[test]
    fn default_only_registry_emits_bare_ids() {
        // Invariant 1, at the routing layer: with ONLY the default root, every
        // emitted folder/note id is BARE — byte-identical to the single-store world.
        let (_dir, mut store) = fresh();
        store.create("Inbox/Work", "# A routed note\n").unwrap();
        let mut reg = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        reg.insert(DEFAULT_ROOT_ID.to_string(), store);
        let list = aggregate(&mut reg);
        for f in &list.folders {
            assert!(!f.id.contains(':'), "default folder id must be bare: {}", f.id);
            assert!(f.parent_id.as_deref().map(|p| !p.contains(':')).unwrap_or(true));
        }
        for n in &list.notes {
            assert!(!n.id.contains(':'), "default note id must be bare: {}", n.id);
            assert!(!n.folder_id.contains(':'), "default folder_id must be bare: {}", n.folder_id);
        }
        assert!(list.folders.iter().any(|f| f.id == "Inbox/Work"));
    }

    #[test]
    fn vault_root_prefixes_ids_and_scopes_to_wiki_and_chats() {
        // Invariants 1+2+3 at the routing layer: a memex "vault" root added beside
        // the default emits "vault:"-prefixed ids, surfaces ONLY wiki/ + chats/,
        // and never pollutes the default root's bare ids.
        let (_ddir, default_store) = fresh();
        let vdir = TempDir::new().unwrap();
        let vroot = vdir.path().join("brain");
        seed_memex(&vroot);
        let mut vault_store = CorpusStore::open(vroot.clone()).unwrap();
        vault_store.os_trash = false;
        assert_eq!(vault_store.layout, Layout::Memex);

        let mut reg = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        reg.insert(DEFAULT_ROOT_ID.to_string(), default_store);
        reg.insert("vault".to_string(), vault_store);
        let list = aggregate(&mut reg);

        // default ids stay bare; vault ids are prefixed
        let default_folders: Vec<&str> =
            list.folders.iter().filter(|f| !f.id.contains(':')).map(|f| f.id.as_str()).collect();
        assert!(default_folders.contains(&"Inbox"), "default Inbox stays bare");
        let vault_folders: Vec<&str> = list
            .folders
            .iter()
            .filter(|f| f.id.starts_with("vault:"))
            .map(|f| f.id.as_str())
            .collect();
        assert!(vault_folders.contains(&"vault:wiki"), "wiki/ surfaces, prefixed");
        assert!(vault_folders.contains(&"vault:chats"), "chats/ surfaces, prefixed");
        // the brain's memory never surfaces, even prefixed
        assert!(
            !list.folders.iter().any(|f| f.id.starts_with("vault:self")
                || f.id.starts_with("vault:history")),
            "self/ + history/ must never surface from the vault"
        );
        // every vault note lives under wiki/ or chats/ and its folder_id is prefixed
        for n in list.notes.iter().filter(|n| n.folder_id.starts_with("vault:")) {
            assert!(
                n.folder_id == "vault:wiki" || n.folder_id == "vault:chats",
                "vault note outside wiki/+chats/: {}",
                n.folder_id
            );
        }
        // the memex root was never scaffolded with local reserved rows
        for name in ["Inbox", "Vault", "Storage", "Board"] {
            assert!(!vroot.join(name).exists(), "vault memex must not be scaffolded: {name}");
        }
    }

    #[test]
    fn watcher_debounces_external_bursts_and_ignores_our_writes() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), suppress.clone(), move |paths: &[PathBuf]| {
            assert!(!paths.is_empty(), "a fire must carry the burst's paths");
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
