//! Phase 2 — the corpus. Files become real.
//!
//! THE CORPUS LAW: plain `.md` files on the user's Mac are the truth. Folders
//! on disk = folders in the sidebar. Each note carries exactly four facts in a
//! YAML frontmatter block — `id`, `created`, `updated`, `pinned` — added on
//! first edit/create; the title is DERIVED from the first non-empty line,
//! never stored. A managed `aliases` line preserves human link names across
//! title/file renames. Foreign frontmatter keys pass through untouched: a note
//! must open cleanly in any other editor, forever.
//!
//! `.rotli/` inside the corpus root holds machine-local settings/view state,
//! rebuildable indexes, and the portable Main/named-view reference manifests.
//! Deleting it never deletes content, but does remove explicit view layout.
//!
//! Writes are atomic (temp file in the same dir + rename). Deletes go to the
//! OS trash (fallback: `.rotli/trash/`) — never a hard delete. A `notify`
//! watcher (debounced) tells the frontend when the corpus changes under it,
//! ignoring private `.rotli/` runtime files and our own in-flight writes while
//! observing external Main/named-view manifest edits.

pub use crate::search_match::{leading_snippet, search_match, sort_hits, SearchHit, SearchMatch};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use ulid::Ulid;

// ─── the one place the corpus root is decided ───────────────────────────────

/// Historical default folder name, retained only for legacy migration probes.
/// Fresh installs explicitly select a vault and never derive their location
/// from this constant.
pub const CORPUS_DIR_NAME: &str = "rotli";
/// The app-owned, fully rebuildable sidecar folder inside the corpus root.
pub const DOT_DIR: &str = ".rotli";

/// One reference node shared by Main and named workspace views. These trees
/// never own content; they point at the same stable note/path identities the
/// corpus already exposes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub(crate) enum ReferenceNode {
    Folder {
        folder: String,
        children: Vec<ReferenceNode>,
    },
    Note {
        note: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ReferenceManifest {
    pub version: u8,
    pub tree: Vec<ReferenceNode>,
}

impl Default for ReferenceManifest {
    fn default() -> Self {
        Self {
            version: 1,
            tree: Vec::new(),
        }
    }
}

/// Project the physical folder graph into a reference tree. `parent=None` is
/// the vault root; every nested folder remains nested and every surfaced item
/// appears exactly once under its physical/user-facing folder.
fn reference_tree_from_list(list: &CorpusList, parent: Option<&str>) -> Vec<ReferenceNode> {
    let folder_id = parent.unwrap_or("");
    let mut tree: Vec<ReferenceNode> = list
        .folders
        .iter()
        .filter(|folder| folder.parent_id.as_deref() == parent)
        .map(|folder| ReferenceNode::Folder {
            folder: folder.name.clone(),
            children: reference_tree_from_list(list, Some(&folder.id)),
        })
        .collect();
    tree.extend(
        list.notes
            .iter()
            .filter(|note| note.folder_id == folder_id)
            .map(|note| ReferenceNode::Note {
                note: note.id.clone(),
            }),
    );
    tree
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct NamedView {
    pub name: String,
    pub tree: Vec<ReferenceNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct ViewsManifest {
    pub version: u8,
    pub views: Vec<NamedView>,
}

impl Default for ViewsManifest {
    fn default() -> Self {
        Self {
            version: 1,
            views: Vec::new(),
        }
    }
}

pub fn default_corpus_root(app: &tauri::AppHandle) -> PathBuf {
    // Compatibility probe only. Fresh installs choose a vault explicitly and
    // never create or silently bind this historical Documents location.
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
            .any(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| !n.starts_with('.'))
                    .unwrap_or(true)
            });
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
    /// An existing Markdown tree adopted in place. It receives only `.rotli/`
    /// sidecars—never Rotli's reserved folder scaffold or welcome note.
    #[serde(default)]
    pub adopted: bool,
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
    if cfg!(debug_assertions) {
        let Some(cfg) = read_dev_source_config(app) else {
            return Vec::new();
        };
        let fallback_read_only = crate::development_read_only(app);
        let mut roots = vec![CorpusRoot {
            id: DEFAULT_ROOT_ID.to_string(),
            label: match (is_memex_root(&cfg.corpus.abs_path), fallback_read_only) {
                (true, true) => "Production vault · read-only".to_string(),
                (false, true) => "Production notes · read-only".to_string(),
                (true, false) => "Development vault".to_string(),
                (false, false) => "Development notes".to_string(),
            },
            abs_path: cfg.corpus.abs_path,
            adopted: cfg.corpus.adopted,
        }];
        // A production fallback remains one read-only source. An explicitly
        // selected development config is different: it must exercise the same
        // multi-vault registry as the installed app instead of collapsing every
        // newly linked vault into the next process's primary root.
        if !fallback_read_only {
            roots.extend(cfg.brains.into_iter().filter_map(|brain| {
                is_memex_root(&brain.abs_path).then_some(CorpusRoot {
                    id: brain.id,
                    label: brain.label,
                    abs_path: brain.abs_path,
                    adopted: false,
                })
            }));
            roots.extend(cfg.folders);
        }
        return roots;
    }
    // demo mode: a single isolated demo memex — the real brains/folders are
    // hidden and corpus.json is never touched (the maintainer, 2026-07-07).
    if demo_active(app) {
        if let Some(demo) = ensure_demo_memex(app) {
            return vec![CorpusRoot {
                id: DEFAULT_ROOT_ID.to_string(),
                label: "Notes".to_string(),
                abs_path: demo,
                adopted: false,
            }];
        }
    }
    if !is_configured(app) {
        return Vec::new();
    }
    let cfg = ensure_corpus_config(app);
    let mut out: Vec<CorpusRoot> = vec![CorpusRoot {
        id: DEFAULT_ROOT_ID.to_string(),
        label: "Notes".to_string(),
        abs_path: resolve_corpus(app),
        adopted: cfg.corpus.adopted,
    }];
    for b in &cfg.brains {
        if is_memex_root(&b.abs_path) {
            out.push(CorpusRoot {
                id: b.id.clone(),
                label: b.label.clone(),
                abs_path: b.abs_path.clone(),
                adopted: false,
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
    #[serde(default)]
    pub adopted: bool,
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
    /// Strict on read: a corrupt perms value fails the config parse (and takes
    /// the existing .bak + re-derive recovery) instead of the old fail-open
    /// behavior where any unknown string compared unequal to "read-only" and
    /// left the brain writable.
    pub perms: crate::memex::MemexPerms,
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
    app.path().app_config_dir().ok().map(|d| {
        d.join(if cfg!(debug_assertions) {
            "corpus.dev.json"
        } else {
            "corpus.json"
        })
    })
}

fn production_corpus_config_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("corpus.json"))
}

fn read_config_path(path: &Path) -> Option<CorpusConfig> {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

/// Read a config without mutating it. A valid `.bak` is an emergency fallback:
/// an older debug recovery bug could rename `corpus.json` while looking for
/// `corpus.dev.json`. Reading the backup keeps the production binding intact
/// until the release app next writes its config; dev never restores or edits it.
fn read_config_path_or_backup(path: &Path) -> Option<CorpusConfig> {
    read_config_path(path).or_else(|| read_config_path(&path.with_extension("json.bak")))
}

pub fn read_corpus_config(app: &tauri::AppHandle) -> Option<CorpusConfig> {
    corpus_config_file(app).and_then(|f| read_config_path_or_backup(&f))
}

fn configured_at(config_file: &Path, config_dir: &Path, default_root: &Path) -> bool {
    read_config_path_or_backup(config_file).is_some_and(|config| config.corpus.abs_path.is_dir())
        || [
            "corpus-root.txt",
            "corpus-memex-root.txt",
            "corpus-roots.json",
            "memex-instances.json",
        ]
        .iter()
        .any(|name| config_dir.join(name).exists())
        || default_root.exists()
}

/// Whether this installation has deliberately selected a primary notes folder.
/// Existing installs count as configured through either the unified config,
/// one of its legacy pointers, or the historical default folder. This probe is
/// read-only: a fresh launch must not create `~/Documents/rotli` or write a
/// `corpus.json` before the user chooses a vault.
pub fn is_configured(app: &tauri::AppHandle) -> bool {
    if demo_active(app) {
        return true;
    }
    // Development may temporarily mirror the production vault so the shell can
    // boot, but that fallback is not an onboarding choice. Only the isolated
    // corpus.dev.json with a usable root proves the developer explicitly
    // selected a vault; a stale/deleted selection returns to activation.
    if cfg!(debug_assertions) {
        return development_source_config(read_corpus_config(app), None).is_some();
    }
    use tauri::Manager;
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    let Some(config_file) = corpus_config_file(app) else {
        return false;
    };
    configured_at(&config_file, &dir, &default_corpus_root(app))
}

/// The development shell mirrors the production corpus as its single visible
/// source and uses the same guarded read/write semantics as the installed app.
/// If a production
/// config predating the unified model is all that exists, promote the active
/// memex from the isolated dev config snapshot instead of showing a second notes
/// root beside it.
fn dev_primary_from_config(cfg: CorpusConfig) -> Option<CorpusConfig> {
    let source = if is_memex_root(&cfg.corpus.abs_path) {
        cfg.corpus.abs_path.clone()
    } else if let Some(brain) = cfg
        .active_brain_id
        .as_deref()
        .and_then(|id| cfg.brains.iter().find(|b| b.id == id))
        .filter(|b| is_memex_root(&b.abs_path))
        .or_else(|| cfg.brains.iter().find(|b| is_memex_root(&b.abs_path)))
    {
        brain.abs_path.clone()
    } else if cfg.corpus.abs_path.exists() {
        cfg.corpus.abs_path.clone()
    } else {
        return None;
    };
    Some(CorpusConfig {
        version: cfg.version,
        corpus: CorpusRef {
            abs_path: source,
            adopted: false,
        },
        brains: Vec::new(),
        folders: Vec::new(),
        active_brain_id: None,
    })
}

fn development_source_config(
    explicit: Option<CorpusConfig>,
    production_fallback: Option<CorpusConfig>,
) -> Option<CorpusConfig> {
    explicit
        .filter(|config| config.corpus.abs_path.is_dir())
        .or_else(|| production_fallback.and_then(dev_primary_from_config))
}

fn read_dev_source_config(app: &tauri::AppHandle) -> Option<CorpusConfig> {
    development_source_config(
        read_corpus_config(app),
        production_corpus_config_file(app).and_then(|f| read_config_path_or_backup(&f)),
    )
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
/// next activation (the maintainer, 2026-07-07 — v2 is the public, rotli-about-rotli seed).
const DEMO_SEED_VERSION: &str = "3";

/// The bundled seed content, written into memex-demo on first activation. It is a
/// PUBLIC demo — general, about rotli itself, nothing personal (it ships in
/// screenshots and demos). `.rotli/main.json` seeds a hand-arranged Main so the
/// demo shows the same note reachable two ways: in Main (your view) and in the
/// Library (where it lives).
const DEMO_SEED: &[(&str, &str)] = &[
    ("memex.json", include_str!("../demo-seed/memex.json")),
    ("MAP.md", include_str!("../demo-seed/MAP.md")),
    ("inbox.md", include_str!("../demo-seed/inbox.md")),
    (".rotli/main.json", include_str!("../demo-seed/main.json")),
    (
        "wiki/guides/welcome-to-rotli.md",
        include_str!("../demo-seed/wiki/guides/welcome-to-rotli.md"),
    ),
    (
        "wiki/guides/main-and-the-library.md",
        include_str!("../demo-seed/wiki/guides/main-and-the-library.md"),
    ),
    (
        "wiki/ideas/note-taking-that-lasts.md",
        include_str!("../demo-seed/wiki/ideas/note-taking-that-lasts.md"),
    ),
    (
        "wiki/reading/local-first-software.md",
        include_str!("../demo-seed/wiki/reading/local-first-software.md"),
    ),
    (
        "wiki/_inbox/try-quick-capture.md",
        include_str!("../demo-seed/wiki/_inbox/try-quick-capture.md"),
    ),
    (
        "wiki/_inbox/weekend-project.md",
        include_str!("../demo-seed/wiki/_inbox/weekend-project.md"),
    ),
    (
        "chats/getting-started.md",
        include_str!("../demo-seed/chats/getting-started.md"),
    ),
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
    app.path().app_config_dir().ok().map(|d| {
        d.join(if cfg!(debug_assertions) {
            "demo.dev.on"
        } else {
            "demo.on"
        })
    })
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
    if cfg!(debug_assertions) {
        return ensure_corpus_config(app).corpus.abs_path;
    }
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
    if cfg!(debug_assertions) {
        if let Some(cfg) = read_dev_source_config(app) {
            return cfg;
        }
    }
    if let Some(cfg) = read_corpus_config(app) {
        return cfg;
    }
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    // The selected config that EXISTS but won't parse must NOT be silently re-migrated over
    // (that would drop added folders / re-add forgotten brains / reset the active
    // pick). Preserve the bad file as `.bak` + log, then re-derive from the legacy files.
    let cfg_file = corpus_config_file(app).unwrap_or_else(|| dir.join("corpus.json"));
    if cfg_file.exists() {
        let backup = cfg_file.with_extension("json.bak");
        eprintln!(
            "rotli: {} is unreadable — preserving it as {}, re-deriving from legacy files",
            cfg_file.display(),
            backup.display()
        );
        let _ = fs::rename(&cfg_file, backup);
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
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
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
                    perms: crate::memex::MemexPerms::ReadOnly,
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
        // legacy string input parses fail-closed: an unrecognized value becomes
        // read-only instead of dropping the instance (or opening a write lane)
        let perms = crate::memex::MemexPerms::parse(&inst.perms)
            .unwrap_or(crate::memex::MemexPerms::ReadOnly);
        if let Some(b) = brains.iter_mut().find(|b| canon(&b.abs_path) == pcanon) {
            b.memex_id = mxid;
            b.mode = inst.mode.clone();
            b.perms = perms;
        } else {
            let id = unique_brain_id(&brains, &inst.label);
            brains.push(ConnectedBrain {
                id,
                label: inst.label.clone(),
                abs_path: path,
                memex_id: mxid,
                mode: inst.mode.clone(),
                perms,
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
        corpus: CorpusRef {
            abs_path: corpus_path,
            adopted: false,
        },
        brains,
        folders,
        active_brain_id,
    }
}

// ─── brain + corpus mutators (write ONLY corpus.json) ───────────────────────

/// Carry the CURRENT corpus's `.rotli/settings.json` to a newly adopted root
/// that has NONE (vault-vs-brain, 2026-07-26): onboarding writes its choices —
/// including the Brain-vs-raw decision — before the corpus switch, and losing
/// them silently re-enabled the Brain on a vault the user explicitly chose raw
/// (pressure-test). A destination that already has settings keeps them: its
/// own prior choices outrank this flow's. Never touches any other file.
pub fn carry_settings(current: &Path, new_root: &Path) -> Result<(), String> {
    let src = current.join(".rotli").join("settings.json");
    let dst_dir = new_root.join(".rotli");
    let dst = dst_dir.join("settings.json");
    if !src.is_file() || dst.exists() {
        return Ok(());
    }
    fs::create_dir_all(&dst_dir).map_err(|e| format!("create {}: {e}", dst_dir.display()))?;
    fs::copy(&src, &dst)
        .map_err(|e| format!("carry settings: {e}"))
        .map(|_| ())
}

fn upsert_brain_config(
    cfg: &mut CorpusConfig,
    brain: ConnectedBrain,
    make_active: bool,
) -> Result<String, String> {
    let target = canon(&brain.abs_path);
    if canon(&cfg.corpus.abs_path) == target {
        return Err(
            "That folder is already your vault — it can't also be a linked library.".into(),
        );
    }
    let existing = cfg.brains.iter().find(|b| canon(&b.abs_path) == target);
    if let (Some(existing), Some(new_id)) = (existing, brain.memex_id.as_deref()) {
        if existing
            .memex_id
            .as_deref()
            .is_some_and(|previous| previous != new_id)
        {
            return Err(
                "This folder is a different vault than the one rotli connected to — refusing."
                    .into(),
            );
        }
    }
    let id = existing.map(|b| b.id.clone()).unwrap_or_else(|| {
        if brain.id.is_empty() {
            unique_brain_id(&cfg.brains, &brain.label)
        } else {
            brain.id.clone()
        }
    });
    let entry = ConnectedBrain {
        id: id.clone(),
        ..brain
    };
    cfg.brains.retain(|b| canon(&b.abs_path) != target);
    cfg.brains.push(entry);
    if make_active || cfg.active_brain_id.is_none() {
        cfg.active_brain_id = Some(id.clone());
    }
    Ok(id)
}

/// Apply one active-vault switch in memory. A compatible outgoing Rotli vault
/// becomes a linked library in the same config write, so the sidebar can switch
/// back; the incoming linked row is removed to preserve one-path/one-role.
fn switch_corpus_config(
    mut cfg: CorpusConfig,
    path: PathBuf,
    adopted: bool,
) -> Result<CorpusConfig, String> {
    let target = canon(&path);
    let outgoing = (canon(&cfg.corpus.abs_path) != target)
        .then(|| crate::memex::brain_connect_view(&cfg.corpus.abs_path).ok())
        .flatten()
        .map(|meta| ConnectedBrain {
            id: String::new(),
            label: meta.label,
            abs_path: cfg.corpus.abs_path.clone(),
            memex_id: Some(meta.memex_id),
            mode: meta.mode,
            perms: meta.perms,
        });
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
    cfg.corpus = CorpusRef {
        abs_path: path,
        adopted,
    };
    if let Some(outgoing) = outgoing {
        let _ = upsert_brain_config(&mut cfg, outgoing, false)?;
    }
    Ok(cfg)
}

/// Resolve an active-vault switch through the persisted registry instead of
/// accepting an arbitrary frontend path. Native picker authorization remains
/// mandatory for new folders; an already-connected vault is trusted only by
/// its exact configured id and is revalidated by the command before switching.
pub(crate) fn connected_vault_switch_target(
    cfg: &CorpusConfig,
    id: &str,
) -> Result<ConnectedBrain, String> {
    cfg.brains
        .iter()
        .find(|brain| brain.id == id)
        .cloned()
        .ok_or_else(|| "no such connected vault".into())
}

fn persist_corpus_path(
    app: &tauri::AppHandle,
    path: PathBuf,
    adopted: bool,
) -> Result<Option<String>, String> {
    // Preserve still-valid connected vaults even when the current folder was
    // removed in Finder. `is_configured` correctly becomes false for that dead
    // primary, but its readable config is still the recovery map.
    let cfg = read_corpus_config(app).unwrap_or_else(|| CorpusConfig {
        version: 1,
        corpus: CorpusRef {
            abs_path: path.clone(),
            adopted,
        },
        brains: Vec::new(),
        folders: Vec::new(),
        active_brain_id: None,
    });
    let outgoing_path = cfg.corpus.abs_path.clone();
    let cfg = switch_corpus_config(cfg, path, adopted)?;
    let outgoing_id = cfg
        .brains
        .iter()
        .find(|brain| canon(&brain.abs_path) == canon(&outgoing_path))
        .map(|brain| brain.id.clone());
    for vault in
        std::iter::once(&cfg.corpus.abs_path).chain(cfg.brains.iter().map(|brain| &brain.abs_path))
    {
        crate::vault_location::remember_vault(app, vault);
    }
    write_corpus_config(app, &cfg)?;
    Ok(outgoing_id)
}

/// Persist a new active corpus and return the optional route assigned to the
/// outgoing folder. Compatible Rotli vaults preserve the way back; first-run
/// and plain-folder transitions have no connected route to retain.
pub(crate) fn set_corpus_path_live(
    app: &tauri::AppHandle,
    path: PathBuf,
    adopted: bool,
) -> Result<Option<String>, String> {
    persist_corpus_path(app, path, adopted)
}

/// Connect / update a brain. A same-folder upsert PRESERVES the existing id (so
/// "vault" and its `vault:` sidebar prefix survive) and pin-checks the memex id
/// (refuse a different brain at the same path). An empty `brain.id` ⇒ a fresh
/// unique slug from the label.
pub fn upsert_brain(
    app: &tauri::AppHandle,
    brain: ConnectedBrain,
    make_active: bool,
) -> Result<String, String> {
    let mut cfg = ensure_corpus_config(app);
    crate::vault_location::remember_vault(app, &brain.abs_path);
    let id = upsert_brain_config(&mut cfg, brain, make_active)?;
    write_corpus_config(app, &cfg)?;
    Ok(id)
}

pub fn set_active_brain(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    if !cfg.brains.iter().any(|b| b.id == id) {
        return Err("no such vault".into());
    }
    cfg.active_brain_id = Some(id.to_string());
    write_corpus_config(app, &cfg)
}

pub fn set_brain_perms(
    app: &tauri::AppHandle,
    id: &str,
    perms: crate::memex::MemexPerms,
) -> Result<(), String> {
    // no string validation here anymore — serde on MemexPerms already rejected
    // anything but the two wire values at the IPC boundary
    let mut cfg = ensure_corpus_config(app);
    let b = cfg
        .brains
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or("no such vault")?;
    b.perms = perms;
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
    cfg.folders.push(CorpusRoot {
        id,
        label,
        abs_path: path,
        adopted: false,
    });
    write_corpus_config(app, &cfg)?;
    Ok(true)
}

/// Forget an added folder OR a connected brain by id (never the corpus). If the
/// active brain is forgotten, the active pointer falls to the first remaining.
pub fn forget_root(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut cfg = ensure_corpus_config(app);
    if id == DEFAULT_ROOT_ID {
        return Err("Switch to another vault before removing the current vault.".into());
    }
    if !cfg.folders.iter().any(|folder| folder.id == id)
        && !cfg.brains.iter().any(|brain| brain.id == id)
    {
        return Err("no such connected vault".into());
    }
    let forgotten_memex_id = cfg
        .brains
        .iter()
        .find(|brain| brain.id == id)
        .and_then(|brain| brain.memex_id.clone());
    cfg.folders.retain(|f| f.id != id);
    cfg.brains.retain(|b| b.id != id);
    if cfg.active_brain_id.as_deref() == Some(id) {
        cfg.active_brain_id = cfg.brains.first().map(|b| b.id.clone());
    }
    write_corpus_config(app, &cfg)?;
    if let Some(memex_id) = forgotten_memex_id {
        crate::vault_location::forget_vault(app, &memex_id);
    }
    Ok(())
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
    format!(
        "{:04}-{:02}-{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    )
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
    /// normal notes stay byte-identical. (the maintainer, 2026-06-13)
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

/// The clean, top-level metadata vocabulary retrieval may search. This makes
/// organizer-generated keywords useful without exposing arbitrary nested or
/// provenance/control frontmatter. Values stay plain text and are never an
/// independent source of truth.
fn searchable_metadata(fm: &Frontmatter) -> String {
    const KEYS: [&str; 8] = [
        "aliases", "area", "summary", "tags", "links", "shelf", "reach", "view_tag",
    ];
    fm.foreign
        .iter()
        .filter(|line| {
            let Some((key, _)) = line.split_once(':') else {
                return false;
            };
            key == key.trim() && KEYS.contains(&key)
        })
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Is this walked note protected content? The same three-way rule
/// `read_for_ai` applies — the explicit flag, the chat taint marker, or the
/// body detector for a note whose metadata panel was never opened.
fn walked_secure(fm: &Frontmatter, body: &str) -> bool {
    fm.foreign.iter().any(|l| secure_field(l) == Some(true))
        || fm
            .foreign
            .iter()
            .any(|l| secure_context_field(l) == Some(true))
        || looks_secure(body)
}

/// Serialize: our four facts first, then every foreign line verbatim, then the
/// raw body exactly as given (callers pass the separating blank line).
pub fn compose_document(fm: &Frontmatter, raw_body: &str) -> String {
    let mut out = String::with_capacity(raw_body.len() + 128);
    out.push_str("---\n");
    out.push_str(&format!("id: {}\n", fm.id.as_deref().unwrap_or("")));
    out.push_str(&format!(
        "created: {}\n",
        fm.created.as_deref().unwrap_or("")
    ));
    out.push_str(&format!(
        "updated: {}\n",
        fm.updated.as_deref().unwrap_or("")
    ));
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
const RESERVED_KEYS: [&str; 12] = [
    "id",
    "created",
    "updated",
    "pinned",
    "origin",
    "aliases",
    "locked",
    "secure",
    "secure_origin",
    "local_ai_allowed",
    "owner",
    "view_tag",
];

/// The metadata keys the AI FILER owns (contract v3.7). Written ONLY via
/// `set_ai_field` / `file_note`; the Filer refuses everything NOT in this set, and
/// these stay disjoint from RESERVED_KEYS (Rust) and the user's `{shelf, reach}` —
/// two actors, two gates, disjoint territories (the maintainer, 2026-07-01).
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

/// A frontmatter line setting the per-note SECURE flag. Only literal `false`
/// opens the ordinary lane; malformed values fail closed as secure.
/// Shared with the organizer daemon (its secure-skip is in-memory, never a write).
pub(crate) fn secure_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "secure").then(|| v.trim() != "false")
}

/// Does this whole document carry `locked: true`? The lock check written once,
/// for callers that hold the file text rather than a parsed `Frontmatter`.
pub(crate) fn has_locked_frontmatter(text: &str) -> bool {
    parse_document(text)
        .0
        .unwrap_or_default()
        .foreign
        .iter()
        .any(|line| locked_field(line) == Some(true))
}

/// The CHAT taint marker (`src/memex/contract.ts` writes it, one-way): this
/// transcript was fed by a secure note, so it IS secure content wearing a
/// different key. A memex root surfaces `chats/**.md` as ordinary notes, so
/// without this the headless remote agent could read a tainted transcript
/// straight out of the notes lane — `secure_field` never matched the longer
/// key (audit 2026-08-01, GAP 3; the matrix promises this at T2 step 5).
pub(crate) fn secure_context_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "secureContext").then(|| v.trim() == "true")
}

/// Explicit permission for a loopback-local model to read a secure note.
/// Absence and malformed values fail closed. Remote models ignore this flag.
pub(crate) fn local_ai_allowed_field(line: &str) -> Option<bool> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "local_ai_allowed").then(|| v.trim() == "true")
}

/// Physical home to restore when secure protection is removed. This is a
/// Rotli-owned operational breadcrumb, not user or AI metadata.
fn secure_origin_field(line: &str) -> Option<String> {
    let (k, v) = line.split_once(':')?;
    (k.trim() == "secure_origin").then(|| v.trim().to_string())
}

/// High-signal secret patterns — API keys, private keys, JWTs, SSNs, card numbers.
/// ANY match → the note holds secrets: it's flagged `secure: true`, its content is
/// never sent to a REMOTE model, and its path is gitignored (the maintainer, 2026-06-29).
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
    pub local_ai_allowed: bool,
    /// The typed pin fact — floats the note to the top of every list (the list
    /// sort is pinned → updated → id). Toggled from the row menu / a hotkey.
    pub pinned: bool,
    pub fields: Vec<String>,
}

/// One legacy secure-intake note (decision 2026-07-22): explicitly flagged
/// `secure: true` yet physically still in Brain intake. The user's repair
/// preview — `title`/`rel` exist for that local UI only and are never journaled.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecureRepairCandidate {
    pub id: String,
    pub rel: String,
    pub title: String,
    pub folder: String,
}

/// The outcome of one repair pass: how many notes reached the protected lane,
/// plus per-note refusal messages (transient UI text, never persisted).
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecureRepairReport {
    pub repaired: usize,
    pub failed: Vec<String>,
}

/// One open Markdown checkbox — the Tasks surface projection (decision
/// 2026-07-25). `line` indexes the editor body's lines: the toggle handle.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub note_id: String,
    pub note_title: String,
    pub line: usize,
    pub text: String,
}

/// Size + writability of a surfaced file — the sheet editor's up-front probe.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub len: u64,
    /// Opaque revision of the complete file bytes. Length and mtime are not
    /// concurrency tokens: same-size writes and coarse timestamp filesystems
    /// would otherwise let an office save replace an external edit.
    pub revision: String,
    pub writable: bool,
    /// Whether an explicit user action may move this storage asset into the
    /// memex Archive or Trash. Separate from `writable`: unsupported formats
    /// still need a recoverable lifecycle action.
    pub lifecycle_mutable: bool,
    /// Why `lifecycle_mutable` is false ("read-only vault", "not a file",
    /// "outside Rotli storage"); None when the file may move.
    pub lifecycle_reason: Option<String>,
    /// Filesystem birth/modify stamps (ms since epoch) — DERIVED display facts
    /// for the file-details panel, never copied into frontmatter. None when the
    /// filesystem can't report one.
    pub created_ms: Option<i64>,
    pub modified_ms: Option<i64>,
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
/// contract v3.7: provenance plus the local-AI permission are not raw-editable.
/// The permission must flow through its explicit command. Everything else in
/// the typed block (updated/pinned/locked/secure/shelf/tags/…) lands as typed.
const RAW_IMMUTABLE_KEYS: [&str; 5] = ["id", "created", "owner", "local_ai_allowed", "view_tag"];

/// Rebuild a document from a user-typed raw frontmatter block (the "Show file
/// metadata" editor). The submitted text is taken VERBATIM — line order,
/// spacing, everything — with exactly one correction: the reserved provenance
/// lines (id/owner/created/local permission/view tag) must match the ORIGINAL file exactly (changed →
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
        return Ok(if orig_block.is_empty() {
            original.to_string()
        } else {
            body.to_string()
        });
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
// "Northstar/Payments" and the user never feels it lives in wiki/. We read the shelf
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

#[cfg(test)]
mod capture_projection_tests {
    use super::*;

    fn with_shelf(shelf: &str) -> Frontmatter {
        let mut fm = Frontmatter::default();
        fm.foreign.push(format!("shelf: [{shelf}]"));
        fm
    }

    #[test]
    fn a_secure_quick_capture_is_a_capture_not_a_secure_note() {
        // ⌥C writes `secure: true` + `shelf: [Inbox]` into wiki/_secure; the
        // sidebar must read it as a Capture, never as a full "Secure notes" row
        assert_eq!(
            project_folder(Layout::Memex, "wiki/_secure", &with_shelf("Inbox")),
            "Board"
        );
        assert_eq!(
            project_folder(Layout::Memex, "wiki/_inbox", &with_shelf("Inbox")),
            "Board"
        );
    }

    #[test]
    fn curated_and_unshelved_secure_notes_keep_the_secure_row() {
        assert_eq!(
            project_folder(Layout::Memex, "wiki/_secure", &with_shelf("Northstar")),
            "Secure notes"
        );
        assert_eq!(
            project_folder(Layout::Memex, "wiki/_secure/deep", &Frontmatter::default()),
            "Secure notes"
        );
        assert_eq!(
            project_folder(Layout::Memex, "wiki/_secure", &with_shelf("Secure notes/Keys")),
            "Secure notes/Keys"
        );
    }
}

/// The folder a note is PROJECTED into. In a Memex, a `wiki/` note appears under
/// its PRIMARY shelf (the user's view) when one is set; otherwise it falls back to
/// its disk folder (a curated note with no shelf yet stays where it lives on disk).
/// Everything outside a memex's wiki/, and the whole local corpus, is unaffected.
fn project_folder(layout: Layout, disk_folder: &str, fm: &Frontmatter) -> String {
    if layout == Layout::Memex {
        let lifecycle_folder = project_lifecycle_folder(layout, disk_folder);
        if lifecycle_folder != disk_folder {
            return lifecycle_folder;
        }
        // storage/ binaries surface under the reserved "Storage" destination
        if disk_folder == "storage" || disk_folder.starts_with("storage/") {
            return "Storage".to_string();
        }
        if disk_folder == "wiki/_secure" || disk_folder.starts_with("wiki/_secure/") {
            let shelves = shelf_of(fm);
            // A quick capture is secure at birth, so it lives in wiki/_secure —
            // but its shelf is still the capture shelf "Inbox". It is a CAPTURE,
            // not a full note: project it to the reserved "Board" root the
            // sidebar reads as "Captures", exactly like a staged wiki/_inbox
            // capture, instead of filing it under "Secure notes" beside every
            // curated secure note (2026-09-01: "quick captures are not full
            // notes — they are separate"). Protection is unchanged: the file
            // stays in the gitignored secure spine and model-gated on read.
            if shelves.first().is_some_and(|shelf| shelf == "Inbox") {
                return "Board".to_string();
            }
            return shelves
                .into_iter()
                .find(|shelf| shelf == "Secure notes" || shelf.starts_with("Secure notes/"))
                .unwrap_or_else(|| "Secure notes".to_string());
        }
        if disk_folder == "wiki" || disk_folder.starts_with("wiki/") {
            if let Some(primary) = shelf_of(fm).into_iter().next() {
                // the default capture shelf "Inbox" is the ONE Captures surface — route
                // it to the reserved "Board" root the sidebar reads as "Captures" (the maintainer,
                // 2026-06-30); a real user shelf (Northstar/Payments) still projects to it.
                return if primary == "Inbox" {
                    "Board".to_string()
                } else {
                    primary
                };
            }
        }
    }
    disk_folder.to_string()
}

/// Memex lifecycle folders are conventional lowercase disk structure while the
/// workspace presents stable title-case destination labels.
fn project_lifecycle_folder(layout: Layout, disk_folder: &str) -> String {
    if layout != Layout::Memex {
        return disk_folder.to_string();
    }
    if disk_folder == "archive" || disk_folder.starts_with("archive/") {
        return format!("Archive{}", &disk_folder["archive".len()..]);
    }
    if disk_folder == "trash" || disk_folder.starts_with("trash/") {
        return format!("Trash{}", &disk_folder["trash".len()..]);
    }
    disk_folder.to_string()
}

fn lifecycle_disk_folder(layout: Layout, folder: &str) -> String {
    if layout != Layout::Memex {
        return folder.to_string();
    }
    if folder == "Archive" || folder.starts_with("Archive/") {
        return format!("archive{}", &folder["Archive".len()..]);
    }
    if folder == "Trash" || folder.starts_with("Trash/") {
        return format!("trash{}", &folder["Trash".len()..]);
    }
    folder.to_string()
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
            folders.push(FolderMeta {
                id: path.clone(),
                name,
                parent_id: parent.clone(),
            });
            known.insert(path.clone());
            path = parent.unwrap_or_default();
        }
    }
}

// ─── title · snippet · slug · filename ───────────────────────────────────────

fn h1_title(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let rest = trimmed.strip_prefix('#')?;
    if rest.starts_with('#') || !rest.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    let title = strip_markdown(rest);
    (!title.is_empty()).then_some(title)
}

/// Title = the first H1, markdown stripped. Older notes without an H1 retain
/// the pre-v3.8 first-non-empty-line fallback until a deliberate rename adopts
/// the H1 form. The title is never duplicated in frontmatter.
pub fn title_of(body: &str) -> String {
    if let Some(title) = body.lines().find_map(h1_title) {
        return title;
    }
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
        for marker in STRIP_MARKERS {
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
    let cleaned: String = reduced
        .chars()
        .filter(|c| !matches!(c, '*' | '_' | '`'))
        .collect();
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
    let body = crate::search_match::strip_html_comments(body);
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

/// Archive and its subtree — excluded from the Tasks projection (a task in a
/// sink is not a nag; restore is what resurrects it).
fn is_archive_folder(folder: &str) -> bool {
    folder == "Archive" || folder.starts_with("Archive/")
}

/// The UNFINISHED checkbox marks. `[/]` is in progress (2026-08-04) — started
/// is not finished, so it still belongs on the Tasks surface. Mirrors the
/// editor's grammar in src/editor/taskState.ts.
fn strip_open_box(rest: &str) -> Option<&str> {
    let tail = rest
        .strip_prefix("[ ]")
        .or_else(|| rest.strip_prefix("[/]"))?;
    tail.chars()
        .next()
        .is_some_and(char::is_whitespace)
        .then_some(tail)
}

/// An open `- [ ]` / `* [ ]` / `1. [ ]` checkbox line's own text — or the `[/]`
/// in-progress form of any of them (None for anything else, including checked
/// boxes and empty checkboxes: nothing to show or toggle). Ordered tasks are
/// GFM's numbered task items, rendered by the editor since 2026-08.
fn open_task_text(trimmed: &str) -> Option<&str> {
    let rest = trimmed
        .strip_prefix("- ")
        .and_then(strip_open_box)
        .or_else(|| trimmed.strip_prefix("* ").and_then(strip_open_box))
        .or_else(|| {
            strip_open_box(strip_ordered_prefix(trimmed)?.strip_prefix(' ')?).map(str::trim_start)
        })?;
    let rest = rest.trim();
    (!rest.is_empty()).then_some(rest)
}

/// Rewrite an open task's checkbox to `[x]`, leaving its words alone.
///
/// It targets the box by POSITION — the three chars right after the list
/// marker — not by searching for "[ ]" in the line. A task whose own text
/// mentions a bracket pair ("- [/] fix the [ ] case") would otherwise have the
/// wrong one flipped. None when the line isn't an open task.
fn check_off(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    let lead = line.len() - trimmed.len();
    let after_marker = if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        trimmed.len() - rest.len()
    } else {
        let rest = strip_ordered_prefix(trimmed)?.strip_prefix(' ')?;
        trimmed.len() - rest.len()
    };
    let at = lead + after_marker;
    strip_open_box(line.get(at..)?)?;
    Some(format!("{}[x]{}", &line[..at], &line[at + 3..]))
}

/// Strip a `1.` ordered-list marker (digits + dot), returning the rest — which
/// still carries its leading space. None when the line isn't an ordered item.
fn strip_ordered_prefix(trimmed: &str) -> Option<&str> {
    let digits = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
        return None;
    }
    trimmed[digits..].strip_prefix('.')
}

/// A hard-wrapped checkbox reads as ONE task: an indented, non-list, non-fence
/// line directly under a `- [ ]` row is its continuation. Without this, the
/// Tasks surface cut wrapped items at the first newline (the maintainer, 2026-07-31:
/// "…set as `X` on the").
fn task_continuation(raw: &str) -> Option<&str> {
    let trimmed = raw.trim_start();
    if trimmed.is_empty() {
        return None;
    }
    // CHAR count, not bytes — a single NBSP is 2 bytes and must not read as
    // a two-space indent
    let indent_chars = raw[..raw.len() - trimmed.len()].chars().count();
    if indent_chars < 2 && !raw.starts_with('\t') {
        return None;
    }
    // a nested list item (bulleted or `1.` ordered), checkbox, fence, heading,
    // blockquote, or table row starts its own block — never a wrapped
    // continuation of the task text
    if trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || trimmed.starts_with("```")
        || trimmed.starts_with("~~~")
        || trimmed.starts_with('#')
        || trimmed.starts_with('>')
        || trimmed.starts_with('|')
        || strip_ordered_prefix(trimmed).is_some_and(|rest| rest.starts_with(' '))
    {
        return None;
    }
    Some(trimmed)
}

/// The FULL text of the task whose checkbox sits at `start`: the `- [ ]` line
/// plus any wrapped continuations, space-joined. `tasks()` reports it and
/// `toggle_task` re-validates against it, so the projection and the toggle
/// stay in lockstep by construction.
fn joined_task_text(lines: &[&str], start: usize) -> Option<String> {
    let mut text = open_task_text(lines.get(start)?.trim_start())?.to_string();
    for raw in lines.iter().skip(start + 1) {
        let Some(cont) = task_continuation(raw) else {
            break;
        };
        text.push(' ');
        text.push_str(cont);
    }
    Some(text)
}

pub fn slugify(title: &str) -> String {
    let mut out = String::new();
    let mut length = 0usize;
    for c in title.to_lowercase().chars() {
        if c.is_alphanumeric() {
            out.push(c);
            length += 1;
        } else if !out.is_empty() && !out.ends_with('-') {
            out.push('-');
            length += 1;
        }
        if length >= 60 {
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

/// The title's human-readable canonical filename. Stable identity lives in
/// frontmatter, never in the path. `free_name` adds ` (2)`, ` (3)`, … when two
/// notes with the same title share a folder.
fn filename_for(title: &str, _id: &str) -> String {
    format!("{}.md", slugify(title))
}

fn filename_stem(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn legacy_filename_stem(rel: &str, id: &str) -> Option<String> {
    let stem = filename_stem(rel);
    let tail: String = id
        .chars()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>()
        .to_lowercase();
    stem.strip_suffix(&format!("-{tail}"))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn alias_values(fm: &Frontmatter) -> Vec<String> {
    let Some(value) = fm.foreign.iter().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key == "aliases").then_some(value.trim())
    }) else {
        return Vec::new();
    };
    if value.is_empty() {
        return Vec::new();
    }
    if let Ok(parsed) = serde_json::from_str::<Vec<String>>(value) {
        return parsed;
    }
    let inner = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(value);
    inner
        .split(',')
        .map(|alias| alias.trim().trim_matches(['"', '\'']).to_string())
        .filter(|alias| !alias.is_empty())
        .collect()
}

fn push_unique_alias(aliases: &mut Vec<String>, value: impl Into<String>) {
    let value = value.into().trim().to_string();
    if value.is_empty()
        || aliases
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&value))
    {
        return;
    }
    aliases.push(value);
}

/// All human selectors that may identify a note without exposing its ULID:
/// durable frontmatter aliases, its current filename stem, the canonical title
/// slug, and the pre-0.34 filename stem with the six-character id tail removed.
fn note_aliases(rel: &str, title: &str, id: &str, fm: &Frontmatter) -> Vec<String> {
    let mut aliases = alias_values(fm);
    push_unique_alias(&mut aliases, filename_stem(rel));
    push_unique_alias(&mut aliases, slugify(title));
    if let Some(legacy) = legacy_filename_stem(rel, id) {
        push_unique_alias(&mut aliases, legacy);
    }
    aliases
}

fn preserve_rename_aliases(
    fm: &mut Frontmatter,
    rel: &str,
    old_title: &str,
    new_title: &str,
    id: &str,
) -> Result<(), String> {
    let mut aliases = alias_values(fm);
    if old_title != new_title {
        push_unique_alias(&mut aliases, old_title);
        push_unique_alias(&mut aliases, slugify(old_title));
    }
    let current_stem = filename_stem(rel);
    push_unique_alias(&mut aliases, current_stem);
    if let Some(legacy) = legacy_filename_stem(rel, id) {
        push_unique_alias(&mut aliases, legacy);
    }
    fm.foreign.retain(|line| {
        line.split_once(':')
            .map(|(key, _)| key != "aliases")
            .unwrap_or(true)
    });
    if !aliases.is_empty() {
        let value = serde_json::to_string(&aliases).map_err(|error| error.to_string())?;
        fm.foreign.insert(0, format!("aliases: {value}"));
    }
    Ok(())
}

/// Make a dropped file's name safe for a `storage:` link: slugify the STEM
/// (lowercase, non-alnum → single `-`) and keep the lowercased extension. A
/// spaced/exotic name (e.g. macOS "Screenshot 2026-… AM.png") otherwise becomes
/// a `storage:` link that breaks markdown AND the memex asset regex
/// `[A-Za-z0-9._/-]` — the validator then reads it as a broken ref (the maintainer,
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
    /// Exact whitespace-aware emptiness of a Markdown editor body. Boards and
    /// conventional files are never blank-note placeholders.
    pub body_empty: bool,
    /// Human-readable selectors for local links and CLI lookup. The stable
    /// identity remains `id`; aliases may include the current filename stem,
    /// canonical title slug, and rename history.
    pub aliases: Vec<String>,
    /// User-facing folder path ("" = corpus root). In a memex this may be the
    /// note's shelf projection rather than its physical wiki folder.
    pub folder_id: String,
    /// Physical folder containing the file. Kept separate from `folder_id` so
    /// shelf-projected notes can still be located and revealed in the Brain.
    pub disk_folder_id: String,
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

#[derive(Debug, Clone, Serialize)]
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
    /// Physical folder containing the file; see `NoteMeta::disk_folder_id`.
    pub disk_folder_id: String,
    /// Frontmatter stripped — what the editor edits.
    pub body: String,
    /// Opaque revision of the complete on-disk file, including frontmatter.
    /// Every whole-body write must present this value so a stale editor cannot
    /// replace a newer external, CLI, MCP, AI, or second-window edit.
    pub revision: String,
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
    /// Opaque revision of the raw scene bytes.
    pub revision: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A write returns both list metadata and the revision of the bytes that
/// actually landed. Flattening keeps the existing TypeScript metadata shape.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusWriteResult {
    #[serde(flatten)]
    pub meta: NoteMeta,
    pub revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorpusAiRead {
    pub body: String,
    pub revision: String,
}

/// A memex's board lane: where a board is born when the caller's folder isn't a
/// writable note surface (src/services/folderBoards.ts BOARD_LANE, parity.json).
pub(crate) const BOARD_LANE: &str = "storage/excalidraw";

/// A minimal, valid empty Excalidraw scene. New boards start here; it opens
/// blank in excalidraw.com. Rotli Web writes the same bytes
/// (src/services/folderBoards.ts EMPTY_BOARD_FILE, parity.json).
pub(crate) const EMPTY_EXCALIDRAW: &str = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"rotli\",\"elements\":[],\"appState\":{},\"files\":{}}";

// ─── suppress set (our own writes must not echo back as "external") ─────────

const SUPPRESS_TTL: Duration = Duration::from_secs(2);

/// Resolve filesystem aliases for watcher comparisons. macOS commonly gives
/// callers `/var/...` while FSEvents reports the same file as
/// `/private/var/...`. For a path that does not exist yet (a pre-write
/// suppression mark), resolve its existing parent and append the filename.
fn normalized_watch_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = fs::canonicalize(path) {
        return canonical;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => fs::canonicalize(parent)
            .map(|canonical| canonical.join(name))
            .unwrap_or_else(|_| path.to_path_buf()),
        _ => path.to_path_buf(),
    }
}

#[derive(Clone, Default)]
pub struct SuppressSet {
    paths: Arc<Mutex<HashMap<PathBuf, Instant>>>,
    /// The corpus CHANGE GENERATION (perf audit 2026-07-30, #1/#5): bumped by
    /// every internal write (mark() is the one chokepoint every mutating store
    /// method already passes through) and by the watcher for external bursts.
    /// `list()`'s walk cache is valid exactly while this is unchanged.
    generation: Arc<std::sync::atomic::AtomicU64>,
}

impl SuppressSet {
    pub fn mark(&self, path: &Path) {
        self.bump();
        let mut map = self.paths.lock().unwrap();
        map.retain(|_, at| at.elapsed() < SUPPRESS_TTL);
        map.insert(normalized_watch_path(path), Instant::now());
    }

    pub fn contains(&self, path: &Path) -> bool {
        self.paths
            .lock()
            .unwrap()
            .get(&normalized_watch_path(path))
            .is_some_and(|at| at.elapsed() < SUPPRESS_TTL)
    }

    /// Invalidate walk caches without suppressing anything — the watcher calls
    /// this once per fired external burst.
    pub fn bump(&self) {
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(std::sync::atomic::Ordering::SeqCst)
    }
}

// ─── atomic write (shared discipline lives in fsutil.rs) ────────────────────

/// Temp file in the SAME directory + rename: a reader never sees a truncated
/// note, and a crash mid-write leaves the old file intact.
fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    crate::fsutil::atomic_write(path, contents, ".rotli-write-")
}

/// The bytes flavor — the spreadsheet editor saves a binary (.xlsx) through the
/// same tempfile+rename discipline, so a crash mid-save never corrupts the workbook.
fn atomic_write_bytes(path: &Path, contents: &[u8]) -> Result<(), String> {
    crate::fsutil::atomic_write_bytes(path, contents, ".rotli-write-")
}

/// Read a file that is about to be REWRITTEN or judged: a missing file reads
/// as empty, but any other failure (permissions, invalid UTF-8) propagates.
/// `unwrap_or_default` here once let an unreadable note read as "blank" — and
/// blank is exactly what discard destroys and what a rewrite starts from
/// (audit 2026-07-29: fail-open reads).
fn read_existing_text(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("couldn't read the existing file: {e}")),
    }
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
///   • `Memex` — the root IS someone's memex spine (for the maintainer, `~/memex-vault`).
///     `chats/` and `wiki/` are writable + surfaced read-write; `identity/`,
///     `personality/`, `history/`, `MAP.md`, `inbox.md` stay out of the tree (Reference)
///     and every control file stays HIDDEN. No reserved folders are scaffolded, no
///     first-run seeding ever runs.
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
    /// A normal, editable note (LegacyRotli: everything; Memex: `wiki/**.md` +
    /// `chats/**.md`).
    NoteRW,
    /// Surfaced but read-only (Memex: `storage/**` foreign binaries).
    NoteRO,
    /// The brain's MEMORY lanes (Memex: identity/ personality/ history/ MAP.md
    /// inbox.md). NOT in the user's Notes tree and never writable by any lane —
    /// but RETRIEVABLE by the AI's own tools (search / knowledge map / read),
    /// for BOTH model classes (the maintainer, 2026-08-01: "it shouldn't be invisible").
    /// See docs/design/ai-visibility-matrix.md.
    Reference,
    /// Never surfaced, never written, never retrievable (Memex: memex.json,
    /// users.json, STRUCTURE/CONFIG/README docs, clients/, scripts/, …).
    Hidden,
}

/// The scope predicate. `rel` is a path relative to the corpus root, using `/`
/// separators ("" = the root itself).
///
/// LegacyRotli surfaces everything read-write (today's behavior). Memex surfaces
/// `wiki/`, `chats/`, and the exact welcome preset path as read-write in the
/// Notes tree, marks the
/// brain's memory (identity/personality/history/MAP/inbox) `Reference` — out of
/// the tree but reachable by the AI's retrieval tools — and hides every
/// memex-vault control file. Top-level memex-vault docs (STRUCTURE.md,
/// CONFIG.md, …) are `.md`, so this rule — not the dot-filter — is what keeps
/// them out of the Notes tree.
fn surfaced(layout: Layout, rel: &str) -> Surface {
    if layout == Layout::LegacyRotli {
        return Surface::NoteRW;
    }
    let rel = rel.trim_start_matches('/');
    // A newly scaffolded vault owns one real, editable root-level Markdown
    // note. It is deliberately outside wiki/ (and therefore Library), while
    // every other root document remains hidden/control material.
    if rel == crate::memex::WELCOME_PRESET_FILE {
        return Surface::NoteRW;
    }
    // chats/ — rotli's owned, writable surface (the dir itself + everything under)
    if rel == "chats" || rel.starts_with("chats/") {
        return Surface::NoteRW;
    }
    // wiki/ — the brain's knowledge tree, WRITABLE (2026-08-03). The read-only
    // era ("this increment") ended when the Librarian began filing staged notes
    // into curated areas: a note the filer organizes must stay editable, not
    // silently become read-only the moment it leaves wiki/_inbox (the save
    // banner retried forever). This covers _inbox staging and _secure alike;
    // _secure stays model-gated on READ and never an organizer area, and the
    // organizer still skips secure + locked notes.
    if rel == "wiki" || rel.starts_with("wiki/") {
        return Surface::NoteRW;
    }
    // Archive/ + Trash/ — rotli's LIFECYCLE sinks (capitalized, matching the TS
    // destinations + is_hidden_root). A note the user archives/trashes lands in
    // these rotli-owned dirs at the memex root; they're never the curated
    // knowledge, so lifecycle moves are a sanctioned write lane even in a memex.
    // Without this, archive/trash silently no-op in a memex (the maintainer, 2026-07-07).
    if is_hidden_root(rel) {
        return Surface::NoteRW;
    }
    // storage/excalidraw/ — the memex's BOARD lane (the maintainer, 2026-07-07). Excalidraw
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
    // The brain's MEMORY lanes: out of the Notes tree, unwritable — but the AI
    // may retrieve them (the maintainer, 2026-08-01). Directories are matched with their
    // trailing slash so a sibling like "identity-notes/" never rides this rule.
    if is_reference_lane(rel) {
        return Surface::Reference;
    }
    // everything else inside a memex is hidden from BOTH the Notes tree and the
    // AI, and is unwritable: every control file (memex.json, users.json,
    // *.local.json, *.json at root, clients/, scripts/,
    // STRUCTURE/CONFIG/README/CHANGELOG/ASSETS/GUIDE/QUERY .md, …).
    Surface::Hidden
}

/// The memex lanes that hold the user's own KNOWLEDGE outside `wiki/` — the
/// whole-person identity layer, the AI's working model of them, the by-day
/// conversation stream, the always-loaded index, and the capture zone. Named
/// once so the surface predicate and the docs agree. Vault plumbing
/// (memex.json, STRUCTURE.md, scripts/, clients/, …) is deliberately NOT here.
fn is_reference_lane(rel: &str) -> bool {
    const DIRS: [&str; 3] = ["identity", "personality", "history"];
    const FILES: [&str; 2] = ["MAP.md", "inbox.md"];
    DIRS.iter()
        .any(|d| rel == *d || rel.starts_with(&format!("{d}/")))
        || FILES.contains(&rel)
}

/// The reserved secure folder name in the legacy layout and every folder-id
/// comparison — byte-identical to SECURE_NOTES_FOLDER in src/security/secureNotes.ts
/// and DEST.secure in src/services/destinations.ts (parity.json).
pub(crate) const SECURE_NOTES_FOLDER: &str = "Secure notes";

/// Leading block markers `strip_markdown` peels for titles/snippets, in peel
/// order — byte-identical to BLOCK_MARKERS in src/services/derive.ts (parity.json).
pub(crate) const STRIP_MARKERS: [&str; 15] = [
    "- ", "* ", "+ ", "( ) ", "(x) ", "(X) ", "[ ][ ] ", "[x][ ] ", "[X][ ] ", "[ ][x] ",
    "[ ][X] ", "[ ] ", "[/] ", "[x] ", "[X] ",
];

/// The native attach picker's image filter — byte-identical to
/// NATIVE_IMAGE_EXTS in src/editor/externalImageDrop.ts (parity.json).
pub(crate) const NATIVE_IMAGE_PICKER_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "bmp", "tiff", "tif", "svg",
    "ico",
];

/// Video containers the embed lane accepts — byte-identical to VIDEO_EXTS in
/// src/lib/fileKind.ts (parity.json).
pub(crate) const VIDEO_EXTS: &[&str] = &["mp4", "mov", "webm", "m4v", "ogv"];

/// Byte-identical to CHAT_IMAGE_ASSET_MAX_BYTES in src/lib/chatWork.ts (parity.json).
/// The byte-backed image lane refuses anything larger; the IPC read-back cap
/// matches so a copied image is never truncated into a corrupt data URL.
pub(crate) const CHAT_IMAGE_ASSET_MAX_BYTES: usize = 25_000_000;

pub(crate) const CHAT_IMAGE_ASSET_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "bmp", "tiff", "tif",
];

/// Shared with acp_images.rs, which names the mime from the same magic numbers.
pub(crate) fn image_payload_matches_extension(ext: &str, bytes: &[u8]) -> bool {
    match ext {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "bmp" => bytes.starts_with(b"BM"),
        "tif" | "tiff" => bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*"),
        "heic" | "heif" | "avif" => {
            if bytes.get(4..8) != Some(b"ftyp") {
                return false;
            }
            bytes.get(8..bytes.len().min(64)).is_some_and(|brands| {
                brands.chunks_exact(4).any(|brand| match ext {
                    "avif" => brand == b"avif" || brand == b"avis",
                    _ => matches!(
                        brand,
                        b"heic"
                            | b"heix"
                            | b"hevc"
                            | b"hevx"
                            | b"heim"
                            | b"heis"
                            | b"mif1"
                            | b"msf1"
                    ),
                })
            })
        }
        _ => false,
    }
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
    /// Contract-band verdict, decided at `open_memex` (#3, audit 2026-07): a memex
    /// whose contract is OUTSIDE rotli's supported band opens read-only — never
    /// write a contract rotli wasn't built for. Both write gates consult it.
    band_read_only: bool,
    /// User-set "read-only" perms for a connected brain (corpus.json) — carried
    /// into the store so the Rust gates enforce it, not only the TS `canWrite`
    /// (#3, audit 2026-07). Never cleared below the band verdict.
    perms_read_only: bool,
    /// The memoized walk (perf audit 2026-07-30, #1/#5): valid while the
    /// suppress-set generation is unchanged. Holds the sorted list AND each
    /// note's parsed text so search()/tasks() stop re-reading every file.
    list_cache: Option<ListCache>,
    /// The Tantivy full-text index (adapter in search_index.rs) — DERIVED,
    /// gitignored, rebuildable. `None` when this store cannot host one (a
    /// read-only mount, or an open error): `search` then uses the substring scan,
    /// the guaranteed-correct floor. Never a source of truth; `corpus_search_ai`
    /// re-gates every hit through `read_for_ai` from disk, so the index is not the
    /// visibility boundary (docs/design/tantivy-search.md).
    search_index: Option<crate::search_index::SearchIndex>,
}

/// One walked note's parsed text, cached beside its meta.
///
/// MEMORY TRADEOFF (deliberate, Greptile PR #14): the whole corpus's note
/// bodies stay resident while the walk cache is valid — ~3 MB for a typical
/// 1k-note corpus, ~200 MB for an extreme 20k×10 KB one. That buys
/// search()/tasks() answering from one parse instead of a second full-vault
/// read per call. No eviction on purpose (the cache IS the working set of a
/// local-first notes app); if a future corpus class outgrows this, the
/// refactor seam is: evict `body`/`metadata` here while keeping the metas,
/// and let search/tasks fall back to per-note reads.
struct CachedNoteText {
    body: String,
    /// The searchable frontmatter projection ("" when the note has none).
    metadata: String,
    /// Decided on the WALK, from the same rule `read_for_ai` applies: the
    /// `secure:` flag, the chat taint marker, or the body detector. It cannot
    /// be re-derived from `metadata`, which is an 8-key search projection that
    /// deliberately omits protection state. The secure-prose ledger is fed
    /// from this (audit 2026-08-01, GAP 2).
    secure: bool,
}

struct ListCache {
    generation: u64,
    list: CorpusList,
    /// The `Surface::Reference` lane, collected on the SAME walk but kept in a
    /// separate vector on purpose: the user-facing `CorpusList` cannot contain a
    /// reference note by construction, so no filter has to be correct for the
    /// sidebar to stay clean. Only the AI lanes ask for these.
    reference: Vec<NoteMeta>,
    texts: HashMap<String, CachedNoteText>,
}

fn valid_view_name(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed == name
        && trimmed.chars().count() <= 64
        && !trimmed.eq_ignore_ascii_case("main")
        && trimmed.chars().next().is_some_and(char::is_alphanumeric)
        && trimmed
            .chars()
            .all(|ch| ch.is_alphanumeric() || matches!(ch, ' ' | '.' | '_' | '-'))
}

/// `/` separates a folder's path id and `:` routes a vault root, so neither can
/// sit inside a view folder name — byte-identical to VIEW_FOLDER_FORBIDDEN_CHARS
/// in src/services/viewTree.ts (parity.json viewFolderForbiddenChars)
pub(crate) const VIEW_FOLDER_FORBIDDEN_CHARS: [char; 2] = ['/', ':'];

fn collect_view_membership(
    nodes: &[ReferenceNode],
    view: &str,
    membership: &mut HashMap<String, String>,
) -> Result<(), String> {
    for node in nodes {
        match node {
            ReferenceNode::Folder { folder, children } => {
                if folder.trim().is_empty()
                    || folder != folder.trim()
                    || folder.contains(VIEW_FOLDER_FORBIDDEN_CHARS)
                {
                    return Err(format!("invalid folder name in view {view}: {folder}"));
                }
                collect_view_membership(children, view, membership)?;
            }
            ReferenceNode::Note { note } => {
                if note.trim().is_empty() {
                    return Err(format!("view {view} contains an empty item reference"));
                }
                if let Some(previous) = membership.insert(note.clone(), view.to_string()) {
                    return Err(format!(
                        "item {note} appears more than once across named views ({previous}, {view})"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn reference_contains(nodes: &[ReferenceNode], item_id: &str) -> bool {
    nodes.iter().any(|node| match node {
        ReferenceNode::Note { note } => note == item_id,
        ReferenceNode::Folder { children, .. } => reference_contains(children, item_id),
    })
}

fn validated_view_membership(manifest: &ViewsManifest) -> Result<HashMap<String, String>, String> {
    if manifest.version != 1 {
        return Err(format!(
            "views format v{} is not writable by this Rotli build",
            manifest.version
        ));
    }
    let mut names = HashSet::new();
    let mut membership = HashMap::new();
    for view in &manifest.views {
        if !valid_view_name(&view.name) {
            return Err(format!("invalid view name: {}", view.name));
        }
        if !names.insert(view.name.to_lowercase()) {
            return Err(format!("view names must be unique: {}", view.name));
        }
        collect_view_membership(&view.tree, &view.name, &mut membership)?;
    }
    Ok(membership)
}

fn with_view_tag(text: &str, tag: Option<&str>) -> String {
    let (frontmatter, body) = parse_document(text);
    let mut frontmatter = frontmatter.unwrap_or_default();
    frontmatter.foreign.retain(|line| {
        line.split_once(':')
            .is_none_or(|(key, _)| key != key.trim() || key != "view_tag")
    });
    if let Some(tag) = tag {
        frontmatter.foreign.push(format!("view_tag: {tag}"));
    }
    compose_document(&frontmatter, body)
}

impl CorpusStore {
    /// Open (or first-run-initialize) a corpus at `root`. The dispatcher: probe
    /// `root/memex.json` once — a valid `mx_` id routes to the memex path (browse
    /// the spine, never scaffold), anything else to the legacy path (today,
    /// byte-identical).
    pub fn open(root: PathBuf) -> Result<Self, String> {
        Self::open_with_mode(root, false)
    }

    /// Open an existing corpus as a view only. Used by explicitly read-only
    /// headless connections: no sidecar creation, seeding, index persistence, or
    /// user/organizer write lane is allowed.
    pub fn open_read_only(root: PathBuf) -> Result<Self, String> {
        Self::open_with_mode(root, true)
    }

    /// Adopt an existing Markdown tree in place. Rotli creates only its hidden,
    /// rebuildable sidecar; the user's visible hierarchy stays byte-for-byte as
    /// it was (no reserved folders and no welcome note).
    pub fn open_adopted(root: PathBuf) -> Result<Self, String> {
        let root =
            fs::canonicalize(&root).map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        let dot = crate::containment::resolve_beneath(&root, Path::new(DOT_DIR))?;
        fs::create_dir_all(dot)
            .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;
        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::LegacyRotli,
            band_read_only: false,
            perms_read_only: false,
            list_cache: None,
            search_index: None,
        };
        store.load_index();
        store.init_search_index();
        Ok(store)
    }

    fn open_with_mode(root: PathBuf, read_only: bool) -> Result<Self, String> {
        // A marker another app moved or deleted comes back first, so a vault
        // never silently reopens as a plain folder (vault_marker.rs).
        if !read_only {
            crate::vault_marker::heal_best_effort(&root);
        }
        // Probe BEFORE create_dir_all so an absent dir reads as "not a memex"
        // (→ legacy first-run), never as a memex over an empty folder.
        if is_memex_root(&root) {
            Self::open_memex(root, read_only)
        } else {
            Self::open_legacy(root, read_only)
        }
    }

    /// Today's behavior, unchanged: reserved folders + first-run seeding, every
    /// path writable. Layout::LegacyRotli.
    fn open_legacy(root: PathBuf, read_only: bool) -> Result<Self, String> {
        let fresh = !root.exists()
            || fs::read_dir(&root)
                .map(|mut d| d.next().is_none())
                .unwrap_or(false);
        if read_only && !root.is_dir() {
            return Err(format!(
                "read-only corpus does not exist: {}",
                root.display()
            ));
        }
        if !read_only {
            fs::create_dir_all(&root).map_err(|e| format!("create {}: {e}", root.display()))?;
        }
        let root =
            fs::canonicalize(&root).map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        if !read_only {
            let dot = crate::containment::resolve_beneath(&root, Path::new(DOT_DIR))?;
            fs::create_dir_all(dot)
                .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;
        }

        let mut store = Self {
            root,
            index: HashMap::new(),
            suppress: SuppressSet::default(),
            os_trash: true,
            layout: Layout::LegacyRotli,
            band_read_only: false,
            perms_read_only: read_only,
            list_cache: None,
            search_index: None,
        };
        store.load_index();
        store.init_search_index();
        // Scaffold the six reserved sidebar destinations every open (idempotent),
        // so existing corpora gain them too. (the maintainer, 2026-06-13)
        if !read_only {
            store.ensure_reserved_folders()?;
        }
        if fresh && !read_only {
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
    fn open_memex(root: PathBuf, read_only: bool) -> Result<Self, String> {
        let root =
            fs::canonicalize(&root).map_err(|e| format!("canonicalize {}: {e}", root.display()))?;
        if !read_only {
            let dot = crate::containment::resolve_beneath(&root, Path::new(DOT_DIR))?;
            fs::create_dir_all(dot)
                .map_err(|e| format!("create {}: {e}", root.join(DOT_DIR).display()))?;
        }

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
            perms_read_only: read_only,
            list_cache: None,
            search_index: None,
        };
        store.load_index();
        store.init_search_index();
        Ok(store)
    }

    /// Open (or wipe+recreate) this root's Tantivy index at `.rotli/search`. Left
    /// `None` — falling back to the substring scan — when the store may not write
    /// its sidecar (read-only mount, out-of-band contract) or when the index fails
    /// to open. The index is DERIVED and rebuildable; a failure here is degraded
    /// search speed, never a broken app or lost data.
    fn init_search_index(&mut self) {
        if self.mutation_allowed().is_err() {
            return; // read-only store → substring fallback, no index writes
        }
        let Ok(dir) = self.guard_rel(&format!("{DOT_DIR}/search")) else {
            return;
        };
        self.search_index = crate::search_index::SearchIndex::open_or_create(&dir).ok();
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
        self.mutation_allowed()?;
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
        self.guard_rel(subdir)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // `safe` is a single clean component; free_name picks the first uncollided
        // rel under the binary subdir and derives its extension.
        let rel = self.free_name(subdir, &safe, None);
        self.guard_rel(&rel)?;
        fs::copy(src, self.abs(&rel)).map_err(|e| format!("import {}: {e}", src.display()))?;
        Ok(rel)
    }

    /// Size + user-lane writability of a surfaced file — the sheet editor decides
    /// read-only vs editable UP FRONT (a memex/linked-library file must never offer
    /// a Save it would refuse; a file over the read cap must never be written back
    /// from a truncated parse).
    pub fn file_stat(&self, rel: &str) -> Result<FileStat, String> {
        validate_rel(rel)?;
        let abs = self.guard_rel(rel)?;
        let meta = fs::metadata(&abs).map_err(|e| format!("stat {rel}: {e}"))?;
        if !meta.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        let stamp_ms = |t: std::io::Result<SystemTime>| {
            t.ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
        };
        let lifecycle_block = self.storage_file_lifecycle_block(rel);
        Ok(FileStat {
            len: meta.len(),
            revision: crate::fsutil::file_revision(&abs)?,
            // an existing storage/ office file is editable in place
            // even though the contract's writable() refuses the storage lane at large
            writable: self.writable(rel).is_ok() || self.storage_office_editable(rel),
            lifecycle_mutable: lifecycle_block.is_none(),
            lifecycle_reason: lifecycle_block.map(str::to_owned),
            created_ms: stamp_ms(meta.created()),
            modified_ms: stamp_ms(meta.modified()),
        })
    }

    /// Why a surfaced storage asset cannot enter Rotli's in-memex Archive/Trash
    /// (None = it can). Markdown and boards keep their own lifecycle.
    fn storage_file_lifecycle_block(&self, rel: &str) -> Option<&'static str> {
        if self.mutation_allowed().is_err() {
            return Some("read-only vault");
        }
        if !self.guard_rel(rel).is_ok_and(|path| path.is_file()) {
            return Some("not a file");
        }
        let in_storage = match self.layout {
            Layout::Memex => rel.starts_with("storage/"),
            Layout::LegacyRotli => rel.starts_with("Storage/"),
        };
        let ext = Path::new(rel)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        let own_lifecycle = matches!(ext.as_deref(), Some("md" | "markdown" | "excalidraw"));
        (!in_storage || own_lifecycle).then_some("outside Rotli storage")
    }

    /// Move an existing storage asset into Archive/Trash while preserving its
    /// original relative path below that sink. The breadcrumb is therefore
    /// durable user-visible structure, not `.rotli/` state.
    pub fn move_file_to_sink(&mut self, rel: &str, sink: &str) -> Result<String, String> {
        validate_rel(rel)?;
        if sink != "Archive" && sink != "Trash" {
            return Err(format!("not a file lifecycle destination: {sink}"));
        }
        if let Some(reason) = self.storage_file_lifecycle_block(rel) {
            return Err(format!("this file can't move ({reason}): {rel}"));
        }
        let abs = self.abs(rel);
        let name = Path::new(rel)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("file has no name: {rel}"))?;
        let disk_sink = lifecycle_disk_folder(self.layout, sink);
        let original_folder = folder_of(rel);
        let sink_folder = if original_folder.is_empty() {
            disk_sink
        } else {
            format!("{disk_sink}/{original_folder}")
        };
        validate_rel(&sink_folder)?;
        self.guard_rel(&sink_folder)?;
        fs::create_dir_all(self.abs(&sink_folder))
            .map_err(|e| format!("create {sink_folder}: {e}"))?;
        let target_rel = self.free_name(&sink_folder, &name, None);
        let target_abs = self.abs(&target_rel);
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        fs::rename(&abs, &target_abs).map_err(|e| format!("move {rel} to {sink}: {e}"))?;
        Ok(target_rel)
    }

    /// Restore a file from Archive/Trash to the storage path nested beneath the
    /// sink. Collisions are renamed safely; no restore overwrites another file.
    pub fn restore_file(&mut self, rel: &str) -> Result<String, String> {
        validate_rel(rel)?;
        self.mutation_allowed()?;
        self.guard_rel(rel)?;
        let original_rel = rel
            .strip_prefix("Archive/")
            .or_else(|| rel.strip_prefix("Trash/"))
            .or_else(|| rel.strip_prefix("archive/"))
            .or_else(|| rel.strip_prefix("trash/"))
            .ok_or_else(|| format!("file is not in Archive or Trash: {rel}"))?;
        let in_storage = match self.layout {
            Layout::Memex => original_rel.starts_with("storage/"),
            Layout::LegacyRotli => original_rel.starts_with("Storage/"),
        };
        // a BOARD restores by this lane too (2026-08-04): it is path-addressed
        // with no frontmatter origin, so the sink-relative path is its only way
        // home — and in LegacyRotli boards live in `Board/`, outside storage.
        let is_board = original_rel.ends_with(".excalidraw");
        if (!in_storage && !is_board) || !self.abs(rel).is_file() {
            return Err(format!("file has no restorable storage origin: {rel}"));
        }
        let name = Path::new(original_rel)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("file has no name: {rel}"))?;
        let original_folder = folder_of(original_rel);
        self.guard_rel(&original_folder)?;
        fs::create_dir_all(self.abs(&original_folder))
            .map_err(|e| format!("create {original_folder}: {e}"))?;
        let target_rel = self.free_name(&original_folder, &name, None);
        let source_abs = self.abs(rel);
        let target_abs = self.abs(&target_rel);
        self.suppress.mark(&source_abs);
        self.suppress.mark(&target_abs);
        fs::rename(&source_abs, &target_abs).map_err(|e| format!("restore {rel}: {e}"))?;
        Ok(target_rel)
    }

    /// Overwrite a surfaced FILE's raw bytes — the spreadsheet editor's SAVE lane.
    /// Same per-store `writable()` gate as every user write, PLUS the sanctioned
    /// storage-office exception (storage_office_editable): an existing sheet/DOCX
    /// in a memex's storage/ edits in place, the way storage/excalidraw already does.
    /// Overwrite ONLY — a missing file is an error, never a create (creation goes
    /// through import/new_file_bytes). `bak`: copy the original to `<name>.bak`
    /// once, before the FIRST Rotli save — office codecs can normalize modeled
    /// content, so the exact pre-Rotli package remains recoverable.
    pub fn write_file_bytes(&mut self, rel: &str, bytes: &[u8], bak: bool) -> Result<(), String> {
        validate_rel(rel)?;
        self.guard_rel(rel)?;
        // the contract gate — unless this is the sanctioned in-place edit of an
        // existing storage office file, which the note lanes
        // still refuse. Overwrite-only is preserved by the is_file() check below.
        if !self.storage_office_editable(rel) {
            self.writable(rel)?;
        }
        let abs = self.abs(rel);
        if !abs.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        if bak {
            let bak_abs = abs.with_file_name(format!(
                "{}.bak",
                abs.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            ));
            if !bak_abs.exists() {
                fs::copy(&abs, &bak_abs).map_err(|e| format!("backup {rel}: {e}"))?;
            }
        }
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)
    }

    pub fn write_file_bytes_if_revision(
        &mut self,
        rel: &str,
        bytes: &[u8],
        bak: bool,
        expected_revision: &str,
    ) -> Result<String, String> {
        validate_rel(rel)?;
        let abs = self.guard_rel(rel)?;
        if !abs.is_file() {
            return Err(format!("not a file: {rel}"));
        }
        let current = fs::read(&abs).map_err(|e| format!("read {rel}: {e}"))?;
        crate::fsutil::compare_revision(expected_revision, &current)?;
        self.write_file_bytes(rel, bytes, bak)?;
        Ok(crate::fsutil::revision(bytes))
    }

    /// Create a NEW file from raw bytes in `folder` — the csv → xlsx convert
    /// writes the sibling workbook here. Collision-safe via free_name (never
    /// clobbers); same writable() gate. Returns the new file's rel path.
    pub fn new_file_bytes(
        &mut self,
        folder: &str,
        name: &str,
        bytes: &[u8],
    ) -> Result<String, String> {
        if !folder.is_empty() {
            validate_rel(folder)?;
        }
        validate_component(name)?;
        let rel = self.free_name(folder, name, None);
        self.guard_rel(&rel)?;
        self.writable(&rel)?;
        if !folder.is_empty() {
            fs::create_dir_all(self.abs(folder))
                .map_err(|e| format!("create folder {folder}: {e}"))?;
        }
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)?;
        Ok(rel)
    }

    /// Create a file owned by Rotli's document/sheet commands. In a memex these
    /// live in a dedicated storage/rotli lane, keeping the foreign storage tree
    /// read-only while giving generated assets an explicit ownership boundary.
    pub fn create_managed_file(&mut self, name: &str, bytes: &[u8]) -> Result<String, String> {
        const GENERATED_FILE_EXTS: &[&str] = &["xlsx", "docx"];
        self.mutation_allowed()?;
        validate_component(name)?;
        let ext = Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if !ext
            .as_deref()
            .is_some_and(|value| GENERATED_FILE_EXTS.contains(&value))
        {
            return Err(format!(
                "managed files must use one of: {}",
                GENERATED_FILE_EXTS.join(", ")
            ));
        }
        let folder = match self.layout {
            Layout::Memex => "storage/rotli",
            Layout::LegacyRotli => "Storage",
        };
        let rel = self.free_name(folder, name, None);
        self.guard_rel(&rel)?;
        fs::create_dir_all(self.abs(folder)).map_err(|e| format!("create {folder}: {e}"))?;
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)?;
        Ok(rel)
    }

    /// A generated PDF is an exported copy, never its editable source. Keep it
    /// in the managed lane but behind a dedicated boundary so the generic
    /// DOCX/XLSX byte command cannot start accepting passive formats.
    pub fn create_exported_pdf(&mut self, name: &str, bytes: &[u8]) -> Result<String, String> {
        self.mutation_allowed()?;
        validate_component(name)?;
        if Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("pdf"))
        {
            return Err("exported copies must use a .pdf filename".into());
        }
        if !bytes.starts_with(b"%PDF-") {
            return Err("exported copy is not a valid PDF".into());
        }
        let folder = match self.layout {
            Layout::Memex => "storage/rotli",
            Layout::LegacyRotli => "Storage",
        };
        let rel = self.free_name(folder, name, None);
        self.guard_rel(&rel)?;
        fs::create_dir_all(self.abs(folder)).map_err(|e| format!("create {folder}: {e}"))?;
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)?;
        Ok(rel)
    }

    fn editable_pdf_source(&mut self, id_or_rel: &str) -> Result<String, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let abs = self.guard_rel(&rel)?;
        let metadata = fs::metadata(&abs).map_err(|e| format!("stat {rel}: {e}"))?;
        if metadata.len() > GENERATED_PDF_SOURCE_MAX_BYTES {
            return Err(format!(
                "PDF source exceeds the {} MB local export limit.",
                GENERATED_PDF_SOURCE_MAX_BYTES / 1_000_000
            ));
        }
        let text = fs::read_to_string(abs).map_err(|e| format!("read {rel}: {e}"))?;
        let (frontmatter, raw) = parse_document(&text);
        let frontmatter = frontmatter.unwrap_or_default();
        let body = editor_body(raw);
        if walked_secure(&frontmatter, body) {
            return Err(
                "Protected or secret-shaped notes cannot be exported to an unprotected PDF copy."
                    .into(),
            );
        }
        if frontmatter
            .foreign
            .iter()
            .any(|line| locked_field(line) == Some(true))
        {
            return Err("Locked notes cannot be used as generated PDF sources.".into());
        }
        Ok(body.to_string())
    }

    /// Persist bytes selected through Chat as a conventional image asset. The
    /// transcript keeps a portable reference; this lane owns only copied bytes.
    pub fn create_image_asset(&mut self, name: &str, bytes: &[u8]) -> Result<String, String> {
        self.mutation_allowed()?;
        validate_component(name)?;
        if bytes.is_empty() {
            return Err("image payload is empty".into());
        }
        let ext = Path::new(name)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if !ext
            .as_deref()
            .is_some_and(|value| CHAT_IMAGE_ASSET_EXTS.contains(&value))
        {
            return Err(format!(
                "chat images must use one of: {}",
                CHAT_IMAGE_ASSET_EXTS.join(", ")
            ));
        }
        let ext = ext.expect("validated image extension");
        if !image_payload_matches_extension(&ext, bytes) {
            return Err(format!("image payload does not match its .{ext} filename"));
        }
        let folder = match self.layout {
            Layout::Memex => "storage/images",
            Layout::LegacyRotli => "Storage",
        };
        let rel = self.free_name(folder, name, None);
        self.guard_rel(&rel)?;
        fs::create_dir_all(self.abs(folder)).map_err(|e| format!("create {folder}: {e}"))?;
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write_bytes(&abs, bytes)?;
        Ok(rel)
    }

    pub fn managed_file_creation_available(&self) -> bool {
        self.mutation_allowed().is_ok()
    }

    /// Read a note's frontmatter for the metadata panel — the typed facts plus the
    /// lock state and every foreign line (shelf/reach/area/summary/tags/links/…).
    /// Takes a wire id OR a rel path (resolve_note_rel): a `.md` note travels the
    /// wire as its frontmatter ULID, and reading "<root>/<ULID>" off disk was the
    /// metadata panel's "No such file or directory" (the maintainer, 2026-07-01).
    fn read_frontmatter(&mut self, id_or_rel: &str) -> Result<FrontmatterView, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(&rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm_opt, body) = parse_document(&text);
        let mut fm = fm_opt.unwrap_or_default();
        let locked = fm.foreign.iter().any(|l| locked_field(l) == Some(true));
        let mut secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true));
        // auto-flag: secrets detected + not yet marked → set secure:true + gitignore.
        // The detector is the regex pass today; the local LLM refines it later.
        // BEST-EFFORT on this READ path: persist + gitignore, but a write/gitignore
        // hiccup must NEVER break reading the metadata — that left the panel stuck on
        // "Reading…" (the maintainer, 2026-06-30). We still report secure=true (the safe
        // direction); the explicit set_secure path keeps hard-failing for the user.
        if !secure && looks_secure(body) {
            fm.foreign.push("secure: true".to_string());
            if self.mutation_allowed().is_ok() {
                if let Err(e) = self.set_secure(&rel, true) {
                    eprintln!("auto-secure-flag (read) failed for {rel}: {e}");
                }
            }
            secure = true;
        }
        // the EFFECTIVE on-device verdict, not the raw bit (2026-08-01): note
        // override → vault knob → the default (allow). Resolved AFTER the
        // auto-flag so a just-detected note answers for its real state, and only
        // ASKED for a secure note — an ordinary note is readable by every class
        // by definition, and the vault knob has nothing to say about it. Policy
        // lives here alone; the note menu never re-derives it in the webview.
        let local_ai_allowed = !secure || self.secure_readable_locally(&fm);
        let fields = fm
            .foreign
            .iter()
            // hide RESERVED keys (locked/secure/owner/…) from the user's editor —
            // they're managed by rotli, not hand-edited (v3.7).
            .filter(|l| {
                !l.trim().is_empty() && field_key(l).is_none_or(|k| !RESERVED_KEYS.contains(&k))
            })
            .cloned()
            .collect();
        Ok(FrontmatterView {
            id: fm.id.unwrap_or_default(),
            created: fm.created.unwrap_or_default(),
            updated: fm.updated.unwrap_or_default(),
            locked,
            secure,
            local_ai_allowed,
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
        self.mutation_allowed()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (fm, body) = parse_document(&text);
            let mut fm = fm.unwrap_or_default();
            fm.foreign.retain(|l| locked_field(l).is_none());
            if locked {
                fm.foreign.push("locked: true".to_string());
            }
            atomic_write(&path, &compose_document(&fm, body))
        })
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
        self.mutation_allowed()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (fm, body) = parse_document(&text);
            let mut fm = fm.unwrap_or_default();
            fm.pinned = Some(pinned);
            atomic_write(&path, &compose_document(&fm, body))
        })
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
            return Err(format!(
                "`{key}` belongs to the AI filer — not editable here"
            ));
        }
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.writable(rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
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
        })
    }

    /// The note's frontmatter as RAW TEXT (fences included), byte-exact from
    /// disk; "" when the note has none. The "Show file metadata" view renders
    /// this above the body — the metadata IS the top of the file, not a form.
    #[cfg(test)]
    fn raw_frontmatter(&mut self, id_or_rel: &str) -> Result<String, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(&rel)).map_err(|e| e.to_string())?;
        Ok(raw_frontmatter_block(&text).to_string())
    }

    fn raw_frontmatter_versioned(
        &mut self,
        id_or_rel: &str,
    ) -> Result<crate::fsutil::VersionedText, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(&rel)).map_err(|e| e.to_string())?;
        Ok(crate::fsutil::VersionedText {
            contents: raw_frontmatter_block(&text).to_string(),
            revision: crate::fsutil::revision(text.as_bytes()),
        })
    }

    /// Write back a user-edited raw frontmatter block. merge_raw_frontmatter
    /// keeps the typed lines verbatim but restores the reserved provenance keys
    /// (id/owner/created) from the file; the body is untouched and `updated` is
    /// NOT bumped (a metadata edit never reorders the list). Gated by the same
    /// user-writability as every editor save (wiki/** included since 2026-08-03).
    /// Because `secure:` can be typed here, the gitignore stays in step the same
    /// way set_secure keeps it (secure ⇒ gitignored, cleared ⇒ un-ignored).
    #[cfg(test)]
    fn write_frontmatter_raw(&mut self, id_or_rel: &str, block: &str) -> Result<(), String> {
        let revision = self.raw_frontmatter_versioned(id_or_rel)?.revision;
        self.write_frontmatter_raw_if_revision(id_or_rel, block, &revision)
            .map(|_| ())
    }

    fn write_frontmatter_raw_if_revision(
        &mut self,
        id_or_rel: &str,
        block: &str,
        expected_revision: &str,
    ) -> Result<String, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        self.writable(&rel)?;
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            crate::fsutil::compare_revision(expected_revision, text.as_bytes())?;
            let out = merge_raw_frontmatter(&text, block)?;
            if out == text {
                return Ok(crate::fsutil::revision(text.as_bytes())); // no write, no watcher echo
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
            let (_, out_body) = parse_document(&out);
            if before && !after && looks_secure(out_body) {
                return Err(
                    "Remove the detected secret from the note before removing secure protection"
                        .into(),
                );
            }
            self.suppress.mark(&path);
            atomic_write(&path, &out)?;
            if after && !before {
                self.gitignore_add(&rel)?;
            } else if before && !after {
                self.gitignore_remove(&rel)?;
            }
            Ok(crate::fsutil::revision(out.as_bytes()))
        })
    }

    /// Append a path to the corpus `.gitignore` (idempotent) — a secure note must
    /// never be pushed when the corpus is a git repo. The write error PROPAGATES: a
    /// note marked secure whose `.gitignore` write failed would silently stay
    /// committable, so set_secure must learn about it (the maintainer, 2026-06-30 — audit).
    fn gitignore_add(&self, rel: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        crate::fsutil::with_file_lock(&path, || {
            // an unreadable .gitignore must not be rewritten from empty — that
            // would drop every OTHER secure note's ignore line
            let existing = read_existing_text(&path)?;
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
        })
    }

    /// Remove a path from the corpus `.gitignore` — called when a note's secure flag
    /// is cleared, so it isn't left needlessly ignored (the symmetric counterpart of
    /// gitignore_add). No-op when there's no `.gitignore` or the line isn't present.
    fn gitignore_remove(&self, rel: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        crate::fsutil::with_file_lock(&path, || {
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
        })
    }

    /// Make the hand-arranged Main and named-view manifests git-committable while
    /// the rest of `.rotli/` stays ignored. Unlike index/settings sidecars, these
    /// arrangements are user work that should travel with the memex.
    /// A bare `.rotli/` line ignores the whole dir — and git CANNOT re-include a file
    /// under an ignored dir — so narrow it to `.rotli/*` and add `!.rotli/main.json`.
    /// Idempotent; a no-op outside a git corpus.
    fn ensure_main_committable(&self) -> Result<(), String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(".gitignore")?;
        if !path.exists() && !self.root.join(".git").exists() {
            return Ok(());
        }
        crate::fsutil::with_file_lock(&path, || {
            let existing = read_existing_text(&path)?;
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
            if !lines.iter().any(|l| l.trim() == "!.rotli/views.json") {
                lines.push("!.rotli/views.json".to_string());
                changed = true;
            }
            if changed {
                let mut out = lines.join("\n");
                out.push('\n');
                atomic_write(&path, &out)?;
            }
            Ok(())
        })
    }

    /// Toggle the per-note SECURE policy. Secure notes have a REAL protected home:
    /// `wiki/_secure/` inside a memex Brain (`Secure notes/` in the legacy corpus).
    /// The previous physical folder is kept as a Rotli-owned breadcrumb so removing
    /// protection can move the same stable note id home again. Every move remains
    /// gitignored until protection has been removed successfully.
    /// Takes a wire id OR a rel path (resolve_note_rel) — the gitignore line must be
    /// the note's PATH, never its ULID.
    /// SANCTIONED writable() exception (#22): `secure` is a rotli-managed CONTROL
    /// flag (like the auto-flag on the read path) — marking a note secure must
    /// never be refused by the user-lane gate.
    fn set_secure(&mut self, id_or_rel: &str, secure: bool) -> Result<(), String> {
        self.mutation_allowed()?;
        let rel = self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || self.set_secure_resolved(&rel, secure))
    }

    fn set_secure_resolved(&mut self, rel: &str, secure: bool) -> Result<(), String> {
        let path = self.abs(rel);
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        if !secure && looks_secure(body) {
            return Err(
                "Remove the detected secret from the note before removing secure protection".into(),
            );
        }
        let note_id = fm
            .id
            .clone()
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "secure notes require a stable frontmatter id".to_string())?;
        let current_folder = folder_of(rel);
        let secure_home = match self.layout {
            Layout::Memex => "wiki/_secure",
            Layout::LegacyRotli => SECURE_NOTES_FOLDER,
        };
        let in_secure_home =
            current_folder == secure_home || current_folder.starts_with(&format!("{secure_home}/"));

        if secure {
            if !in_secure_home
                && !fm
                    .foreign
                    .iter()
                    .any(|line| secure_origin_field(line).is_some())
            {
                fm.foreign.push(format!("secure_origin: {current_folder}"));
            }
            fm.foreign.retain(|line| secure_field(line).is_none());
            fm.foreign.push("secure: true".to_string());
            // Protect the CURRENT path before any write or move. relocate adds
            // the target ignore before moving and removes this old line after.
            self.gitignore_add(rel)?;
            self.suppress.mark(&path);
            atomic_write(&path, &compose_document(&fm, body))?;
            if !in_secure_home {
                self.relocate(&note_id, rel, secure_home)?;
            }
            return Ok(());
        }

        // Move while the secure flag + ignore are still active; only then drop
        // protection at the destination. A failed move therefore never exposes
        // the file at an unignored path.
        let restore_home = fm
            .foreign
            .iter()
            .find_map(|line| secure_origin_field(line))
            .filter(|home| home != secure_home && !home.starts_with(&format!("{secure_home}/")))
            .unwrap_or_else(|| match self.layout {
                Layout::Memex => "wiki/_inbox".to_string(),
                Layout::LegacyRotli => "Inbox".to_string(),
            });
        let final_rel = if in_secure_home {
            self.relocate(&note_id, rel, &restore_home)?;
            self.resolve_note_rel(&note_id)?
        } else {
            rel.to_string()
        };
        let final_path = self.abs(&final_rel);
        let final_text = fs::read_to_string(&final_path).map_err(|e| e.to_string())?;
        let (final_fm, final_body) = parse_document(&final_text);
        let mut final_fm = final_fm.unwrap_or_default();
        final_fm.foreign.retain(|line| {
            secure_field(line).is_none()
                && local_ai_allowed_field(line).is_none()
                && secure_origin_field(line).is_none()
        });
        self.suppress.mark(&final_path);
        atomic_write(&final_path, &compose_document(&final_fm, final_body))?;
        self.gitignore_remove(&final_rel)?;
        Ok(())
    }

    /// Scan Brain intake for LEGACY secure state (decision 2026-07-22): a note
    /// explicitly flagged `secure: true` whose file still sits in the intake
    /// lane. Current creation and flagging place secure notes in the protected
    /// lane, so such a file is pre-lane or externally moved state the organizer
    /// must never read in place. Read-only; the preview the UI shows.
    /// Deliberately narrow:
    /// - intake ONLY — a secure note in Archive/Trash or a hand-picked folder
    ///   got there through sanctioned moves that carry its ignore line;
    /// - the EXPLICIT flag only — detector-only notes stay "review yourself"
    ///   (the secure-pattern confirmation feature owns proposing the flag);
    /// - notes with a stable frontmatter id only — the protected move keeps
    ///   identity by id, and set_secure refuses id-less notes anyway.
    pub(crate) fn secure_repair_scan(&mut self) -> Result<Vec<SecureRepairCandidate>, String> {
        let intake = match self.layout {
            Layout::Memex => "wiki/_inbox",
            Layout::LegacyRotli => "Inbox",
        };
        let mut out = Vec::new();
        let Ok(entries) = fs::read_dir(self.abs(intake)) else {
            return Ok(out); // no intake dir → nothing stuck
        };
        let mut names: Vec<String> = entries
            .filter_map(|e| e.ok())
            // symlinks and subdirectories are not repair material — the intake
            // lane is flat, and a link's target must never be moved through it
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".md") && !n.starts_with('.'))
            .collect();
        names.sort();
        for name in names {
            let rel = format!("{intake}/{name}");
            let Ok(text) = fs::read_to_string(self.abs(&rel)) else {
                continue;
            };
            let (fm, raw) = parse_document(&text);
            let Some(fm) = fm else { continue };
            if !fm.foreign.iter().any(|l| secure_field(l) == Some(true)) {
                continue;
            }
            let Some(id) = fm.id.clone().filter(|id| !id.is_empty()) else {
                continue;
            };
            out.push(SecureRepairCandidate {
                id,
                rel: rel.clone(),
                // title is for the user's own preview UI only — never journaled
                title: title_of(editor_body(raw)),
                folder: intake.to_string(),
            });
        }
        Ok(out)
    }

    /// Repair every current scan candidate: complete the protected move that
    /// creation/flagging would have done. Each note is RE-VALIDATED on disk
    /// before its move — the preview is informational, never trusted. Refusals
    /// (flag gone, id missing, unwritable `.gitignore`, containment) collect
    /// per note; one bad file never blocks the rest.
    pub(crate) fn secure_repair_apply(&mut self) -> Result<SecureRepairReport, String> {
        self.mutation_allowed()?;
        let mut report = SecureRepairReport::default();
        for cand in self.secure_repair_scan()? {
            match self.secure_repair_note(&cand.rel) {
                Ok(()) => report.repaired += 1,
                Err(e) => report.failed.push(e),
            }
        }
        Ok(report)
    }

    /// Repair ONE legacy secure-intake note. Unlike `set_secure` this NEVER
    /// flags a note — it refuses unless `secure: true` is already on disk, then
    /// delegates the move to the one existing protected flow (ignore line for
    /// the current path first, destination ignore before the move, prose
    /// untouched, stale ignore entries harmless on failure). The journal row is
    /// CONTENT-FREE: ULIDs and structural folders only — never the title, the
    /// slug-bearing rel, a summary, or tags.
    fn secure_repair_note(&mut self, id_or_rel: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(&rel)).map_err(|e| e.to_string())?;
        let (fm, _) = parse_document(&text);
        let fm = fm.unwrap_or_default();
        if !fm.foreign.iter().any(|l| secure_field(l) == Some(true)) {
            return Err("Repair applies only to a note explicitly marked secure".into());
        }
        let note_ulid = fm
            .id
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "secure notes require a stable frontmatter id".to_string())?;
        let before = folder_of(&rel);
        self.set_secure(&rel, true)?;
        let after = match self.layout {
            Layout::Memex => "wiki/_secure",
            Layout::LegacyRotli => SECURE_NOTES_FOLDER,
        };
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let row = serde_json::json!({
            "id": Ulid::new().to_string(),
            "ts": ts,
            "action": "repair",
            "noteId": note_ulid,
            "noteUlid": note_ulid,
            "noteTitle": "",
            "before": before,
            "after": after,
            "model": "",
            "status": "applied",
        });
        self.journal_append(&row.to_string()).map_err(|e| {
            format!("The note moved to the protected lane, but journaling failed: {e}")
        })
    }

    /// Pin this note's on-device AI visibility, overriding the vault default.
    /// Valid only while the note is secure — an ordinary note is visible to
    /// every class of model by definition, so there is nothing here to say. The
    /// line is written EXPLICITLY in both directions (`true` / `false`) rather
    /// than removed, so the note's intent is legible on disk and in `git diff`;
    /// an ABSENT line means "follow the vault knob" (2026-08-01). Remote
    /// endpoints stay blocked in `read_for_ai` regardless of this flag.
    fn set_local_ai_access(&mut self, id_or_rel: &str, allowed: bool) -> Result<(), String> {
        self.mutation_allowed()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (fm, body) = parse_document(&text);
            let mut fm = fm.unwrap_or_default();
            let explicitly_secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true));
            let secure = explicitly_secure || looks_secure(body);
            if !secure {
                return Err("Local AI access is only meaningful for a secure note".into());
            }
            fm.foreign.retain(|l| local_ai_allowed_field(l).is_none());
            // pin the classification either way: a detector-secure note that now
            // carries an explicit access decision must carry the flag it decides on
            if !explicitly_secure {
                fm.foreign.push("secure: true".to_string());
                self.gitignore_add(rel)?;
            }
            fm.foreign.push(format!("local_ai_allowed: {allowed}"));
            atomic_write(&path, &compose_document(&fm, body))
        })
    }

    /// Read a note FOR an AI model — the ONE read gate every AI lane passes
    /// (docs/design/ai-visibility-matrix.md).
    ///
    /// * A `Hidden` path is refused outright: vault plumbing is not knowledge,
    ///   and no model has a reason to read `memex.json` or `STRUCTURE.md`. A
    ///   `Reference` path (identity/, personality/, history/, MAP.md, inbox.md)
    ///   IS readable — that is the 2026-08-01 flip.
    /// * A SECURE note is ALWAYS refused to a remote/frontier model. No knob
    ///   changes that and none will exist.
    /// * A SECURE note is readable by a registered on-device model BY DEFAULT
    ///   (the maintainer, 2026-08-01: "only local AI can see secure notes" — see, not
    ///   "see if separately permitted"). Two knobs can still say no: the note's
    ///   own `local_ai_allowed: false`, and the vault's `secureLocalAi: false`.
    ///   The per-note bit wins over the vault default in BOTH directions.
    ///
    /// The `secure:` flag is checked first; when it's ABSENT the secret DETECTOR
    /// runs on the body too (#21, audit 2026-07) — the auto-flag only fires when
    /// the metadata panel is opened, so a never-inspected note with detectable
    /// secrets must not slip through on the flag alone.
    /// Takes a wire id OR a rel path (resolve_note_rel — same bridge as the filer lane).
    pub(crate) fn read_for_ai(
        &mut self,
        id_or_rel: &str,
        model_is_local: bool,
    ) -> Result<String, String> {
        let rel = &self.resolve_note_rel(id_or_rel)?;
        if surfaced(self.layout, rel) == Surface::Hidden {
            return Err(format!("not available to AI: {rel}"));
        }
        let text = fs::read_to_string(self.abs(rel)).map_err(|e| e.to_string())?;
        let (fm, body) = parse_document(&text);
        let fm = fm.unwrap_or_default();
        let secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true))
            || fm
                .foreign
                .iter()
                .any(|l| secure_context_field(l) == Some(true))
            || looks_secure(body);
        if secure {
            // remote FIRST and unconditionally — the refusal must never depend
            // on, or leak the state of, a local-visibility knob
            if !model_is_local {
                return Err("This note is secure and can never be sent to a remote model.".into());
            }
            if !self.secure_readable_locally(&fm) {
                return Err(
                    "This secure note is hidden from AI — turn Local AI access back on for it (or for this vault) to use it here."
                        .into(),
                );
            }
            // The read is ALLOWED, and it is about to put secure prose into an
            // on-device model's context. Remember it: from here on, every egress
            // seam refuses outbound text that quotes this body, whatever the
            // (untrusted) agent loop asks for. This is the ONE recording site —
            // the same choke point that decided the read.
            crate::secret::remember_secure_text(body);
        }
        Ok(text)
    }

    /// May an ON-DEVICE model read this secure note? Default yes (2026-08-01);
    /// the note's explicit `local_ai_allowed` bit wins, else the vault knob.
    /// Never consulted for a remote model — remote is refused unconditionally.
    fn secure_readable_locally(&self, fm: &Frontmatter) -> bool {
        match fm.foreign.iter().find_map(|l| local_ai_allowed_field(l)) {
            Some(explicit) => explicit,
            None => self.secure_local_ai(),
        }
    }

    /// The vault-wide default for secure ⇄ on-device visibility, read from the
    /// settings sidecar per call exactly like `brain_enabled`. A MISSING file or
    /// field means ON (the documented default, and today's behavior for every
    /// existing vault). A REAL read error fails CLOSED: an unreadable consent
    /// boundary must never resolve permissively.
    fn secure_local_ai(&self) -> bool {
        let Ok(settings) = self.dot_read("settings") else {
            return false; // NotFound is Ok("{}") — this is a genuine IO fault
        };
        serde_json::from_str::<serde_json::Value>(&settings)
            .ok()
            .and_then(|v| v.get("secureLocalAi").and_then(serde_json::Value::as_bool))
            .unwrap_or(true)
    }

    /// WRITE a note on behalf of an interactive AI model — `update_note` and the
    /// per-turn chat-memory sync. Two gates, in order:
    ///   1. the same `read_for_ai` gate the model passed to SEE it (a model may
    ///      never edit what it may not read), and
    ///   2. **LOCKED** — no AI of any class edits a locked note. "Local" buys
    ///      visibility, never edit authority (the maintainer, 2026-08-01).
    ///
    /// Then the SAME `writable()` surface gate the user's own editor passes — so
    /// the AI's write surface is exactly the human's minus locked notes, never
    /// wider. The USER's own `write` is untouched: locking protects a note from
    /// models, not from its author.
    #[cfg(test)]
    pub(crate) fn write_for_ai(
        &mut self,
        id_or_rel: &str,
        body: &str,
        model_is_local: bool,
    ) -> Result<NoteMeta, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = self.read_for_ai(&rel, model_is_local)?;
        let (fm, target_body) = parse_document(&text);
        let fm = fm.unwrap_or_default();
        if fm
            .foreign
            .iter()
            .any(|line| locked_field(line) == Some(true))
        {
            return Err(
                "This note is locked — no AI may edit it. Unlock it from the note's menu first."
                    .into(),
            );
        }
        // THE LAUNDERING RULE, in Rust (docs/design/ai-visibility-matrix.md T2:
        // "secure content flows only into secure containers"). The TS host has
        // enforced this since PR #4 by tracking the CHAT's secure taint — but a
        // chat id is a webview assertion, so a compromised loop could read a
        // secure note on-device and then write its prose into an open note that
        // a frontier model reads five minutes later. Rust cannot see chats; it
        // CAN see that the incoming body is protected content, so it refuses to
        // let protected prose land anywhere it would stop being protected.
        let target_secure =
            fm.foreign.iter().any(|l| secure_field(l) == Some(true)) || looks_secure(target_body);
        if !target_secure && crate::secret::blocked_for_remote(body) {
            return Err(
                "This text came out of a secure note, so it can only be written into a note that is itself secure. Use create_note instead — the new note will be marked secure."
                    .into(),
            );
        }
        self.writable(&rel)?;
        self.write_resolved(id_or_rel, body, rel)
    }

    pub(crate) fn write_for_ai_if_revision(
        &mut self,
        id_or_rel: &str,
        body: &str,
        model_is_local: bool,
        expected_revision: &str,
    ) -> Result<CorpusWriteResult, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        self.writable(&rel)?;
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = self.read_for_ai(&rel, model_is_local)?;
            let (fm, target_body) = parse_document(&text);
            let fm = fm.unwrap_or_default();
            if fm
                .foreign
                .iter()
                .any(|line| locked_field(line) == Some(true))
            {
                return Err(
                    "This note is locked — no AI may edit it. Unlock it from the note's menu first."
                        .into(),
                );
            }
            let target_secure = fm.foreign.iter().any(|l| secure_field(l) == Some(true))
                || looks_secure(target_body);
            if !target_secure && crate::secret::blocked_for_remote(body) {
                return Err(
                    "This text came out of a secure note, so it can only be written into a note that is itself secure. Use create_note instead — the new note will be marked secure."
                        .into(),
                );
            }
            crate::fsutil::compare_revision(expected_revision, text.as_bytes())?;
            let meta = self.write_resolved(id_or_rel, body, rel.clone())?;
            let landed_rel = self.path_of(id_or_rel)?;
            let landed = fs::read(self.guard_rel(&landed_rel)?)
                .map_err(|e| format!("read saved note {landed_rel}: {e}"))?;
            Ok(CorpusWriteResult {
                meta,
                revision: crate::fsutil::revision(&landed),
            })
        })
    }

    /// The headless workspace adapters are remote-agent surfaces. They share the
    /// same fail-closed secure-content gate as Chat and add the organizer's lock
    /// rule before any body write. Keeping this check beside `writable()` means
    /// the CLI and MCP cannot accidentally invent a broader write policy.
    #[cfg(test)]
    pub(crate) fn write_for_remote_agent(
        &mut self,
        id: &str,
        body: &str,
    ) -> Result<NoteMeta, String> {
        let rel = self.resolve_note_rel(id)?;
        let text = self.read_for_ai(&rel, false)?;
        let fm = parse_document(&text).0.unwrap_or_default();
        if fm
            .foreign
            .iter()
            .any(|line| locked_field(line) == Some(true))
        {
            return Err("note is locked — an external agent may not edit it".into());
        }
        if self.layout == Layout::Memex && (rel == "wiki" || rel.starts_with("wiki/")) {
            self.filer_writable(&rel)?;
        } else {
            self.writable(&rel)?;
        }
        self.write_resolved(id, body, rel)
    }

    pub(crate) fn write_for_remote_agent_if_revision(
        &mut self,
        id: &str,
        body: &str,
        expected_revision: &str,
    ) -> Result<CorpusWriteResult, String> {
        let rel = self.resolve_note_rel(id)?;
        if self.layout == Layout::Memex && (rel == "wiki" || rel.starts_with("wiki/")) {
            self.filer_writable(&rel)?;
        } else {
            self.writable(&rel)?;
        }
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = self.read_for_ai(&rel, false)?;
            let fm = parse_document(&text).0.unwrap_or_default();
            if fm
                .foreign
                .iter()
                .any(|line| locked_field(line) == Some(true))
            {
                return Err("note is locked — an external agent may not edit it".into());
            }
            crate::fsutil::compare_revision(expected_revision, text.as_bytes())?;
            let meta = self.write_resolved(id, body, rel.clone())?;
            let landed_rel = self.path_of(id)?;
            let landed = fs::read(self.guard_rel(&landed_rel)?)
                .map_err(|e| format!("read saved note {landed_rel}: {e}"))?;
            Ok(CorpusWriteResult {
                meta,
                revision: crate::fsutil::revision(&landed),
            })
        })
    }

    /// May a remote agent rewrite this note's FRONTMATTER (a view tag)? The
    /// surface predicate is the whole answer: `Reference` and `Hidden` are
    /// documented as written by no lane, ever, and a bare existence check let
    /// the workspace's view lane write both (audit 2026-08-01, GAP 7).
    pub(crate) fn agent_frontmatter_writable(&self, rel: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        match surfaced(self.layout, rel) {
            Surface::NoteRW | Surface::NoteRO => Ok(()),
            Surface::Reference => {
                Err("that note is part of the vault's protected reference layer and no agent may write it".into())
            }
            Surface::Hidden => Err(format!("not available to AI: {rel}")),
        }
    }

    /// May a remote agent SEE that this path exists at all? Folders and
    /// surfaced files carry no frontmatter, so nothing per-item marks them —
    /// the surface predicate is the only policy they have, and the workspace
    /// listing lane was applying none (audit 2026-08-01, GAP 8). The corpus
    /// root ("") is always listable; it is the tree the agent was handed.
    pub(crate) fn agent_listable(&mut self, id_or_rel: &str) -> bool {
        let (_, rel) = split_root_id(id_or_rel);
        if rel.is_empty() {
            return true;
        }
        let rel = self.resolve_note_rel(&rel).unwrap_or(rel);
        !matches!(
            surfaced(self.layout, &rel),
            Surface::Hidden | Surface::Reference
        )
    }

    pub(crate) fn move_for_remote_agent(
        &mut self,
        id: &str,
        target_folder: &str,
    ) -> Result<NoteMeta, String> {
        let rel = self.resolve_note_rel(id)?;
        let text = self.read_for_ai(&rel, false)?;
        let fm = parse_document(&text).0.unwrap_or_default();
        if fm
            .foreign
            .iter()
            .any(|line| locked_field(line) == Some(true))
        {
            return Err("note is locked — an external agent may not move it".into());
        }
        if self.layout == Layout::Memex
            && (rel == "wiki" || rel.starts_with("wiki/"))
            && (target_folder == "wiki" || target_folder.starts_with("wiki/"))
        {
            self.filer_move(id, target_folder)
        } else {
            self.move_note(id, target_folder)
        }
    }

    pub(crate) fn create_for_remote_agent(
        &mut self,
        folder_id: &str,
        body: &str,
    ) -> Result<NoteMeta, String> {
        if looks_secure(body) {
            return Err(
                "the new note looks sensitive — a remote agent may not create or retain it".into(),
            );
        }
        self.create(folder_id, body)
    }

    /// First run: the corpus is born with Inbox and ONE warm welcome note.
    /// No demo notes on disk — the in-memory demo corpus stays browser-only.
    fn first_run(&mut self) -> Result<(), String> {
        fs::create_dir_all(self.root.join("Inbox")).map_err(|e| format!("create Inbox: {e}"))?;
        self.create("Inbox", WELCOME_BODY)?;
        Ok(())
    }

    /// The reserved top-level destinations the sidebar always offers —
    /// Inbox, Secure notes, Vault, Storage, Board, Archive, Trash — scaffolded on disk so they
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
    /// (Invariant 4 — no data loss). (the maintainer, 2026-06-13 / 2026-06-24)
    fn ensure_reserved_folders(&self) -> Result<(), String> {
        for name in [
            "Inbox",
            SECURE_NOTES_FOLDER,
            "Vault",
            "Storage",
            "Board",
            "Archive",
            "Trash",
        ] {
            fs::create_dir_all(self.guard_rel(name)?)
                .map_err(|e| format!("create reserved folder {name}: {e}"))?;
        }
        Ok(())
    }

    fn load_index(&mut self) {
        let Ok(path) = self.guard_rel(&format!("{DOT_DIR}/index.json")) else {
            return;
        };
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(file) = serde_json::from_str::<IndexFile>(&text) {
                self.index = file.notes;
            }
        }
    }

    fn persist_index(&self) {
        if self.mutation_allowed().is_err() {
            return;
        }
        let file = IndexFile {
            version: 1,
            notes: self.index.clone(),
        };
        if let Ok(json) = serde_json::to_string_pretty(&file) {
            if let Ok(path) = self.guard_rel(&format!("{DOT_DIR}/index.json")) {
                let _ = atomic_write(&path, &json);
            }
        }
    }

    fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    /// Resolve a corpus-relative path without following any symlink component.
    /// Call this at every read boundary; mutation boundaries receive the same
    /// check centrally through `writable` / `filer_writable`.
    pub(crate) fn guard_rel(&self, rel: &str) -> Result<PathBuf, String> {
        crate::containment::resolve_beneath(&self.root, Path::new(rel))
    }

    /// The ownership choke point (Increment 3). Called at the TOP of every
    /// mutating method, before any disk touch. LegacyRotli → Ok for everything
    /// (today). Memex → Ok ONLY for the NoteRW lanes (`wiki/**`, `chats/**`,
    /// lifecycle sinks, the board lane); every other path returns a user-facing
    /// Err that the TS layer renders. `rel == ""` is the corpus root — writable
    /// only in LegacyRotli.
    fn mutation_allowed(&self) -> Result<(), String> {
        // #3 (audit 2026-07): perms + contract band are enforced HERE, not only in
        // the TS canWrite — a user-set read-only brain and an out-of-band contract
        // both refuse every user write.
        if self.band_read_only {
            return Err(
                "this vault's format is outside the range rotli supports — it opens read-only"
                    .into(),
            );
        }
        if self.perms_read_only {
            return Err(
                "this vault is connected read-only — allow writes in Settings → Location first"
                    .into(),
            );
        }
        Ok(())
    }

    fn writable(&self, rel: &str) -> Result<(), String> {
        self.guard_rel(rel)?;
        self.mutation_allowed()?;
        if self.layout == Layout::LegacyRotli {
            return Ok(());
        }
        match surfaced(self.layout, rel) {
            Surface::NoteRW => Ok(()),
            _ => Err(format!(
                "this location is read-only to rotli in this vault — it writes Library notes, chats, and boards (refused: {})",
                if rel.is_empty() { "<root>" } else { rel }
            )),
        }
    }

    /// A memex `storage/` binary is contract-read-only (the note lanes never write
    /// it — foreign assets are mirrored, not owned). But a user editing an EXISTING
    /// spreadsheet or DOCX they dropped there is a deliberate, IN-PLACE overwrite — the same
    /// reasoning that already makes `storage/excalidraw` a writable board lane. This
    /// SANCTIONED exception lets the office editors' Save — and the file_stat
    /// that gates edit mode — overwrite an existing `.xlsx`/`.csv`/DOCX-family file in
    /// storage. It NEVER widens to: new-file creation (new_file_bytes still refuses
    /// storage), note writes, or any other binary — and it still yields to a
    /// band/perms read-only brain (checked in `writable`, mirrored here).
    fn storage_office_editable(&self, rel: &str) -> bool {
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
        matches!(
            ext.as_deref(),
            Some("xlsx") | Some("csv") | Some("docx") | Some("docm") | Some("dotx") | Some("dotm")
        ) && self.guard_rel(rel).is_ok_and(|path| path.is_file())
    }

    /// Scan the disk (the truth), reconciling the id↔path index as we go:
    /// frontmatter ids win, then the previous index (keeps frontmatter-less
    /// files stable across runs), then a freshly minted ulid.
    pub fn list(&mut self) -> Result<CorpusList, String> {
        self.ensure_walked()?;
        Ok(self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache")
            .list
            .clone())
    }

    /// Warm the secure-prose ledger for this root at STARTUP, before any egress
    /// command can run (audit follow-up 2026-08-01, finding #2).
    ///
    /// The ledger is fed by the corpus WALK (`ensure_walked` hashes every secure
    /// note's prose), but `open`/`open_with_mode` deliberately do NOT walk — they
    /// load the persisted index and return. So in a fresh process, until a root's
    /// first `list`/`search`, the ledger held none of that root's secure prose —
    /// and the ungated editor/file lanes (`corpus_read`, `corpus_file_text`,
    /// `corpus_file_bytes`) can hand a secure note's frontmatter-stripped body
    /// straight to a remote lane. A connected brain the user never browses this
    /// session might never walk at all. That is a real boot race, and this is
    /// what closes it: the lib.rs setup loop walks every registered root once, so
    /// the ledger is warm before the first command. It is the SAME walk the first
    /// sidebar paint would do — this only moves it earlier, warming the list
    /// cache the perf audit wants. Non-fatal for the caller to skip: `read_for_ai`
    /// is still the primary gate; the ledger is the defense-in-depth layer.
    pub fn warm_secure_ledger(&mut self) -> Result<(), String> {
        self.ensure_walked()
    }

    /// First activation of an adopted Markdown folder mirrors its disk tree into
    /// Main as references. Content is never copied and note files are never
    /// rewritten; `.rotli/index.json` supplies the stable local identities.
    pub fn seed_main_from_disk_if_missing(&mut self) -> Result<(), String> {
        let path = self.guard_rel(&format!("{DOT_DIR}/main.json"))?;
        if path.exists() {
            return Ok(());
        }
        let list = self.list()?;
        let manifest = ReferenceManifest {
            version: 1,
            tree: reference_tree_from_list(&list, None),
        };
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())? + "\n";
        atomic_write(&path, &json)
    }

    /// Walk the disk ONLY when the change generation moved (perf audit
    /// 2026-07-30, #1: with staleTime ∞ + broad invalidation, ~9 uncached
    /// walks rode every editor tick). Internal writes bump the generation at
    /// `suppress.mark()`; external changes bump it from the watcher — an
    /// unchanged generation means the disk is exactly as last walked.
    fn ensure_walked(&mut self) -> Result<(), String> {
        // read the generation BEFORE walking: a write landing mid-walk makes
        // the stored generation stale and the next call re-walks — the safe side
        let generation = self.suppress.generation();
        if self
            .list_cache
            .as_ref()
            .is_some_and(|c| c.generation == generation)
        {
            return Ok(());
        }
        let mut folders: Vec<FolderMeta> = Vec::new();
        let mut notes: Vec<NoteMeta> = Vec::new();
        let mut reference: Vec<NoteMeta> = Vec::new();
        let mut texts: HashMap<String, CachedNoteText> = HashMap::new();
        let reverse: HashMap<String, String> = self
            .index
            .iter()
            .map(|(id, p)| (p.clone(), id.clone()))
            .collect();
        let mut new_index: HashMap<String, String> = HashMap::new();

        walk(
            self.layout,
            &self.root,
            "",
            &reverse,
            &mut new_index,
            &mut folders,
            &mut notes,
            &mut reference,
            &mut texts,
        )?;

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
        reference.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
        // Feed the secure-prose ledger from the WALK, not from a read (audit
        // 2026-08-01, GAP 2). Deriving it from `read_for_ai` alone would have
        // left the real hole open: `corpus_read` — the editor's ungated read —
        // returns the frontmatter-STRIPPED body, so prose fetched that way and
        // handed to a remote lane carries no `secure: true` marker for the
        // egress detector to find. The vault itself is the honest source: if a
        // note in this corpus is secure, its prose may not leave, whichever
        // command went and got it. This holds from PROCESS START because the
        // lib.rs setup loop calls `warm_secure_ledger` (this same walk) on every
        // registered root before any command runs — otherwise a never-browsed
        // root's secure prose would be absent until its first list (the boot
        // race, follow-up finding #2). Idempotent, so re-walks cost nothing.
        for text in texts.values().filter(|t| t.secure) {
            crate::secret::remember_secure_text(&text.body);
        }
        self.list_cache = Some(ListCache {
            generation,
            list: CorpusList { folders, notes },
            reference,
            texts,
        });
        Ok(())
    }

    /// The `Surface::Reference` lane — the brain's memory notes, which the AI
    /// may retrieve and the Notes tree never shows (2026-08-01; see
    /// docs/design/ai-visibility-matrix.md). Ids ARE relative paths, so
    /// `resolve_note_rel`'s passthrough reads them without an index entry.
    pub fn reference_notes(&mut self) -> Result<Vec<NoteMeta>, String> {
        self.ensure_walked()?;
        Ok(self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache")
            .reference
            .clone())
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
    ///
    /// `include_reference` adds the `Surface::Reference` lane (identity/,
    /// personality/, history/, MAP.md, inbox.md). It defaults to FALSE at the
    /// command boundary, so ⌘K, backlinks, and every other user caller keep
    /// exactly today's scope; only the AI host asks for the wider corpus
    /// (2026-08-01, docs/design/ai-visibility-matrix.md). Per-hit READABILITY is
    /// still decided by `read_for_ai` through the permission probe — this only
    /// decides what exists to rank.
    pub fn search(
        &mut self,
        query: &str,
        limit: usize,
        include_reference: bool,
    ) -> Result<Vec<SearchHit>, String> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        // Feed the secure-prose ledger and fill the walk cache BEFORE the index is
        // consulted — the ledger is walk-fed (audit 2026-08-01, GAP 2), and the
        // Tantivy path must never let that go cold. The walk is generation-gated,
        // so at a steady corpus this is a cache hit.
        self.ensure_walked()?;
        // Tantivy governs MEMBERSHIP (infix/tokenized/phrase/fuzzy), `search_match`
        // owns PRESENTATION (snippet, offsets, rank) — so the SearchHit wire
        // contract and its TS twin are unchanged. The index membership is a
        // SUPERSET of the old substring lane for any query with alphanumeric
        // tokens (infix ⊇ prefix ⊇ exact; verifier 2026-08-01). A query with NO
        // such token (punctuation only) has no index term to match but the old
        // `find_ci` could still match it literally, so it goes straight to the
        // substring lane — keeping "never fewer results than substring" true for
        // EVERY query. If the index is absent or errors, the substring scan is the
        // guaranteed-correct floor (docs/design/tantivy-search.md).
        let indexable = query.chars().any(char::is_alphanumeric);
        if indexable && self.search_index.is_some() {
            if let Ok(hits) = self.search_indexed(query, limit, include_reference) {
                return Ok(hits);
            }
        }
        self.search_substring(query, limit, include_reference)
    }

    /// The Tantivy lane: sync the index to the current walk (only when the corpus
    /// generation moved — riding the same suppress-marked watcher every other
    /// cache does), query it for candidate ids, then re-derive each hit's
    /// snippet/offsets/rank with `search_match` so the wire is byte-for-byte the
    /// substring lane's for any query that IS a substring, and a sensible rank-1
    /// fallback for a purely tokenized/fuzzy hit.
    fn search_indexed(
        &mut self,
        query: &str,
        limit: usize,
        include_reference: bool,
    ) -> Result<Vec<SearchHit>, String> {
        let mut idx = self.search_index.take().ok_or("no search index")?;
        let generation = self.suppress.generation();
        let outcome = (|| {
            if idx.synced_generation() != Some(generation) {
                let docs = self.collect_index_docs();
                idx.sync(generation, &docs)?;
            }
            // over-fetch so post-filtering (Trash, chats, reference, and the AI
            // per-hit gate upstream) still fills the requested page
            let over = limit.saturating_mul(5).clamp(limit.max(1), 500);
            idx.query(query, over)
        })();
        // ALWAYS restore the index, success or failure, before propagating.
        self.search_index = Some(idx);
        let ids = outcome?;
        Ok(self.hits_from_ids(query, &ids, limit, include_reference))
    }

    /// The searchable set, projected for indexing from the walk cache: kind Note,
    /// never Trash, never a Memex root's chats/ — identical scope to the substring
    /// lane, plus the Reference lane (gated at query time by `include_reference`).
    fn collect_index_docs(&self) -> Vec<crate::search_index::IndexDoc> {
        let cache = self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache");
        let layout = self.layout;
        let mut docs = Vec::new();
        for meta in cache.list.notes.iter().chain(cache.reference.iter()) {
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || (layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let Some(text) = cache.texts.get(&meta.id) else {
                continue;
            };
            let meta_text = if meta.aliases.is_empty() {
                text.metadata.clone()
            } else {
                format!("{}\n{}", text.metadata, meta.aliases.join("\n"))
            };
            docs.push(crate::search_index::IndexDoc {
                id: meta.id.clone(),
                title: meta.title.clone(),
                body: text.body.clone(),
                meta: meta_text,
                secure: text.secure,
            });
        }
        docs
    }

    /// Turn ranked candidate ids into `SearchHit`s. Applies the SAME scope
    /// predicates as the substring lane (reusing the same functions, so the two
    /// cannot drift) and gates the Reference lane on `include_reference`.
    fn hits_from_ids(
        &self,
        query: &str,
        ids: &[String],
        limit: usize,
        include_reference: bool,
    ) -> Vec<SearchHit> {
        let cache = self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache");
        let layout = self.layout;
        let mut lut: HashMap<&str, (&NoteMeta, bool)> = HashMap::new();
        for m in cache.list.notes.iter() {
            lut.insert(m.id.as_str(), (m, false));
        }
        for m in cache.reference.iter() {
            lut.entry(m.id.as_str()).or_insert((m, true));
        }
        let mut hits: Vec<SearchHit> = Vec::new();
        for id in ids {
            let Some(&(meta, is_ref)) = lut.get(id.as_str()) else {
                continue;
            };
            if is_ref && !include_reference {
                continue;
            }
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || (layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let text = cache.texts.get(id);
            let m = text
                .and_then(|t| {
                    search_match(query, &meta.title, &t.body, &meta.snippet)
                        .or_else(|| search_match(query, &meta.title, &t.metadata, &meta.snippet))
                })
                .or_else(|| {
                    search_match(query, &meta.title, &meta.aliases.join("\n"), &meta.snippet)
                })
                .unwrap_or_else(|| SearchMatch {
                    // a purely tokenized/fuzzy hit — nothing contiguous to frame.
                    // Rank it a body hit with a leading snippet and no highlight
                    // span, so it renders honestly and sorts after exact hits.
                    rank: crate::search_match::RANK_FUZZY,
                    snippet: leading_snippet(
                        text.map(|t| t.body.as_str())
                            .unwrap_or(meta.snippet.as_str()),
                    ),
                    match_start: 0,
                    match_len: 0,
                    spans: Vec::new(),
                });
            hits.push(SearchHit {
                id: meta.id.clone(),
                title: meta.title.clone(),
                folder_id: meta.folder_id.clone(),
                kind: meta.kind,
                rank: m.rank,
                snippet: m.snippet,
                match_start: m.match_start,
                match_len: m.match_len,
                spans: m.spans,
                updated_at: meta.updated_at,
            });
        }
        sort_hits(&mut hits);
        hits.truncate(limit);
        hits
    }

    /// The substring scan — the pre-Tantivy behavior, kept verbatim as the
    /// guaranteed-correct fallback for a read-only store or an index error.
    fn search_substring(
        &mut self,
        query: &str,
        limit: usize,
        include_reference: bool,
    ) -> Result<Vec<SearchHit>, String> {
        let mut hits: Vec<SearchHit> = Vec::new();
        // the cached walk already parsed every note (audit 2026-07-30, #5:
        // search was a DOUBLE full read — list() then re-read+parse per body)
        self.ensure_walked()?;
        let layout = self.layout;
        let cache = self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache");
        let reference: &[NoteMeta] = if include_reference {
            &cache.reference
        } else {
            &[]
        };
        for meta in cache.list.notes.iter().chain(reference) {
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || (layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let Some(text) = cache.texts.get(&meta.id) else {
                continue;
            };
            if let Some(m) = search_match(query, &meta.title, &text.body, &meta.snippet)
                .or_else(|| search_match(query, &meta.title, &text.metadata, &meta.snippet))
                .or_else(|| {
                    search_match(query, &meta.title, &meta.aliases.join("\n"), &meta.snippet)
                })
            {
                hits.push(SearchHit {
                    id: meta.id.clone(),
                    title: meta.title.clone(),
                    folder_id: meta.folder_id.clone(),
                    kind: meta.kind,
                    rank: m.rank,
                    snippet: m.snippet,
                    match_start: m.match_start,
                    match_len: m.match_len,
                    spans: m.spans,
                    updated_at: meta.updated_at,
                });
            }
        }
        sort_hits(&mut hits);
        hits.truncate(limit);
        Ok(hits)
    }

    /// The Tasks projection (decision 2026-07-25): every open checkbox
    /// (`- [ ]` / `* [ ]` / `1. [ ]`) across ordinary Markdown notes, in
    /// corpus list order. Derived per call —
    /// Markdown stays the only truth. Trash/Archive/chats/boards excluded;
    /// fenced code skipped; secure and locked notes INCLUDED (this is the
    /// user's own local screen, and the surface is not agent-exposed).
    pub(crate) fn tasks(&mut self) -> Result<Vec<TaskItem>, String> {
        // rides the same cached walk as list()/search() — no second read pass
        self.ensure_walked()?;
        let layout = self.layout;
        let cache = self
            .list_cache
            .as_ref()
            .expect("ensure_walked fills the cache");
        let mut out = Vec::new();
        for meta in &cache.list.notes {
            if meta.kind != NoteKind::Note
                || is_trash_folder(&meta.folder_id)
                || is_archive_folder(&meta.folder_id)
                || (layout == Layout::Memex && is_chats_folder(&meta.folder_id))
            {
                continue;
            }
            let Some(text) = cache.texts.get(&meta.id) else {
                continue;
            };
            let lines: Vec<&str> = text.body.lines().collect();
            let mut fenced = false;
            for (line, raw_line) in lines.iter().enumerate() {
                let trimmed = raw_line.trim_start();
                if trimmed.starts_with("```") {
                    fenced = !fenced;
                    continue;
                }
                if fenced {
                    continue;
                }
                if open_task_text(trimmed).is_some() {
                    let text = joined_task_text(&lines, line).expect("checkbox matched above");
                    out.push(TaskItem {
                        note_id: meta.id.clone(),
                        note_title: meta.title.clone(),
                        line,
                        text,
                    });
                }
            }
        }
        Ok(out)
    }

    /// Check ONE open task off (`[ ]` or `[/]` → `[x]`) — a real user edit through the
    /// ordinary note write path (updated bump, rename aliases, gitignore-follow
    /// all ride along). Re-validates the exact line first: a note edited since
    /// the list was built refuses instead of flipping the wrong line. `line`
    /// indexes the EDITOR BODY's lines — the same domain `tasks()` reports.
    pub(crate) fn toggle_task(
        &mut self,
        id_or_rel: &str,
        line: usize,
        expect: &str,
    ) -> Result<(), String> {
        self.mutation_allowed()?;
        let rel = self.resolve_note_rel(id_or_rel)?;
        let text = fs::read_to_string(self.abs(&rel)).map_err(|e| e.to_string())?;
        let (fm, raw) = parse_document(&text);
        let body = match &fm {
            Some(_) => editor_body(raw),
            None => raw,
        };
        let stale =
            || "This task changed since the list was made — it refreshes on its own.".to_string();
        let lines: Vec<&str> = body.lines().collect();
        let Some(current) = lines.get(line) else {
            return Err(stale());
        };
        // validate against the JOINED text — the same shape tasks() reported
        if joined_task_text(&lines, line).as_deref() != Some(expect) {
            return Err(stale());
        }
        let mut new_lines: Vec<String> = lines.iter().map(|s| (*s).to_string()).collect();
        new_lines[line] = check_off(current).ok_or_else(stale)?;
        let mut new_body = new_lines.join("\n");
        if body.ends_with('\n') {
            new_body.push('\n');
        }
        // write() resolves through the ID index — hand it the note's stable id
        // (the frontmatter ULID when it has one; the rel doubles as the id for
        // a frontmatter-less legacy file).
        let wire_id = fm
            .as_ref()
            .and_then(|f| f.id.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| rel.clone());
        self.write(&wire_id, &new_body).map(|_| ())
    }

    /// Resolve an id through the index; on a miss (stale index, external
    /// move), rebuild from a scan once and retry.
    fn path_of(&mut self, id: &str) -> Result<String, String> {
        if let Some(rel) = self.index.get(id) {
            if self.guard_rel(rel).is_ok_and(|path| path.is_file()) {
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
        if validate_rel(id_or_rel).is_ok()
            && self.guard_rel(id_or_rel).is_ok_and(|path| path.is_file())
        {
            return Ok(id_or_rel.to_string());
        }
        self.path_of(id_or_rel)
    }

    /// The reverse bridge for OPEN lanes: rel → canonical WIRE id. The
    /// Librarian journal stores path-addressed rows (an `_index.md` carries no
    /// frontmatter ULID — organizer.rs writes `note_ulid: None`), but tabs and
    /// title lookups key on wire ids: a `.md` note's ULID, a board/file's rel.
    /// Accepts either shape so "Open the note" can name any journal row.
    pub fn wire_id_of(&mut self, id_or_rel: &str) -> Result<String, String> {
        let rel = self.resolve_note_rel(id_or_rel)?;
        if !rel.ends_with(".md") {
            return Ok(rel); // boards/files already travel as their rel
        }
        if let Some((id, _)) = self.index.iter().find(|(_, r)| **r == rel) {
            return Ok(id.clone());
        }
        // not indexed yet (fresh walk state): one list() rebuilds, then retry
        self.list()?;
        self.index
            .iter()
            .find(|(_, r)| **r == rel)
            .map(|(id, _)| id.clone())
            .ok_or_else(|| format!("note not found: {id_or_rel}"))
    }

    pub fn read(&mut self, id: &str) -> Result<NoteDoc, String> {
        let rel = self.path_of(id)?;
        let abs = self.guard_rel(&rel)?;
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
            origin: if is_hidden_root(&disk_folder) {
                fm.origin.clone()
            } else {
                None
            },
            folder_id: folder,
            disk_folder_id: disk_folder,
            body: body.to_string(),
            revision: crate::fsutil::revision(text.as_bytes()),
            created_at: fm
                .created
                .as_deref()
                .and_then(stamp_to_ms)
                .unwrap_or(file_created),
            updated_at: fm
                .updated
                .as_deref()
                .and_then(stamp_to_ms)
                .unwrap_or(file_updated),
            pinned: fm.pinned.unwrap_or(false),
        })
    }

    /// Atomic save. Mints/keeps the four facts (foreign keys ride along
    /// untouched), bumps `updated`, and renames the file — through the index —
    /// when the title moved. `pinned` is preserved from disk (like origin) —
    /// pin toggles have their own path (`set_pinned`), so a body save can
    /// never reassert a stale pin (the old read-modify-write race).
    pub fn write(&mut self, id: &str, body: &str) -> Result<NoteMeta, String> {
        let rel = self.path_of(id)?;
        self.writable(&rel)?;
        self.write_resolved(id, body, rel)
    }

    /// Human/interactive whole-body save with optimistic concurrency. The
    /// comparison happens inside the store's mutation critical section, after
    /// path routing and immediately before the write path re-reads metadata.
    /// A Rotli-owned
    /// location/frontmatter update changes the complete-file revision while
    /// preserving editor prose. In that one case the local body edit can be
    /// applied safely because `write_resolved` re-reads and preserves the
    /// latest frontmatter under this same file lock. A changed disk body still
    /// receives the ordinary revision conflict.
    pub fn write_if_revision_with_body_base(
        &mut self,
        id: &str,
        body: &str,
        expected_revision: &str,
        expected_body: Option<&str>,
    ) -> Result<CorpusWriteResult, String> {
        let rel = self.path_of(id)?;
        self.writable(&rel)?;
        let abs = self.guard_rel(&rel)?;
        crate::fsutil::with_file_lock(&abs, || {
            let current = fs::read(&abs).map_err(|e| format!("read {rel}: {e}"))?;
            if crate::fsutil::revision(&current) != expected_revision {
                let current_text = std::str::from_utf8(&current)
                    .map_err(|e| format!("read {rel} as UTF-8: {e}"))?;
                let (frontmatter, raw_body) = parse_document(current_text);
                let current_body = if frontmatter.is_some() {
                    editor_body(raw_body)
                } else {
                    raw_body
                };
                if expected_body != Some(current_body) {
                    crate::fsutil::compare_revision(expected_revision, &current)?;
                }
            }
            let meta = self.write_resolved(id, body, rel.clone())?;
            let landed_rel = self.path_of(id)?;
            let landed = fs::read(self.guard_rel(&landed_rel)?)
                .map_err(|e| format!("read saved note {landed_rel}: {e}"))?;
            Ok(CorpusWriteResult {
                meta,
                revision: crate::fsutil::revision(&landed),
            })
        })
    }

    fn write_resolved(&mut self, id: &str, body: &str, rel: String) -> Result<NoteMeta, String> {
        let abs = self.abs(&rel);

        // an unreadable existing file must abort the save — regenerating
        // frontmatter from "empty" would drop secure/locked/tags/created
        let existing = read_existing_text(&abs)?;
        let (old_fm, old_raw) = parse_document(&existing);
        let (file_created, _) = file_stamps(&abs);
        let old_body = if old_fm.is_some() {
            editor_body(old_raw)
        } else {
            old_raw
        };
        let old_title = title_of(old_body);
        let mut old_fm = old_fm.unwrap_or_default();
        let title = title_of(body);
        if old_title != title || filename_stem(&rel) != slugify(&old_title) {
            preserve_rename_aliases(&mut old_fm, &rel, &old_title, &title, id)?;
        }
        let created = old_fm
            .created
            .clone()
            .filter(|s| stamp_to_ms(s).is_some())
            .unwrap_or_else(|| ms_to_stamp(file_created));
        // a memex note stays date-shaped (v3.5: updated: YYYY-MM-DD); local notes
        // keep rotli's RFC3339 stamp.
        let updated = if self.layout == Layout::Memex {
            today_stamp()
        } else {
            now_stamp()
        };

        let fm = Frontmatter {
            id: Some(id.to_string()),
            created: Some(created.clone()),
            updated: Some(updated.clone()),
            // an edit never changes pin state or WHERE a note belongs —
            // carry both through from disk.
            pinned: old_fm.pinned,
            origin: old_fm.origin,
            foreign: old_fm.foreign,
        };
        let text = compose_document(&fm, &format!("\n{body}"));

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
        // The welcome preset is the one sanctioned root note. Its Markdown is
        // fully editable, but its path stays stable so changing the H1 cannot
        // rename it into the otherwise hidden root-document namespace.
        let target_rel = if rel == crate::memex::WELCOME_PRESET_FILE || current_name == desired {
            rel.clone()
        } else {
            self.free_note_name(&disk_folder, &desired, Some(&rel))
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
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        // Rewrite in place first, then use the filesystem's rename operation.
        // The former copy-to-target + ignored remove_file failure could leave
        // two independent files with the same durable note id; a later index
        // rebuild could then select the stale duplicate nondeterministically.
        atomic_write(&abs, &text)?;
        if target_abs != abs {
            fs::rename(&abs, &target_abs)
                .map_err(|e| format!("rename {rel} to {target_rel}: {e}"))?;
            if is_secure {
                let _ = self.gitignore_remove(&rel);
            }
        }
        self.index.insert(id.to_string(), target_rel.clone());
        self.persist_index();

        Ok(NoteMeta {
            id: id.to_string(),
            title,
            snippet: snippet_of(body),
            body_empty: body.trim().is_empty(),
            aliases: note_aliases(&target_rel, &title_of(body), id, &fm),
            folder_id: folder,
            disk_folder_id: disk_folder.clone(),
            created_at: stamp_to_ms(&created).unwrap_or_else(now_ms),
            updated_at: stamp_to_ms(&updated).unwrap_or_else(now_ms),
            pinned: fm.pinned.unwrap_or(false),
            origin: if is_hidden_root(&disk_folder) {
                fm.origin
            } else {
                None
            },
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
        // resolve_note_rel, not path_of: a BOARD (and any surfaced file) travels
        // as its rel path and never enters the ULID index, so path_of refused it
        // outright — "note not found: storage/excalidraw/untitled-2.excalidraw"
        // for an item sitting right there in the tree. Trash IS a move, so that
        // one lookup broke board delete, archive, and move alike (the maintainer,
        // 2026-08-04: "I don't understand why I can't delete something that is
        // showing in my view").
        let rel = self.resolve_note_rel(id)?;
        let target_folder = lifecycle_disk_folder(self.layout, target_folder);
        // BOTH ends must be writable: the note's current file (a self/ note may
        // not leave) AND its destination folder (only chats/ accepts notes in a
        // memex). LegacyRotli waves both through.
        self.writable(&rel)?;
        self.writable(&target_folder)?;
        if !rel.ends_with(".md") {
            // Into a SINK, an opaque item keeps its original path underneath it
            // (`trash/storage/excalidraw/x`) — that breadcrumb IS how
            // `restore_file` finds its way home, since a board carries no
            // frontmatter `origin`. A move to a real folder just lands there.
            let dest = if is_hidden_root(&target_folder) {
                let origin_folder = folder_of(&rel);
                if origin_folder.is_empty() {
                    target_folder.clone()
                } else {
                    format!("{target_folder}/{origin_folder}")
                }
            } else {
                target_folder.clone()
            };
            let path = self.abs(&rel);
            return crate::fsutil::with_file_lock(&path, || self.relocate_opaque(&rel, &dest));
        }
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || self.relocate(id, &rel, &target_folder))
    }

    /// Move a NON-markdown item (a board, a surfaced file) between folders
    /// without touching its bytes, and hand back its fresh meta.
    ///
    /// `relocate` is the MARKDOWN machinery: it parses frontmatter, derives the
    /// title from the body, renames to a slug of that title, and composes a
    /// frontmatter block back into the file. Correct for a `.md` note; for a
    /// board's JSON it would retitle the file after the first line of the scene
    /// and write YAML into it — silent corruption. So the non-markdown lane
    /// moves the file and nothing else; a board's identity IS its path
    /// (`rename_board` has always worked this way).
    fn relocate_opaque(&mut self, rel: &str, target_folder: &str) -> Result<NoteMeta, String> {
        let abs = self.abs(rel);
        if !abs.is_file() {
            return Err(format!("not found: {rel}"));
        }
        let name = Path::new(rel)
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .ok_or_else(|| format!("file has no name: {rel}"))?;
        if !target_folder.is_empty() {
            validate_rel(target_folder)?;
            fs::create_dir_all(self.abs(target_folder))
                .map_err(|e| format!("create folder {target_folder}: {e}"))?;
        }
        let target_rel = self.free_name(target_folder, &name, None);
        let target_abs = self.abs(&target_rel);
        // both paths are OUR writes — neither should echo back as external
        self.suppress.mark(&abs);
        self.suppress.mark(&target_abs);
        if target_abs != abs {
            fs::rename(&abs, &target_abs).map_err(|e| format!("move {rel}: {e}"))?;
        }
        let (created_at, updated_at) = file_stamps(&target_abs);
        let is_board = target_rel.ends_with(".excalidraw");
        let folder = folder_of(&target_rel);
        Ok(NoteMeta {
            id: target_rel.clone(),
            title: if is_board {
                board_title(&target_rel)
            } else {
                name
            },
            snippet: String::new(),
            body_empty: false,
            aliases: Vec::new(),
            // boards/files carry no frontmatter, so the shelf projection has
            // nothing to read — the lifecycle/storage mapping is the whole answer
            folder_id: project_folder(self.layout, &folder, &Frontmatter::default()),
            disk_folder_id: folder,
            created_at,
            updated_at,
            pinned: false,
            origin: None,
            kind: if is_board {
                NoteKind::Board
            } else {
                NoteKind::File
            },
        })
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
        let mut old_fm = fm.unwrap_or_default();
        let current_folder = folder_of(rel);
        let title = title_of(&body);
        if filename_stem(rel) != slugify(&title) {
            preserve_rename_aliases(&mut old_fm, rel, &title, &title, id)?;
        }

        // The Secure notes destination is a secure-by-default filing action,
        // not merely a visual label. Moving a normal note into it adds the same
        // durable file policy as secure creation; moving it back out preserves
        // that policy until the user deliberately removes protection.
        if (target_folder == SECURE_NOTES_FOLDER
            || target_folder.starts_with(&format!("{SECURE_NOTES_FOLDER}/")))
            && !old_fm
                .foreign
                .iter()
                .any(|line| secure_field(line) == Some(true))
        {
            old_fm.foreign.push("secure: true".to_string());
        }

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
        let desired = filename_for(&title, id);
        let target_rel = self.free_note_name(target_folder, &desired, None);
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
        // Rewrite the single source inode first, then move it. Never implement
        // an identity-preserving move as copy + best-effort delete: a failed
        // delete creates duplicate durable ids and unstable reachability.
        atomic_write(&abs, &out)?;
        if target_abs != abs {
            fs::rename(&abs, &target_abs)
                .map_err(|e| format!("move {rel} to {target_rel}: {e}"))?;
            if is_secure {
                let _ = self.gitignore_remove(rel);
            }
        }
        self.index.insert(id.to_string(), target_rel.clone());
        self.persist_index();

        Ok(NoteMeta {
            id: id.to_string(),
            title,
            snippet: snippet_of(&body),
            body_empty: body.trim().is_empty(),
            aliases: note_aliases(&target_rel, &title_of(&body), id, &fm),
            folder_id: project_lifecycle_folder(self.layout, target_folder),
            disk_folder_id: target_folder.to_string(),
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
    /// USER's `writable()` is unchanged — two disjoint lanes (the maintainer, 2026-07-01).
    /// The vault's Brain master switch (vault-vs-brain, 2026-07-26). Read from
    /// the settings sidecar per call. A MISSING file/field means ON — existing
    /// vaults keep today's behavior (the frontend's debounced saver later
    /// writes the resolved value like every other setting). A REAL read error
    /// fails CLOSED (pressure-test 2026-07-26): an unreadable consent boundary
    /// must never silently re-enable the Brain on a raw vault.
    pub(crate) fn brain_enabled(&self) -> bool {
        let Ok(settings) = self.dot_read("settings") else {
            return false; // NotFound is Ok("{}") — this is a genuine IO fault
        };
        serde_json::from_str::<serde_json::Value>(&settings)
            .ok()
            .and_then(|v| v.get("brainEnabled").and_then(serde_json::Value::as_bool))
            .unwrap_or(true)
    }

    /// RAW vault (vault-vs-brain, 2026-07-26): no Brain ⇒ no ORGANIZING —
    /// the second, independent layer behind the organizer's own cycle gate.
    /// Deliberately NOT inside `filer_writable`: that gate also fronts agent
    /// edits and Breve's managed writes, which are vault features, not Brain
    /// features (pressure-test 2026-07-26 — the broad placement broke both).
    fn brain_gate(&self) -> Result<(), String> {
        if !self.brain_enabled() {
            return Err("This vault's Librarian is off — nothing files or enriches it.".into());
        }
        Ok(())
    }

    fn filer_writable(&self, rel: &str) -> Result<(), String> {
        self.guard_rel(rel)?;
        if self.layout != Layout::Memex {
            return Err("the Librarian only runs in a Rotli vault".into());
        }
        // #3 (audit 2026-07): the FILER lane honors the same read-only verdicts as
        // the user lane — an out-of-band contract or read-only perms close BOTH.
        if self.band_read_only {
            return Err(
                "this vault's format is outside the range rotli supports — the Librarian may not write it".into(),
            );
        }
        if self.perms_read_only {
            return Err(
                "this vault is connected read-only — the Librarian may not write it".into(),
            );
        }
        let rel = rel.trim_start_matches('/');
        if !(rel == "wiki" || rel.starts_with("wiki/")) {
            return Err(format!(
                "the Librarian may only write the vault's Library (refused: {rel})"
            ));
        }
        let abs = self.abs(rel);
        if abs.is_file() {
            let text = fs::read_to_string(&abs).map_err(|e| e.to_string())?;
            let fm = parse_document(&text).0.unwrap_or_default();
            let locked = fm.foreign.iter().any(|l| locked_field(l) == Some(true));
            if locked {
                return Err("note is locked — the filer must not touch it".into());
            }
            if fm.foreign.iter().any(|l| secure_field(l) == Some(true))
                || rel == "wiki/_secure"
                || rel.starts_with("wiki/_secure/")
            {
                return Err("note is secure — the organizer must not touch it".into());
            }
        }
        Ok(())
    }

    /// Set (empty value ⇒ remove) an AI-OWNED frontmatter field — the Filer's
    /// counterpart to `set_field`. Accepts ONLY `AI_KEYS`; refuses reserved and user
    /// keys, so the territories stay disjoint. Gated by `filer_writable`. Takes a
    /// wire id OR a rel path (resolve_note_rel). pub(crate): the organizer daemon
    /// writes through this same gate — no second write primitive.
    pub(crate) fn set_ai_field(
        &mut self,
        id_or_rel: &str,
        key: &str,
        value: &str,
    ) -> Result<(), String> {
        self.brain_gate()?;
        let key = key.trim();
        if !AI_KEYS.contains(&key) {
            return Err(format!("`{key}` is not a filer-writable field"));
        }
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.filer_writable(rel)?;
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
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
        })
    }

    /// Overwrite a per-area generated overview `wiki/<area>/_index.md` — the ONLY
    /// file the Filer writes wholesale (the reserved `_index.md` name can never
    /// clobber a user note). An EMPTY body removes the file instead: undoing the
    /// FIRST applied index rewrite (journal `before` == "" — no file existed)
    /// must restore "no file", not leave a 0-byte generated husk behind. Gated
    /// by `filer_writable`. pub(crate): the organizer daemon's RefreshIndex
    /// applies through this same gate — no second write lane.
    pub(crate) fn write_index(&self, area: &str, body: &str) -> Result<(), String> {
        self.brain_gate()?;
        if area.contains('/') || area.contains("..") || area.trim().is_empty() {
            return Err(format!("invalid area: {area}"));
        }
        let dir = self.abs(&format!("wiki/{area}"));
        let rel = format!("wiki/{area}/_index.md");
        let path = self.abs(&rel);
        crate::fsutil::with_file_lock(&path, || {
            // Re-check after acquiring the same lock used by every other Rotli
            // note writer. A user or another process may have locked/secured
            // the generated note while this operation was waiting.
            self.filer_writable(&rel)?;
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
        })
    }

    /// FILE a note (by wire id or rel path) into the brain per its `area` frontmatter
    /// — the Filer's move (`_inbox/…` or a wrong area → `wiki/<area>/<slug>.md`).
    /// Gated by `filer_writable` on BOTH ends; reuses `relocate` (fs-atomic,
    /// preserves id/created/foreign, does NOT bump `updated`). The ulid for the index
    /// comes from the note's own frontmatter.
    pub fn file_note(&mut self, id_or_rel: &str) -> Result<NoteMeta, String> {
        self.brain_gate()?;
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
        self.brain_gate()?;
        let rel = &self.resolve_note_rel(id_or_rel)?;
        self.filer_writable(rel)?;
        self.filer_writable(target_folder)?;
        if folder_of(rel) == target_folder {
            return Err(format!("already in {target_folder}"));
        }
        let path = self.abs(rel);
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).map_err(|e| format!("read {rel}: {e}"))?;
            let id = parse_document(&text)
                .0
                .unwrap_or_default()
                .id
                .ok_or("note has no id")?;
            self.relocate(&id, rel, target_folder)
        })
    }

    /// Append one line to the brain change JOURNAL (`.rotli/brain-journal.jsonl`) —
    /// the frontend-owned audit + undo log. The frontend composes the JSON; Rust just
    /// does the append (in the deletable sidecar, per-machine).
    pub fn journal_append(&self, line: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let dir = self.guard_rel(DOT_DIR)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = self.guard_rel(&format!("{DOT_DIR}/brain-journal.jsonl"))?;
        crate::fsutil::with_file_lock(&path, || {
            // a failed read must not silently REPLACE the whole journal with one line
            let mut out = read_existing_text(&path)?;
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(line.trim());
            out.push('\n');
            atomic_write(&path, &out)
        })
    }

    /// Read the whole brain journal (`""` when none yet).
    pub fn journal_read(&self) -> Result<String, String> {
        let path = self.guard_rel(&format!("{DOT_DIR}/brain-journal.jsonl"))?;
        Ok(fs::read_to_string(path).unwrap_or_default())
    }

    /// Prune resolved journal entries older than `keep_days` (0 = all of them).
    /// PENDING work is sacred: every line of an id whose LATEST status is
    /// "proposed" survives regardless of age — pruning must never eat an
    /// unanswered question. Resolved ids (applied/reverted/dismissed) keep all
    /// their lines while the latest is younger than the cutoff, else drop them
    /// all. The journal is the deletable per-machine sidecar, so this is pure
    /// hygiene — and a real perf fix, since every append rewrites the file.
    /// Returns the number of lines removed.
    pub fn journal_prune(&self, keep_days: u32) -> Result<usize, String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(&format!("{DOT_DIR}/brain-journal.jsonl"))?;
        crate::fsutil::with_file_lock(&path, || {
            let text = fs::read_to_string(&path).unwrap_or_default();
            if text.is_empty() {
                return Ok(0);
            }
            let cutoff_ms = OffsetDateTime::now_utc().unix_timestamp() * 1000
                - i64::from(keep_days) * 86_400_000;
            // fold: latest status + ts per id (last line wins, same as the frontend)
            let mut latest: HashMap<String, (String, i64)> = HashMap::new();
            for line in text.lines() {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                    continue;
                };
                let Some(id) = v.get("id").and_then(|x| x.as_str()) else {
                    continue;
                };
                let status = v
                    .get("status")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let ts = v.get("ts").and_then(serde_json::Value::as_i64).unwrap_or(0);
                latest.insert(id.to_string(), (status, ts));
            }
            let keep = |line: &str| -> bool {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
                    return true; // never eat a line we can't read
                };
                let Some(id) = v.get("id").and_then(|x| x.as_str()) else {
                    return true;
                };
                match latest.get(id) {
                    Some((status, ts)) => status == "proposed" || *ts >= cutoff_ms,
                    None => true,
                }
            };
            let kept: Vec<&str> = text.lines().filter(|l| keep(l)).collect();
            let removed = text.lines().count() - kept.len();
            if removed == 0 {
                return Ok(0);
            }
            let mut out = kept.join("\n");
            if !out.is_empty() {
                out.push('\n');
            }
            atomic_write(&path, &out)?;
            Ok(removed)
        })
    }

    /// Shared Main-manifest seam for the GUI and headless workspace adapters.
    /// Main is durable user work, so every writer also preserves the `.gitignore`
    /// exception that keeps `.rotli/main.json` committable.
    pub(crate) fn main_read(&self) -> Result<String, String> {
        self.dot_read("main")
    }

    pub(crate) fn main_read_versioned(&self) -> Result<crate::fsutil::VersionedText, String> {
        Ok(crate::fsutil::versioned_text(self.main_read()?))
    }

    pub(crate) fn main_write(&self, contents: &str) -> Result<(), String> {
        let path = self.root.join(DOT_DIR).join("main.json");
        crate::fsutil::with_file_lock(&path, || self.main_write_unlocked(contents))
    }

    pub(crate) fn main_write_if_revision(
        &self,
        contents: &str,
        expected_revision: &str,
    ) -> Result<String, String> {
        let path = self.root.join(DOT_DIR).join("main.json");
        crate::fsutil::with_file_lock(&path, || {
            let current = self.main_read()?;
            crate::fsutil::compare_revision(expected_revision, current.as_bytes())?;
            self.main_write_unlocked(contents)?;
            Ok(crate::fsutil::revision(contents.as_bytes()))
        })
    }

    pub(crate) fn main_update<T>(
        &self,
        update: impl FnOnce(&str) -> Result<(String, T), String>,
    ) -> Result<T, String> {
        let path = self.root.join(DOT_DIR).join("main.json");
        crate::fsutil::with_file_lock(&path, || {
            let current = self.main_read()?;
            let (contents, result) = update(&current)?;
            self.main_write_unlocked(&contents)?;
            Ok(result)
        })
    }

    fn main_write_unlocked(&self, contents: &str) -> Result<(), String> {
        let manifest: ReferenceManifest = serde_json::from_str(contents)
            .map_err(|error| format!("invalid Main manifest: {error}"))?;
        if manifest.version != 1 {
            return Err(format!(
                "Main format v{} is not writable by this Rotli build",
                manifest.version
            ));
        }
        self.suppress
            .mark(&self.root.join(DOT_DIR).join("main.json"));
        self.dot_write("main", contents)?;
        self.ensure_main_committable()
    }

    pub(crate) fn views_read(&self) -> Result<String, String> {
        self.dot_read("views")
    }

    pub(crate) fn views_read_versioned(&self) -> Result<crate::fsutil::VersionedText, String> {
        Ok(crate::fsutil::versioned_text(self.views_read()?))
    }

    /// Validate and persist a named-view manifest while synchronizing singular
    /// Markdown membership into `view_tag`. The prepared writes are rolled back
    /// if any later write fails, so a CLI/UI operation cannot leave half-tagged
    /// notes. Boards and binary files are intentionally skipped.
    pub(crate) fn views_write_if_revision(
        &mut self,
        contents: &str,
        expected_revision: &str,
    ) -> Result<String, String> {
        let path = self.root.join(DOT_DIR).join("views.json");
        crate::fsutil::with_file_lock(&path, || {
            let current = self.views_read()?;
            crate::fsutil::compare_revision(expected_revision, current.as_bytes())?;
            self.views_write_unlocked(contents)?;
            Ok(crate::fsutil::revision(contents.as_bytes()))
        })
    }

    pub(crate) fn views_update<T>(
        &mut self,
        update: impl FnOnce(&str) -> Result<(String, T), String>,
    ) -> Result<T, String> {
        let path = self.root.join(DOT_DIR).join("views.json");
        crate::fsutil::with_file_lock(&path, || {
            let current = self.views_read()?;
            let (contents, result) = update(&current)?;
            self.views_write_unlocked(&contents)?;
            Ok(result)
        })
    }

    fn views_write_unlocked(&mut self, contents: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let next: ViewsManifest = serde_json::from_str(contents)
            .map_err(|error| format!("invalid views manifest: {error}"))?;
        let next_membership = validated_view_membership(&next)?;
        let current =
            serde_json::from_str::<ViewsManifest>(&self.views_read()?).unwrap_or_default();
        let current_membership = validated_view_membership(&current).unwrap_or_default();

        // Rust independently enforces the product law that named views are
        // subsets of global Main—even if a future presentation caller forgets.
        let main_raw = self.main_read()?;
        let mut main = if main_raw.trim().is_empty() || main_raw.trim() == "{}" {
            ReferenceManifest::default()
        } else {
            serde_json::from_str::<ReferenceManifest>(&main_raw)
                .map_err(|error| format!("invalid Main manifest: {error}"))?
        };
        if main.version != 1 {
            return Err(format!(
                "Main format v{} is not writable by this Rotli build",
                main.version
            ));
        }
        let mut main_changed = false;
        for item_id in next_membership.keys() {
            if !reference_contains(&main.tree, item_id) {
                main.tree.push(ReferenceNode::Note {
                    note: item_id.clone(),
                });
                main_changed = true;
            }
        }
        if main_changed {
            let raw =
                serde_json::to_string_pretty(&main).map_err(|error| error.to_string())? + "\n";
            self.main_write(&raw)?;
        }

        let changed_ids: HashSet<String> = current_membership
            .keys()
            .chain(next_membership.keys())
            .filter(|id| current_membership.get(*id) != next_membership.get(*id))
            .cloned()
            .collect();
        let mut prepared: Vec<(PathBuf, Option<String>)> = Vec::new();
        for id in changed_ids {
            let Ok(rel) = self.resolve_note_rel(&id) else {
                continue; // an orphan reference is retained until normal view GC
            };
            if Path::new(&rel).extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue; // boards and binaries never receive Markdown metadata
            }
            let path = self.abs(&rel);
            prepared.push((path, next_membership.get(&id).cloned()));
        }

        let manifest_path = self.root.join(DOT_DIR).join("views.json");
        let previous_manifest = fs::read_to_string(&manifest_path).ok();
        let mut written: Vec<(PathBuf, String, String)> = Vec::new();
        for (path, tag) in &prepared {
            let result = crate::fsutil::with_file_lock(path, || {
                // Read only after acquiring the note lock. Building `updated`
                // from an earlier snapshot could replace a user, CLI, MCP, or
                // Librarian edit that landed while the view transaction waited.
                let original = fs::read_to_string(path)
                    .map_err(|error| format!("read {}: {error}", path.display()))?;
                let updated = with_view_tag(&original, tag.as_deref());
                if updated == original {
                    return Ok(None);
                }
                self.suppress.mark(path);
                atomic_write(path, &updated)?;
                Ok(Some((original, updated)))
            });
            match result {
                Ok(Some((original, updated))) => {
                    written.push((path.clone(), original, updated));
                }
                Ok(None) => {}
                Err(error) => {
                    self.rollback_view_note_writes(&written);
                    return Err(error);
                }
            }
        }
        self.suppress.mark(&manifest_path);
        if let Err(error) = self.dot_write("views", contents) {
            self.rollback_view_note_writes(&written);
            return Err(error);
        }
        if let Err(error) = self.ensure_main_committable() {
            self.rollback_view_note_writes(&written);
            match previous_manifest {
                Some(raw) => {
                    self.suppress.mark(&manifest_path);
                    let _ = atomic_write(&manifest_path, &raw);
                }
                None => {
                    self.suppress.mark(&manifest_path);
                    let _ = fs::remove_file(&manifest_path);
                }
            }
            return Err(error);
        }
        Ok(())
    }

    /// Best-effort rollback for a failed multi-file view update. Never replace
    /// bytes written after this transaction: another writer's newer content is
    /// more important than restoring perfect projection consistency.
    fn rollback_view_note_writes(&self, written: &[(PathBuf, String, String)]) {
        for (path, prior, applied) in written.iter().rev() {
            let _ = crate::fsutil::with_file_lock(path, || {
                let current = fs::read_to_string(path).map_err(|error| error.to_string())?;
                if current == *applied {
                    self.suppress.mark(path);
                    atomic_write(path, prior)?;
                }
                Ok(())
            });
        }
    }

    pub fn create(&mut self, folder_id: &str, body: &str) -> Result<NoteMeta, String> {
        self.create_with_policy(folder_id, body, false)
    }

    pub fn create_with_policy(
        &mut self,
        folder_id: &str,
        body: &str,
        secure: bool,
    ) -> Result<NoteMeta, String> {
        let secure =
            secure || folder_id == "Secure notes" || folder_id.starts_with("Secure notes/");
        let disk_folder = if secure {
            match self.layout {
                Layout::Memex => "wiki/_secure",
                Layout::LegacyRotli
                    if folder_id != "Secure notes" && !folder_id.starts_with("Secure notes/") =>
                {
                    "Secure notes"
                }
                Layout::LegacyRotli => folder_id,
            }
        } else {
            folder_id
        };
        self.writable(disk_folder)?;
        if !disk_folder.is_empty() {
            validate_rel(disk_folder)?;
            fs::create_dir_all(self.abs(disk_folder))
                .map_err(|e| format!("create folder {disk_folder}: {e}"))?;
        }
        let id = Ulid::new().to_string();
        let now = now_stamp();
        let title = title_of(body);
        let rel = self.free_note_name(disk_folder, &filename_for(&title, &id), None);
        let mut foreign = vec!["aliases: []".to_string()];
        if self.layout == Layout::Memex {
            let shelf = if secure
                && (folder_id == "Secure notes" || folder_id.starts_with("Secure notes/"))
            {
                folder_id
            } else {
                "Inbox"
            };
            foreign.extend([
                "owner: rotli".to_string(),
                format!("shelf: [{shelf}]"),
                "reach: []".to_string(),
                "area:".to_string(),
                "summary:".to_string(),
                "tags: []".to_string(),
                "links: []".to_string(),
            ]);
        }
        if secure {
            foreign.push("secure: true".to_string());
        }
        let fm = Frontmatter {
            id: Some(id.clone()),
            created: Some(now.clone()),
            updated: Some(now.clone()),
            pinned: Some(false),
            origin: None,
            foreign,
        };
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        if secure {
            self.gitignore_add(&rel)?;
        }
        atomic_write(&abs, &compose_document(&fm, &format!("\n{body}")))?;
        self.index.insert(id.clone(), rel.clone());
        self.persist_index();
        let ms = stamp_to_ms(&now).unwrap_or_else(now_ms);
        let aliases = note_aliases(&rel, &title, &id, &fm);
        Ok(NoteMeta {
            id,
            title,
            snippet: snippet_of(body),
            body_empty: body.trim().is_empty(),
            aliases,
            folder_id: project_folder(self.layout, disk_folder, &fm),
            disk_folder_id: disk_folder.to_string(),
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
        // lives under a lane the Notes tree would never surface — this is the
        // only corpus read that could leak one. Reference lanes are text-only
        // for retrieval; a board there is not a browsable surface either.
        if !matches!(surfaced(self.layout, id), Surface::NoteRW | Surface::NoteRO) {
            return Err(format!("not available here: {id}"));
        }
        let abs = self.guard_rel(id)?;
        if !abs.is_file() {
            return Err(format!("board not found: {id}"));
        }
        let body = fs::read_to_string(&abs).map_err(|e| format!("read {id}: {e}"))?;
        let (created_at, updated_at) = file_stamps(&abs);
        Ok(CorpusBoardDoc {
            id: id.to_string(),
            folder_id: folder_of(id),
            revision: crate::fsutil::revision(body.as_bytes()),
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
        crate::board::validate_scene(body)?;
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
            body_empty: false,
            aliases: Vec::new(),
            folder_id: folder_of(id),
            disk_folder_id: folder_of(id),
            created_at,
            updated_at,
            pinned: false,
            origin: None,
            kind: NoteKind::Board,
        })
    }

    pub fn write_board_if_revision(
        &mut self,
        id: &str,
        body: &str,
        expected_revision: &str,
    ) -> Result<CorpusWriteResult, String> {
        validate_rel(id)?;
        if !id.ends_with(".excalidraw") {
            return Err(format!("not a board: {id}"));
        }
        self.writable(id)?;
        let abs = self.guard_rel(id)?;
        let current = fs::read(&abs).map_err(|e| format!("read {id}: {e}"))?;
        crate::fsutil::compare_revision(expected_revision, &current)?;
        let meta = self.write_board(id, body)?;
        Ok(CorpusWriteResult {
            meta,
            revision: crate::fsutil::revision(body.as_bytes()),
        })
    }

    /// Create a board at its final, user-supplied name in one atomic write.
    pub fn create_named_board(
        &mut self,
        folder_id: &str,
        name: &str,
        body: Option<&str>,
    ) -> Result<NoteMeta, String> {
        let stem = board_name_stem(name)?;
        self.create_board_with_stem(folder_id, &stem, body)
    }

    fn create_board_with_stem(
        &mut self,
        folder_id: &str,
        stem: &str,
        body: Option<&str>,
    ) -> Result<NoteMeta, String> {
        // In a memex, boards live in the storage/excalidraw board lane (writable —
        // see surfaced()). If the caller's folder isn't itself a writable surface,
        // land the board there so ⌘⇧N always saves and every board shares one home
        // (the maintainer, 2026-07-07).
        let body = body.unwrap_or(EMPTY_EXCALIDRAW);
        crate::board::validate_scene(body)?;
        let folder_id = if self.layout == Layout::Memex
            && !matches!(surfaced(self.layout, folder_id), Surface::NoteRW)
        {
            BOARD_LANE
        } else {
            folder_id
        };
        self.writable(folder_id)?;
        if !folder_id.is_empty() {
            validate_rel(folder_id)?;
            fs::create_dir_all(self.abs(folder_id))
                .map_err(|e| format!("create folder {folder_id}: {e}"))?;
        }
        let rel = self.free_name(folder_id, &format!("{stem}.excalidraw"), None);
        let abs = self.abs(&rel);
        self.suppress.mark(&abs);
        atomic_write(&abs, body)?;
        let (created_at, updated_at) = file_stamps(&abs);
        Ok(NoteMeta {
            id: rel.clone(),
            title: board_title(&rel),
            snippet: String::new(),
            body_empty: false,
            aliases: Vec::new(),
            folder_id: folder_id.to_string(),
            disk_folder_id: folder_id.to_string(),
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
    /// move + a fresh meta — no id remap to chase elsewhere (the maintainer, 2026-06-26).
    pub fn rename_board(&mut self, id: &str, new_name: &str) -> Result<NoteMeta, String> {
        if !id.ends_with(".excalidraw") {
            return Err(format!("not a board: {id}"));
        }
        self.writable(id)?;
        let old_abs = self.abs(id);
        if !old_abs.exists() {
            return Err(format!("board not found: {id}"));
        }
        let folder = id
            .rsplit_once('/')
            .map(|(f, _)| f.to_string())
            .unwrap_or_default();
        let stem = board_name_stem(new_name)?;
        let new_rel = self.free_name(&folder, &format!("{stem}.excalidraw"), None);
        if new_rel == id {
            // same name — nothing to do, return current meta
            let (created_at, updated_at) = file_stamps(&old_abs);
            return Ok(NoteMeta {
                id: id.to_string(),
                title: board_title(id),
                snippet: String::new(),
                body_empty: false,
                aliases: Vec::new(),
                folder_id: folder.clone(),
                disk_folder_id: folder,
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
            body_empty: false,
            aliases: Vec::new(),
            folder_id: folder.clone(),
            disk_folder_id: folder,
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
    /// (the maintainer, 2026-06-13)
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        // Soft-delete slides the note into the reserved `Trash` folder. In a
        // memex there is no writable `Trash`, so move_note's target gate refuses
        // it — gate here too so the error is explicit (chats aren't deleted into
        // the brain's sinks this increment).
        // resolve_note_rel, not path_of — boards/files travel as rel paths and
        // never enter the ULID index (2026-08-04). move_note re-gates both ends
        // and routes non-markdown through the opaque lane.
        let rel = self.resolve_note_rel(id)?;
        self.writable(&rel)?;
        // hand move_note the CALLER's id, never the resolved rel: for a `.md`
        // note the id is its ULID and `relocate` stamps it back into the
        // frontmatter + the index — passing a rel here would rewrite the note's
        // identity to its path (caught by create_read_write_delete_cycle).
        self.move_note(id, "Trash").map(|_| ())
    }

    /// The ONLY hard delete — Empty Trash (shipped 2026-07-31; audit #68 kept
    /// it unregistered while it had no caller). The note actually leaves the
    /// corpus: OS trash first, `.rotli/trash/` as the fallback (and as the
    /// test path — tests must not touch the user's real Trash). The command
    /// wrapper additionally requires the note to already live under Trash/.
    pub fn purge(&mut self, id: &str) -> Result<(), String> {
        // resolve_note_rel, not path_of: Trash holds path-id'd boards/files
        // (kind != note never enters the ULID index), and Empty Trash must
        // delete those too (2026-07-31 — "Emptied 0 of 35").
        let rel = self.resolve_note_rel(id)?;
        let stale_ulid = self
            .index
            .iter()
            .find(|(_, r)| **r == rel)
            .map(|(k, _)| k.clone());
        self.writable(&rel)?;
        let abs = self.abs(&rel);
        let name = Path::new(&rel)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("{id}.md"));
        self.trash_existing_path(&abs, &name, &rel)?;
        // drop the index entry whichever shape the caller held — a purge-by-rel
        // would otherwise leave a stale ULID→rel entry until the next list()
        self.index.remove(id);
        if let Some(ulid) = stale_ulid {
            self.index.remove(&ulid);
        }
        self.persist_index();
        Ok(())
    }

    /// Hard-remove a BLANK note — the ephemeral-note lifecycle ("a new note is
    /// just a view until you write into it", the maintainer 2026-07-17). Never the in-app
    /// Trash folder (no clutter): straight to the OS trash / `.rotli/trash`
    /// fallback via the purge internals. Rust re-reads the file and REFUSES any
    /// non-blank body, so this exposed command cannot destroy content even if
    /// miscalled — the same rationale that keeps `corpus_purge` unregistered
    /// (audit #68). Refusal is the SAFE outcome, not an error state.
    pub fn discard_blank(&mut self, id: &str) -> Result<(), String> {
        let rel = self.path_of(id)?;
        self.writable(&rel)?;
        let abs = self.abs(&rel);
        // fail CLOSED: a note that can't be read (permissions, invalid UTF-8)
        // is not provably blank — refusing beats trashing real content
        let existing = read_existing_text(&abs)
            .map_err(|e| format!("the note couldn't be inspected — refusing to discard ({e})"))?;
        let (_fm, body) = parse_document(&existing);
        if !body.trim().is_empty() {
            return Err("the note isn't blank — refusing to discard".into());
        }
        let name = Path::new(&rel)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("{id}.md"));
        self.trash_existing_path(&abs, &name, &rel)?;
        self.index.remove(id);
        self.persist_index();
        Ok(())
    }

    /// Shared recoverable file removal for note purge and storage assets.
    fn trash_existing_path(
        &mut self,
        abs: &Path,
        fallback_name: &str,
        label: &str,
    ) -> Result<(), String> {
        self.suppress.mark(abs);
        if self.os_trash && trash::delete(abs).is_ok() {
            return Ok(());
        }
        let trash_dir = self.guard_rel(&format!("{DOT_DIR}/trash"))?;
        fs::create_dir_all(&trash_dir).map_err(|e| format!("create trash: {e}"))?;
        let mut dest = trash_dir.join(fallback_name);
        let mut n = 2;
        while fs::symlink_metadata(&dest).is_ok() {
            dest = trash_dir.join(format!("{n}-{fallback_name}"));
            n += 1;
        }
        let relative_dest = dest
            .strip_prefix(&self.root)
            .map_err(|_| "trash destination escaped the corpus".to_string())?;
        crate::containment::resolve_beneath(&self.root, relative_dest)?;
        fs::rename(abs, &dest).map_err(|e| format!("trash {label}: {e}"))
    }

    pub fn create_folder(
        &mut self,
        name: &str,
        parent_id: Option<&str>,
    ) -> Result<FolderMeta, String> {
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
        Ok(CorpusOverview {
            root,
            folders,
            files,
        })
    }

    /// Opaque JSON dot-files. `background.json` remains a readable legacy slot
    /// so removing the shelved Glass feature never deletes user data.
    pub fn dot_read(&self, which: &str) -> Result<String, String> {
        let path = self.guard_rel(&format!("{DOT_DIR}/{}", dot_file(which)?))?;
        match fs::read_to_string(&path) {
            Ok(s) => Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
            Err(e) => Err(format!("read {which}: {e}")),
        }
    }

    pub fn dot_write(&self, which: &str, contents: &str) -> Result<(), String> {
        self.mutation_allowed()?;
        let path = self.guard_rel(&format!("{DOT_DIR}/{}", dot_file(which)?))?;
        atomic_write(&path, contents)
    }

    /// First free relative path in `folder` for boards and imported binaries.
    /// These existing surfaces retain their `stem-2.ext` convention.
    fn free_name(&self, folder: &str, desired: &str, keep_rel: Option<&str>) -> String {
        self.free_name_with(folder, desired, keep_rel, |stem, ext, n| {
            format!("{stem}-{n}{ext}")
        })
    }

    /// Markdown note collisions use the familiar Finder-style suffix while
    /// stable identity remains in frontmatter.
    fn free_note_name(&self, folder: &str, desired: &str, keep_rel: Option<&str>) -> String {
        self.free_name_with(folder, desired, keep_rel, |stem, ext, n| {
            format!("{stem} ({n}){ext}")
        })
    }

    fn free_name_with(
        &self,
        folder: &str,
        desired: &str,
        keep_rel: Option<&str>,
        collision_name: impl Fn(&str, &str, usize) -> String,
    ) -> String {
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
        while fs::symlink_metadata(self.abs(&rel)).is_ok() && keep_rel != Some(rel.as_str()) {
            rel = join(&collision_name(stem, &ext, n));
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
        "views" => Ok("views.json"), // named reference views (committed + metadata-synchronized)
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
        "settings" | "viewstate" => Ok(()),
        "background" => Err("the legacy background slot is read-only".into()),
        "main" => Err("write .rotli/main.json through corpus_main_write".into()),
        "views" => Err("write .rotli/views.json through corpus_views_write".into()),
        "organizer" => {
            Err("`organizer` is the daemon's own state — not writable from the app".into())
        }
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
/// moving back OUT clears it. (the maintainer, 2026-06-13)
fn is_hidden_root(folder: &str) -> bool {
    folder == "Archive"
        || folder == "Trash"
        || folder == "archive"
        || folder == "trash"
        || folder.starts_with("Archive/")
        || folder.starts_with("Trash/")
        || folder.starts_with("archive/")
        || folder.starts_with("trash/")
}

/// Folder ids come from the frontend — keep them inside the corpus root.
pub(crate) fn validate_rel(rel: &str) -> Result<(), String> {
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
// The params ARE the recursion's accumulators — bundling them into a struct
// would rename, not reduce, the coupling.
#[allow(clippy::too_many_arguments)]
fn walk(
    layout: Layout,
    root: &Path,
    prefix: &str,
    reverse: &HashMap<String, String>,
    new_index: &mut HashMap<String, String>,
    folders: &mut Vec<FolderMeta>,
    notes: &mut Vec<NoteMeta>,
    reference: &mut Vec<NoteMeta>,
    texts: &mut HashMap<String, CachedNoteText>,
) -> Result<(), String> {
    let dir = if prefix.is_empty() {
        root.to_path_buf()
    } else {
        root.join(prefix)
    };
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
        let rel = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let kind = match entry.file_type() {
            Ok(k) => k,
            Err(_) => continue,
        };
        // The scope gate (Increment 3): in Memex layout only wiki/ + chats/ are
        // surfaced in the Notes tree; every control file is Hidden, so
        // memex-vault's root docs never appear as notes. A Hidden DIRECTORY is
        // not descended into. LegacyRotli surfaces all.
        let surface = surfaced(layout, &rel);
        if surface == Surface::Hidden {
            continue;
        }
        // The REFERENCE lane (2026-08-01): identity/ personality/ history/
        // MAP.md inbox.md are collected for the AI's retrieval tools only. They
        // never become folder rows or tree notes, they never enter the ULID
        // index (id IS the rel path, like a board), and no write lane accepts
        // them — `writable()` still refuses every non-NoteRW surface.
        if surface == Surface::Reference {
            if kind.is_dir() {
                walk(
                    layout, root, &rel, reverse, new_index, folders, notes, reference, texts,
                )?;
            } else if kind.is_file() && name.ends_with(".md") {
                let abs = entry.path();
                let Ok(text) = fs::read_to_string(&abs) else {
                    continue;
                };
                let (fm, raw) = parse_document(&text);
                let had_fm = fm.is_some();
                let body = match &fm {
                    Some(_) => editor_body(raw),
                    None => raw,
                };
                let fm = fm.unwrap_or_default();
                texts.insert(
                    rel.clone(),
                    CachedNoteText {
                        body: body.to_string(),
                        metadata: if had_fm {
                            searchable_metadata(&fm)
                        } else {
                            String::new()
                        },
                        secure: walked_secure(&fm, body),
                    },
                );
                let (file_created, file_updated) = file_stamps(&abs);
                reference.push(NoteMeta {
                    id: rel.clone(),
                    title: title_of(body),
                    snippet: snippet_of(body),
                    body_empty: body.trim().is_empty(),
                    aliases: Vec::new(),
                    folder_id: prefix.to_string(),
                    disk_folder_id: prefix.to_string(),
                    created_at: fm
                        .created
                        .as_deref()
                        .and_then(stamp_to_ms)
                        .unwrap_or(file_created),
                    updated_at: fm
                        .updated
                        .as_deref()
                        .and_then(stamp_to_ms)
                        .unwrap_or(file_updated),
                    pinned: false,
                    origin: None,
                    kind: NoteKind::Note,
                });
            }
            continue;
        }
        if kind.is_dir() {
            // Memex: the wiki/_inbox staging dir is plumbing, not a folder — its
            // notes are re-homed by their shelf (below), so don't surface it as a
            // browsable folder; still recurse to collect those notes.
            // wiki/_inbox staging + storage/ aren't browsable folder ROWS: their
            // files are re-homed (notes by shelf; storage binaries to Storage).
            let staging = layout == Layout::Memex && (rel == "wiki/_inbox" || rel == "storage");
            if !staging {
                let folder_id = project_lifecycle_folder(layout, &rel);
                let parent_id = if prefix.is_empty() {
                    None
                } else {
                    Some(project_lifecycle_folder(layout, prefix))
                };
                let display_name = Path::new(&folder_id)
                    .file_name()
                    .map(|value| value.to_string_lossy().into_owned())
                    .unwrap_or(name);
                folders.push(FolderMeta {
                    id: folder_id,
                    name: display_name,
                    parent_id,
                });
            }
            walk(
                layout, root, &rel, reverse, new_index, folders, notes, reference, texts,
            )?;
        } else if kind.is_file() && name.ends_with(".md") {
            let abs = entry.path();
            let Ok(text) = fs::read_to_string(&abs) else {
                continue;
            };
            let (fm, raw) = parse_document(&text);
            let body = match &fm {
                Some(_) => editor_body(raw),
                None => raw,
            };
            let had_fm = fm.is_some();
            let fm = fm.unwrap_or_default();
            // shelf-projection (v3.5): a wiki note appears under its shelf (the
            // user's folder), not its disk path. Computed BEFORE fm.id is moved.
            let folder_id = project_folder(layout, prefix, &fm);
            // identity: frontmatter id → previous index (path-stable for
            // frontmatter-less files) → fresh mint. Duplicate ids (a copied
            // file) never collapse two notes into one.
            let id = fm
                .id
                .as_ref()
                .filter(|id| !id.is_empty() && !new_index.contains_key(id.as_str()))
                .cloned()
                .or_else(|| {
                    reverse
                        .get(&rel)
                        .filter(|id| !new_index.contains_key(*id))
                        .cloned()
                })
                .unwrap_or_else(|| Ulid::new().to_string());
            new_index.insert(id.clone(), rel.clone());
            // cache the parsed text beside the meta — search()/tasks() read it
            // instead of a second full read+parse pass (audit 2026-07-30, #5)
            texts.insert(
                id.clone(),
                CachedNoteText {
                    body: body.to_string(),
                    metadata: if had_fm {
                        searchable_metadata(&fm)
                    } else {
                        String::new()
                    },
                    secure: walked_secure(&fm, body),
                },
            );
            let title = title_of(body);
            let aliases = note_aliases(&rel, &title, &id, &fm);
            let (file_created, file_updated) = file_stamps(&abs);
            // only notes physically under a hidden root (Archive/Trash) carry
            // an origin out to the wire; everything else is None.
            let origin = if is_hidden_root(prefix) {
                fm.origin.clone()
            } else {
                None
            };
            notes.push(NoteMeta {
                id,
                title,
                snippet: snippet_of(body),
                body_empty: body.trim().is_empty(),
                aliases,
                folder_id,
                disk_folder_id: prefix.to_string(),
                created_at: fm
                    .created
                    .as_deref()
                    .and_then(stamp_to_ms)
                    .unwrap_or(file_created),
                updated_at: fm
                    .updated
                    .as_deref()
                    .and_then(stamp_to_ms)
                    .unwrap_or(file_updated),
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
                body_empty: false,
                aliases: Vec::new(),
                folder_id: prefix.to_string(),
                disk_folder_id: prefix.to_string(),
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
                body_empty: false,
                aliases: Vec::new(),
                // a memex storage/ binary re-homes to the Storage destination; a
                // plain-corpus file stays in its own folder.
                folder_id: project_folder(layout, prefix, &Frontmatter::default()),
                disk_folder_id: prefix.to_string(),
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
fn board_name_stem(name: &str) -> Result<String, String> {
    let stem: String = name
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
    Ok(stem)
}

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
    let handler = move |res: notify::Result<notify::Event>| {
        let _ = tx.send(res);
    };
    // Sandboxed macOS test processes do not receive FSEvents reliably. The
    // polling backend exercises the same filter/debounce/suppression pipeline;
    // production keeps the native recommended watcher.
    #[cfg(test)]
    let mut watcher = notify::PollWatcher::new(
        handler,
        notify::Config::default().with_poll_interval(Duration::from_millis(100)),
    )?;
    #[cfg(not(test))]
    let mut watcher = notify::recommended_watcher(handler)?;
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
                        // stale-cache order: bump BEFORE the notify, so the
                        // frontend's refetch can never hit a pre-change cache
                        suppress.bump();
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
    // A file create/remove updates its parent directory's mtime. Polling and
    // some native backends emit that as a second event carrying only the
    // directory; treating it as content bypasses the exact-file suppress set
    // and makes every app-authored write echo as "external". Metadata-only
    // changes contain no note bytes and never require a corpus refresh.
    if matches!(
        event.kind,
        notify::EventKind::Modify(notify::event::ModifyKind::Metadata(_))
    ) {
        return Vec::new();
    }
    event
        .paths
        .iter()
        .filter(|p| path_relevant(root, suppress, p))
        .cloned()
        .collect()
}

/// The unit-testable core of the watcher's filter.
pub fn path_relevant(root: &Path, suppress: &SuppressSet, path: &Path) -> bool {
    if suppress.contains(path) {
        return false;
    }
    let normalized_root = normalized_watch_path(root);
    let normalized_path = normalized_watch_path(path);
    let Ok(rel) = normalized_path.strip_prefix(&normalized_root) else {
        return false;
    };
    // Main, named views, and chat folders are portable hand-arranged sidecars.
    // Another Rotli process may write them, so every resident window must
    // observe them; every other dot-file remains private runtime state.
    if rel == Path::new(".rotli/main.json")
        || rel == Path::new(".rotli/views.json")
        || rel == Path::new(".rotli/chat-folders.json")
    {
        return true;
    }
    for comp in rel.components() {
        if comp.as_os_str().to_string_lossy().starts_with('.') {
            return false; // .rotli/, .DS_Store, .rotli-write-* temp files
        }
    }
    // directories (a dropped folder), .md notes and .excalidraw boards matter;
    // foreign files don't
    match normalized_path.extension() {
        Some(ext) => ext == "md" || ext == "excalidraw" || normalized_path.is_dir(),
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
        Self {
            stores: HashMap::new(),
            default_id,
        }
    }

    pub fn insert(&mut self, id: String, store: CorpusStore) -> Result<(), String> {
        if id.is_empty() || id.contains(':') {
            return Err(format!("invalid corpus root id: {id:?}"));
        }
        if self.stores.contains_key(&id) {
            return Err(format!("duplicate corpus root id: {id}"));
        }
        self.stores.insert(id, store);
        Ok(())
    }
}

/// `CorpusState` wraps the registry. Built empty when the corpus failed to open
/// (disk error at startup) — commands then return a clean error instead of
/// panicking on missing state.
pub struct CorpusState(pub Mutex<CorpusRegistry>);

const IMPORT_AUTHORIZATION_TTL: Duration = Duration::from_secs(30);

/// Exact paths supplied by a native OS drop event. The webview is untrusted:
/// knowing an arbitrary absolute path is not authority to copy it into the
/// corpus and read it back. Each native grant is short-lived and single-use.
#[derive(Default)]
pub struct ImportAuthorizations(Mutex<HashMap<PathBuf, (Instant, usize)>>);

impl ImportAuthorizations {
    /// Grant one import for every file the OS actually delivered and return the
    /// canonical paths that are safe to hand to the webview. The caller emits
    /// this result only after the grants exist, so a fast frontend import can
    /// never race ahead of native authorization.
    pub(crate) fn authorize_native_drop(&self, paths: &[PathBuf]) -> Vec<String> {
        let Ok(mut grants) = self.0.lock() else {
            return Vec::new();
        };
        let now = Instant::now();
        grants.retain(|_, (issued, _)| now.duration_since(*issued) <= IMPORT_AUTHORIZATION_TTL);
        let mut authorized = Vec::with_capacity(paths.len());
        for path in paths {
            let Ok(canonical) = fs::canonicalize(path) else {
                continue;
            };
            if !canonical.is_file() {
                continue;
            }
            let Some(delivered) = canonical.to_str().map(str::to_owned) else {
                continue;
            };
            let entry = grants.entry(canonical).or_insert((now, 0));
            entry.0 = now;
            entry.1 = entry.1.saturating_add(1);
            authorized.push(delivered);
        }
        authorized
    }

    fn consume(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical =
            fs::canonicalize(path).map_err(|e| format!("the dropped file is unavailable: {e}"))?;
        let mut grants = self
            .0
            .lock()
            .map_err(|_| "import authorization lock poisoned".to_string())?;
        let now = Instant::now();
        grants.retain(|_, (issued, _)| now.duration_since(*issued) <= IMPORT_AUTHORIZATION_TTL);
        let Some((_issued, remaining)) = grants.get_mut(&canonical) else {
            return Err("file import requires a fresh native drag-and-drop authorization".into());
        };
        *remaining = remaining.saturating_sub(1);
        if *remaining == 0 {
            grants.remove(&canonical);
        }
        Ok(canonical)
    }
}

impl CorpusState {
    pub(crate) fn contains_root(&self, root_id: &str) -> Result<bool, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?
            .stores
            .contains_key(root_id))
    }

    pub(crate) fn insert_root(&self, root_id: String, store: CorpusStore) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?
            .insert(root_id, store)
    }

    /// Replace one store with a clean reopen of the same folder. Keep the
    /// shared suppression/generation handle so its existing filesystem watcher
    /// continues to invalidate the replacement store.
    pub(crate) fn refresh_root(
        &self,
        root_id: &str,
        mut incoming: CorpusStore,
    ) -> Result<(), String> {
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let current = reg
            .stores
            .get(root_id)
            .ok_or_else(|| "the selected vault is unavailable".to_string())?;
        if canon(current.root()) != canon(incoming.root()) {
            return Err("the refreshed vault does not match the selected vault".into());
        }
        incoming.suppress = current.suppress_set();
        incoming.perms_read_only = current.perms_read_only;
        reg.stores.insert(root_id.to_string(), incoming);
        Ok(())
    }

    /// Disconnect one non-active route after its durable binding has been
    /// removed. Persistence runs first, so a failed config write leaves the
    /// live registry and its access boundary untouched.
    pub(crate) fn remove_registered_root(
        &self,
        root_id: &str,
        persist: impl FnOnce() -> Result<(), String>,
    ) -> Result<PathBuf, String> {
        if root_id == DEFAULT_ROOT_ID {
            return Err("Switch to another vault before removing the current vault.".into());
        }
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let root = reg
            .stores
            .get(root_id)
            .map(|store| store.root().to_path_buf())
            .ok_or_else(|| "no such connected vault".to_string())?;
        persist()?;
        reg.stores.remove(root_id);
        Ok(root)
    }

    /// Resolve an already-open route by its filesystem identity. Native picker
    /// paths can point at a connected vault; reusing that store avoids opening
    /// the same folder twice or attaching a duplicate watcher.
    pub(crate) fn root_id_for_path(&self, root: &Path) -> Result<Option<String>, String> {
        let target = canon(root);
        let reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        Ok(reg
            .stores
            .iter()
            .find_map(|(id, store)| (canon(store.root()) == target).then(|| id.clone())))
    }

    /// Promote one already-open connected vault to the default route without
    /// rebuilding the process. The persistence callback runs after every live
    /// precondition passes but before store keys move, so a failed config write
    /// leaves the in-memory registry untouched. It returns the optional route
    /// assigned to the outgoing vault: compatible Rotli vaults preserve the
    /// way back, while an unconfigured or plain outgoing folder is detached.
    pub(crate) fn activate_registered_root(
        &self,
        incoming_id: &str,
        persist: impl FnOnce() -> Result<Option<String>, String>,
    ) -> Result<(), String> {
        if incoming_id == DEFAULT_ROOT_ID {
            return Ok(());
        }
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        if !reg.stores.contains_key(incoming_id) {
            return Err(format!("corpus root unavailable: {incoming_id}"));
        }
        if !reg.stores.contains_key(DEFAULT_ROOT_ID) {
            return Err("the active vault is unavailable".into());
        }
        let outgoing_id = persist()?;
        if outgoing_id.as_ref().is_some_and(|id| {
            id.is_empty()
                || id == DEFAULT_ROOT_ID
                || id == incoming_id
                || id.contains(':')
                || reg.stores.contains_key(id)
        }) {
            return Err("the outgoing vault could not be assigned a safe route".into());
        }
        let outgoing = reg
            .stores
            .remove(DEFAULT_ROOT_ID)
            .ok_or("the active vault is unavailable")?;
        let mut incoming = reg
            .stores
            .remove(incoming_id)
            .ok_or_else(|| format!("corpus root unavailable: {incoming_id}"))?;
        incoming.set_perms_read_only(false);
        if let Some(outgoing_id) = outgoing_id {
            reg.stores.insert(outgoing_id, outgoing);
        }
        reg.stores.insert(DEFAULT_ROOT_ID.to_string(), incoming);
        reg.default_id = DEFAULT_ROOT_ID.to_string();
        Ok(())
    }

    /// Install a newly opened folder as the live default route. This is the
    /// creation/import counterpart to `activate_registered_root`: persistence
    /// happens before the registry changes, and a first-run registry with no
    /// default store is valid. The caller owns watcher installation after this
    /// atomic swap succeeds.
    pub(crate) fn activate_new_root(
        &self,
        mut incoming: CorpusStore,
        persist: impl FnOnce() -> Result<Option<String>, String>,
    ) -> Result<(), String> {
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let incoming_path = canon(incoming.root());
        if reg
            .stores
            .values()
            .any(|store| canon(store.root()) == incoming_path)
        {
            return Err("the selected vault is already open".into());
        }
        let outgoing_id = persist()?;
        if outgoing_id.as_ref().is_some_and(|id| {
            id.is_empty()
                || id == DEFAULT_ROOT_ID
                || id.contains(':')
                || reg.stores.contains_key(id)
        }) {
            return Err("the outgoing vault could not be assigned a safe route".into());
        }
        let outgoing = reg.stores.remove(DEFAULT_ROOT_ID);
        if let (Some(outgoing_id), Some(outgoing)) = (outgoing_id, outgoing) {
            reg.stores.insert(outgoing_id, outgoing);
        }
        incoming.set_perms_read_only(false);
        reg.stores.insert(DEFAULT_ROOT_ID.to_string(), incoming);
        reg.default_id = DEFAULT_ROOT_ID.to_string();
        Ok(())
    }

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

    /// Absolute path of the active/default corpus for fixed-path companion
    /// services (Breve migration). The path is owned by the registry; callers
    /// never accept a path from the webview.
    pub(crate) fn default_root_path(&self) -> Result<PathBuf, String> {
        let reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let store = reg
            .stores
            .get(&reg.default_id)
            .ok_or_else(|| format!("corpus root unavailable: {}", reg.default_id))?;
        Ok(store.root().to_path_buf())
    }

    pub(crate) fn default_is_memex(&self) -> Result<bool, String> {
        let reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let store = reg
            .stores
            .get(&reg.default_id)
            .ok_or_else(|| format!("corpus root unavailable: {}", reg.default_id))?;
        Ok(store.is_memex())
    }

    /// Share one registered store's cache generation/suppression set with a
    /// narrow legacy memex write. Those writes use the same filesystem root but
    /// historically bypassed `CorpusStore`, leaving its warm list cache stale
    /// until the watcher echoed the change. Matching by canonical root keeps the
    /// bridge capability-scoped; caller-controlled paths cannot mint a store.
    pub(crate) fn suppress_set_for_root(&self, root: &Path) -> Result<SuppressSet, String> {
        let canonical = fs::canonicalize(root)
            .map_err(|e| format!("canonicalize corpus root {}: {e}", root.display()))?;
        let reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        reg.stores
            .values()
            .find(|store| {
                fs::canonicalize(store.root()).is_ok_and(|candidate| candidate == canonical)
            })
            .map(CorpusStore::suppress_set)
            .ok_or_else(|| format!("corpus root unavailable: {}", canonical.display()))
    }

    /// The Breve importer writes curated notes under `wiki/reference/**`, so it
    /// rides the same memex-only, contract-band, user-permissions gate as the AI
    /// filer. App-private `.rotli/routines` writes use `default_root_path` and
    /// remain available even when the connected brain itself is read-only.
    pub(crate) fn default_breve_memex_write_root(&self) -> Result<PathBuf, String> {
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
        let default_id = reg.default_id.clone();
        let store = reg
            .stores
            .get_mut(&default_id)
            .ok_or_else(|| format!("corpus root unavailable: {default_id}"))?;
        store.filer_writable("wiki/reference")?;
        Ok(store.root().to_path_buf())
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
        let mut reg = self
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?;
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
    m.disk_folder_id = compose_root_id(root_id, &m.disk_folder_id);
    if m.kind == NoteKind::Board || m.kind == NoteKind::File {
        // a board/file id IS its relative path — prefix it like a folder id so a
        // later read/open routes back to this store
        m.id = compose_root_id(root_id, &m.id);
    }
    m
}

fn prefix_write_result(root_id: &str, mut result: CorpusWriteResult) -> CorpusWriteResult {
    result.meta = prefix_meta(root_id, result.meta);
    if result.meta.kind == NoteKind::Note {
        result.meta.id = compose_root_id(root_id, &result.meta.id);
    }
    result
}

/// ASYNC + spawn_blocking: on a cache miss `corpus_list` walks the active vault
/// under the corpus mutex. Connected vaults are registered switch targets, not
/// simultaneous data sources. The walk stays off Tauri's main thread.
#[tauri::command]
pub async fn corpus_list(app: tauri::AppHandle) -> Result<CorpusList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        corpus_list_inner(&state)
    })
    .await
    .map_err(|e| format!("corpus list worker failed ({e})"))?
}

/// The active-vault half of `corpus_list`, shared with `corpus_notes_ai`.
fn corpus_list_inner(state: &CorpusState) -> Result<CorpusList, String> {
    let mut reg = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?;
    let default_id = reg.default_id.clone();
    reg.stores
        .get_mut(&default_id)
        .ok_or_else(|| format!("corpus root unavailable: {default_id}"))?
        .list()
}

/// The Tasks projection over the DEFAULT corpus (decision 2026-07-25): every
/// open checkbox, derived per call. Read-only.
#[tauri::command]
pub async fn corpus_tasks(app: tauri::AppHandle) -> Result<Vec<TaskItem>, String> {
    // ASYNC + spawn_blocking (perf audit 2026-08): the projection reads (and on a
    // cache miss walks) the default corpus under the mutex — off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        let default_id = state
            .0
            .lock()
            .map_err(|_| "corpus lock poisoned".to_string())?
            .default_id
            .clone();
        state.route(&default_id, |s| s.tasks())
    })
    .await
    .map_err(|e| format!("corpus tasks worker failed ({e})"))?
}

/// Check one open task off — re-validated against its exact text, written
/// through the ordinary note write path.
#[tauri::command]
pub fn corpus_toggle_task(
    state: tauri::State<'_, CorpusState>,
    id: String,
    line: usize,
    expect: String,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.toggle_task(&rel, line, &expect))
}

/// FULL-TEXT search inside the active vault only. Connected vaults are reached
/// through an explicit switch, never merged into search results. The disk work
/// stays off the main thread so a ⌘K keystroke never janks the window.
#[tauri::command]
pub async fn corpus_search(
    app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
    include_reference: Option<bool>,
) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        corpus_search_inner(&state, &query, limit, include_reference)
    })
    .await
    .map_err(|e| format!("corpus search worker failed ({e})"))?
}

/// The ranking half of `corpus_search`, shared with the model-gated
/// `corpus_search_ai` so the two lanes cannot rank differently.
fn corpus_search_inner(
    state: &CorpusState,
    query: &str,
    limit: Option<usize>,
    include_reference: Option<bool>,
) -> Result<Vec<SearchHit>, String> {
    let cap = limit.unwrap_or(50).clamp(1, 200);
    // default FALSE: ⌘K and every other user caller keep today's scope. Only the
    // AI host opts into the reference lane (docs/design/ai-visibility-matrix.md).
    let include_reference = include_reference.unwrap_or(false);
    let mut reg = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?;
    let default_id = reg.default_id.clone();
    let store = reg
        .stores
        .get_mut(&default_id)
        .ok_or_else(|| format!("corpus root unavailable: {default_id}"))?;
    let mut hits = store.search(query, cap, include_reference)?;
    sort_hits(&mut hits);
    hits.truncate(cap);
    Ok(hits)
}

/// The AI's search lane — `corpus_search` with the read gate applied IN RUST.
///
/// `corpus_search` above is a USER surface (⌘K, backlinks): it ranks the whole
/// corpus, secure notes included, because the user may see their own notes. The
/// AI's copy may not. Until 2026-08-01 the AI lane called `corpus_search` and
/// then filtered the ids through `corpus_readable_ids` — Rust supplied the
/// verdict but TYPESCRIPT applied it, so a compromised agent loop could simply
/// skip the second call and hand a frontier model the titles and body snippets
/// of every secure note that matched. The matrix promises a frontier model
/// never receives a secure note's "title, snippet, body, hit"; that promise now
/// holds at the command boundary, where the untrusted side cannot reach past it
/// (audit 2026-08-01, GAP 1).
///
/// Same filter as the probe — `read_for_ai` per hit — so the two lanes cannot
/// drift. One IPC round trip instead of two, which is also strictly faster.
#[tauri::command]
pub async fn corpus_search_ai(
    app: tauri::AppHandle,
    query: String,
    limit: Option<usize>,
    include_reference: Option<bool>,
    model_id: String,
    endpoint: String,
) -> Result<Vec<SearchHit>, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        let hits = corpus_search_inner(&state, &query, limit, include_reference)?;
        let mut permitted = Vec::with_capacity(hits.len());
        for hit in hits {
            let (root, rel) = split_root_id(&hit.id);
            if state
                .route(&root, |s| s.read_for_ai(&rel, model_is_local))
                .is_ok()
            {
                permitted.push(hit);
            }
        }
        Ok(permitted)
    })
    .await
    .map_err(|e| format!("ai search worker failed ({e})"))?
}

/// The AI's LISTING lane — every note meta the model may retrieve, Notes tree
/// plus the reference lanes, filtered by the same gate. Feeds the knowledge map
/// and the folder-name fallback, which are the other two routes by which a
/// secure note's TITLE could otherwise reach a frontier model's context.
#[tauri::command]
pub async fn corpus_notes_ai(
    app: tauri::AppHandle,
    model_id: String,
    endpoint: String,
) -> Result<Vec<NoteMeta>, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        let listed = corpus_list_inner(&state)?;
        let reference = corpus_reference_notes_inner(&state)?;
        let mut permitted = Vec::new();
        for meta in listed.notes.into_iter().chain(reference) {
            let (root, rel) = split_root_id(&meta.id);
            if state
                .route(&root, |s| s.read_for_ai(&rel, model_is_local))
                .is_ok()
            {
                permitted.push(meta);
            }
        }
        Ok(permitted)
    })
    .await
    .map_err(|e| format!("ai listing worker failed ({e})"))?
}

#[tauri::command]
pub fn corpus_read(state: tauri::State<'_, CorpusState>, id: String) -> Result<NoteDoc, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.read(&rel)).map(|mut doc| {
        doc.id = compose_root_id(&root, &doc.id);
        doc.folder_id = compose_root_id(&root, &doc.folder_id);
        doc.disk_folder_id = compose_root_id(&root, &doc.disk_folder_id);
        doc
    })
}

/// Open a surfaced FILE (`NoteKind::File`) in the OS default app — resolve its
/// routed id to an absolute path via the owning store, then `open` it. rotli
/// never reads/writes a non-note file as markdown; this just hands it to the OS.
#[tauri::command]
pub fn corpus_open_file(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    // The webview-supplied rel joins the root directly — validate like every
    // write lane so "../…" can never reach outside it (audit 2026-07).
    validate_rel(&rel)?;
    let abs = state.route(&root, |s| s.guard_rel(&rel))?;
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
    // Same traversal guard as the write lanes (audit 2026-07): a raw "../…"
    // from the webview must never read a file outside the corpus root.
    validate_rel(&rel)?;
    let abs = state.route(&root, |s| s.guard_rel(&rel))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    let cap = max_bytes.unwrap_or(200_000);
    let data = fs::read(&abs).map_err(|e| e.to_string())?;
    let end = data.len().min(cap);
    Ok(String::from_utf8_lossy(&data[..end]).into_owned())
}

/// Default byte cap for `corpus_file_bytes` — the sheet editor's edit gate.
/// Byte-identical to SHEET_EDIT_MAX_BYTES in src/sheets/kinds.ts (parity.json).
pub(crate) const SHEET_EDIT_MAX_BYTES: usize = 8_000_000;

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
    // Same traversal guard as the write lanes (audit 2026-07).
    validate_rel(&rel)?;
    let abs = state.route(&root, |s| s.guard_rel(&rel))?;
    if !abs.is_file() {
        return Err(format!("not a file: {}", abs.display()));
    }
    let cap = max_bytes.unwrap_or(SHEET_EDIT_MAX_BYTES);
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
    authorizations: tauri::State<'_, ImportAuthorizations>,
    root_id: String,
    path: String,
) -> Result<String, String> {
    // The native drag event grants this exact source path once. Destination
    // authority is independent: `route` accepts only a registered root and
    // `import_file` enforces that root's mutation policy. Keeping the old
    // default-only check here silently routed Chat drops away from the active
    // connected vault even though every subsequent operation was root-aware.
    let src = authorizations.consume(Path::new(&path))?;
    let rel = state.route(&root_id, |s| s.import_file(&src))?;
    Ok(compose_root_id(&root_id, &rel))
}

/// Persist an image selected through the webview's file input into the same
/// user-owned asset lane used by the rest of the corpus. The IPC payload is
/// bounded before writing; the store independently validates name, type, root
/// mutability, and destination.
#[tauri::command]
pub fn corpus_create_image_asset(
    state: tauri::State<'_, CorpusState>,
    root_id: String,
    name: String,
    base64: String,
) -> Result<String, String> {
    use base64::Engine;
    if base64.len() > (CHAT_IMAGE_ASSET_MAX_BYTES * 4 / 3) + 8 {
        return Err("image is larger than 25 MB".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad image payload: {e}"))?;
    if bytes.len() > CHAT_IMAGE_ASSET_MAX_BYTES {
        return Err("image is larger than 25 MB".into());
    }
    let rel = state.route(&root_id, |store| store.create_image_asset(&name, &bytes))?;
    Ok(compose_root_id(&root_id, &rel))
}

/// Size + user-lane writability of a surfaced file. The sheet editor probes this
/// before offering edit mode: a read-only root (a memex/linked-library) or a file
/// over the read cap stays a viewer.
#[tauri::command]
pub fn corpus_file_stat(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<FileStat, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.file_stat(&rel))
}

/// Move a surfaced storage asset into the memex Archive/Trash. Its original
/// storage path is retained beneath the sink for durable, sidecar-free restore.
#[tauri::command]
pub fn corpus_move_file_to_sink(
    state: tauri::State<'_, CorpusState>,
    id: String,
    sink: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let moved = state.route(&root, |store| store.move_file_to_sink(&rel, &sink))?;
    Ok(compose_root_id(&root, &moved))
}

/// Restore a surfaced file from Archive/Trash to its nested storage origin.
#[tauri::command]
pub fn corpus_restore_file(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let restored = state.route(&root, |store| store.restore_file(&rel))?;
    Ok(compose_root_id(&root, &restored))
}

/// Save a surfaced FILE's bytes back to disk (base64 in) — the spreadsheet
/// editor's explicit Save. Gated by the same writable() lane as every user write.
#[tauri::command]
pub fn corpus_write_file_bytes(
    state: tauri::State<'_, CorpusState>,
    id: String,
    base64: String,
    bak: Option<bool>,
    expected_revision: String,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad file payload: {e}"))?;
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| {
        s.write_file_bytes_if_revision(&rel, &bytes, bak.unwrap_or(false), &expected_revision)
    })
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

/// Create a Rotli-owned workbook or DOCX in the managed binary lane. Unlike the
/// generic import path this accepts only the two formats Rotli can generate.
#[tauri::command]
pub fn corpus_create_managed_file(
    state: tauri::State<'_, CorpusState>,
    name: String,
    base64: String,
    root_id: Option<String>,
) -> Result<String, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("bad file payload: {e}"))?;
    let root_id = match root_id {
        Some(id) => id,
        None => state.default_root_id()?,
    };
    let rel = state.route(&root_id, |store| store.create_managed_file(&name, &bytes))?;
    Ok(compose_root_id(&root_id, &rel))
}

/// Export one ordinary editable Markdown note to a separate managed PDF copy.
/// The source and destination stay in the same registered root; Rust refuses
/// secure, secret-shaped, locked, read-only, and malformed inputs independently
/// of the frontend host policy.
#[tauri::command]
pub async fn corpus_export_note_pdf(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    id: String,
    name: String,
    title: String,
) -> Result<String, String> {
    let (root, source_id) = split_root_id(&id);
    let (body, root_path) = state.route(&root, |store| {
        store.mutation_allowed()?;
        Ok((store.editable_pdf_source(&source_id)?, store.root.clone()))
    })?;
    // themed lane first (the same renderer + palette as the Breve briefs,
    // 2026-09-02), plain-text macOS exporter as the fallback — see
    // document_conversion::export_note_pdf_bytes
    let bundled = crate::routines::source_root(&app).ok();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::document_conversion::export_note_pdf_bytes(&root_path, bundled.as_deref(), &title, &body)
    })
    .await
    .map_err(|e| format!("PDF export worker failed ({e})"))??;
    let rel = state.route(&root, |store| store.create_exported_pdf(&name, &bytes))?;
    Ok(compose_root_id(&root, &rel))
}

/// Byte-identical to DOCUMENT_CONVERTIBLE_EXTS in src/documents/kinds.ts (parity.json).
pub(crate) const DOCUMENT_CONVERTIBLE_EXTS: &[&str] = &["doc", "rtf", "odt", "pdf"];
const LOCAL_DOCUMENT_CONVERSION_MAX_BYTES: u64 = 32_000_000;
const GENERATED_PDF_SOURCE_MAX_BYTES: u64 = 16_000_000;

fn converted_document_name(rel: &str) -> Result<String, String> {
    let path = Path::new(rel);
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "this file has no supported document extension".to_string())?;
    if !DOCUMENT_CONVERTIBLE_EXTS.contains(&ext.as_str()) {
        return Err(format!(".{ext} has no faithful local DOCX conversion path"));
    }
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("converted");
    Ok(format!("{stem}.docx"))
}

/// Convert a legacy local document or embedded-text PDF into a NEW managed
/// DOCX. The source path is resolved by the corpus and is never opened for
/// writing. PDF extraction is offline; scanned/image-only PDFs fail with an
/// explicit OCR requirement. The resulting bytes still pass the managed-file
/// extension and mutation gates before entering the memex.
/// ASYNC command (perf audit 2026-07-30, #14): the textutil/PDF extraction can
/// run multi-second on a ≤32 MB document and froze the window. The subprocess
/// moves to a worker; every gate (path guard, size ceiling, managed-lane
/// availability, extension check) runs exactly where it did before.
#[tauri::command]
pub async fn corpus_convert_document(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    let output_name = converted_document_name(&rel)?;
    let source = state.route(&root, |store| store.guard_rel(&rel))?;
    let metadata = fs::metadata(&source).map_err(|error| format!("read {}: {error}", source.display()))?;
    if !metadata.is_file() {
        return Err(format!("not a file: {}", source.display()));
    }
    if metadata.len() > LOCAL_DOCUMENT_CONVERSION_MAX_BYTES {
        return Err("This document is too large for safe local conversion (32 MB maximum).".into());
    }
    let ext = Path::new(&rel)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "this file has no supported document extension".to_string())?;

    let default_id = state.default_root_id()?;
    state.route(&default_id, |store| {
        if store.managed_file_creation_available() {
            Ok(())
        } else {
            Err("Rotli Storage is read-only, so a converted copy cannot be created.".into())
        }
    })?;

    let _ = (&output_name, &ext); // read on every platform; only macOS converts
    #[cfg(not(target_os = "macos"))]
    return Err("Local legacy-document conversion is currently available only on macOS.".into());

    #[cfg(target_os = "macos")]
    {
        let converted = tauri::async_runtime::spawn_blocking(move || {
            crate::document_conversion::convert_document_bytes(&source, &ext)
        })
        .await
        .map_err(|e| format!("conversion worker failed ({e})"))??;
        let rel = state.route(&default_id, |store| {
            store.create_managed_file(&output_name, &converted)
        })?;
        Ok(compose_root_id(&default_id, &rel))
    }
}

#[tauri::command]
pub fn corpus_managed_file_creation_available(
    state: tauri::State<'_, CorpusState>,
) -> Result<bool, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| {
        Ok(store.managed_file_creation_available())
    })
}

/// Reveal a surfaced file in Finder (`open -R`) — the file surface's dropdown.
#[tauri::command]
pub fn corpus_reveal_file(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    // a NOTE travels the wire as its frontmatter ULID — joining that to the root
    // was never a file, so "Show in Finder" silently failed for every note
    // (the maintainer, 2026-07-09; the same ULID→rel class as the v0.18.1 filing bug).
    // resolve_note_rel passes real file paths through and maps ids via the index.
    let abs = state.route(&root, |s| {
        let resolved = s.resolve_note_rel(&rel)?;
        s.guard_rel(&resolved)
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
const OPEN_WITH_APPS: &[&str] = &[
    "Numbers",
    "Microsoft Excel",
    "Microsoft Word",
    "Pages",
    "LibreOffice",
    "TextEdit",
    "Preview",
    "Safari",
];

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
    let abs = state.route(&root, |s| s.guard_rel(&rel))?;
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
    validate_rel(&rel)?;
    state.route(&root_id, |s| {
        Ok(s.guard_rel(&rel)?.to_string_lossy().into_owned())
    })
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
) -> Result<crate::fsutil::VersionedText, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.raw_frontmatter_versioned(&rel))
}

/// Write back a user-edited raw frontmatter block. Rust restores the reserved
/// provenance keys (id/owner/created) and refuses notes the user can't write.
#[tauri::command]
pub fn corpus_write_frontmatter_raw(
    state: tauri::State<'_, CorpusState>,
    id: String,
    block: String,
    expected_revision: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| {
        s.write_frontmatter_raw_if_revision(&rel, &block, &expected_revision)
    })
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
pub fn corpus_file_note(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<String, String> {
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
pub fn corpus_note_path(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<String, String> {
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

/// Prune resolved journal entries older than `keep_days` (0 = clear all
/// resolved history). Pending proposals always survive. Returns lines removed.
#[tauri::command]
pub fn corpus_journal_prune(
    state: tauri::State<'_, CorpusState>,
    keep_days: u32,
) -> Result<usize, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.journal_prune(keep_days))
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

/// Preview LEGACY secure-intake state in the default memex (read-only): notes
/// explicitly flagged `secure: true` still sitting in Brain intake.
#[tauri::command]
pub fn corpus_secure_repair_scan(
    state: tauri::State<'_, CorpusState>,
) -> Result<Vec<SecureRepairCandidate>, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |s| s.secure_repair_scan())
}

/// Repair every current candidate (explicit user confirm in the Activity pane):
/// each note is re-validated on disk, then moved into the protected lane
/// through the existing ignore-before-move flow and journaled content-free.
#[tauri::command]
pub fn corpus_secure_repair_apply(
    state: tauri::State<'_, CorpusState>,
    organizer: tauri::State<'_, crate::organizer::OrganizerState>,
) -> Result<SecureRepairReport, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    let report = state.route(&default_id, |s| s.secure_repair_apply())?;
    // the moves are suppress-marked (no watcher events) — owe the organizer one
    // reconciliation sweep so its secure-pending hint and index diff catch up
    organizer.0.nudge_sweep();
    Ok(report)
}

/// Explicitly permit or deny loopback-local AI access to a secure note.
#[tauri::command]
pub fn corpus_set_local_ai_access(
    state: tauri::State<'_, CorpusState>,
    id: String,
    allowed: bool,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.set_local_ai_access(&rel, allowed))
}

/// Read a note for an AI model — refused for a SECURE note unless the model is
/// LOCAL. Rust verifies both the model registry identity and loopback endpoint,
/// so a localhost proxy for a frontier provider remains remote.
#[tauri::command]
pub fn corpus_read_ai(
    state: tauri::State<'_, CorpusState>,
    id: String,
    model_id: String,
    endpoint: String,
) -> Result<CorpusAiRead, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| {
        let body = s.read_for_ai(&rel, model_is_local)?;
        Ok(CorpusAiRead {
            revision: crate::fsutil::revision(body.as_bytes()),
            body,
        })
    })
}

/// Batch form of the AI read-permission probe (perf audit 2026-07-30, #4):
/// which of `ids` may this model read? The verdict comes from the EXACT same
/// enforcement as `corpus_read_ai` — `read_for_ai` per id, secure detector
/// included — so Rust stays the enforcement point and TS only FILTERS its hit
/// list with the answer. Bodies are never returned. ASYNC: the old per-note
/// probe was ~350 serial IPC round-trips on the main thread, holding the first
/// token of every chat; the batch runs once, on a worker.
#[tauri::command]
pub async fn corpus_readable_ids(
    app: tauri::AppHandle,
    ids: Vec<String>,
    model_id: String,
    endpoint: String,
) -> Result<Vec<String>, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let state = app.state::<CorpusState>();
        let mut readable = Vec::new();
        for id in ids {
            let (root, rel) = split_root_id(&id);
            if state
                .route(&root, |s| s.read_for_ai(&rel, model_is_local))
                .is_ok()
            {
                readable.push(id);
            }
        }
        Ok(readable)
    })
    .await
    .map_err(|e| format!("permission probe worker failed ({e})"))?
}

/// The reference lane's metas — the brain's memory notes (identity/,
/// personality/, history/, MAP.md, inbox.md), which the Notes tree never shows
/// and the AI's retrieval tools now reach for BOTH model classes (2026-08-01,
/// docs/design/ai-visibility-matrix.md). Metas only: readability is still
/// decided per note by `read_for_ai` through `corpus_readable_ids`.
/// The reference lane's metas. There is deliberately NO ungated command for
/// this: the only caller is `corpus_notes_ai`, which applies the read gate per
/// note. The bare `corpus_reference_notes` command was retired on 2026-08-01 —
/// an AI-only retrieval surface with no model argument is exactly the shape
/// this audit was closing (docs/architecture/egress-threat-model.md).
fn corpus_reference_notes_inner(state: &CorpusState) -> Result<Vec<NoteMeta>, String> {
    let mut reg = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?;
    let mut ids: Vec<String> = reg.stores.keys().cloned().collect();
    ids.sort();
    if let Some(pos) = ids.iter().position(|i| *i == reg.default_id) {
        let d = ids.remove(pos);
        ids.insert(0, d);
    }
    let mut notes: Vec<NoteMeta> = Vec::new();
    for id in ids {
        let store = reg.stores.get_mut(&id).expect("id from keys");
        for meta in store.reference_notes()? {
            let mut meta = prefix_meta(&id, meta);
            // a reference id IS a rel path, but its kind is Note — so
            // `prefix_meta` (which only prefixes board/file ids) leaves it bare.
            // Prefix it here or a later read on a CONNECTED vault would route to
            // the default root. compose_root_id is a no-op for the default root.
            meta.id = compose_root_id(&id, &meta.id);
            notes.push(meta);
        }
    }
    Ok(notes)
}

/// WRITE a note on behalf of an interactive AI model. Rust re-derives the
/// model's locality, re-runs the read gate, and refuses a LOCKED note — the
/// second, independent layer behind the TypeScript host's own refusals
/// (docs/design/ai-visibility-matrix.md).
#[tauri::command]
pub fn corpus_write_ai(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
    model_id: String,
    endpoint: String,
    expected_revision: String,
) -> Result<CorpusWriteResult, String> {
    let model_is_local = crate::chat::model_is_local(&model_id, &endpoint);
    let (root, rel) = split_root_id(&id);
    state
        .route(&root, |s| {
            s.write_for_ai_if_revision(&rel, &body, model_is_local, &expected_revision)
        })
        .map(|result| prefix_write_result(&root, result))
}

#[tauri::command]
pub fn corpus_write(
    state: tauri::State<'_, CorpusState>,
    id: String,
    body: String,
    expected_revision: String,
    expected_body: Option<String>,
) -> Result<CorpusWriteResult, String> {
    let (root, rel) = split_root_id(&id);
    state
        .route(&root, |s| {
            s.write_if_revision_with_body_base(
                &rel,
                &body,
                &expected_revision,
                expected_body.as_deref(),
            )
        })
        .map(|result| prefix_write_result(&root, result))
}

#[tauri::command]
pub fn corpus_create(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    body: String,
    secure: Option<bool>,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&folder_id);
    state
        .route(&root, |s| {
            s.create_with_policy(&rel, &body, secure.unwrap_or(false))
        })
        .map(|mut m| {
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

/// The ephemeral-note lane: hard-discard a note ONLY if its body is blank
/// (Rust re-verifies; see `Store::discard_blank`). Bypasses the in-app Trash.
#[tauri::command]
pub fn corpus_discard_blank(
    state: tauri::State<'_, CorpusState>,
    id: String,
) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| s.discard_blank(&rel))
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
    state
        .route(&id_root, |s| s.move_note(&rel, &tgt_rel))
        .map(|mut m| {
            m = prefix_meta(&id_root, m);
            if m.kind == NoteKind::Note {
                m.id = compose_root_id(&id_root, &m.id);
            }
            m
        })
}

/// Rename a board (`.excalidraw`) within its folder. Boards are path-id'd and
/// carry no note index, so the returned meta has the NEW id — the caller swaps
/// the open tab's `boardId` to it (the maintainer, 2026-06-26).
#[tauri::command]
pub fn corpus_rename_board(
    state: tauri::State<'_, CorpusState>,
    id: String,
    name: String,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&id);
    state
        .route(&root, |s| s.rename_board(&rel, &name))
        .map(|m| prefix_meta(&root, m))
}

/// The `corpus_purge` command was unregistered in the 2026-07 audit (#68)
/// while it had no caller. Empty Trash ships one now (2026-07-31), so the
/// lane returns — NARROWER than before: only a note already in the Trash
/// root may be purged, so a miscall can never hard-delete a live note. The
/// file still lands in the OS Trash (recoverable), never oblivion.
#[tauri::command]
pub fn corpus_purge(state: tauri::State<'_, CorpusState>, id: String) -> Result<(), String> {
    let (root, rel) = split_root_id(&id);
    state.route(&root, |s| {
        // resolve_note_rel: notes arrive as ULIDs, boards/files as rel paths —
        // both must purge (the trash-IN lane is two-laned; so is this gate).
        let note_rel = s.resolve_note_rel(&rel)?;
        // both trash spellings: the app root uses `Trash/`, the memex layout's
        // sink is lowercase `trash/` (matches is_hidden_root — review F6)
        let in_trash = ["Trash", "trash"]
            .iter()
            .any(|t| note_rel == *t || note_rel.starts_with(&format!("{t}/")));
        if !in_trash {
            return Err("only items already in Trash can be deleted forever".into());
        }
        s.purge(&rel)
    })
}

/// Rel→wire-id resolve (Librarian "Open the note": journal rows may be
/// path-addressed; tabs/titles key on wire ids). Read-only.
#[tauri::command]
pub fn corpus_resolve_ref(
    state: tauri::State<'_, CorpusState>,
    target: String,
) -> Result<String, String> {
    let (root, rel) = split_root_id(&target);
    // recompose the root prefix — the wire contract everywhere else in this
    // file (a bare id from a non-default root would route the open back to
    // the DEFAULT store)
    let id = state.route(&root, |s| s.wire_id_of(&rel))?;
    Ok(compose_root_id(&root, &id))
}

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
    expected_revision: String,
) -> Result<CorpusWriteResult, String> {
    let (root, rel) = split_root_id(&id);
    state
        .route(&root, |s| {
            s.write_board_if_revision(&rel, &body, &expected_revision)
        })
        .map(|result| prefix_write_result(&root, result))
}

/// Create a board in `folderId` at its final `name` (Tauri maps JS camelCase).
/// `body` is optional — `None` seeds an empty Excalidraw scene.
#[tauri::command]
pub fn corpus_create_board(
    state: tauri::State<'_, CorpusState>,
    folder_id: String,
    name: String,
    body: Option<String>,
) -> Result<NoteMeta, String> {
    let (root, rel) = split_root_id(&folder_id);
    state
        .route(&root, |s| {
            s.create_named_board(&rel, &name, body.as_deref())
        })
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
/// viewstate.json, which we keep reading from and writing to the
/// REAL corpus's `.rotli/` so a demo never forces re-onboarding or resets the theme
/// (the maintainer, 2026-07-07). `main.json` is per-MEMEX (it travels with the notes), so it
/// is deliberately NOT redirected — it still routes to the active (demo) store.
fn demo_machine_dot_path(app: &tauri::AppHandle, file: &str) -> Option<PathBuf> {
    if !demo_active(app) {
        return None;
    }
    if !matches!(file, "settings" | "viewstate") {
        return None;
    }
    let real = read_corpus_config(app)?.corpus.abs_path;
    let name = dot_file(file).ok()?;
    Some(real.join(DOT_DIR).join(name))
}

/// Per-machine window state for a debug shell. View state and wallpaper stay in
/// the app cache so development window experiments do not replace the installed
/// app's layout. Vault settings and portable organization (`main` and `views`)
/// deliberately bypass this lane and route to the live vault.
fn dev_machine_dot_path(app: &tauri::AppHandle, file: &str) -> Option<PathBuf> {
    if !cfg!(debug_assertions) || !dev_machine_state_file(file) {
        return None;
    }
    use tauri::Manager;
    let name = dot_file(file).ok()?;
    app.path()
        .app_cache_dir()
        .ok()
        .map(|d| d.join("tauri-dev-state").join(name))
}

fn dev_machine_state_file(file: &str) -> bool {
    matches!(file, "viewstate" | "wallpaper")
}

#[tauri::command]
pub fn corpus_settings_read(
    app: tauri::AppHandle,
    state: tauri::State<'_, CorpusState>,
    file: String,
) -> Result<String, String> {
    if let Some(path) = dev_machine_dot_path(&app, &file) {
        return match fs::read_to_string(&path) {
            Ok(s) => Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("{}".into()),
            Err(e) => Err(format!("read {file}: {e}")),
        };
    }
    // settings/viewstate live in the DEFAULT root's `.rotli/` — except in
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
    if let Some(path) = dev_machine_dot_path(&app, &file) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        return atomic_write(&path, &contents);
    }
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

/// Read the user's durable Main arrangement with the exact content revision
/// required by its next full-manifest replacement.
#[tauri::command]
pub fn corpus_main_read(
    state: tauri::State<'_, CorpusState>,
) -> Result<crate::fsutil::VersionedText, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| store.main_read_versioned())
}

/// Write `.rotli/main.json` (the user's durable Main arrangement) AND ensure the
/// corpus `.gitignore` commits it — separate from settings/viewstate, which stay
/// per-machine (the maintainer, 2026-07-01). A stale full-manifest replacement is refused.
#[tauri::command]
pub fn corpus_main_write(
    state: tauri::State<'_, CorpusState>,
    contents: String,
    expected_revision: String,
) -> Result<String, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| {
        store.main_write_if_revision(&contents, &expected_revision)
    })
}

/// Read named views with the exact content revision required by their next
/// replacement. Main remains a separate global reference projection.
#[tauri::command]
pub fn corpus_views_read(
    state: tauri::State<'_, CorpusState>,
) -> Result<crate::fsutil::VersionedText, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| store.views_read_versioned())
}

/// Write `.rotli/views.json` through the schema + Markdown metadata sync gate.
/// Main and named views are portable vault organization, so development and
/// installed builds deliberately share these files.
#[tauri::command]
pub fn corpus_views_write(
    state: tauri::State<'_, CorpusState>,
    contents: String,
    expected_revision: String,
) -> Result<String, String> {
    let default_id = state
        .0
        .lock()
        .map_err(|_| "corpus lock poisoned".to_string())?
        .default_id
        .clone();
    state.route(&default_id, |store| {
        store.views_write_if_revision(&contents, &expected_revision)
    })
}

/// Document/sheet rename — a child module so it reuses the store's own gates.
#[path = "corpus_file_rename.rs"]
pub mod file_rename;

// ─── tests ───────────────────────────────────────────────────────────────────

/// The prompt-injection evals — a fully cooperating, fully compromised caller
/// driven against the real gates. Kept in its own file because it is a
/// deliverable, not a unit test (docs/architecture/egress-threat-model.md).
#[cfg(test)]
#[path = "injection_evals.rs"]
mod injection_evals;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    #[test]
    fn development_isolates_window_state_but_not_vault_state() {
        for file in ["viewstate", "wallpaper"] {
            assert!(dev_machine_state_file(file), "{file}");
        }
        for file in ["settings", "main", "views", "organizer", "chat-folders"] {
            assert!(!dev_machine_state_file(file), "{file}");
        }
    }

    #[test]
    fn open_with_allowlist_covers_office_apps_without_accepting_arbitrary_commands() {
        for app in [
            "Microsoft Excel",
            "Numbers",
            "Microsoft Word",
            "Pages",
            "LibreOffice",
        ] {
            assert!(OPEN_WITH_APPS.contains(&app));
        }
        assert!(!OPEN_WITH_APPS.contains(&"Terminal"));
        assert!(!OPEN_WITH_APPS.contains(&"/bin/sh"));
    }

    #[test]
    fn document_conversion_names_only_the_explicit_local_family() {
        assert_eq!(
            converted_document_name("storage/Quarterly report.doc").unwrap(),
            "Quarterly report.docx"
        );
        assert_eq!(
            converted_document_name("storage/notes.rtf").unwrap(),
            "notes.docx"
        );
        assert_eq!(
            converted_document_name("storage/draft.odt").unwrap(),
            "draft.docx"
        );
        assert_eq!(
            converted_document_name("storage/reference.pdf").unwrap(),
            "reference.docx"
        );
        assert!(converted_document_name("storage/design.pages").is_err());
        assert!(converted_document_name("storage/macro.docm").is_err());
    }

    #[test]
    fn config_reader_uses_backup_without_moving_or_rewriting_it() {
        let tmp = TempDir::new().unwrap();
        let selected = tmp.path().join("corpus.json");
        let backup = tmp.path().join("corpus.json.bak");
        let root = tmp.path().join("memex-vault");
        fs::write(
            &backup,
            format!(
                "{{\"version\":1,\"corpus\":{{\"absPath\":\"{}\"}},\"brains\":[],\"folders\":[],\"activeBrainId\":null}}",
                root.display()
            ),
        )
        .unwrap();

        let cfg = read_config_path_or_backup(&selected).unwrap();
        assert_eq!(cfg.corpus.abs_path, root);
        assert!(
            !selected.exists(),
            "a read-only fallback must not restore or rewrite production config"
        );
        assert!(
            backup.exists(),
            "the recovery snapshot must remain untouched"
        );
    }

    #[test]
    fn development_source_preserves_an_explicit_multi_vault_config() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path().join("notes");
        let brain = tmp.path().join("memex-vault");
        fs::create_dir_all(&notes).unwrap();
        seed_memex(&brain);
        let cfg = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: notes.clone(),
                adopted: false,
            },
            brains: vec![ConnectedBrain {
                id: "vault".into(),
                label: "Vault".into(),
                abs_path: brain.clone(),
                memex_id: Some("mx_test123".into()),
                mode: Some("secure".into()),
                perms: crate::memex::MemexPerms::ChatsInbox,
            }],
            folders: Vec::new(),
            active_brain_id: Some("vault".into()),
        };

        let dev = development_source_config(Some(cfg), None).unwrap();
        assert_eq!(dev.corpus.abs_path, notes);
        assert_eq!(dev.brains.len(), 1);
        assert_eq!(dev.brains[0].abs_path, brain);
        assert_eq!(dev.active_brain_id.as_deref(), Some("vault"));
    }

    #[test]
    fn development_source_promotes_only_the_production_fallback_to_one_root() {
        let tmp = TempDir::new().unwrap();
        let notes = tmp.path().join("notes");
        let brain = tmp.path().join("memex-vault");
        fs::create_dir_all(&notes).unwrap();
        seed_memex(&brain);
        let cfg = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: notes,
                adopted: false,
            },
            brains: vec![ConnectedBrain {
                id: "vault".into(),
                label: "Vault".into(),
                abs_path: brain.clone(),
                memex_id: Some("mx_test123".into()),
                mode: Some("secure".into()),
                perms: crate::memex::MemexPerms::ChatsInbox,
            }],
            folders: Vec::new(),
            active_brain_id: Some("vault".into()),
        };

        let dev = development_source_config(None, Some(cfg)).unwrap();
        assert_eq!(dev.corpus.abs_path, brain);
        assert!(dev.brains.is_empty());
        assert!(dev.folders.is_empty());
        assert!(dev.active_brain_id.is_none());
    }

    #[test]
    fn switching_vaults_keeps_the_outgoing_vault_connected() {
        let tmp = TempDir::new().unwrap();
        let outgoing = tmp.path().join("personal");
        let target = tmp.path().join("work");
        seed_memex(&outgoing);
        seed_memex(&target);
        let cfg = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: outgoing.clone(),
                adopted: false,
            },
            brains: vec![ConnectedBrain {
                id: "work".into(),
                label: "Work".into(),
                abs_path: target.clone(),
                memex_id: Some("mx_test123".into()),
                mode: Some("open".into()),
                perms: crate::memex::MemexPerms::ChatsInbox,
            }],
            folders: Vec::new(),
            active_brain_id: Some("work".into()),
        };

        let switched = switch_corpus_config(cfg, target.clone(), false).unwrap();
        assert_eq!(switched.corpus.abs_path, target);
        assert_eq!(switched.brains.len(), 1);
        assert_eq!(switched.brains[0].abs_path, outgoing);
        assert_eq!(switched.brains[0].label, "personal");
    }

    #[test]
    fn switching_away_from_a_deleted_vault_keeps_other_valid_connections() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("deleted-in-finder");
        let target = tmp.path().join("work");
        let other = tmp.path().join("archive");
        seed_memex(&target);
        seed_memex(&other);
        let brain = |id: &str, path: PathBuf| ConnectedBrain {
            id: id.into(),
            label: id.into(),
            abs_path: path,
            memex_id: Some(format!("mx_{id}")),
            mode: Some("open".into()),
            perms: crate::memex::MemexPerms::ChatsInbox,
        };
        let cfg = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: missing.clone(),
                adopted: false,
            },
            brains: vec![
                brain("work", target.clone()),
                brain("archive", other.clone()),
            ],
            folders: Vec::new(),
            active_brain_id: None,
        };

        let switched = switch_corpus_config(cfg, target.clone(), false).unwrap();

        assert_eq!(switched.corpus.abs_path, target);
        assert_eq!(switched.brains.len(), 1);
        assert_eq!(switched.brains[0].abs_path, other);
        assert!(switched
            .brains
            .iter()
            .all(|connected| connected.abs_path != missing));
    }

    #[test]
    fn connected_vault_switch_target_resolves_only_registered_ids() {
        let target = PathBuf::from("/tmp/work-vault");
        let cfg = CorpusConfig {
            version: 1,
            corpus: CorpusRef {
                abs_path: PathBuf::from("/tmp/personal-vault"),
                adopted: false,
            },
            brains: vec![ConnectedBrain {
                id: "work".into(),
                label: "Work".into(),
                abs_path: target.clone(),
                memex_id: Some("mx_work".into()),
                mode: Some("open".into()),
                perms: crate::memex::MemexPerms::ChatsInbox,
            }],
            folders: Vec::new(),
            active_brain_id: Some("work".into()),
        };

        assert_eq!(
            connected_vault_switch_target(&cfg, "work")
                .unwrap()
                .abs_path,
            target
        );
        assert_eq!(
            connected_vault_switch_target(&cfg, "missing").unwrap_err(),
            "no such connected vault"
        );
    }

    /// The load-bearing migration: the maintainer's live shape (plain `~/Documents/rotli`
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

        assert_eq!(
            canon(&cfg.corpus.abs_path),
            canon(&corpus),
            "corpus stays the plain notes folder"
        );
        assert_eq!(
            cfg.brains.len(),
            1,
            "double registration deduped to one brain"
        );
        let b = &cfg.brains[0];
        assert_eq!(
            b.id, "vault",
            "keeps the vault id so the sidebar prefix stays valid"
        );
        assert_eq!(canon(&b.abs_path), canon(&brain));
        assert_eq!(
            b.perms,
            crate::memex::MemexPerms::ChatsInbox,
            "carries write perms from the instance, not read-only"
        );
        assert_eq!(b.memex_id.as_deref(), Some(mxid));
        assert_eq!(b.mode.as_deref(), Some("secure"));
        assert_eq!(
            cfg.active_brain_id.as_deref(),
            Some("vault"),
            "active mapped via memexId"
        );
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
        assert!(!looks_secure(
            "A normal note — groceries, weather, call 555-1234 at 3pm."
        ));
        assert!(!looks_secure(
            "Meeting notes: ship v2, review the gateway flow."
        ));
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
        // slug so the ref passes the memex asset regex (the maintainer, 2026-07-03).
        let (dir, store) = bare();
        let src = dir.path().join("Screenshot 2026-07-03 at 8.59.00 AM.png");
        fs::write(&src, b"png").unwrap();
        let rel = store.import_file(&src).unwrap();
        assert_eq!(rel, "Storage/screenshot-2026-07-03-at-8-59-00-am.png");
        assert!(store.root().join(&rel).is_file());
    }

    #[test]
    fn absolute_import_paths_require_a_single_use_native_drop_grant() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("private.txt");
        fs::write(&source, "private").unwrap();
        let grants = ImportAuthorizations::default();

        assert!(grants.consume(&source).is_err());
        let delivered = grants.authorize_native_drop(std::slice::from_ref(&source));
        assert_eq!(
            delivered,
            vec![fs::canonicalize(&source)
                .unwrap()
                .to_string_lossy()
                .to_string()]
        );
        assert_eq!(
            grants.consume(Path::new(&delivered[0])).unwrap(),
            fs::canonicalize(&source).unwrap()
        );
        assert!(
            grants.consume(&source).is_err(),
            "a webview cannot replay a native grant"
        );
    }

    #[test]
    fn write_file_bytes_overwrites_with_one_time_bak() {
        let (_dir, mut store) = bare();
        fs::create_dir_all(store.root().join("Storage")).unwrap();
        fs::write(store.root().join("Storage/book.xlsx"), b"original-bytes").unwrap();

        // a missing file is an error — the save lane never creates
        assert!(store
            .write_file_bytes("Storage/nope.xlsx", b"x", false)
            .is_err());

        store
            .write_file_bytes("Storage/book.xlsx", b"first-save", true)
            .unwrap();
        assert_eq!(
            fs::read(store.root().join("Storage/book.xlsx")).unwrap(),
            b"first-save"
        );
        // .bak holds the PRE-rotli original…
        assert_eq!(
            fs::read(store.root().join("Storage/book.xlsx.bak")).unwrap(),
            b"original-bytes"
        );
        // …and a second save never touches it (one-time backup)
        store
            .write_file_bytes("Storage/book.xlsx", b"second-save", true)
            .unwrap();
        assert_eq!(
            fs::read(store.root().join("Storage/book.xlsx.bak")).unwrap(),
            b"original-bytes"
        );
        assert_eq!(
            fs::read(store.root().join("Storage/book.xlsx")).unwrap(),
            b"second-save"
        );
    }

    #[test]
    fn stale_office_save_must_not_overwrite_a_same_size_external_edit() {
        let (_dir, mut store) = bare();
        fs::write(store.root().join("Storage/book.xlsx"), b"opened").unwrap();
        let opened = fs::read(store.root().join("Storage/book.xlsx")).unwrap();
        fs::write(store.root().join("Storage/book.xlsx"), b"newer!").unwrap();

        let result = store.write_file_bytes_if_revision(
            "Storage/book.xlsx",
            b"stale!",
            false,
            &crate::fsutil::revision(&opened),
        );
        assert!(
            result.is_err(),
            "a stale office save must report a conflict"
        );
        assert_eq!(
            fs::read(store.root().join("Storage/book.xlsx")).unwrap(),
            b"newer!"
        );
        assert_eq!(opened, b"opened");
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
        assert!(store
            .write_file_bytes("storage/graph.png", b"edited", true)
            .is_err());
        assert_eq!(fs::read(root.join("storage/graph.png")).unwrap(), b"pixels");
        assert!(
            !root.join("storage/graph.png.bak").exists(),
            "a refused save must not leave a .bak"
        );
        // new files refuse too (the csv→xlsx convert can't create in the vault)
        assert!(store.new_file_bytes("storage", "new.xlsx", b"x").is_err());
    }

    #[test]
    fn storage_sheets_are_editable_in_place() {
        // the sanctioned exception (the maintainer, 2026-07-08): an EXISTING .xlsx/.csv in the
        // memex storage/ can be overwritten in place — but nothing else in storage.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("storage/samples")).unwrap();
        fs::write(
            root.join("storage/samples/company-overview.xlsx"),
            b"vault-bytes",
        )
        .unwrap();
        fs::write(root.join("storage/notes.csv"), b"a,b\n").unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        // the probe now offers edit mode, the in-place save lands, the pre-rotli
        // bytes survive as a one-time .bak
        assert!(
            store
                .file_stat("storage/samples/company-overview.xlsx")
                .unwrap()
                .writable
        );
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
        assert!(store
            .write_file_bytes("storage/nope.xlsx", b"x", false)
            .is_err());
        assert!(store.new_file_bytes("storage", "fresh.xlsx", b"x").is_err());

        // a read-only-connected brain closes even the storage-sheet lane — the
        // exception must yield to perms, exactly like writable() does
        store.set_perms_read_only(true);
        assert!(!store.file_stat("storage/notes.csv").unwrap().writable);
        assert!(store
            .write_file_bytes("storage/notes.csv", b"x,y\n", false)
            .is_err());
    }

    #[test]
    fn new_file_bytes_is_collision_safe() {
        let (_dir, mut store) = bare();
        let a = store
            .new_file_bytes("Storage", "sheet.xlsx", b"one")
            .unwrap();
        assert_eq!(a, "Storage/sheet.xlsx");
        let b = store
            .new_file_bytes("Storage", "sheet.xlsx", b"two")
            .unwrap();
        assert_eq!(b, "Storage/sheet-2.xlsx");
        assert_eq!(fs::read(store.root().join(&a)).unwrap(), b"one");
        assert_eq!(fs::read(store.root().join(&b)).unwrap(), b"two");
        // stat sees a legacy corpus as writable
        assert!(store.file_stat(&a).unwrap().writable);
    }

    #[test]
    fn managed_office_files_use_an_owned_memex_lane_and_respect_read_only() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let doc = store.create_managed_file("untitled.docx", b"docx").unwrap();
        let sheet = store.create_managed_file("untitled.xlsx", b"xlsx").unwrap();
        assert_eq!(doc, "storage/rotli/untitled.docx");
        assert_eq!(sheet, "storage/rotli/untitled.xlsx");
        assert_eq!(fs::read(root.join(&doc)).unwrap(), b"docx");
        let listed = store.list().unwrap();
        assert!(listed
            .notes
            .iter()
            .any(|note| note.id == doc && note.kind == NoteKind::File));
        assert!(listed
            .notes
            .iter()
            .any(|note| note.id == sheet && note.kind == NoteKind::File));
        assert!(store.create_managed_file("script.sh", b"nope").is_err());
        assert!(store.managed_file_creation_available());

        store.set_perms_read_only(true);
        assert!(!store.managed_file_creation_available());
        assert!(store.create_managed_file("blocked.docx", b"nope").is_err());
        assert!(!root.join("storage/rotli/blocked.docx").exists());
    }

    #[test]
    fn storage_files_move_to_memex_sinks_and_restore_only_when_mutable() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let doc = store.create_managed_file("draft.docx", b"docx").unwrap();
        let stat = store.file_stat(&doc).unwrap();
        assert!(
            stat.writable,
            "DOCX files open in Rotli's local document editor"
        );
        assert!(
            stat.lifecycle_mutable,
            "managed files still need a lifecycle action"
        );
        let trashed = store.move_file_to_sink(&doc, "Trash").unwrap();
        assert!(!root.join(&doc).exists());
        assert_eq!(trashed, "trash/storage/rotli/draft.docx");
        assert!(root.join(&trashed).is_file());
        let listed = store.list().unwrap();
        assert!(
            listed.notes.iter().any(|note| {
                note.id == trashed
                    && note.folder_id == "Trash/storage/rotli"
                    && note.kind == NoteKind::File
            }),
            "trashed file was not surfaced: {:?}",
            listed.notes
        );
        assert_eq!(store.restore_file(&trashed).unwrap(), doc);
        assert!(root.join(&doc).is_file());

        let archived = store.move_file_to_sink(&doc, "Archive").unwrap();
        assert_eq!(archived, "archive/storage/rotli/draft.docx");
        assert_eq!(store.restore_file(&archived).unwrap(), doc);

        // the FILE lifecycle stays a storage-lane affair even though wiki/ is a
        // writable NOTE lane (2026-08-03): a binary parked in wiki/ is outside
        // Rotli storage, so the sink move still refuses it.
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(root.join("wiki/projects/reference.pdf"), b"keep").unwrap();
        assert!(store
            .move_file_to_sink("wiki/projects/reference.pdf", "Trash")
            .is_err());
        assert!(root.join("wiki/projects/reference.pdf").is_file());
        assert!(store.move_file_to_sink(&doc, "Somewhere").is_err());
    }

    #[test]
    fn file_stat_names_why_a_file_cannot_enter_archive_or_trash() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        let doc = store.create_managed_file("reasons.docx", b"docx").unwrap();
        assert_eq!(store.file_stat(&doc).unwrap().lifecycle_reason, None);
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(root.join("wiki/projects/reference.pdf"), b"keep").unwrap();
        let outside = store.file_stat("wiki/projects/reference.pdf").unwrap();
        assert!(!outside.lifecycle_mutable);
        assert_eq!(outside.lifecycle_reason.as_deref(), Some("outside Rotli storage"));
        store.set_perms_read_only(true);
        let locked = store.file_stat(&doc).unwrap();
        assert!(!locked.lifecycle_mutable);
        assert_eq!(locked.lifecycle_reason.as_deref(), Some("read-only vault"));
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

    #[test]
    fn chat_image_asset_rejects_mislabeled_bytes_before_writing() {
        let (_dir, mut store) = bare();
        assert!(store
            .create_image_asset("not-an-image.png", b"ordinary text")
            .is_err());
        assert!(!store.root().join("Storage/not-an-image.png").exists());

        let id = store
            .create_image_asset("pixel.png", b"\x89PNG\r\n\x1a\nminimal-test-payload")
            .unwrap();
        assert_eq!(id, "Storage/pixel.png");
        assert_eq!(
            fs::read(store.root().join(id)).unwrap(),
            b"\x89PNG\r\n\x1a\nminimal-test-payload"
        );
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
        assert!(
            !out.contains("origin:"),
            "absent origin must not be emitted:\n{out}"
        );
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
            vec![
                "tags: [alpha, beta]",
                "meta:",
                "  source: web",
                "# a comment"
            ]
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
        store
            .set_pinned("01TESTID000000000000ABCDEF", true)
            .unwrap();
        let meta = store
            .write("01TESTID000000000000ABCDEF", "# Kept\n\nEdited.\n")
            .unwrap();
        assert!(meta.pinned, "body save must preserve the on-disk pin");
        let on_disk = fs::read_to_string(
            store
                .root()
                .join(store.index.get("01TESTID000000000000ABCDEF").unwrap()),
        )
        .unwrap();
        assert!(
            on_disk.contains("aliases: [old-name]"),
            "foreign key destroyed:\n{on_disk}"
        );
        assert!(
            on_disk.contains("created: 2026-06-01T00:00:00Z"),
            "created not preserved"
        );
        assert!(on_disk.contains("pinned: true"));
        assert!(on_disk.ends_with("# Kept\n\nEdited.\n"));
    }

    // ── raw frontmatter (the "Show file metadata" editor) ──

    #[test]
    fn raw_frontmatter_round_trips_verbatim() {
        // hand-formatted lines (odd spacing, nested yaml, a comment) survive a
        // read → write of the SAME block byte-for-byte — nothing reformats
        let text = "---\nid:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: fixture\ntags: [a,  b]\nmeta:\n  source: web\n# a comment\n---\n\n# A note\n\nBody stays byte-exact.\n";
        let block = raw_frontmatter_block(text);
        assert_eq!(block, "---\nid:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: fixture\ntags: [a,  b]\nmeta:\n  source: web\n# a comment\n---\n");
        assert_eq!(merge_raw_frontmatter(text, block).unwrap(), text);
        // no frontmatter → empty block; an empty submission leaves the file alone
        assert_eq!(raw_frontmatter_block("# Bare\n"), "");
        assert_eq!(merge_raw_frontmatter("# Bare\n", "").unwrap(), "# Bare\n");
        // a trailing-newline / bare (fence-less) submission lands identically
        let bare = "id:  01RAW0000000000000000000A\ncreated: 2026-06-12T10:00:00Z\nowner: fixture\ntags: [a,  b]\nmeta:\n  source: web\n# a comment";
        assert_eq!(merge_raw_frontmatter(text, bare).unwrap(), text);
    }

    #[test]
    fn raw_frontmatter_restores_reserved_keeps_typed() {
        let text = "---\nid: 01RAW0000000000000000000B\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T11:00:00Z\npinned: false\nowner: breve\nview_tag: OpenSource\nshelf: Inbox\n---\n\nBody.\n";
        // the user retypes the id, drops created + owner, flips pinned, adds
        // locked/secure/tags — provenance comes back, everything else as typed
        let submitted = "---\nid: HACKED\npinned: true\nlocked: true\nsecure: true\nview_tag: Northstar\ntags: [x]\nshelf: Projects\n---\n";
        let out = merge_raw_frontmatter(text, submitted).unwrap();
        let (fm, body) = parse_document(&out);
        let fm = fm.unwrap();
        assert_eq!(body, "\nBody.\n", "body must be byte-exact from disk");
        assert_eq!(
            fm.id.as_deref(),
            Some("01RAW0000000000000000000B"),
            "id restored"
        );
        assert_eq!(
            fm.created.as_deref(),
            Some("2026-06-12T10:00:00Z"),
            "created restored"
        );
        assert!(
            out.contains("owner: breve"),
            "dropped owner restored:\n{out}"
        );
        assert!(out.contains("view_tag: OpenSource") && !out.contains("view_tag: Northstar"));
        assert_eq!(fm.pinned, Some(true), "pinned lands as typed");
        assert!(out.contains("locked: true") && out.contains("secure: true"));
        assert!(out.contains("shelf: Projects") && !out.contains("shelf: Inbox"));
        // updated was dropped by the user — NOT restored (only id/owner/created are)
        assert!(!out.contains("updated:"));

        // a user can't MINT provenance: an invented owner on a note without one goes
        let plain = "---\nid: C\ncreated: 2026-06-12T10:00:00Z\nupdated: 2026-06-12T10:00:00Z\npinned: false\n---\n\nP.\n";
        let out = merge_raw_frontmatter(
            plain,
            "---\nid: C\ncreated: 2026-06-12T10:00:00Z\nowner: me\n---\n",
        )
        .unwrap();
        assert!(
            !out.contains("owner:"),
            "invented owner must be dropped:\n{out}"
        );

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
        assert_eq!(
            fs::read_to_string(store.root().join(&rel)).unwrap(),
            original
        );
        store
            .write_frontmatter_raw(
                id,
                "---\nid: FORGED\ncreated: yesterday\ntags: [kept]\n---\n",
            )
            .unwrap();
        let on_disk = fs::read_to_string(store.root().join(&rel)).unwrap();
        assert!(
            on_disk.contains("id: 01RAWSTORE000000000000000A"),
            "id restored:\n{on_disk}"
        );
        assert!(
            on_disk.contains("created: 2026-06-01T00:00:00Z"),
            "created restored"
        );
        assert!(on_disk.contains("tags: [kept]"), "typed key lands");
        assert!(
            on_disk.ends_with("\n# Raw\n\nBody.\n"),
            "body byte-exact:\n{on_disk}"
        );

        // Memex: wiki + chats both accept (the USER gate — same as every save;
        // wiki writable since 2026-08-03), Reference/Hidden lanes still refuse
        let dir = TempDir::new().unwrap();
        let brain = dir.path().join("brain");
        seed_memex(&brain);
        let mut mx = CorpusStore::open(brain).unwrap();
        mx.os_trash = false;
        mx.write_frontmatter_raw("wiki/note.md", "---\ntags: [x]\n---\n")
            .unwrap();
        assert_eq!(
            mx.raw_frontmatter("wiki/note.md").unwrap(),
            "---\ntags: [x]\n---\n"
        );
        mx.write_frontmatter_raw("chats/welcome.md", "---\ntags: [x]\n---\n")
            .unwrap();
        assert_eq!(
            mx.raw_frontmatter("chats/welcome.md").unwrap(),
            "---\ntags: [x]\n---\n"
        );
        assert!(mx
            .write_frontmatter_raw("MAP.md", "---\ntags: [x]\n---\n")
            .is_err());
    }

    #[test]
    fn stale_raw_metadata_never_erases_newer_vault_or_librarian_fields() {
        let (_dir, mut store) = fresh();
        let note = store.create("Inbox", "# Metadata race\n").unwrap();
        let opened = store.raw_frontmatter_versioned(&note.id).unwrap();

        store.set_field(&note.id, "project", "Rotli").unwrap();
        let error = store
            .write_frontmatter_raw_if_revision(&note.id, &opened.contents, &opened.revision)
            .unwrap_err();
        assert!(error.contains("revision conflict"), "{error}");
        assert!(store
            .raw_frontmatter(&note.id)
            .unwrap()
            .contains("project: Rotli"));
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
        assert!(
            out.contains("\n  created: 2020-01-01\n"),
            "nested created kept:\n{out}"
        );
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
        assert!(
            ignored.lines().any(|l| l.trim() == rel),
            "secure via raw lane must gitignore: {ignored:?}"
        );
        // clearing it un-ignores (the set_secure symmetry)
        store.write_frontmatter_raw(id, "---\n---\n").unwrap();
        let ignored = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(
            !ignored.lines().any(|l| l.trim() == rel),
            "cleared secure must un-ignore: {ignored:?}"
        );
        assert!(!fs::read_to_string(root.join(&rel))
            .unwrap()
            .contains("secure:"));
    }

    #[test]
    fn resolve_note_rel_refuses_traversal() {
        // the passthrough fronts WRITE lanes (write_frontmatter_raw/set_field)
        // and LegacyRotli's writable() allows everything — a "../…" that
        // resolves to a real file outside the root must fail, not write
        let (dir, mut store) = bare();
        fs::write(dir.path().join("outside.md"), "---\n---\nX\n").unwrap();
        assert!(
            store.abs("../outside.md").is_file(),
            "test setup: the escape target exists"
        );
        assert!(store.resolve_note_rel("../outside.md").is_err());
        assert!(store
            .write_frontmatter_raw("../outside.md", "---\npwn: true\n---\n")
            .is_err());
        assert!(!fs::read_to_string(dir.path().join("outside.md"))
            .unwrap()
            .contains("pwn"));
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
        fs::write(
            root.join("Work/no frontmatter.md"),
            "# Dropped in\n\nFrom outside.\n",
        )
        .unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.notes.len(), 2);
        assert!(list
            .notes
            .iter()
            .any(|n| n.id == "01HASID0000000000000ABCDEF"));
        let minted = list
            .notes
            .iter()
            .find(|n| n.title == "Dropped in")
            .unwrap()
            .id
            .clone();

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
        assert!(list3
            .notes
            .iter()
            .any(|n| n.id == "01HASID0000000000000ABCDEF"));
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
        let deep = list
            .folders
            .iter()
            .find(|f| f.id == "Imported/Deep")
            .unwrap();
        assert_eq!(deep.parent_id.as_deref(), Some("Imported"));
        assert!(list.notes.iter().any(|n| n.folder_id == "Imported/Deep"));
    }

    // ── slugs, filenames, renames ──

    #[test]
    fn slugging_and_collisions() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("  ⌥Space — the way in  "), "space-the-way-in");
        assert_eq!(slugify("Café résumé"), "café-résumé");
        assert_eq!(slugify("###"), "untitled");
        assert_eq!(title_of("\n\n## **Bold** _title_\nrest"), "Bold title");
        assert_eq!(title_of("- [x] ship it\n"), "ship it");
        // an in-progress task titles by its words too, not "[/] draft…"
        assert_eq!(title_of("- [/] draft the memo\n"), "draft the memo");
        assert_eq!(title_of("- [ ][x] API fails\n"), "API fails");
        assert_eq!(title_of("- [x][ ] API passes\n"), "API passes");
        assert_eq!(title_of("- (x) Blue\n"), "Blue");
        assert_eq!(
            title_of("Preface\n## Section\n# Canonical title\nBody"),
            "Canonical title"
        );

        let (_dir, mut store) = bare();
        let a = store.create("", "# Same title\n").unwrap();
        let b = store.create("", "# Same title\n").unwrap();
        let pa = store.index.get(&a.id).unwrap().clone();
        let pb = store.index.get(&b.id).unwrap().clone();
        assert_ne!(pa, pb, "same-title notes must get distinct filenames");
        assert_eq!(pa, "same-title.md");
        assert_eq!(pb, "same-title (2).md");
    }

    #[test]
    fn legacy_id_tailed_filename_is_a_human_alias_without_rewriting_the_file() {
        let (_dir, mut store) = bare();
        fs::create_dir_all(store.root().join("Notes")).unwrap();
        let rel = "Notes/northstar-stage-plan-abc123.md";
        fs::write(
            store.root().join(rel),
            "---\nid: 01LEGACYABC123\ncreated: 2026-07-01\nupdated: 2026-07-01\npinned: false\n---\n\n# The 3-stage infrastructure plan\n",
        )
        .unwrap();

        let note = store
            .list()
            .unwrap()
            .notes
            .into_iter()
            .find(|note| note.id == "01LEGACYABC123")
            .unwrap();
        assert!(note
            .aliases
            .iter()
            .any(|alias| alias == "northstar-stage-plan"));
        assert!(note
            .aliases
            .iter()
            .any(|alias| alias == "the-3-stage-infrastructure-plan"));
        assert_eq!(
            store
                .search("northstar-stage-plan", 10, false)
                .unwrap()
                .len(),
            1
        );
        assert!(
            store.root().join(rel).is_file(),
            "listing must remain read-only"
        );
    }

    #[test]
    fn deliberate_legacy_filename_repair_keeps_the_exact_old_stem() {
        let (_dir, mut store) = bare();
        fs::create_dir_all(store.root().join("Notes")).unwrap();
        let rel = "Notes/northstar-stage-plan-abc123.md";
        fs::write(
            store.root().join(rel),
            "---\nid: 01LEGACYABC123\ncreated: 2026-07-01\nupdated: 2026-07-01\npinned: false\naliases: [kept]\n---\n\n# The 3-stage infrastructure plan\n",
        )
        .unwrap();
        store.list().unwrap();

        store
            .write(
                "01LEGACYABC123",
                "# The 3-stage infrastructure plan\n\nEdited deliberately.\n",
            )
            .unwrap();

        let repaired = store
            .root()
            .join("Notes/the-3-stage-infrastructure-plan.md");
        assert!(repaired.is_file());
        assert!(!store.root().join(rel).exists());
        let text = fs::read_to_string(repaired).unwrap();
        assert!(text.contains(
            "aliases: [\"kept\",\"northstar-stage-plan-abc123\",\"northstar-stage-plan\"]"
        ));
        assert!(!text.contains("\"The 3-stage infrastructure plan\""));
    }

    #[test]
    fn strip_markdown_reduces_images_and_links() {
        // raw image markdown never reads as a title (the "images in All notes" leak)
        assert_eq!(title_of("![photo](storage:abc.png)\nrest"), "photo");
        assert_eq!(title_of("![](storage:abc.png)\nrest"), "Image");
        assert_eq!(title_of("[the doc](https://x.y/z)"), "the doc");
        assert_eq!(
            snippet_of("# T\nsee ![chart](a.png) and [spec](b)"),
            "see chart and spec"
        );
        // malformed spans pass through untouched
        assert_eq!(title_of("[not a link] (gap)"), "[not a link] (gap)");
        assert_eq!(title_of("![dangling](no close"), "![dangling](no close");
    }

    // ── full-text search (corpus_search) — the pure grammar + the store pass ──

    #[test]
    fn store_search_covers_bodies_ranks_titles_first_and_skips_trash() {
        let (_dir, mut store) = bare();
        let a = store
            .create("Inbox", "# Wire limit\n\nCall the bank about the cap.\n")
            .unwrap();
        let b = store
            .create(
                "Notes",
                "# Meeting prep\n\nRaise the wire limit question with finance.\n",
            )
            .unwrap();
        let c = store
            .create("Inbox", "# Old wire limit note\n\ndead\n")
            .unwrap();
        store.move_note(&c.id, "Trash").unwrap();

        let hits = store.search("wire limit", 50, false).unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert!(ids.contains(&a.id.as_str()), "title hit found");
        assert!(
            ids.contains(&b.id.as_str()),
            "BODY hit found — full-text works"
        );
        assert!(
            !ids.contains(&c.id.as_str()),
            "Trash never surfaces in search"
        );
        // title hit outranks the body hit
        assert_eq!(hits[0].id, a.id);
        assert_eq!(hits[0].rank, 0);
        let body_hit = hits.iter().find(|h| h.id == b.id).unwrap();
        assert_eq!(body_hit.rank, crate::search_match::RANK_BODY);
        assert!(body_hit.snippet.contains("wire limit"));
        // blank query is empty, never everything
        assert!(store.search("  ", 50, false).unwrap().is_empty());
    }

    #[test]
    fn store_search_index_reflects_edits_incrementally() {
        // the store's Tantivy lane rides the corpus generation: an edit bumps it,
        // the next search re-syncs only the changed doc, the old term is gone, and
        // a move to Trash drops the note from search — all through store.search,
        // never touching the substring fallback.
        let (_dir, mut store) = bare();
        let n = store
            .create("Inbox", "# Notes\n\nthe kelpie surfaced at dawn\n")
            .unwrap();
        assert_eq!(
            store.search("kelpie", 50, false).unwrap().len(),
            1,
            "indexed on first search"
        );

        store
            .write(&n.id, "# Notes\n\nthe selkie surfaced at dawn\n")
            .unwrap();
        assert!(
            store.search("kelpie", 50, false).unwrap().is_empty(),
            "edited-away term gone"
        );
        let hits = store.search("selkie", 50, false).unwrap();
        assert_eq!(hits.len(), 1, "the new term is found");
        assert_eq!(hits[0].id, n.id);

        store.move_note(&n.id, "Trash").unwrap();
        assert!(
            store.search("selkie", 50, false).unwrap().is_empty(),
            "trashed note leaves search"
        );
    }

    #[test]
    fn store_search_index_membership_is_a_superset_of_the_substring_lane() {
        // The substring lane is the correctness ORACLE: the Tantivy membership set
        // must never be SMALLER than it (verifier 2026-08-01, the infix regression).
        // This diffs the two lanes over the mid-word cases prefix matching used to
        // drop, plus multi-word and whole-word queries, and asserts index ⊇ substring.
        let (_dir, mut store) = bare();
        store
            .create(
                "Inbox",
                "# Router\n\nsteps to reconfigure the router later\n",
            )
            .unwrap();
        store
            .create("Notes", "# Session\n\nhow to reauthenticate the session\n")
            .unwrap();
        store
            .create(
                "Inbox",
                "# Carbon\n\nreduce the carbon footprint this year\n",
            )
            .unwrap();
        store
            .create("Notes", "# Garden\n\nunrelated notes about gardens\n")
            .unwrap();
        for q in [
            "config",
            "auth",
            "print",
            "reconfigure",
            "footprint",
            "the router",
            "session",
        ] {
            let idx: std::collections::HashSet<String> = store
                .search(q, 200, true)
                .unwrap()
                .into_iter()
                .map(|h| h.id)
                .collect();
            let sub: std::collections::HashSet<String> = store
                .search_substring(q, 200, true)
                .unwrap()
                .into_iter()
                .map(|h| h.id)
                .collect();
            assert!(
                sub.is_subset(&idx),
                "index lost recall for {q:?}: substring={sub:?} index={idx:?}"
            );
            // and the infix cases prove the lanes AGREE here, not just that idx is bigger
            if matches!(q, "config" | "auth" | "print") {
                assert!(!sub.is_empty(), "oracle setup: {q:?} must match mid-word");
            }
        }
    }

    #[test]
    fn plain_root_search_covers_a_user_folder_named_chats() {
        // LegacyRotli has no Chat front — a folder literally named "chats" is
        // just a folder, and its notes MUST stay findable (only a memex root's
        // chats/ transcripts are excluded).
        let (_dir, mut store) = bare();
        let n = store
            .create("chats", "# Chat ideas\n\nthe kelpie fragment\n")
            .unwrap();
        let hits = store.search("kelpie", 50, false).unwrap();
        assert_eq!(
            hits.len(),
            1,
            "plain-root chats/ note is searchable: {hits:?}"
        );
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
        fs::write(
            root.join("chats/k.md"),
            "# Chat\n\nthe kelpie fragment too\n",
        )
        .unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;

        // the staged note (projected to "Board") hits; the chat transcript never does
        let hits = store.search("kelpie", 50, false).unwrap();
        assert_eq!(hits.len(), 1, "staged yes, chats no: {hits:?}");
        assert_eq!(hits[0].folder_id, "Board");
        // curated wiki bodies stay findable (read-only ≠ unsearchable)
        assert!(!store.search("A wiki note", 50, false).unwrap().is_empty());
    }

    #[test]
    fn search_uses_clean_brain_metadata_keywords() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(
            root.join("wiki/projects/launch.md"),
            "---\nid: 01SEARCHMETA00000000000000\ntags: [cedar, launch]\nprivate_nested: cedar-hidden\n---\n# Launch\n\nOrdinary body.\n",
        )
        .unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        let hits = store.search("cedar", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("tags"));
        assert!(store.search("cedar-hidden", 10, false).unwrap().is_empty());
    }

    #[test]
    fn title_change_renames_through_the_index() {
        let (_dir, mut store) = bare();
        let meta = store.create("Notes", "# First title\n\nBody.\n").unwrap();
        let before = store.index.get(&meta.id).unwrap().clone();
        assert!(before.ends_with("first-title.md"));

        store.write(&meta.id, "# Second title\n\nBody.\n").unwrap();
        let after = store.index.get(&meta.id).unwrap().clone();
        assert!(
            after.ends_with("second-title.md"),
            "file not renamed: {after}"
        );
        assert!(!store.root().join(&before).exists(), "old file left behind");
        assert!(store.root().join(&after).is_file());
        let on_disk = fs::read_to_string(store.root().join(&after)).unwrap();
        assert!(on_disk.contains("aliases: [\"First title\",\"first-title\"]"));

        // id↔path index stays authoritative: read by the same id still works
        let doc = store.read(&meta.id).unwrap();
        assert_eq!(doc.body, "# Second title\n\nBody.\n");
    }

    #[test]
    fn stale_editor_write_must_not_overwrite_an_external_edit() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = CorpusStore::open(dir.path().to_path_buf()).unwrap();
        let note = store.create("Inbox", "# Original\n\nfirst").unwrap();
        let opened = store.read(&note.id).unwrap();
        let rel = store.path_of(&note.id).unwrap();

        fs::write(
            store.root().join(&rel),
            "---\nid: 01EXTERNAL\n---\n\n# External\n\nnewer",
        )
        .unwrap();

        let result = store.write_if_revision_with_body_base(
            &note.id,
            &format!("{}\n\nlocal", opened.body),
            &opened.revision,
            Some(&opened.body),
        );
        assert!(
            result.is_err(),
            "a stale editor save must report a conflict"
        );
        let current = fs::read_to_string(store.root().join(&rel)).unwrap();
        assert!(current.contains("# External\n\nnewer"));
    }

    #[test]
    fn stale_complete_revision_merges_when_only_rotli_metadata_changed() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = CorpusStore::open(dir.path().to_path_buf()).unwrap();
        let note = store.create("Inbox", "# Original\n\nfirst").unwrap();
        let opened = store.read(&note.id).unwrap();

        // A pin is representative of the Librarian's metadata/location work:
        // complete-file bytes and revision move, editor prose does not.
        store.set_pinned(&note.id, true).unwrap();
        let after_metadata = store.read(&note.id).unwrap();
        assert_ne!(after_metadata.revision, opened.revision);
        assert_eq!(after_metadata.body, opened.body);

        let result = store
            .write_if_revision_with_body_base(
                &note.id,
                "# Original\n\nlocal edit",
                &opened.revision,
                Some(&opened.body),
            )
            .unwrap();

        assert_eq!(
            store.read(&note.id).unwrap().body,
            "# Original\n\nlocal edit"
        );
        assert!(
            result.meta.pinned,
            "the newer metadata must survive the body save"
        );
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
        let meta = store
            .create("Inbox", "# Groceries\n\nOlive oil, sourdough.\n")
            .unwrap();
        assert_eq!(meta.title, "Groceries");
        assert_eq!(meta.snippet, "Olive oil, sourdough.");
        assert!(!meta.pinned);

        let doc = store.read(&meta.id).unwrap();
        assert_eq!(doc.body, "# Groceries\n\nOlive oil, sourdough.\n");
        assert_eq!(doc.folder_id, "Inbox");
        assert_eq!(doc.created_at, meta.created_at);

        // pin through the real pin path, then confirm a body save PRESERVES it
        // (write() carries pinned through from disk — the race-fix contract).
        store.set_pinned(&meta.id, true).unwrap();
        let updated = store
            .write(&meta.id, "# Groceries\n\nOlive oil, the good butter.\n")
            .unwrap();
        assert!(updated.pinned, "body save must preserve the on-disk pin");
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
        assert!(
            doc.folder_id.starts_with("Trash"),
            "soft-deleted note must live under Trash, got {}",
            doc.folder_id
        );
        assert_eq!(
            doc.origin.as_deref(),
            Some("Inbox"),
            "origin must remember where it came from"
        );
        assert!(
            doc.body.contains("the good butter"),
            "body survives the move"
        );
        // still surfaced by the raw walk — but under Trash, so the TS "normal"
        // view (isHidden) filters it out. The corpus never loses it.
        let list = store.list().unwrap();
        let still = list.notes.iter().find(|n| n.id == meta.id).unwrap();
        assert!(
            still.folder_id.starts_with("Trash"),
            "still in the corpus, just under Trash"
        );
        // the file truly lives on disk under Trash/ (never the OS trash / .rotli)
        let rel = store.index.get(&meta.id).unwrap();
        assert!(
            rel.starts_with("Trash/"),
            "physical path under Trash: {rel}"
        );
        assert!(store.root().join(rel).is_file());
    }

    // ── boards (Excalidraw): a parallel, path-as-id, frontmatter-free surface ──

    #[test]
    fn board_create_list_read_write_cycle() {
        let (_dir, mut store) = bare();

        // create defaults to an empty scene, lands in the requested folder,
        // id == its relative path, kind == Board.
        let meta = store
            .create_named_board("Inbox/excalidraw", "untitled", None)
            .unwrap();
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
        assert!(
            !store.index.contains_key(&meta.id),
            "boards must bypass the ulid index"
        );

        // read returns the raw JSON body (the empty-scene default)
        let doc = store.read_board(&meta.id).unwrap();
        assert_eq!(doc.id, meta.id);
        assert_eq!(doc.folder_id, "Inbox/excalidraw");
        assert!(
            doc.body.contains("\"type\":\"excalidraw\""),
            "default scene JSON: {}",
            doc.body
        );

        // write round-trips the raw scene verbatim (no frontmatter added)
        let scene = "{\"type\":\"excalidraw\",\"version\":2,\"source\":\"rotli\",\"elements\":[{\"id\":\"a\"}],\"appState\":{},\"files\":{}}";
        let w = store.write_board(&meta.id, scene).unwrap();
        assert_eq!(w.kind, NoteKind::Board);
        let on_disk = fs::read_to_string(store.root().join(&meta.id)).unwrap();
        assert_eq!(
            on_disk, scene,
            "board JSON must persist byte-exact, no frontmatter"
        );
        let doc = store.read_board(&meta.id).unwrap();
        assert!(
            doc.body.contains("\"id\":\"a\""),
            "round-tripped element survives"
        );

        // a second board in the same folder gets a collision-safe name
        let meta2 = store
            .create_named_board("Inbox/excalidraw", "untitled", None)
            .unwrap();
        assert_eq!(meta2.id, "Inbox/excalidraw/untitled-2.excalidraw");
    }

    #[test]
    fn named_board_is_created_without_an_untitled_placeholder() {
        let (_dir, mut store) = bare();

        let meta = store
            .create_named_board("Inbox/excalidraw", "Project/Map", None)
            .unwrap();
        assert_eq!(meta.id, "Inbox/excalidraw/Project-Map.excalidraw");
        assert_eq!(meta.title, "Project-Map");
        assert!(!store
            .root()
            .join("Inbox/excalidraw/untitled.excalidraw")
            .exists());

        let second = store
            .create_named_board("Inbox/excalidraw", "Project/Map", None)
            .unwrap();
        assert_eq!(second.id, "Inbox/excalidraw/Project-Map-2.excalidraw");
        assert!(store
            .create_named_board("Inbox/excalidraw", "   ", None)
            .is_err());
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
        let board = list
            .notes
            .iter()
            .find(|n| n.id == "Notes/sketch.excalidraw")
            .unwrap();
        assert_eq!(board.kind, NoteKind::Board);
        assert_eq!(board.title, "sketch");
        assert_eq!(board.folder_id, "Notes");
        assert!(!store.index.contains_key("Notes/sketch.excalidraw"));
    }

    #[test]
    fn rename_board_moves_the_file_and_returns_new_id() {
        let (_dir, mut store) = bare();
        let created = store
            .create_named_board("Inbox/excalidraw", "untitled", None)
            .unwrap();
        assert_eq!(created.id, "Inbox/excalidraw/untitled.excalidraw");

        // rename within the folder: id becomes the new relpath, kind stays Board
        let renamed = store.rename_board(&created.id, "My Sketch").unwrap();
        assert_eq!(renamed.id, "Inbox/excalidraw/My Sketch.excalidraw");
        assert_eq!(renamed.kind, NoteKind::Board);
        assert_eq!(renamed.folder_id, "Inbox/excalidraw");
        assert!(!store.root().join(&created.id).exists(), "old file is gone");
        assert!(
            store.root().join(&renamed.id).exists(),
            "new file is present"
        );

        // path separators in a name are flattened to '-'; empty names refused
        let flat = store.rename_board(&renamed.id, "a/b").unwrap();
        assert_eq!(flat.id, "Inbox/excalidraw/a-b.excalidraw");
        assert!(
            store.rename_board(&flat.id, "   ").is_err(),
            "empty name refused"
        );
        // a non-board id is refused
        assert!(store.rename_board("Inbox/note", "x").is_err());
    }

    #[test]
    fn read_board_rejects_non_board_and_escape() {
        let (_dir, mut store) = bare();
        assert!(
            store.read_board("Inbox/note.md").is_err(),
            "must reject non-.excalidraw"
        );
        assert!(
            store.read_board("../escape.excalidraw").is_err(),
            "must reject path escape"
        );
        assert!(
            store.read_board("Nope/missing.excalidraw").is_err(),
            "missing file errors"
        );
    }

    // ── the never-delete lifecycle: move · archive · restore ──

    #[test]
    fn move_into_archive_stamps_origin_then_restore_clears_it() {
        let (_dir, mut store) = bare();
        let meta = store
            .create("Brain", "# A thought\n\nKeep this.\n")
            .unwrap();
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
        assert!(
            on_disk.contains("origin: Brain"),
            "origin not persisted:\n{on_disk}"
        );

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
        assert!(
            !on_disk.contains("origin:"),
            "origin should be gone after restore:\n{on_disk}"
        );
    }

    #[test]
    fn purge_is_the_only_hard_delete() {
        let (_dir, mut store) = bare();
        let meta = store.create("Inbox", "# Throwaway\n").unwrap();
        // soft-delete first (into Trash), then purge it for real
        store.delete(&meta.id).unwrap();
        assert!(
            store.read(&meta.id).is_ok(),
            "still in the corpus after soft delete"
        );
        store.purge(&meta.id).unwrap();
        assert!(
            store.read(&meta.id).is_err(),
            "purge removes it from the corpus"
        );
        assert!(store.list().unwrap().notes.iter().all(|n| n.id != meta.id));
        // never a TRUE hard delete in tests: it landed in .rotli/trash/
        let trashed: Vec<_> = fs::read_dir(store.root().join(DOT_DIR).join("trash"))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(trashed.len(), 1);
    }

    #[test]
    fn purge_deletes_path_id_files_in_trash() {
        // Empty Trash regression (2026-07-31 "Emptied 0 of 35"): boards/files
        // are path-id'd and never enter the ULID index — purge must accept
        // a rel like trash/storage/rotli/x.xlsx, not just note ULIDs.
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let doc = store.create_managed_file("stale.xlsx", b"xlsx").unwrap();
        let trashed = store.move_file_to_sink(&doc, "Trash").unwrap();
        assert_eq!(trashed, "trash/storage/rotli/stale.xlsx");

        store.purge(&trashed).unwrap();
        assert!(
            !root.join(&trashed).exists(),
            "purge removes the file from trash/"
        );
        assert!(store.list().unwrap().notes.iter().all(|n| n.id != trashed));
    }

    #[test]
    fn journal_prune_keeps_pending_and_recent_drops_old_resolved() {
        let (_dir, store) = bare();
        let now = (OffsetDateTime::now_utc().unix_timestamp()) * 1000;
        let old = now - 90 * 86_400_000; // ~90 days ago
                                         // pending-old: latest status "proposed" → survives ANY prune.
                                         // resolved-old: proposed→applied long ago → dropped (both lines).
                                         // resolved-new: applied yesterday → survives a 30-day prune.
        for line in [
            format!(r#"{{"id":"pend","ts":{old},"status":"proposed"}}"#),
            format!(r#"{{"id":"oldr","ts":{old},"status":"proposed"}}"#),
            format!(r#"{{"id":"oldr","ts":{old},"status":"applied"}}"#),
            format!(
                r#"{{"id":"newr","ts":{},"status":"applied"}}"#,
                now - 86_400_000
            ),
        ] {
            store.journal_append(&line).unwrap();
        }
        let removed = store.journal_prune(30).unwrap();
        assert_eq!(removed, 2, "both lines of the old resolved id go");
        let kept = store.journal_read().unwrap();
        assert!(
            kept.contains(r#""id":"pend""#),
            "pending is sacred:\n{kept}"
        );
        assert!(
            kept.contains(r#""id":"newr""#),
            "recent resolved stays:\n{kept}"
        );
        assert!(
            !kept.contains(r#""id":"oldr""#),
            "old resolved is gone:\n{kept}"
        );
        // keep_days = 0 clears ALL resolved history, pending still survives
        store.journal_prune(0).unwrap();
        let kept = store.journal_read().unwrap();
        assert!(kept.contains(r#""id":"pend""#));
        assert!(!kept.contains(r#""id":"newr""#));
        // idempotent: nothing left to remove
        assert_eq!(store.journal_prune(0).unwrap(), 0);
    }

    #[test]
    fn discard_blank_removes_only_truly_blank_notes_and_skips_the_trash_folder() {
        let (_dir, mut store) = bare();

        // a blank note discards for real — no Trash-folder detour
        let blank = store.create("Inbox", "").unwrap();
        assert!(blank.body_empty, "wire metadata marks a true blank exactly");
        store.discard_blank(&blank.id).unwrap();
        assert!(
            store.read(&blank.id).is_err(),
            "blank note must leave the corpus"
        );
        assert!(
            store
                .list()
                .unwrap()
                .notes
                .iter()
                .all(|n| n.folder_id != "Trash"),
            "discard must never route through the in-app Trash folder"
        );
        // recoverable: it landed in .rotli/trash (the test-path fallback)
        assert!(
            fs::read_dir(store.root().join(DOT_DIR).join("trash"))
                .unwrap()
                .count()
                >= 1
        );

        // whitespace-only still counts as blank
        let spaces = store.create("Inbox", "  \n\n  ").unwrap();
        assert!(spaces.body_empty);
        store.discard_blank(&spaces.id).unwrap();
        assert!(store.read(&spaces.id).is_err());

        // ANY content refuses — the exposed command cannot destroy prose
        let kept = store.create("Inbox", "# Real note\n").unwrap();
        assert!(
            !kept.body_empty,
            "a titled note must never be hidden as blank"
        );
        assert!(
            store.discard_blank(&kept.id).is_err(),
            "non-blank must refuse"
        );
        assert!(
            store.read(&kept.id).is_ok(),
            "refusal leaves the note untouched"
        );
    }

    #[test]
    fn discard_blank_refuses_a_note_it_cannot_read() {
        // an externally-edited note with invalid UTF-8 is NOT provably blank —
        // the old unwrap_or_default read it as "" and trashed real content
        let (_dir, mut store) = bare();
        let note = store.create("Inbox", "").unwrap();
        let rel = store.index.get(&note.id).unwrap().clone();
        let abs = store.root().join(&rel);
        fs::write(&abs, [0xC3, 0x28, b'r', b'e', b'a', b'l']).unwrap();

        let err = store.discard_blank(&note.id).unwrap_err();
        assert!(
            err.contains("refusing to discard"),
            "unreadable must refuse: {err}"
        );
        assert!(abs.is_file(), "the file must survive the refusal");

        // the same unreadable file must abort a body save instead of
        // regenerating its frontmatter from nothing
        assert!(store.write(&note.id, "new body").is_err());
        assert_eq!(
            fs::read(&abs).unwrap(),
            [0xC3, 0x28, b'r', b'e', b'a', b'l']
        );
    }

    #[test]
    fn first_run_creates_inbox_and_one_welcome_note() {
        let (_dir, mut store) = fresh();
        assert!(store.root().join("Inbox").is_dir());
        assert!(store.root().join(DOT_DIR).is_dir());
        let list = store.list().unwrap();
        assert_eq!(
            list.notes.len(),
            1,
            "exactly ONE welcome note, no demo corpus"
        );
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
        store.set_pinned(&meta.id, true).unwrap();
        store.write(&meta.id, "# Keep me up top\n").unwrap();
        drop(store);

        let mut again = CorpusStore::open(root).unwrap();
        again.os_trash = false;
        let doc = again.read(&meta.id).unwrap();
        assert!(doc.pinned, "pin lost across quit/relaunch");
        assert_eq!(
            again.list().unwrap().notes[0].id,
            meta.id,
            "pinned must sort first"
        );
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
        assert!(ov.files.iter().any(|f| f == "Inbox/welcome-to-rotli.md"));
        assert!(ov.files.iter().any(|f| f == "Work/plan.md"));
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
        let f = store.create_folder("Northstar", Some("Work")).unwrap();
        assert_eq!(f.id, "Work/Northstar");
        assert_eq!(f.parent_id.as_deref(), Some("Work"));
        assert!(store.root().join("Work/Northstar").is_dir());
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
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/Inbox/excalidraw/ideas.excalidraw")
        )); // a board
        assert!(path_relevant(&root, &s, Path::new("/corpus/Dropped"))); // a folder
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/main.json")
        ));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/views.json")
        ));
        assert!(path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/chat-folders.json")
        ));
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli/index.json")
        ));
        assert!(!path_relevant(
            &root,
            &s,
            Path::new("/corpus/.rotli-write-abc")
        ));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/.DS_Store")));
        assert!(!path_relevant(&root, &s, Path::new("/corpus/photo.png")));
        assert!(!path_relevant(&root, &s, Path::new("/elsewhere/x.md")));
        let ours = PathBuf::from("/corpus/Work/ours.md");
        s.mark(&ours);
        assert!(
            !path_relevant(&root, &s, &ours),
            "our own write must not echo"
        );
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

    #[cfg(unix)]
    #[test]
    fn note_creation_refuses_a_symlinked_memex_intake_lane() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        let outside = dir.path().join("outside");
        seed_memex(&root);
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();

        let error = store.create("wiki/_inbox", "# Contained").unwrap_err();
        assert!(error.contains("symlink"));
        assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_paths_refuse_reads_writes_moves_and_folder_creation() {
        let (dir, mut store) = bare();
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();

        fs::create_dir_all(store.root().join("Boards")).unwrap();
        let outside_board = outside.join("board.excalidraw");
        fs::write(&outside_board, EMPTY_EXCALIDRAW).unwrap();
        std::os::unix::fs::symlink(
            &outside_board,
            store.root().join("Boards/linked.excalidraw"),
        )
        .unwrap();
        assert!(store.read_board("Boards/linked.excalidraw").is_err());
        assert!(store
            .write_board("Boards/linked.excalidraw", EMPTY_EXCALIDRAW)
            .is_err());
        assert_eq!(
            fs::read_to_string(&outside_board).unwrap(),
            EMPTY_EXCALIDRAW
        );

        let note = store.create("Inbox", "# Contained\n").unwrap();
        std::os::unix::fs::symlink(&outside, store.root().join("Escape")).unwrap();
        assert!(store.move_note(&note.id, "Escape").is_err());
        assert!(store.create_folder("Child", Some("Escape")).is_err());
        assert_eq!(fs::read_dir(outside).unwrap().count(), 1);
        assert!(
            store.path_of(&note.id).is_ok(),
            "refused move keeps the note"
        );
    }

    #[test]
    fn read_only_open_never_creates_sidecars_or_changes_the_memex() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let staged = root.join("wiki/_inbox/draft.md");
        fs::write(&staged, "# Draft\n").unwrap();

        let mut store = CorpusStore::open_read_only(root.clone()).unwrap();
        assert_eq!(store.layout, Layout::Memex);
        assert!(
            !root.join(DOT_DIR).exists(),
            "opening a live memex must not create .rotli"
        );

        let list = store.list().unwrap();
        assert!(
            !list.notes.is_empty(),
            "the production memex remains readable"
        );
        assert!(
            !root.join(DOT_DIR).exists(),
            "index reconciliation must remain in memory"
        );
        assert!(store.write("wiki/_inbox/draft.md", "changed").is_err());
        assert!(store.set_locked("wiki/_inbox/draft.md", true).is_err());
        assert!(store.set_pinned("wiki/_inbox/draft.md", true).is_err());
        assert!(store.set_secure("wiki/_inbox/draft.md", true).is_err());
        assert!(store.dot_write("settings", "{}").is_err());
        assert!(store.journal_append("{}").is_err());
        assert_eq!(fs::read_to_string(&staged).unwrap(), "# Draft\n");
        assert!(!root.join(DOT_DIR).exists());
    }

    // contract v3.7 — the FILER lane is disjoint from the USER lane by KEY
    // ownership: the filer can ONLY write the brain, only AI keys, and never a
    // locked note (paths overlap since wiki became user-writable, 2026-08-03).
    #[test]
    fn filer_lane_is_disjoint_and_files_notes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // USER lane: the curated brain is writable too (2026-08-03) — the lanes
        // stay disjoint by KEY ownership (AI_KEYS below), not by path anymore.
        assert!(store.writable("wiki/note.md").is_ok());
        assert!(store.writable("wiki/Projects/x.md").is_ok());

        // FILER lane — the brain is writable, everything else refused.
        assert!(store.filer_writable("wiki").is_ok());
        assert!(store.filer_writable("wiki/Projects").is_ok());
        assert!(store.filer_writable("wiki/_inbox/x.md").is_ok());
        assert!(store.filer_writable("chats/x.md").is_err());
        assert!(store.filer_writable("storage/x.png").is_err());
        assert!(store.filer_writable("").is_err());

        // stage a note in _inbox, then the FILER gives it an area/summary.
        let note = store
            .create("wiki/_inbox", "# Alazan 84\n\nland deal notes")
            .unwrap();
        let rel = store.path_of(&note.id).unwrap();
        assert!(store.set_ai_field(&rel, "area", "Projects").is_ok());
        assert!(store
            .set_ai_field(&rel, "summary", "the Alazan 84 land deal")
            .is_ok());
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
        assert_eq!(
            store.read_frontmatter(&new_rel).unwrap().updated,
            before.updated
        );

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
        // (the maintainer's screenshot, 2026-07-01).
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
        // Secure is a VISIBILITY control against REMOTE (2026-08-01). An
        // on-device model reads it by default; a remote model never can, in any
        // knob state.
        assert!(store.read_for_ai(&note.id, false).is_err());
        assert!(store.read_for_ai(&note.id, true).is_ok());
        store.set_local_ai_access(&note.id, true).unwrap();
        assert!(store.read_for_ai(&note.id, true).is_ok());
        assert!(store.read_for_ai(&note.id, false).is_err());
        store.set_local_ai_access(&note.id, false).unwrap();
        assert!(store.read_for_ai(&note.id, true).is_err());
        assert!(store.read_for_ai(&note.id, false).is_err());
        store.set_secure(&note.id, false).unwrap();

        // write_index — the one file the filer overwrites wholesale.
        assert!(store
            .write_index("Projects", "# Projects\n\n- Alazan 84\n")
            .is_ok());
        assert!(store.abs("wiki/Projects/_index.md").is_file());
        // an EMPTY body removes the file: undoing the FIRST applied index
        // rewrite (journal before == "") restores "no file", not a 0-byte husk
        assert!(store.write_index("Projects", "").is_ok());
        assert!(!store.abs("wiki/Projects/_index.md").exists());
        assert!(
            store.write_index("Projects", "").is_ok(),
            "removing a missing index is a no-op"
        );
    }

    /// #1 (audit 2026-07, CRITICAL): a SECURE note's `.gitignore` line is its
    /// PATH — a rename and a user move must carry it along, while the memex
    /// secure-home transition must keep the organizer categorically outside.
    #[test]
    fn gitignore_follows_secure_moves_and_memex_secure_home_blocks_filing() {
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
        let note = store
            .create("Inbox", "# Api key\n\nsk-ant-abcdefghijklmnop123")
            .unwrap();
        store.set_secure(&note.id, true).unwrap();
        let old_rel = store.path_of(&note.id).unwrap();
        assert!(ignored_lines(&store.root).contains(&old_rel));

        // retitle → the file renames; the gitignore line must follow
        store
            .write(&note.id, "# Rotated key\n\nsk-ant-abcdefghijklmnop123")
            .unwrap();
        let renamed_rel = store.path_of(&note.id).unwrap();
        assert_ne!(renamed_rel, old_rel, "the title change renames the file");
        let lines = ignored_lines(&store.root);
        assert!(
            lines.contains(&renamed_rel),
            "new path must be ignored: {lines:?}"
        );
        assert!(
            !lines.contains(&old_rel),
            "old line must be gone: {lines:?}"
        );

        // user move (Archive) → same discipline
        store.move_note(&note.id, "Archive").unwrap();
        let archived_rel = store.path_of(&note.id).unwrap();
        assert!(archived_rel.starts_with("Archive/"));
        let lines = ignored_lines(&store.root);
        assert!(
            lines.contains(&archived_rel),
            "moved path must be ignored: {lines:?}"
        );
        assert!(
            !lines.contains(&renamed_rel),
            "pre-move line must be gone: {lines:?}"
        );

        // a NON-secure note's moves never touch the gitignore
        let plain = store
            .create("Inbox", "# Plain note\n\nnothing secret")
            .unwrap();
        store.move_note(&plain.id, "Archive").unwrap();
        let plain_rel = store.path_of(&plain.id).unwrap();
        assert!(!ignored_lines(&store.root).contains(&plain_rel));

        // — memex corpus: marking secure moves the note into its protected
        // Brain home; the filer cannot write or move it; removing protection
        // restores its previous physical home with the same stable id. —
        let tmp2 = TempDir::new().unwrap();
        let brain = tmp2.path().join("brain");
        seed_memex(&brain);
        let mut mx = CorpusStore::open(brain).unwrap();
        mx.os_trash = false;
        let staged = mx
            .create("wiki/_inbox", "# Private draft\n\nOwner-only notes")
            .unwrap();
        mx.set_secure(&staged.id, true).unwrap();
        let secure_rel = mx.path_of(&staged.id).unwrap();
        assert!(secure_rel.starts_with("wiki/_secure/"));
        assert!(ignored_lines(&mx.root).contains(&secure_rel));
        assert!(mx.set_ai_field(&staged.id, "area", "Projects").is_err());
        assert!(mx.file_note(&staged.id).is_err());
        mx.set_secure(&staged.id, false).unwrap();
        let restored_rel = mx.path_of(&staged.id).unwrap();
        assert!(restored_rel.starts_with("wiki/_inbox/"));
        assert!(!ignored_lines(&mx.root).contains(&restored_rel));
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
        let note = store
            .create("Inbox", "# Api key\n\nsk-ant-abcdefghijklmnop123")
            .unwrap();
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
        assert!(store
            .write(&note.id, "# Rotated key\n\nsk-ant-abcdefghijklmnop123")
            .is_err());
        assert_eq!(store.path_of(&note.id).unwrap(), old_rel);
        assert!(store.root.join(&old_rel).is_file());

        // a NON-secure note never touches the gitignore — its moves still work
        let plain = store.create("Inbox", "# Plain\n\nnothing secret").unwrap();
        store.move_note(&plain.id, "Archive").unwrap();
        assert!(store.path_of(&plain.id).unwrap().starts_with("Archive/"));
    }

    /// Decision 2026-07-22 (legacy secure intake repair): a note explicitly
    /// flagged `secure: true` yet physically still in `wiki/_inbox/` is legacy
    /// or externally moved state. Repair completes the protected move —
    /// ignore-before-move, same stable id, prose untouched — and journals it
    /// WITHOUT recording title, summary, body, or tags.
    #[test]
    fn secure_repair_moves_flagged_intake_notes_into_the_lane() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        // the legacy file: flagged secure, stable id, never moved to the lane
        let legacy_body = "# Gateway ENV\n\nTOKEN=abc-legacy-value\n";
        fs::write(
            root.join("wiki/_inbox/gateway-env.md"),
            format!("---\nid: 01JLEGACYSECUREULID000000\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-01T00:00:00Z\nsecure: true\n---\n\n{legacy_body}"),
        )
        .unwrap();
        // NOT candidates: a plain intake note, a flagged note WITHOUT a stable
        // id, and a note already living in the protected lane
        fs::write(
            root.join("wiki/_inbox/plain.md"),
            "# Plain\n\nnothing secret\n",
        )
        .unwrap();
        fs::write(
            root.join("wiki/_inbox/idless.md"),
            "---\nsecure: true\n---\n\n# Idless\n\nold hand-made state\n",
        )
        .unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        let homed = store
            .create("wiki/_inbox", "# Homed secret\n\nprivate")
            .unwrap();
        store.set_secure(&homed.id, true).unwrap();
        assert!(store
            .path_of(&homed.id)
            .unwrap()
            .starts_with("wiki/_secure/"));

        let candidates = store.secure_repair_scan().unwrap();
        assert_eq!(
            candidates.len(),
            1,
            "only the flagged, id-bearing intake note: {candidates:?}"
        );
        assert_eq!(candidates[0].id, "01JLEGACYSECUREULID000000");
        assert_eq!(candidates[0].folder, "wiki/_inbox");
        assert_eq!(
            candidates[0].title, "Gateway ENV",
            "the preview shows the user the real title"
        );

        let report = store.secure_repair_apply().unwrap();
        assert_eq!(report.repaired, 1);
        assert!(report.failed.is_empty(), "{:?}", report.failed);

        // moved into the lane, same stable id, prose byte-identical
        let new_rel = store.path_of("01JLEGACYSECUREULID000000").unwrap();
        assert!(new_rel.starts_with("wiki/_secure/"), "{new_rel}");
        let moved = fs::read_to_string(store.abs(&new_rel)).unwrap();
        assert!(
            moved.contains(legacy_body.trim_end()),
            "prose must survive unchanged:\n{moved}"
        );
        assert!(moved.contains("secure: true"));
        // the new path is ignored; the old intake path line is gone
        let ignored = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(ignored.lines().any(|l| l.trim() == new_rel), "{ignored}");
        assert!(
            !ignored
                .lines()
                .any(|l| l.trim() == "wiki/_inbox/gateway-env.md"),
            "{ignored}"
        );
        // untouched bystanders
        assert!(root.join("wiki/_inbox/plain.md").is_file());
        assert!(root.join("wiki/_inbox/idless.md").is_file());

        // the journal row: applied, content-free, ULID-addressed
        let journal = store.journal_read().unwrap();
        let rows: Vec<serde_json::Value> = journal
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .filter(|v: &serde_json::Value| v["action"] == "repair")
            .collect();
        assert_eq!(rows.len(), 1, "{journal}");
        let row = &rows[0];
        assert_eq!(row["status"], "applied");
        assert_eq!(row["noteUlid"], "01JLEGACYSECUREULID000000");
        assert_eq!(
            row["noteId"], "01JLEGACYSECUREULID000000",
            "the rel embeds the slug — journal by ULID"
        );
        assert_eq!(row["noteTitle"], "");
        assert_eq!(row["before"], "wiki/_inbox");
        assert_eq!(row["after"], "wiki/_secure");
        for leak in ["Gateway", "gateway-env", "TOKEN", "abc-legacy-value"] {
            assert!(
                !journal.contains(leak),
                "journal must stay content-free ({leak}):\n{journal}"
            );
        }

        // idempotent: nothing left to repair, no second journal row
        assert!(store.secure_repair_scan().unwrap().is_empty());
        let report = store.secure_repair_apply().unwrap();
        assert_eq!((report.repaired, report.failed.len()), (0, 0));
    }

    /// The repair is refusal-first: it can never flag a non-secure note, never
    /// runs read-only, and detector-only or id-less files are simply not
    /// candidates (they remain the user's "review yourself" set).
    #[test]
    fn secure_repair_refuses_non_secure_and_read_only_targets() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        // detector-firing content, NO explicit flag → not repair material
        fs::write(
            root.join("wiki/_inbox/hot.md"),
            "---\nid: 01JDETECTORONLYULID000000\n---\n\n# Api key\n\nsk-ant-abcdefghijklmnop123\n",
        )
        .unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        assert!(
            store.secure_repair_scan().unwrap().is_empty(),
            "the explicit flag is required"
        );
        // the per-note step holds the same line even when called directly
        let err = store.secure_repair_note("wiki/_inbox/hot.md").unwrap_err();
        assert!(err.contains("explicitly marked secure"), "{err}");
        assert!(
            root.join("wiki/_inbox/hot.md").is_file(),
            "refusal moves nothing"
        );
        assert!(
            !fs::read_to_string(root.join("wiki/_inbox/hot.md"))
                .unwrap()
                .contains("secure: true"),
            "repair must never ADD the flag"
        );
        drop(store);

        let mut ro = CorpusStore::open_read_only(root).unwrap();
        assert!(
            ro.secure_repair_scan().is_ok(),
            "the preview scan stays read-only"
        );
        assert!(
            ro.secure_repair_apply().is_err(),
            "read-only refuses the mutation"
        );
    }

    /// A symlink dropped into intake is never repair material — the scan skips
    /// non-regular files, so the link's target can't be moved through the lane.
    #[cfg(unix)]
    #[test]
    fn secure_repair_skips_symlinked_intake_entries() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let outside = tmp.path().join("outside.md");
        fs::write(
            &outside,
            "---\nid: 01JOUTSIDEULID00000000000\nsecure: true\n---\n\n# Outside\n",
        )
        .unwrap();
        std::os::unix::fs::symlink(&outside, root.join("wiki/_inbox/linked.md")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        assert!(store.secure_repair_scan().unwrap().is_empty());
        let report = store.secure_repair_apply().unwrap();
        assert_eq!((report.repaired, report.failed.len()), (0, 0));
        assert!(outside.is_file(), "the outside target is untouched");
    }

    /// The ignore-before-move discipline holds for repair exactly as for every
    /// other secure move: an unwritable `.gitignore` refuses the repair with
    /// nothing moved and the note still readable at its old path.
    #[test]
    fn secure_repair_aborts_before_move_when_gitignore_is_unwritable() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let rel = "wiki/_inbox/stuck.md";
        fs::write(
            root.join(rel),
            "---\nid: 01JSTUCKSECUREULID0000000\nsecure: true\n---\n\n# Stuck\n\nprivate\n",
        )
        .unwrap();
        // a DIRECTORY at .gitignore makes every ignore write fail
        fs::create_dir(root.join(".gitignore")).unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;
        let report = store.secure_repair_apply().unwrap();
        assert_eq!(report.repaired, 0);
        assert_eq!(report.failed.len(), 1, "{:?}", report.failed);
        assert!(root.join(rel).is_file(), "nothing moved");
        assert!(!root.join("wiki/_secure").join("stuck.md").exists());
        assert!(
            store.journal_read().unwrap().is_empty(),
            "a refused repair journals nothing"
        );
    }

    /// A RAW vault (vault-vs-brain, 2026-07-26) refuses the ENTIRE filer lane —
    /// daemon, manual filing, and index writes alike — while the user lane and
    /// security controls stay fully alive. A missing field means ON.
    #[test]
    fn raw_vault_refuses_the_filer_lane_but_not_the_user() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        let note = store.create("wiki/_inbox", "# Draft\n\nwords\n").unwrap();

        // missing field ⇒ the filer lane works exactly like today
        store.set_ai_field(&note.id, "summary", "one line").unwrap();
        store.set_ai_field(&note.id, "area", "Projects").unwrap();

        store
            .dot_write("settings", "{\"brainEnabled\":false}")
            .unwrap();
        let err = store
            .set_ai_field(&note.id, "summary", "two lines")
            .unwrap_err();
        assert!(err.contains("Librarian is off"), "{err}");
        assert!(store
            .file_note(&note.id)
            .unwrap_err()
            .contains("Librarian is off"));
        assert!(store
            .write_index("Projects", "# P\n")
            .unwrap_err()
            .contains("Librarian is off"));
        assert!(store
            .filer_move(&note.id, "wiki/Projects")
            .unwrap_err()
            .contains("Librarian is off"));

        // the AGENT edit surface is a VAULT feature, not a Brain feature
        // (pressure-test 2026-07-26: the broad filer_writable gate broke it) —
        // CLI/MCP edits keep working in a raw vault
        store
            .write_for_remote_agent(&note.id, "# Draft\n\nagent words\n")
            .unwrap();

        // the USER lane is untouched: editing, moving, security controls
        store.write(&note.id, "# Draft\n\nmore words\n").unwrap();
        store.set_locked(&note.id, true).unwrap();
        store.set_locked(&note.id, false).unwrap();
        store.set_secure(&note.id, true).unwrap();
        assert!(store
            .path_of(&note.id)
            .unwrap()
            .starts_with("wiki/_secure/"));
        store.set_secure(&note.id, false).unwrap();

        // flipping back on restores the lane
        store
            .dot_write("settings", "{\"brainEnabled\":true}")
            .unwrap();
        store
            .set_ai_field(&note.id, "summary", "three lines")
            .unwrap();
    }

    /// The consent boundary fails CLOSED (pressure-test 2026-07-26): a genuine
    /// IO error reading settings must never silently re-enable the Brain.
    /// (A MISSING file stays ON — dot_read maps NotFound to "{}".)
    #[test]
    fn brain_enabled_fails_closed_on_a_real_read_error() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("brain");
        seed_memex(&root);
        let store = CorpusStore::open(root.clone()).unwrap();
        assert!(
            store.brain_enabled(),
            "no settings file at all ⇒ ON (today's behavior)"
        );
        // a DIRECTORY at the settings path makes the read a genuine IO error
        fs::create_dir_all(root.join(".rotli/settings.json")).unwrap();
        assert!(
            !store.brain_enabled(),
            "an unreadable consent boundary fails closed"
        );
    }

    /// Onboarding's choices survive the corpus switch (pressure-test
    /// 2026-07-26): a newly adopted root with NO settings inherits the current
    /// file; a root with its OWN settings keeps them.
    #[test]
    fn carry_settings_seeds_new_roots_and_respects_existing_ones() {
        let tmp = TempDir::new().unwrap();
        let old = tmp.path().join("old");
        let fresh = tmp.path().join("fresh");
        let veteran = tmp.path().join("veteran");
        fs::create_dir_all(old.join(".rotli")).unwrap();
        fs::create_dir_all(&fresh).unwrap();
        fs::create_dir_all(veteran.join(".rotli")).unwrap();
        fs::write(old.join(".rotli/settings.json"), "{\"brainEnabled\":false}").unwrap();
        fs::write(
            veteran.join(".rotli/settings.json"),
            "{\"brainEnabled\":true}",
        )
        .unwrap();

        carry_settings(&old, &fresh).unwrap();
        assert_eq!(
            fs::read_to_string(fresh.join(".rotli/settings.json")).unwrap(),
            "{\"brainEnabled\":false}",
            "the raw-vault choice rides along to a settings-less root"
        );
        carry_settings(&old, &veteran).unwrap();
        assert_eq!(
            fs::read_to_string(veteran.join(".rotli/settings.json")).unwrap(),
            "{\"brainEnabled\":true}",
            "a vault with its own settings keeps them"
        );
        // no source settings → clean no-op
        let bare = tmp.path().join("bare");
        fs::create_dir_all(&bare).unwrap();
        carry_settings(&bare, &fresh).unwrap();
    }

    /// The Tasks projection (decision 2026-07-25): open checkboxes only, fenced
    /// code skipped, sinks excluded, and the toggle is a validated user edit
    /// through the ordinary write path.
    #[test]
    fn tasks_project_open_checkboxes_and_toggle_checks_them_off() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store
            .create(
                "Inbox",
                "# Plan\n\n- [ ] call the bank\n  about the wire\n- [x] already done\n- [ ]\n- [ ][ ] unanswered result\n- [ ][x] failed result\n- [x][ ] passed result\n- (x) selected choice\n```\n- [ ] not a task — code\n```\n* [ ] second style\n1. [ ] rotate the key\n2. [x] ordered but done\n3. plain step, not a task\n",
            )
            .unwrap();
        // a task in a sink is not a nag
        let sunk = store
            .create("Inbox", "# Sunk\n\n- [ ] never nags\n")
            .unwrap();
        store.move_note(&sunk.id, "Archive").unwrap();

        let tasks = store.tasks().unwrap();
        let texts: Vec<&str> = tasks.iter().map(|t| t.text.as_str()).collect();
        // the wrapped continuation joins into ONE task (2026-07-31); `1. [ ]`
        // ordered tasks project too (2026-08-03), checked/plain ordered lines don't
        assert_eq!(
            texts,
            vec![
                "call the bank about the wire",
                "second style",
                "rotate the key"
            ],
            "{tasks:?}"
        );
        assert!(tasks.iter().all(|t| t.note_id == note.id));
        assert_eq!(tasks[0].note_title, "Plan");

        // checking off rewrites exactly the checkbox line, through the write
        // path — validated against the joined text tasks() reported
        store
            .toggle_task(&note.id, tasks[0].line, "call the bank about the wire")
            .unwrap();
        let body = store.read(&note.id).unwrap().body;
        assert!(body.contains("- [x] call the bank"), "{body}");
        assert!(
            body.contains("* [ ] second style"),
            "other tasks untouched: {body}"
        );
        assert!(
            body.contains("- [ ] not a task — code"),
            "fenced text untouched: {body}"
        );
        assert_eq!(
            store.tasks().unwrap().len(),
            2,
            "a checked task leaves the list"
        );

        // an ordered task toggles the same way — replacen hits the box, not the number
        let ordered = store
            .tasks()
            .unwrap()
            .into_iter()
            .find(|t| t.text == "rotate the key")
            .unwrap();
        store
            .toggle_task(&note.id, ordered.line, "rotate the key")
            .unwrap();
        let body = store.read(&note.id).unwrap().body;
        assert!(body.contains("1. [x] rotate the key"), "{body}");
        assert_eq!(store.tasks().unwrap().len(), 1);

        // stale refusal: the note changed since the list was built
        let err = store
            .toggle_task(&note.id, tasks[0].line, "call the bank")
            .unwrap_err();
        assert!(err.contains("changed since"), "{err}");
        // and a wrong line index refuses the same way
        assert!(store.toggle_task(&note.id, 999, "second style").is_err());

        // read-only stores refuse the mutation, not the projection
        drop(store);
        let root = tmp.path().join("corpus");
        let mut ro = CorpusStore::open_read_only(root).unwrap();
        assert!(ro.tasks().is_ok());
        let remaining = ro.tasks().unwrap();
        assert!(ro
            .toggle_task(&note.id, remaining[0].line, "second style")
            .is_err());
    }

    /// `[/]` — in progress (2026-08-04, from ZenNotes). Started is not
    /// finished: an in-progress task still belongs on the Tasks surface, and
    /// checking it off there takes it straight to done.
    #[test]
    fn in_progress_tasks_still_project_and_check_off() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store
            .create(
                "Inbox",
                "# Plan\n\n- [/] drafting the memo\n* [/] second style\n2. [/] ordered, underway\n- [x] done\n",
            )
            .unwrap();

        let tasks = store.tasks().unwrap();
        let texts: Vec<&str> = tasks.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(
            texts,
            vec!["drafting the memo", "second style", "ordered, underway"],
            "{tasks:?}"
        );

        store
            .toggle_task(&note.id, tasks[0].line, "drafting the memo")
            .unwrap();
        let body = store.read(&note.id).unwrap().body;
        assert!(body.contains("- [x] drafting the memo"), "{body}");
        assert!(
            body.contains("* [/] second style"),
            "others untouched: {body}"
        );
        assert_eq!(store.tasks().unwrap().len(), 2);
    }

    /// The box is found by POSITION, not by searching the line for "[ ]" —
    /// otherwise a task that TALKS about a checkbox gets the wrong one flipped.
    #[test]
    fn check_off_targets_the_box_and_never_the_words() {
        assert_eq!(
            check_off("- [/] fix the [ ] case").unwrap(),
            "- [x] fix the [ ] case"
        );
        assert_eq!(check_off("  - [ ] nested").unwrap(), "  - [x] nested");
        assert_eq!(
            check_off("12. [ ] step twelve").unwrap(),
            "12. [x] step twelve"
        );
        assert_eq!(check_off("* [/] star").unwrap(), "* [x] star");
        // already done, or not a task at all
        assert!(check_off("- [x] done").is_none());
        assert!(check_off("- [ ][ ] unanswered result").is_none());
        assert!(check_off("- [x][ ] passed result").is_none());
        assert!(check_off("- (x) selected choice").is_none());
        assert!(check_off("- plain bullet").is_none());
        assert!(check_off("just a line").is_none());
    }

    /// The legacy corpus layout gets the same repair with its own lane names
    /// (`Inbox` intake → `Secure notes`).
    #[test]
    fn secure_repair_covers_the_legacy_layout() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        fs::create_dir_all(store.root().join("Inbox")).unwrap();
        fs::write(
            store.root().join("Inbox/old-secret.md"),
            "---\nid: 01JLEGACYLAYOUTULID000000\nsecure: true\n---\n\n# Old secret\n\nprivate\n",
        )
        .unwrap();
        let candidates = store.secure_repair_scan().unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].folder, "Inbox");
        let report = store.secure_repair_apply().unwrap();
        assert_eq!(
            (report.repaired, report.failed.len()),
            (1, 0),
            "{:?}",
            report.failed
        );
        let new_rel = store.path_of("01JLEGACYLAYOUTULID000000").unwrap();
        assert!(new_rel.starts_with("Secure notes/"), "{new_rel}");
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
        let hot = store
            .create("Inbox", "# Stripe\n\ncard 4242424242424242")
            .unwrap();
        assert!(
            store.read_for_ai(&hot.id, false).is_err(),
            "unflagged secret must refuse remote"
        );
        assert!(
            store.read_for_ai(&hot.id, true).is_ok(),
            "on-device reads a secure note by default"
        );
        store.set_local_ai_access(&hot.id, false).unwrap();
        assert!(
            store.read_for_ai(&hot.id, true).is_err(),
            "an explicit per-note DENY closes it locally"
        );
        store.set_local_ai_access(&hot.id, true).unwrap();
        assert!(
            store.read_for_ai(&hot.id, true).is_ok(),
            "explicitly allowed local access passes"
        );
        assert!(
            store.read_for_ai(&hot.id, false).is_err(),
            "remote stays blocked in every knob state"
        );
        // a clean note passes remote
        let clean = store.create("Inbox", "# Groceries\n\neggs, milk").unwrap();
        assert!(store.read_for_ai(&clean.id, false).is_ok());
    }

    #[test]
    fn secure_notes_are_private_at_birth_and_remote_access_is_absolute() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;

        let quick = store
            .create_with_policy("Inbox", "# Call notes\n\nPrivate by default", true)
            .unwrap();
        let secure_folder = store
            .create_with_policy("Secure notes", "# Passwords\n", false)
            .unwrap();

        for note in [&quick, &secure_folder] {
            let fm = store.read_frontmatter(&note.id).unwrap();
            assert!(fm.secure);
            // the EFFECTIVE verdict: on-device access is the 2026-08-01 default
            assert!(fm.local_ai_allowed);
            assert!(store.read_for_ai(&note.id, false).is_err());
            assert!(store.read_for_ai(&note.id, true).is_ok());
            let rel = store.path_of(&note.id).unwrap();
            let ignored = fs::read_to_string(store.root.join(".gitignore")).unwrap();
            assert!(ignored.lines().any(|line| line.trim() == rel));
        }

        store.set_local_ai_access(&quick.id, true).unwrap();
        assert!(store.read_for_ai(&quick.id, true).is_ok());
        assert!(store.read_for_ai(&quick.id, false).is_err());

        let moved = store.create("Inbox", "# Move me\n").unwrap();
        store.move_note(&moved.id, "Secure notes/Calls").unwrap();
        assert!(store.read_frontmatter(&moved.id).unwrap().secure);
        assert!(store.read_for_ai(&moved.id, true).is_ok());
        assert!(store.read_for_ai(&moved.id, false).is_err());
    }

    /// THE matrix, asserted end to end on the Rust layer (2026-08-01,
    /// docs/design/ai-visibility-matrix.md). A frontier-context request receives
    /// NOTHING secure from read, the batch probe, search, or the reference lane
    /// — even when it names the note directly.
    #[test]
    fn a_frontier_request_never_receives_secure_content_by_any_route() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let secret = store
            .create_with_policy(
                "Secure notes",
                "# Vault code\n\nthe kelpie passphrase",
                true,
            )
            .unwrap();
        let open = store
            .create("Inbox", "# Kelpie\n\nan ordinary kelpie note")
            .unwrap();

        // READ, named directly — the only answer a remote model ever gets
        let refusal = store.read_for_ai(&secret.id, false).unwrap_err();
        assert!(refusal.contains("secure"), "{refusal}");
        assert!(
            !refusal.contains("passphrase"),
            "a refusal must never quote the body"
        );
        // the same id IS readable on-device — proving the refusal is about the
        // model class, not a missing file
        assert!(store.read_for_ai(&secret.id, true).is_ok());

        // SEARCH — the hit exists in the raw index (search is a user lane), and
        // the per-hit read gate is what removes it for a remote model. That is
        // exactly what `corpus_readable_ids` does with `read_for_ai`.
        let hits = store.search("kelpie", 50, true).unwrap();
        assert!(
            hits.iter().any(|h| h.id == secret.id),
            "test setup: both notes match"
        );
        let remote_visible: Vec<String> = hits
            .iter()
            .filter(|h| store.read_for_ai(&h.id, false).is_ok())
            .map(|h| h.id.clone())
            .collect();
        assert_eq!(remote_visible, vec![open.id.clone()]);
        // and the same filter run for an on-device model keeps BOTH
        let local_visible = hits
            .iter()
            .filter(|h| store.read_for_ai(&h.id, true).is_ok())
            .count();
        assert_eq!(local_visible, hits.len());
    }

    /// The vault-level knob (`secureLocalAi`) and the per-note override, and
    /// which one wins. Neither can ever open a secure note to a remote model.
    #[test]
    fn secure_local_visibility_knobs_layer_note_over_vault() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store
            .create_with_policy("Secure notes", "# Private\n\nbody", true)
            .unwrap();

        // default: no settings file at all ⇒ on-device may read
        assert!(store.read_for_ai(&note.id, true).is_ok());
        // vault knob OFF ⇒ closed locally, still closed remotely
        store
            .dot_write("settings", "{\"secureLocalAi\":false}")
            .unwrap();
        assert!(store.read_for_ai(&note.id, true).is_err());
        assert!(store.read_for_ai(&note.id, false).is_err());
        // an explicit per-note ALLOW overrides the vault's no
        store.set_local_ai_access(&note.id, true).unwrap();
        assert!(store.read_for_ai(&note.id, true).is_ok());
        assert!(store.read_for_ai(&note.id, false).is_err());
        // and an explicit per-note DENY overrides the vault's yes
        store
            .dot_write("settings", "{\"secureLocalAi\":true}")
            .unwrap();
        store.set_local_ai_access(&note.id, false).unwrap();
        assert!(store.read_for_ai(&note.id, true).is_err());
        assert!(store.read_for_ai(&note.id, false).is_err());
        // the decision is written EXPLICITLY, both ways, so it is legible on disk
        let rel = store.path_of(&note.id).unwrap();
        let text = fs::read_to_string(store.abs(&rel)).unwrap();
        assert!(
            text.lines().any(|l| l.trim() == "local_ai_allowed: false"),
            "{text}"
        );
        // a NON-secure note has nothing to say here, and the vault knob never
        // narrows an ordinary note (every class reads those by definition)
        store
            .dot_write("settings", "{\"secureLocalAi\":false}")
            .unwrap();
        let open = store.create("Inbox", "# Open\n\nbody").unwrap();
        assert!(store.set_local_ai_access(&open.id, false).is_err());
        assert!(store.read_frontmatter(&open.id).unwrap().local_ai_allowed);
        assert!(store.read_for_ai(&open.id, true).is_ok());
        assert!(store.read_for_ai(&open.id, false).is_ok());
    }

    /// LOCKED is an EDIT control, not a visibility one: every class SEES a
    /// locked note and no class edits it. The user's own write lane is
    /// untouched — locking protects a note from models, not from its author.
    #[test]
    fn locked_notes_are_readable_by_every_model_and_editable_by_none() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store.create("Inbox", "# Plan\n\noriginal body").unwrap();
        store.set_locked(&note.id, true).unwrap();

        // SEE: both classes
        assert!(store.read_for_ai(&note.id, true).is_ok());
        assert!(store.read_for_ai(&note.id, false).is_ok());
        // EDIT: neither class
        for local in [true, false] {
            let err = store
                .write_for_ai(&note.id, "# Plan\n\nrewritten", local)
                .unwrap_err();
            assert!(err.contains("locked"), "{err}");
        }
        let rel = store.path_of(&note.id).unwrap();
        assert!(fs::read_to_string(store.abs(&rel))
            .unwrap()
            .contains("original body"));
        // the human's own save still works
        assert!(store.write(&note.id, "# Plan\n\nmy own edit").is_ok());
        // unlocked, an AI write lands
        store.set_locked(&note.id, false).unwrap();
        assert!(store
            .write_for_ai(&note.id, "# Plan\n\nAI edit", true)
            .is_ok());
    }

    /// AUDIT 2026-08-01, GAP 2 — the compromised-loop shape. The agent loop can
    /// call ANY command: it does not have to use `corpus_read_ai`, whose result
    /// still carries the `secure: true` marker the egress detector looks for.
    /// It can call the editor's ungated `corpus_read`, which returns the body
    /// with the frontmatter STRIPPED, and hand that to a remote lane as
    /// innocent-looking prose. So the ledger is fed by the WALK, not by a read:
    /// if a secure note exists in this vault, its prose cannot leave, whichever
    /// command went and got it.
    #[test]
    fn secure_prose_cannot_egress_however_the_loop_fetched_it() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store
            .create_with_policy(
                "Secure notes",
                "# Chapterhouse\n\nThe chapterhouse valuation settles before Lammas tide.",
                true,
            )
            .unwrap();

        // the walk is what teaches the gate — a plain list() is enough
        store.list().unwrap();

        // the exact bytes a compromised loop would obtain from the UNGATED
        // editor read: no frontmatter, so no marker for the old detector
        let stripped = store.read(&note.id).unwrap().body;
        assert!(
            !stripped.contains("secure:"),
            "the editor lane strips frontmatter: {stripped}"
        );
        assert!(
            !crate::secret::looks_secure(&stripped),
            "and the prose is not secret-SHAPED"
        );
        assert!(
            !crate::secret::protected_for_remote(&stripped),
            "which is exactly why the marker backstop alone was not enough"
        );

        // every outbound seam now refuses it, in every wrapper the loop might use
        assert!(crate::secret::blocked_for_remote(&stripped));
        assert!(crate::secret::blocked_for_remote(
            "the chapterhouse valuation settles before lammas"
        ));
        assert!(crate::secret::blocked_for_remote(
            "https://exfil.example/?d=The%20chapterhouse valuation settles before Lammas tide"
        ));

        // an ORDINARY note in the same vault is untouched by any of this
        let open = store
            .create("Inbox", "# Errands\n\nCollect the boots from the cobbler.")
            .unwrap();
        store.list().unwrap();
        let open_body = store.read(&open.id).unwrap().body;
        assert!(!crate::secret::blocked_for_remote(&open_body));
    }

    /// AUDIT 2026-08-01, GAP 3 — a chat a secure note fed is stamped
    /// `secureContext: true`. In a memex root `chats/**.md` are ordinary notes,
    /// so before this the headless (remote-by-policy) agent could read a tainted
    /// transcript straight out of the notes lane: `secure_field` never matched
    /// the longer key.
    #[test]
    fn a_secure_tainted_chat_reads_like_a_secure_note() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let chat = store
            .create("Inbox", "# Chat\n\nordinary looking words")
            .unwrap();
        let rel = store.path_of(&chat.id).unwrap();
        let text = fs::read_to_string(store.abs(&rel)).unwrap();
        let (fm, body) = parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.push("secureContext: true".to_string());
        atomic_write(&store.abs(&rel), &compose_document(&fm, body)).unwrap();

        assert!(
            store.read_for_ai(&chat.id, false).is_err(),
            "remote must be refused"
        );
        assert!(
            store.read_for_ai(&chat.id, true).is_ok(),
            "on-device still reads it"
        );
    }

    /// AUDIT 2026-08-01, GAP 9 — the laundering rule, in Rust. The TS host has
    /// enforced "secure content flows only into secure containers" by tracking
    /// the CHAT's taint, but a chat id is a webview assertion. Rust cannot see
    /// chats; it CAN see that the incoming body is protected content.
    #[test]
    fn write_for_ai_refuses_to_launder_secure_prose_into_an_open_note() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let secret = store
            .create_with_policy(
                "Secure notes",
                "# Wardship\n\nThe wardship stipend renews each Candlemas quarter.",
                true,
            )
            .unwrap();
        let open = store
            .create("Inbox", "# Open\n\nnothing sensitive here")
            .unwrap();
        store.list().unwrap(); // the walk teaches the ledger

        let laundered = "# Open\n\nThe wardship stipend renews each Candlemas quarter.";
        // the compromised shape: read secure on-device, write it into an OPEN note
        let err = store.write_for_ai(&open.id, laundered, true).unwrap_err();
        assert!(err.contains("secure"), "{err}");
        let rel = store.path_of(&open.id).unwrap();
        assert!(
            fs::read_to_string(store.abs(&rel))
                .unwrap()
                .contains("nothing sensitive"),
            "the open note must be untouched"
        );

        // the SAME text into a SECURE container is fine — that is the rule, not
        // a blanket refusal
        assert!(store.write_for_ai(&secret.id, laundered, true).is_ok());
        // and an ordinary edit to the open note still lands
        assert!(store
            .write_for_ai(&open.id, "# Open\n\nbuy more oats", true)
            .is_ok());
    }

    /// AUDIT 2026-08-01, GAP 7 — a view tag REWRITES frontmatter, so it is an AI
    /// write and takes the write gate. The workspace's view lane checked only
    /// that the path resolved.
    #[test]
    fn agent_frontmatter_writes_stop_at_the_reference_and_hidden_lanes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("memex");
        fs::create_dir_all(root.join("wiki")).unwrap();
        fs::create_dir_all(root.join("identity")).unwrap();
        fs::write(
            root.join("memex.json"),
            "{\"id\":\"mx_test\",\"contract\":\"3.7\"}",
        )
        .unwrap();
        fs::write(root.join("wiki/open.md"), "# Open\n").unwrap();
        fs::write(root.join("identity/00-identity.md"), "# Me\n").unwrap();
        fs::write(root.join("STRUCTURE.md"), "# Layout\n").unwrap();
        let store = CorpusStore::open(root).unwrap();
        assert_eq!(
            store.layout,
            Layout::Memex,
            "test setup: this must open as a memex"
        );

        // curated wiki notes DO take a view tag (view inheritance is a feature)
        assert!(store.agent_frontmatter_writable("wiki/open.md").is_ok());
        // the protected reference lanes are written by no agent lane, ever
        let err = store
            .agent_frontmatter_writable("identity/00-identity.md")
            .unwrap_err();
        assert!(err.contains("protected reference layer"), "{err}");
        // and vault plumbing is not even acknowledged
        assert!(store.agent_frontmatter_writable("STRUCTURE.md").is_err());
    }

    /// AUDIT FOLLOW-UP 2026-08-01, finding #2 — the LAZY-LEDGER boot race. The
    /// ledger is fed by the walk, and `open` does not walk. So a fresh process
    /// that reads a secure note through an UNGATED lane (`corpus_read` /
    /// `corpus_file_text`, both directly webview-invokable) before that root's
    /// first list would hand its stripped body to a remote lane with a cold
    /// ledger. This proves the STARTUP WARM — not a `list()` — closes it.
    #[test]
    fn the_startup_warm_closes_the_ungated_read_egress_race() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("corpus");
        // author a secure note, capturing its id, then drop the authoring store
        let secure_id = {
            let mut authoring = CorpusStore::open(root.clone()).unwrap();
            authoring.os_trash = false;
            authoring
                .create_with_policy(
                    "Secure notes",
                    "# Escrow\n\nThe Wexford escrow releases on the feast of Saint Swithin.",
                    true,
                )
                .unwrap()
                .id
        };
        // simulate the process boundary: a FRESH store that has only loaded its
        // index (open does not walk). The ledger is process-global and shared
        // with every parallel test, so this test never resets it — its secure
        // phrase is globally UNIQUE instead, so "absent before the warm" holds
        // without clobbering another test's entries.
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;

        // the exact bytes the ungated editor lane hands the webview — the body
        // with frontmatter stripped, no marker for the detector to find
        let stripped = store.read(&secure_id).unwrap().body;
        assert!(!crate::secret::looks_secure(&stripped), "not secret-SHAPED");
        // BEFORE the warm the ledger has never seen this root's prose, so the
        // race is real — this is the hole the startup walk exists to close,
        // asserted so a regression (e.g. open() starting to walk, or the warm
        // being dropped) shows up here
        assert!(
            !crate::secret::blocked_for_remote(&stripped),
            "cold ledger: without the warm the stripped body would egress"
        );

        // the STARTUP action — the same call lib.rs makes per root, NOT a list()
        store.warm_secure_ledger().unwrap();

        // now the stripped body cannot leave by any seam, whichever ungated
        // command fetched it
        assert!(crate::secret::blocked_for_remote(&stripped));
        assert!(crate::secret::blocked_for_remote(
            "the wexford escrow releases on the feast of saint swithin"
        ));
    }

    /// A secure note is EDITABLE by the class that can see it (secure gates
    /// visibility, not authorship) and refused to the class that cannot.
    #[test]
    fn write_for_ai_follows_the_same_read_gate() {
        let tmp = TempDir::new().unwrap();
        let mut store = CorpusStore::open(tmp.path().join("corpus")).unwrap();
        store.os_trash = false;
        let note = store
            .create_with_policy("Secure notes", "# Private\n\nbody", true)
            .unwrap();
        assert!(store
            .write_for_ai(&note.id, "# Private\n\nremote edit", false)
            .is_err());
        assert!(store
            .write_for_ai(&note.id, "# Private\n\nlocal edit", true)
            .is_ok());
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

        let staged = store
            .create("wiki/_inbox", "# A staged note\n\nbody")
            .unwrap();
        let rel = store.path_of(&staged.id).unwrap();
        // a user key on a user-writable note: fine
        assert!(store.set_field(&rel, "shelf", "[Inbox]").is_ok());
        // every AI key is refused in the user lane — even where writable() passes
        for key in AI_KEYS {
            assert!(
                store.set_field(&rel, key, "x").is_err(),
                "AI key `{key}` must refuse"
            );
        }
        // reserved keys stay refused (existing behavior)
        assert!(store.set_field(&rel, "locked", "true").is_err());
        // the curated wiki is user-writable (2026-08-03): a USER key lands, but
        // AI keys stay the filer's alone even there
        assert!(store.set_field("wiki/note.md", "topic", "x").is_ok());
        assert!(store.set_field("wiki/note.md", "area", "x").is_err());
    }

    /// #3 (audit 2026-07): the contract band and a brain's user-set read-only
    /// perms are enforced by the RUST write gates — both lanes — not only TS.
    #[test]
    fn out_of_band_or_read_only_brain_refuses_writes_in_rust() {
        // a memex on a FUTURE contract rotli wasn't built for → read-only, both lanes
        let tmp = TempDir::new().unwrap();
        let ahead = tmp.path().join("ahead");
        seed_memex(&ahead);
        fs::write(
            ahead.join("memex.json"),
            "{\"id\":\"mx_future\",\"contract\":\"9.9\",\"apps\":{}}",
        )
        .unwrap();
        let mut store = CorpusStore::open(ahead).unwrap();
        store.os_trash = false;
        assert!(
            store.writable("chats/x.md").is_err(),
            "user lane closed out of band"
        );
        assert!(
            store.filer_writable("wiki/_inbox").is_err(),
            "filer lane closed out of band"
        );
        assert!(store.create("chats", "# chat").is_err());

        // in-band brain: open, then user-set read-only perms close both lanes live
        let inband = tmp.path().join("inband");
        seed_memex(&inband);
        let mut store = CorpusStore::open(inband).unwrap();
        store.os_trash = false;
        assert!(store.writable("chats/x.md").is_ok());
        assert!(store.filer_writable("wiki/_inbox").is_ok());
        store.set_perms_read_only(true);
        assert!(
            store.writable("chats/x.md").is_err(),
            "read-only perms close the user lane"
        );
        assert!(
            store.filer_writable("wiki/_inbox").is_err(),
            "…and the filer lane"
        );
        store.set_perms_read_only(false);
        assert!(
            store.writable("chats/x.md").is_ok(),
            "perms can re-open an in-band brain"
        );
    }

    /// #44 (audit 2026-07): the webview's settings-write whitelist is NARROWER
    /// than the read table — the daemon's `organizer.json` and the committed
    /// `main.json` are not writable through corpus_settings_write.
    #[test]
    fn settings_write_whitelist_protects_daemon_and_main_files() {
        assert!(user_dot_writable("settings").is_ok());
        assert!(user_dot_writable("viewstate").is_ok());
        assert!(
            user_dot_writable("background").is_err(),
            "legacy wallpaper is read-only"
        );
        assert!(
            user_dot_writable("organizer").is_err(),
            "daemon-owned state"
        );
        assert!(
            user_dot_writable("main").is_err(),
            "main goes through corpus_main_write"
        );
        assert!(
            user_dot_writable("views").is_err(),
            "views go through corpus_views_write"
        );
        assert!(user_dot_writable("junk").is_err());
        // the READ table still serves all five
        for f in ["settings", "viewstate", "background", "main", "organizer"] {
            assert!(dot_file(f).is_ok());
        }
    }

    #[test]
    fn stale_main_and_view_manifests_never_replace_newer_vault_structure() {
        let (_dir, mut store) = fresh();

        let opened_main = store.main_read_versioned().unwrap();
        let first_main = r#"{"version":1,"tree":[{"note":"first"}]}"#;
        store
            .main_write_if_revision(first_main, &opened_main.revision)
            .unwrap();
        let stale_main = r#"{"version":1,"tree":[{"note":"stale"}]}"#;
        let error = store
            .main_write_if_revision(stale_main, &opened_main.revision)
            .unwrap_err();
        assert!(error.contains("revision conflict"), "{error}");
        assert_eq!(store.main_read().unwrap(), first_main);

        let opened_views = store.views_read_versioned().unwrap();
        let first_views = r#"{"version":1,"views":[{"name":"Work","tree":[]}]}"#;
        store
            .views_write_if_revision(first_views, &opened_views.revision)
            .unwrap();
        let stale_views = r#"{"version":1,"views":[{"name":"Personal","tree":[]}]}"#;
        let error = store
            .views_write_if_revision(stale_views, &opened_views.revision)
            .unwrap_err();
        assert!(error.contains("revision conflict"), "{error}");
        assert_eq!(store.views_read().unwrap(), first_views);
    }

    #[test]
    fn failed_view_rollback_never_replaces_a_newer_note_edit() {
        let (_dir, mut store) = fresh();
        let note = store.create("Inbox", "# Original\n\nBody").unwrap();
        let rel = store.path_of(&note.id).unwrap();
        let path = store.abs(&rel);
        let prior = fs::read_to_string(&path).unwrap();
        let applied = with_view_tag(&prior, Some("Work"));
        fs::write(&path, &applied).unwrap();

        let newer = applied.replace("Body", "Newer edit");
        fs::write(&path, &newer).unwrap();
        store.rollback_view_note_writes(&[(path.clone(), prior.clone(), applied.clone())]);
        assert_eq!(fs::read_to_string(&path).unwrap(), newer);

        fs::write(&path, &applied).unwrap();
        store.rollback_view_note_writes(&[(path.clone(), prior.clone(), applied)]);
        assert_eq!(fs::read_to_string(&path).unwrap(), prior);
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
        let meta = store.write("01ABC", "# Pricing\n\nedited body").unwrap();
        // the default "Inbox" shelf projects onto the Captures surface ("Board"), not wiki/_inbox
        assert_eq!(meta.folder_id, "Board");

        // A first save normalizes the legacy slug-id filename into the clean
        // title slug while retaining the old human stem as a durable alias.
        let inbox = root.join("wiki/_inbox");
        let files: Vec<String> = fs::read_dir(&inbox)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".md"))
            .collect();
        assert_eq!(
            files,
            vec!["pricing.md"],
            "expected one clean slug file, got {files:?}"
        );
        let on_disk = fs::read_to_string(inbox.join("pricing.md")).unwrap();
        let _ = rel; // the original path is gone after the title-tracking rename
        assert!(on_disk.contains("aliases: [\"pricing-aa11bb\"]"));
        // the v3.5 user + AI metadata rode through untouched (foreign preservation)
        assert!(on_disk.contains("owner: rotli"), "owner lost:\n{on_disk}");
        assert!(on_disk.contains("shelf: [Inbox]"), "shelf lost:\n{on_disk}");
        assert!(on_disk.contains("reach: [seth]"), "reach lost:\n{on_disk}");
        assert!(on_disk.contains("summary:"), "summary lost:\n{on_disk}");
        // created preserved as the original DATE; updated bumped to a DATE (not RFC3339)
        assert!(
            on_disk.contains("created: 2026-06-20"),
            "created changed:\n{on_disk}"
        );
        assert!(
            !on_disk.contains("updated: 2026-06-20"),
            "updated not bumped:\n{on_disk}"
        );
        let updated_line = on_disk.lines().find(|l| l.starts_with("updated:")).unwrap();
        assert!(
            !updated_line.contains('T'),
            "updated should be a date, not RFC3339: {updated_line}"
        );
        // the body changed
        assert!(on_disk.contains("edited body"));
        assert!(!on_disk.contains("original body"));
    }

    #[test]
    fn shelf_of_parses_the_v35_field() {
        let fm = |line: &str| Frontmatter {
            foreign: vec![line.to_string()],
            ..Default::default()
        };
        assert_eq!(shelf_of(&fm("shelf: [Inbox]")), vec!["Inbox"]);
        assert_eq!(
            shelf_of(&fm("shelf: [Northstar/Payments, Work]")),
            vec!["Northstar/Payments", "Work"]
        );
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
            "---\nid: 01DEF\nshelf: [Northstar/Payments]\nreach: [seth]\n---\n# Q3\n\nbody\n",
        )
        .unwrap();
        // Filing preserves the user's shelf. The wire therefore needs BOTH the
        // Captures projection and the physical Brain home so "Show in Brain"
        // can reveal this note under Projects.
        fs::create_dir_all(root.join("wiki/projects")).unwrap();
        fs::write(
            root.join("wiki/projects/cross-project-tasks.md"),
            "---\nid: 01GHI\nshelf: [Inbox]\narea: projects\n---\n# Cross-project tasks\n\nbody\n",
        )
        .unwrap();

        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);
        let list = store.list().unwrap();

        let folder_of_note = |id: &str| {
            list.notes
                .iter()
                .find(|n| n.title == id)
                .map(|n| n.folder_id.clone())
                .unwrap()
        };
        // staging notes are PROJECTED onto their shelf, not wiki/_inbox. The default
        // "Inbox" shelf routes to the Captures surface ("Board"); a real shelf stays.
        assert_eq!(folder_of_note("Pricing"), "Board");
        assert_eq!(folder_of_note("Q3"), "Northstar/Payments");
        assert_eq!(folder_of_note("Cross-project tasks"), "Board");
        // the shelf-less curated note falls back to its disk folder
        assert_eq!(folder_of_note("A wiki note"), "wiki");

        let filed = list
            .notes
            .iter()
            .find(|n| n.title == "Cross-project tasks")
            .unwrap();
        assert_eq!(filed.disk_folder_id, "wiki/projects");
        let staged = list.notes.iter().find(|n| n.title == "Pricing").unwrap();
        assert_eq!(staged.disk_folder_id, "wiki/_inbox");
        let read = store.read("01GHI").unwrap();
        assert_eq!(read.folder_id, "Board");
        assert_eq!(read.disk_folder_id, "wiki/projects");

        let has = |id: &str| list.folders.iter().any(|f| f.id == id);
        // the shelf folders (+ the nested ancestor) were synthesized — the default
        // "Inbox" shelf lands on "Board" (Captures), a real shelf keeps its path
        assert!(has("Board"));
        assert!(has("Northstar"), "the nested shelf's ancestor must exist");
        assert!(has("Northstar/Payments"));
        let parent_of = |id: &str| {
            list.folders
                .iter()
                .find(|f| f.id == id)
                .unwrap()
                .parent_id
                .clone()
        };
        assert_eq!(
            parent_of("Northstar/Payments"),
            Some("Northstar".to_string())
        );
        assert_eq!(parent_of("Northstar"), None);
        // the wiki/_inbox staging dir is NOT surfaced as a browsable folder
        assert!(!has("wiki/_inbox"));
        // the real wiki folder still exists (curated notes live there)
        assert!(has("wiki"));
    }

    #[test]
    fn surfaced_scopes_a_memex_to_wiki_and_chats() {
        let m = Layout::Memex;
        // hidden: every control/root doc — plumbing, not knowledge
        assert_eq!(surfaced(m, "STRUCTURE.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "memex.json"), Surface::Hidden);
        assert_eq!(surfaced(m, "self/x.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "clients/x.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "scripts/organize.ts"), Surface::Hidden);
        assert_eq!(
            surfaced(m, crate::memex::WELCOME_PRESET_FILE),
            Surface::NoteRW
        );
        assert_eq!(surfaced(m, "Another root note.md"), Surface::Hidden);
        // REFERENCE (2026-08-01): out of the Notes tree, reachable by the AI
        assert_eq!(surfaced(m, "inbox.md"), Surface::Reference);
        assert_eq!(surfaced(m, "MAP.md"), Surface::Reference);
        assert_eq!(surfaced(m, "history/2026/x.md"), Surface::Reference);
        assert_eq!(surfaced(m, "identity"), Surface::Reference);
        assert_eq!(surfaced(m, "identity/00-identity.md"), Surface::Reference);
        assert_eq!(
            surfaced(m, "personality/04-principles.md"),
            Surface::Reference
        );
        // a SIBLING whose name merely starts with a lane name is not the lane
        assert_eq!(surfaced(m, "identity-drafts/x.md"), Surface::Hidden);
        assert_eq!(surfaced(m, "MAP.md.bak"), Surface::Hidden);
        // storage/ — the binary asset store: surfaced READ-ONLY (the Storage front),
        // never writable via the note path (writable() refuses NoteRO, asserted below).
        assert_eq!(surfaced(m, "storage"), Surface::NoteRO);
        assert_eq!(surfaced(m, "storage/graph.png"), Surface::NoteRO);
        // surfaced: chats + wiki + lifecycle sinks all writable (wiki since
        // 2026-08-03 — a Librarian-filed note stays editable)
        assert_eq!(surfaced(m, "chats/x.md"), Surface::NoteRW);
        assert_eq!(surfaced(m, "chats"), Surface::NoteRW);
        assert_eq!(surfaced(m, "archive"), Surface::NoteRW);
        assert_eq!(surfaced(m, "trash/storage/file.pdf"), Surface::NoteRW);
        assert_eq!(surfaced(m, "wiki/x.md"), Surface::NoteRW);
        assert_eq!(surfaced(m, "wiki/engineering/filed.md"), Surface::NoteRW);
        assert_eq!(surfaced(m, "wiki"), Surface::NoteRW);
        // LegacyRotli surfaces everything read-write (today)
        assert_eq!(
            surfaced(Layout::LegacyRotli, "STRUCTURE.md"),
            Surface::NoteRW
        );
        assert_eq!(surfaced(Layout::LegacyRotli, "self/x.md"), Surface::NoteRW);
    }

    /// The 2026-08-01 flip: the brain's memory lanes are RETRIEVABLE by the AI
    /// for BOTH model classes, while staying out of the user's Notes tree and
    /// out of every write lane (docs/design/ai-visibility-matrix.md).
    #[test]
    fn reference_lanes_are_ai_retrievable_and_never_in_the_notes_tree() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        fs::create_dir_all(root.join("identity")).unwrap();
        fs::create_dir_all(root.join("personality")).unwrap();
        fs::write(
            root.join("identity/00-identity.md"),
            "# Identity\n\nthe maintainer is a quokkanaut.\n",
        )
        .unwrap();
        fs::write(
            root.join("personality/04-principles.md"),
            "# Principles\n\nquokkanaut rules\n",
        )
        .unwrap();
        fs::write(
            root.join("history/2026/day.md"),
            "# A day\n\nquokkanaut log\n",
        )
        .ok();
        fs::create_dir_all(root.join("history/2026")).unwrap();
        fs::write(
            root.join("history/2026/day.md"),
            "# A day\n\nquokkanaut log\n",
        )
        .unwrap();

        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;

        // NOT in the Notes tree: no note rows, no folder rows
        let list = store.list().unwrap();
        assert!(!list.notes.iter().any(|n| n.id.starts_with("identity/")));
        assert!(!list.notes.iter().any(|n| n.title == "Identity"));
        for hidden in ["identity", "personality", "history", "history/2026"] {
            assert!(
                !list.folders.iter().any(|f| f.id == hidden),
                "{hidden} became a folder row"
            );
        }
        assert!(
            list.notes.iter().any(|n| n.title == "A wiki note"),
            "the wiki note still lists"
        );

        // retrievable through the AI's own lane
        let reference = store.reference_notes().unwrap();
        for rel in [
            "identity/00-identity.md",
            "personality/04-principles.md",
            "MAP.md",
            "inbox.md",
        ] {
            assert!(
                reference.iter().any(|n| n.id == rel),
                "{rel} missing from the reference lane"
            );
        }
        assert!(
            !reference.iter().any(|n| n.id == "STRUCTURE.md"),
            "control docs stay hidden"
        );
        assert!(!reference.iter().any(|n| n.id == "memex.json"));

        // search: OUT by default, IN when the AI asks — and READABLE by BOTH classes
        assert!(store.search("quokkanaut", 50, false).unwrap().is_empty());
        let hits = store.search("quokkanaut", 50, true).unwrap();
        assert!(hits.iter().any(|h| h.id == "identity/00-identity.md"));
        assert!(hits.iter().any(|h| h.id == "personality/04-principles.md"));
        assert!(hits.iter().any(|h| h.id == "history/2026/day.md"));
        for hit in &hits {
            assert!(
                store.read_for_ai(&hit.id, true).is_ok(),
                "on-device must read {}",
                hit.id
            );
            assert!(
                store.read_for_ai(&hit.id, false).is_ok(),
                "frontier must read {}",
                hit.id
            );
        }
        assert!(store
            .read_for_ai("identity/00-identity.md", false)
            .unwrap()
            .contains("quokkanaut"));

        // still unwritable by every lane, and control files stay unreadable
        assert!(store
            .write_for_ai("identity/00-identity.md", "# Pwned\n", true)
            .is_err());
        assert!(store.write("identity/00-identity.md", "# Pwned\n").is_err());
        assert!(store.read_for_ai("STRUCTURE.md", true).is_err());
        assert!(store.read_for_ai("memex.json", false).is_err());
    }

    #[test]
    fn writable_gate_refuses_the_brain_allows_chats() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root).unwrap();
        store.os_trash = false;
        assert_eq!(store.layout, Layout::Memex);

        // forbidden: self/history/MAP/inbox + control files + the root
        assert!(store.writable("self/identity.md").is_err());
        assert!(store.writable("history/x.md").is_err());
        assert!(store.writable("MAP.md").is_err());
        assert!(store.writable("inbox.md").is_err());
        assert!(store.writable("memex.json").is_err());
        assert!(store.writable("").is_err());
        // allowed: chats, wiki (curated included — 2026-08-03), lifecycle sinks
        assert!(store.writable("chats").is_ok());
        assert!(store.writable("chats/new.md").is_ok());
        assert!(store.writable("wiki/note.md").is_ok());
        assert!(store.writable("wiki/engineering/filed.md").is_ok());
        assert!(store.writable("archive").is_ok());
        assert!(store.writable("trash/storage/file.pdf").is_ok());
    }

    /// the maintainer, 2026-08-04: "⚠ Couldn't delete this note — note not found:
    /// storage/excalidraw/untitled-2.excalidraw … I don't understand why I
    /// can't delete something that is showing in my view."
    ///
    /// A board is addressed by its REL path and never enters the ULID index, so
    /// the note lane's `path_of` refused it outright — trash IS a move, so board
    /// delete/archive/move were all dead. And had it resolved, `relocate` would
    /// have composed frontmatter INTO the board's JSON and retitled the file
    /// after the scene's first line. The opaque lane moves the bytes untouched.
    #[test]
    fn a_board_trashes_and_restores_without_touching_its_bytes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        seed_memex(&root);
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let board = store
            .create_named_board("storage/excalidraw", "untitled", None)
            .unwrap();
        let scene = fs::read_to_string(root.join(&board.id)).unwrap();
        assert!(board.id.ends_with(".excalidraw"));

        // the exact failing call: trash is move_note(id, "Trash")
        let trashed = store.move_note(&board.id, "Trash").unwrap();
        assert!(!root.join(&board.id).is_file(), "the board left its lane");
        assert_eq!(trashed.kind, NoteKind::Board);
        // bytes are IDENTICAL — no frontmatter composed into the JSON
        assert_eq!(fs::read_to_string(root.join(&trashed.id)).unwrap(), scene);
        // …and the filename survived (relocate would have slugified the JSON)
        assert!(
            trashed.id.ends_with("untitled.excalidraw"),
            "{}",
            trashed.id
        );

        // the round trip: it goes back where it came from
        let restored = store.restore_file(&trashed.id).unwrap();
        assert_eq!(restored, board.id);
        assert_eq!(fs::read_to_string(root.join(&restored)).unwrap(), scene);

        // delete() — the sibling lane — resolves a board rel too
        store.delete(&board.id).unwrap();
        assert!(!root.join(&board.id).is_file());
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
        // saves (the maintainer, 2026-07-07). write_board takes an explicit path with no such
        // redirect, so a hidden root is still refused outright.
        let staged = store.create_named_board("self", "untitled", None).unwrap();
        assert_eq!(staged.kind, NoteKind::Board);
        assert_eq!(staged.folder_id, "storage/excalidraw");
        // …and a board in that lane is EDITABLE (the jorge case: saves succeed).
        assert!(store.write_board(&staged.id, EMPTY_EXCALIDRAW).is_ok());
        assert!(
            store.writable("storage/other.png").is_err(),
            "rest of storage stays read-only"
        );
        assert!(store.write_board("self/x.excalidraw", "{}").is_err());
        // …and a board created directly on chats/ (rotli's owned surface) stays there
        let meta = store.create_named_board("chats", "untitled", None).unwrap();
        assert_eq!(meta.kind, NoteKind::Board);
        assert_eq!(meta.folder_id, "chats");
        assert!(store
            .read_board(&meta.id)
            .unwrap()
            .body
            .contains("excalidraw"));

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

        // NO Rotli-only folders are scaffolded inside someone's memex. Archive
        // and Trash already exist as lowercase durable memex lifecycle lanes.
        for name in ["Inbox", "Brain", "Storage", "Board"] {
            assert!(
                !store.root().join(name).exists(),
                "memex open must not scaffold the reserved folder {name}"
            );
        }
        // Opening an existing memex never invents a welcome note. Only the
        // explicit fresh-vault scaffold owns that preset.
        let list = store.list().unwrap();
        assert!(
            list.notes.iter().all(|n| n.title != "Welcome to rotli"),
            "first-run welcome note leaked into the memex"
        );

        // The tree shows content lanes plus title-cased lifecycle destinations,
        // never self/history/control material.
        let folder_ids: Vec<&str> = list.folders.iter().map(|f| f.id.as_str()).collect();
        assert!(
            folder_ids.contains(&"wiki"),
            "wiki/ should surface as a folder"
        );
        assert!(
            folder_ids.contains(&"chats"),
            "chats/ should surface as a folder"
        );
        assert!(
            !folder_ids.iter().any(|f| f.starts_with("self")),
            "self/ must stay hidden"
        );
        assert!(
            !folder_ids.iter().any(|f| f.starts_with("history")),
            "history/ must stay hidden"
        );
        assert!(
            folder_ids.contains(&"Archive"),
            "archive/ should project to Archive"
        );
        assert!(
            folder_ids.contains(&"Trash"),
            "trash/ should project to Trash"
        );
        assert!(
            !folder_ids.iter().any(|f| f.starts_with("archive")),
            "lowercase disk id leaked"
        );
        // STRUCTURE.md / inbox.md / MAP.md (root .md docs) never appear as notes
        let folders_of: Vec<&str> = list.notes.iter().map(|n| n.folder_id.as_str()).collect();
        assert!(
            list.notes
                .iter()
                .all(|n| n.title != "Structure" && n.title != "MAP" && n.title != "Inbox"),
            "a root memex-vault doc surfaced as an editable note"
        );
        // every surfaced note lives under wiki/ or chats/, nothing else
        assert!(
            folders_of.iter().all(|f| *f == "wiki" || *f == "chats"),
            "a note outside wiki/+chats/ surfaced: {folders_of:?}"
        );
    }

    #[test]
    fn scaffolded_welcome_is_an_editable_root_note_with_normal_trash_lifecycle() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("vault");
        crate::memex::scaffold_memex(&root).unwrap();
        let mut store = CorpusStore::open(root.clone()).unwrap();
        store.os_trash = false;

        let id = store.wire_id_of(crate::memex::WELCOME_PRESET_FILE).unwrap();
        let initial = store.read(&id).unwrap();
        assert_eq!(initial.folder_id, "");
        assert_eq!(initial.disk_folder_id, "");

        store
            .write(&id, "# My first Rotli note\n\nI changed the welcome.")
            .unwrap();
        assert!(root.join(crate::memex::WELCOME_PRESET_FILE).is_file());
        assert!(!root.join("my-first-rotli-note.md").exists());

        let trashed = store.move_note(&id, "Trash").unwrap();
        assert_eq!(trashed.folder_id, "Trash");
        assert_eq!(trashed.origin.as_deref(), Some(""));
        assert!(!root.join(crate::memex::WELCOME_PRESET_FILE).exists());
        assert!(root.join(store.path_of(&id).unwrap()).is_file());
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
        assert_eq!(
            split_root_id("Inbox/Work"),
            ("default".into(), "Inbox/Work".into())
        );
        assert_eq!(
            split_root_id("01JXF00000000000000000000A"),
            ("default".into(), "01JXF00000000000000000000A".into())
        );
        // a non-default root prefixes "<rootid>:" and splits on the FIRST colon
        assert_eq!(
            split_root_id("vault:wiki/foo"),
            ("vault".into(), "wiki/foo".into())
        );
        assert_eq!(
            split_root_id("vault:chats/x.md"),
            ("vault".into(), "chats/x.md".into())
        );
        assert_eq!(split_root_id("vault:"), ("vault".into(), "".into()));

        // compose: default → BARE (no prefix, ever); non-default → prefixed
        assert_eq!(compose_root_id("default", "Inbox"), "Inbox");
        assert_eq!(compose_root_id("default", "Inbox/Work"), "Inbox/Work");
        assert_eq!(compose_root_id("vault", "wiki/foo"), "vault:wiki/foo");

        // round-trips for the default root are IDENTITY on the wire
        for id in [
            "Inbox",
            "Inbox/Work",
            "Storage",
            "01JXF00000000000000000000A",
        ] {
            let (r, rel) = split_root_id(id);
            assert_eq!(
                compose_root_id(&r, &rel),
                id,
                "default round-trip must be byte-identical"
            );
        }
    }

    #[test]
    fn colon_is_rejected_inside_a_path_component() {
        // the router char must never be allowed inside a folder name, or a
        // folder literally named "a:b" could collide with "<rootid>:path".
        let (_dir, mut store) = bare();
        assert!(
            store.create_folder("a:b", None).is_err(),
            "colon name must be rejected"
        );
        assert!(
            store.create("a:b", "# nope\n").is_err(),
            "colon folder must be rejected"
        );
        assert!(validate_component("plain").is_ok());
        assert!(validate_component("has:colon").is_err());
        // the file read/open lanes (corpus_file_text/_bytes/open_file) now run
        // this on the webview-supplied rel — a traversal escape must be rejected
        // (audit 2026-07). Mirrors the write lanes.
        assert!(validate_rel("../../.ssh/id_rsa").is_err());
        assert!(validate_rel("/etc/passwd").is_err());
        assert!(validate_rel("wiki/notes/ok.md").is_ok());
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
            adopted: false,
        });
        assert_eq!(reg.roots.len(), 1);
        assert_eq!(
            reg.get(DEFAULT_ROOT_ID).unwrap().abs_path,
            PathBuf::from("/tmp/rotli2")
        );
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
        assert!(
            store.root().join("Brain").is_dir(),
            "existing Brain folder must survive"
        );
        assert!(
            store.root().join("Brain/kept.md").is_file(),
            "the note must survive"
        );
        // and it surfaces as a plain folder in the listing (no data loss)
        let list = store.list().unwrap();
        assert!(
            list.folders.iter().any(|f| f.id == "Brain"),
            "Brain surfaces as a plain folder"
        );
        let note = list
            .notes
            .iter()
            .find(|n| n.id == "01BRAINKEEP000000000000AAA")
            .unwrap();
        assert_eq!(note.folder_id, "Brain");
    }

    /// Mirror of `corpus_list`'s active-vault scope without Tauri State.
    fn list_active(reg: &mut CorpusRegistry) -> CorpusList {
        let default_id = reg.default_id.clone();
        reg.stores.get_mut(&default_id).unwrap().list().unwrap()
    }

    #[test]
    fn default_only_registry_emits_bare_ids() {
        // Invariant 1, at the routing layer: with ONLY the default root, every
        // emitted folder/note id is BARE — byte-identical to the single-store world.
        let (_dir, mut store) = fresh();
        store.create("Inbox/Work", "# A routed note\n").unwrap();
        let mut reg = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        reg.insert(DEFAULT_ROOT_ID.to_string(), store).unwrap();
        let list = list_active(&mut reg);
        for f in &list.folders {
            assert!(
                !f.id.contains(':'),
                "default folder id must be bare: {}",
                f.id
            );
            assert!(f
                .parent_id
                .as_deref()
                .map(|p| !p.contains(':'))
                .unwrap_or(true));
        }
        for n in &list.notes {
            assert!(
                !n.id.contains(':'),
                "default note id must be bare: {}",
                n.id
            );
            assert!(
                !n.folder_id.contains(':'),
                "default folder_id must be bare: {}",
                n.folder_id
            );
            assert!(
                !n.disk_folder_id.contains(':'),
                "default disk_folder_id must be bare: {}",
                n.disk_folder_id
            );
        }
        assert!(list.folders.iter().any(|f| f.id == "Inbox/Work"));
    }

    #[test]
    fn duplicate_or_malformed_root_ids_never_replace_an_existing_route() {
        let (_first_dir, first) = fresh();
        let (_second_dir, second) = fresh();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry.insert("vault".into(), first).unwrap();
        assert!(registry.insert("vault".into(), second).is_err());
        let (_third_dir, third) = fresh();
        assert!(registry.insert("bad:id".into(), third).is_err());
        assert!(registry.stores.contains_key("vault"));
        assert_eq!(registry.stores.len(), 1);
    }

    #[test]
    fn activating_a_registered_vault_swaps_the_default_route_without_a_restart() {
        let (_outgoing_dir, outgoing) = fresh();
        let (_incoming_dir, incoming) = fresh();
        let incoming_path = incoming.root().to_path_buf();
        let outgoing_path = outgoing.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), outgoing)
            .unwrap();
        registry.insert("work".into(), incoming).unwrap();
        let state = CorpusState(Mutex::new(registry));

        state
            .activate_registered_root("work", || Ok(Some("personal".into())))
            .unwrap();

        assert_eq!(state.default_root_path().unwrap(), incoming_path);
        let registry = state.0.lock().unwrap();
        assert_eq!(
            registry.stores.get("personal").unwrap().root(),
            outgoing_path
        );
        assert!(!registry.stores.contains_key("work"));
    }

    #[test]
    fn activating_a_registered_vault_can_detach_a_plain_outgoing_folder() {
        let (_outgoing_dir, outgoing) = fresh();
        let (_incoming_dir, incoming) = fresh();
        let incoming_path = incoming.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), outgoing)
            .unwrap();
        registry.insert("work".into(), incoming).unwrap();
        let state = CorpusState(Mutex::new(registry));

        state.activate_registered_root("work", || Ok(None)).unwrap();

        assert_eq!(state.default_root_path().unwrap(), incoming_path);
        let registry = state.0.lock().unwrap();
        assert_eq!(registry.stores.len(), 1);
        assert!(!registry.stores.contains_key("work"));
    }

    #[test]
    fn a_failed_live_switch_persistence_leaves_routes_untouched() {
        let (_outgoing_dir, outgoing) = fresh();
        let (_incoming_dir, incoming) = fresh();
        let outgoing_path = outgoing.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), outgoing)
            .unwrap();
        registry.insert("work".into(), incoming).unwrap();
        let state = CorpusState(Mutex::new(registry));

        let error = state
            .activate_registered_root("work", || Err("config write failed".into()))
            .unwrap_err();

        assert_eq!(error, "config write failed");
        assert_eq!(state.default_root_path().unwrap(), outgoing_path);
        assert!(state.contains_root("work").unwrap());
    }

    #[test]
    fn activating_a_new_vault_populates_an_empty_first_run_registry() {
        let (_incoming_dir, incoming) = fresh();
        let incoming_path = incoming.root().to_path_buf();
        let state = CorpusState(Mutex::new(CorpusRegistry::new(DEFAULT_ROOT_ID.to_string())));

        state.activate_new_root(incoming, || Ok(None)).unwrap();

        assert_eq!(state.default_root_path().unwrap(), incoming_path);
        assert_eq!(state.0.lock().unwrap().stores.len(), 1);
    }

    #[test]
    fn a_failed_new_vault_persistence_does_not_change_the_live_registry() {
        let (_outgoing_dir, outgoing) = fresh();
        let (_incoming_dir, incoming) = fresh();
        let outgoing_path = outgoing.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), outgoing)
            .unwrap();
        let state = CorpusState(Mutex::new(registry));

        let error = state
            .activate_new_root(incoming, || Err("config write failed".into()))
            .unwrap_err();

        assert_eq!(error, "config write failed");
        assert_eq!(state.default_root_path().unwrap(), outgoing_path);
        assert_eq!(state.0.lock().unwrap().stores.len(), 1);
    }

    #[test]
    fn removing_a_connected_vault_drops_only_its_live_route() {
        let (_active_dir, active) = fresh();
        let (_connected_dir, connected) = fresh();
        let connected_path = connected.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), active)
            .unwrap();
        registry.insert("work".into(), connected).unwrap();
        let state = CorpusState(Mutex::new(registry));

        let removed = state.remove_registered_root("work", || Ok(())).unwrap();

        assert_eq!(removed, connected_path);
        assert!(!state.contains_root("work").unwrap());
        assert!(
            connected_path.is_dir(),
            "disconnecting must never delete files"
        );
        assert!(state.contains_root(DEFAULT_ROOT_ID).unwrap());
    }

    #[test]
    fn failed_connected_vault_removal_keeps_the_live_route() {
        let (_active_dir, active) = fresh();
        let (_connected_dir, connected) = fresh();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), active)
            .unwrap();
        registry.insert("work".into(), connected).unwrap();
        let state = CorpusState(Mutex::new(registry));

        let error = state
            .remove_registered_root("work", || Err("config write failed".into()))
            .unwrap_err();

        assert_eq!(error, "config write failed");
        assert!(state.contains_root("work").unwrap());
    }

    #[test]
    fn refreshing_the_active_vault_replaces_only_the_default_store() {
        let (_active_dir, active) = fresh();
        let active_path = active.root().to_path_buf();
        let (_connected_dir, connected) = fresh();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), active)
            .unwrap();
        registry.insert("work".into(), connected).unwrap();
        let state = CorpusState(Mutex::new(registry));
        let reopened = CorpusStore::open(active_path.clone()).unwrap();

        state.refresh_root(DEFAULT_ROOT_ID, reopened).unwrap();

        assert_eq!(state.default_root_path().unwrap(), active_path);
        assert!(state.contains_root("work").unwrap());
    }

    #[test]
    fn refreshing_refuses_a_different_folder() {
        let (_active_dir, active) = fresh();
        let active_path = active.root().to_path_buf();
        let (_other_dir, other) = fresh();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), active)
            .unwrap();
        let state = CorpusState(Mutex::new(registry));

        assert_eq!(
            state.refresh_root(DEFAULT_ROOT_ID, other).unwrap_err(),
            "the refreshed vault does not match the selected vault"
        );
        assert_eq!(state.default_root_path().unwrap(), active_path);
    }

    #[test]
    fn refreshing_a_connected_vault_keeps_the_active_route_untouched() {
        let (_active_dir, active) = fresh();
        let active_path = active.root().to_path_buf();
        let (_connected_dir, connected) = fresh();
        let connected_path = connected.root().to_path_buf();
        let mut registry = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        registry
            .insert(DEFAULT_ROOT_ID.to_string(), active)
            .unwrap();
        registry.insert("work".into(), connected).unwrap();
        let state = CorpusState(Mutex::new(registry));

        let reopened = CorpusStore::open(connected_path).unwrap();
        state.refresh_root("work", reopened).unwrap();

        assert_eq!(state.default_root_path().unwrap(), active_path);
        assert!(state.contains_root("work").unwrap());
    }

    #[test]
    fn connected_vault_stays_out_of_the_active_listing() {
        // A connected vault is a future switch target, not a simultaneous data
        // source. Its files never enter the current System counts or searches.
        let (_ddir, default_store) = fresh();
        let vdir = TempDir::new().unwrap();
        let vroot = vdir.path().join("brain");
        seed_memex(&vroot);
        let mut vault_store = CorpusStore::open(vroot.clone()).unwrap();
        vault_store.os_trash = false;
        assert_eq!(vault_store.layout, Layout::Memex);

        let mut reg = CorpusRegistry::new(DEFAULT_ROOT_ID.to_string());
        reg.insert(DEFAULT_ROOT_ID.to_string(), default_store)
            .unwrap();
        reg.insert("vault".to_string(), vault_store).unwrap();
        let list = list_active(&mut reg);

        let default_folders: Vec<&str> = list.folders.iter().map(|f| f.id.as_str()).collect();
        assert!(
            default_folders.contains(&"Inbox"),
            "default Inbox stays bare"
        );
        assert!(
            list.folders.iter().all(|folder| !folder.id.contains(':')),
            "connected vault folders must stay hidden"
        );
        assert!(list.notes.iter().all(|note| !note.id.starts_with("vault:")));
        // the memex root was never scaffolded with local reserved rows
        for name in ["Inbox", "Vault", "Storage", "Board"] {
            assert!(
                !vroot.join(name).exists(),
                "vault memex must not be scaffolded: {name}"
            );
        }
    }

    #[test]
    fn adopted_markdown_tree_keeps_visible_files_and_seeds_nested_main_references() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("obsidian-vault");
        fs::create_dir_all(root.join("Projects/Rotli")).unwrap();
        fs::write(root.join("loose.md"), "# Loose\n").unwrap();
        fs::write(root.join("Projects/brief.md"), "# Brief\n").unwrap();
        fs::write(root.join("Projects/Rotli/plan.md"), "# Plan\n").unwrap();

        let mut store = CorpusStore::open_adopted(root.clone()).unwrap();
        for reserved in [
            "Inbox",
            "Secure notes",
            "Vault",
            "Storage",
            "Board",
            "Archive",
            "Trash",
        ] {
            assert!(
                !root.join(reserved).exists(),
                "adoption injected visible folder {reserved}"
            );
        }

        store.seed_main_from_disk_if_missing().unwrap();
        let raw = fs::read_to_string(root.join(DOT_DIR).join("main.json")).unwrap();
        let manifest: ReferenceManifest = serde_json::from_str(&raw).unwrap();
        assert_eq!(manifest.version, 1);
        assert_eq!(
            manifest.tree.len(),
            2,
            "root folder + loose note should appear once"
        );
        let projects = manifest
            .tree
            .iter()
            .find_map(|node| match node {
                ReferenceNode::Folder { folder, children } if folder == "Projects" => {
                    Some(children)
                }
                _ => None,
            })
            .expect("Projects folder mirrored into Main");
        assert_eq!(projects.len(), 2, "nested folder + direct note retained");
        assert!(projects.iter().any(|node| matches!(
            node,
            ReferenceNode::Folder { folder, children }
                if folder == "Rotli" && children.len() == 1
        )));
    }

    #[test]
    fn fresh_install_stays_unconfigured_until_a_real_or_legacy_root_exists() {
        let dir = TempDir::new().unwrap();
        let config = dir.path().join("config/corpus.json");
        let config_dir = config.parent().unwrap();
        let default_root = dir.path().join("Documents/rotli");
        fs::create_dir_all(config_dir).unwrap();
        assert!(!configured_at(&config, config_dir, &default_root));

        fs::write(
            &config,
            serde_json::json!({
                "version": 1,
                "corpus": {
                    "absPath": dir.path().join("moved-away-vault"),
                    "adopted": false
                }
            })
            .to_string(),
        )
        .unwrap();
        assert!(
            !configured_at(&config, config_dir, &default_root),
            "a stale absolute path must return to vault activation"
        );
        fs::remove_file(&config).unwrap();

        fs::write(config_dir.join("corpus-root.txt"), "/old/notes").unwrap();
        assert!(configured_at(&config, config_dir, &default_root));
        fs::remove_file(config_dir.join("corpus-root.txt")).unwrap();

        fs::create_dir_all(&default_root).unwrap();
        assert!(configured_at(&config, config_dir, &default_root));
    }

    // ─── the walk cache (perf audit 2026-07-30, #1/#5) ───────────────────────

    #[test]
    fn walk_cache_holds_until_the_generation_moves() {
        let (_dir, mut store) = bare();
        store.create("", "# First\n").unwrap();
        let n = store.list().unwrap().notes.len();

        // a DIRECT disk write (no store, no watcher running): an unchanged
        // generation means list() must serve the cache, not re-walk
        fs::write(store.root().join("sneaky.md"), "# Sneaky\n").unwrap();
        assert_eq!(
            store.list().unwrap().notes.len(),
            n,
            "cache re-walked without a bump"
        );

        // the watcher's lane: an external burst bumps the generation
        store.suppress_set().bump();
        assert_eq!(
            store.list().unwrap().notes.len(),
            n + 1,
            "bump did not refresh the walk"
        );
    }

    #[test]
    fn internal_writes_invalidate_the_walk_cache() {
        let (_dir, mut store) = bare();
        let before = store.list().unwrap().notes.len();
        store.create("", "# Fresh note\n").unwrap();
        assert_eq!(
            store.list().unwrap().notes.len(),
            before + 1,
            "a store write must invalidate the cached walk (suppress.mark bumps)"
        );
    }

    #[test]
    fn search_and_tasks_ride_the_cached_parse() {
        let (_dir, mut store) = bare();
        store
            .create("", "# Groceries\n\noat milk\n\n- [ ] buy the good butter\n")
            .unwrap();
        // both projections answer from the SAME cached walk — and stay correct
        let hits = store.search("oat milk", 10, false).unwrap();
        assert_eq!(hits.len(), 1, "cached body missed a search hit");
        let tasks = store.tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].text, "buy the good butter");
        // an edit refreshes what they see
        let id = hits[0].id.clone();
        store.write(&id, "# Groceries\n\nalmond milk\n").unwrap();
        assert!(
            store.search("oat milk", 10, false).unwrap().is_empty(),
            "stale cached body served"
        );
        assert_eq!(store.search("almond milk", 10, false).unwrap().len(), 1);
        assert!(
            store.tasks().unwrap().is_empty(),
            "checked-off task survived in the cache"
        );
    }

    #[test]
    fn external_change_refreshes_through_the_watcher() {
        let (_dir, mut store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(root.clone(), suppress, move |_paths: &[PathBuf]| {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        std::thread::sleep(Duration::from_millis(400)); // watcher warm-up

        let before = store.list().unwrap().notes.len();
        fs::write(root.join("external.md"), "# From another app\n").unwrap();
        // wait for the debounced fire (poll watcher 100ms + debounce 300ms)
        let deadline = Instant::now() + Duration::from_secs(5);
        while fired.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(fired.load(Ordering::SeqCst) >= 1, "watcher never fired");
        assert_eq!(
            store.list().unwrap().notes.len(),
            before + 1,
            "the watcher's bump must refresh the cached walk"
        );
    }

    #[test]
    fn watcher_debounces_external_bursts_and_ignores_our_writes() {
        let (_dir, store) = bare();
        let root = store.root().to_path_buf();
        let suppress = store.suppress_set();
        let fired = Arc::new(AtomicUsize::new(0));
        let counter = fired.clone();
        spawn_watcher(
            root.clone(),
            suppress.clone(),
            move |paths: &[PathBuf]| {
                assert!(!paths.is_empty(), "a fire must carry the burst's paths");
                counter.fetch_add(1, Ordering::SeqCst);
            },
        )
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
        assert!(
            after_burst <= 2,
            "debounce failed: {after_burst} fires for one burst"
        );

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
