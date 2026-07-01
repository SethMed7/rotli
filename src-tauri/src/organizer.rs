//! organizer.rs — the Brain filer daemon (Phase 4 of docs/design/main-brain-daemon.md).
//!
//! A single std::thread worker (mirrors `spawn_watcher` — no runtime, no tokio)
//! that drains a queue of changed `wiki/**` notes and runs the narrow, single-shot
//! Filer jobs against the LOCAL model: Job A (Classify: `wiki/_inbox` capture →
//! area), Job B (Enrich: summary/tags/links, never clobbering a user edit), and
//! Job C (RefreshIndex: per-area `_index.md` overviews — fully DETERMINISTIC, no
//! model call, so regeneration is a guaranteed fixed point).
//!
//! The load-bearing constraints, each enforced structurally:
//!   • SECURE never enters ANY model — detected IN MEMORY (`parse_document` +
//!     the secure line probe + `looks_secure`), never via `read_frontmatter`,
//!     which WRITES on read and would break "Suggest is provably write-free".
//!   • LOCKED is never touched; the Filer gates re-read it fresh at apply time.
//!   • At trust Suggest (the shipped default) the only disk sinks are the
//!     `.rotli/` sidecars (journal + organizer.json) — journal PROPOSALS only.
//!   • Reads are lock-free off the root; every write rides a SHORT
//!     `CorpusState::route()` and no lock is ever held across a model call.
//!   • Writes go through the existing Filer primitives (`set_ai_field` /
//!     `file_note`) — no new write lane, so the user/Filer territories stay
//!     exactly as contract v3.7 drew them.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use ulid::Ulid;

use crate::chat::{self, WireMsg};
use crate::corpus::{self, CorpusState};

/// The daemon's model timeout — deliberately far below chat's 120s so a stuck
/// server never camps a background thread (doc §2: "shorter timeout than chat").
const MODEL_TIMEOUT: Duration = Duration::from_secs(45);
/// Daemon replies are one small JSON object (classify: an area + confidence;
/// enrich: a summary line + short tag/link arrays) — cap generation accordingly.
const GEN_MAX_TOKENS: u32 = 512;
/// Reconciliation sweep cadence (doc §2 gate 3 — a diff sweep, not a re-process).
const SWEEP_EVERY: Duration = Duration::from_secs(15 * 60);
/// Model-offline backoff band (doc §4.8: queue, never block; resume cleanly).
const BACKOFF_MIN: Duration = Duration::from_secs(30);
const BACKOFF_MAX: Duration = Duration::from_secs(15 * 60);
/// Knob defaults — knob-not-constant per §6.4; the settings.json keys
/// (`organizerThreshold` / `organizerQuietSecs`) override per cycle.
const DEFAULT_THRESHOLD: f64 = 0.8;
const DEFAULT_QUIET: Duration = Duration::from_secs(45);
/// How much note body rides in a classify/enrich prompt (chars — the model only
/// needs the gist, and `_inbox` captures are usually short anyway).
const BODY_BUDGET: usize = 4000;
/// How many link candidates the keyword scorer offers the model (Job B). The
/// model may only pick FROM this closed list — links stay grounded and cheap.
const LINK_CANDIDATES: usize = 8;
/// The three fields Enrich may fill (each only when empty or daemon-owned).
const ENRICH_FIELDS: [&str; 3] = ["summary", "tags", "links"];
/// A `summary:` is ONE frontmatter line — clamp a rogue model's paragraph.
const SUMMARY_BUDGET: usize = 240;

// ─── the trust ladder ────────────────────────────────────────────────────────

/// The §4.3 trust ladder. Governs only auto-APPLY — the daemon always
/// classifies in the background (Off is fully dormant). Monotonic in risk.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Trust {
    Off,
    Suggest,
    Tidy,
    Organize,
}

impl Trust {
    /// Settings-read parse: unknown/missing input falls to the SAFE default
    /// (Suggest — propose-only), never to an applying rung.
    pub fn parse(s: &str) -> Trust {
        Self::parse_strict(s).unwrap_or(Trust::Suggest)
    }

    /// Command-input parse: an unknown level is the caller's bug — reject it
    /// rather than silently coercing what the user picked.
    fn parse_strict(s: &str) -> Option<Trust> {
        match s {
            "off" => Some(Trust::Off),
            "suggest" => Some(Trust::Suggest),
            "tidy" => Some(Trust::Tidy),
            "organize" => Some(Trust::Organize),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Trust::Off => "off",
            Trust::Suggest => "suggest",
            Trust::Tidy => "tidy",
            Trust::Organize => "organize",
        }
    }
}

/// What the daemon wants to do — the verbs of the §4.3 apply matrix.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Verb {
    /// File a brand-new `wiki/_inbox` capture (no placement to disturb).
    FileStaged,
    /// Pure additive annotation (AI fields only — suggested_area, summary, …).
    Annotate,
    /// Re-home a note the user has already SEEN in a place (jarring — review).
    /// Not emitted yet (a Phase-5 pass); the apply matrix + its table test
    /// already pin the rung it needs.
    #[allow(dead_code)]
    Refile,
    /// Rewrite an area `_index.md` wholesale (jarring — review until Organize).
    Index,
}

/// The ONE apply decision — the §4.3 ladder table, verbatim. `secure` wins at
/// every rung (§4.2.4: never auto-apply on a secure note, even in Organize).
fn auto_applies(trust: Trust, verb: Verb, secure: bool) -> bool {
    if secure {
        return false;
    }
    match trust {
        Trust::Off | Trust::Suggest => false,
        Trust::Tidy => matches!(verb, Verb::FileStaged | Verb::Annotate),
        Trust::Organize => true,
    }
}

// ─── the managed handle ──────────────────────────────────────────────────────

/// Live daemon status for the UI (Settings → Brain / the Activity pane).
#[derive(Default, Clone)]
struct StatusSnapshot {
    last_run_at: Option<String>,
    last_error: Option<String>,
    /// The rel paths of notes that STILL look like they hold secrets (§4.2.3).
    /// A durable set, not a per-cycle count: a small watcher cycle that touches
    /// one unrelated note must not zero the "review them yourself" hint while
    /// the secret captures sit unreviewed. Entries clear when a note is
    /// processed non-secure, or when its file disappears (pruned each cycle).
    secure_pending: BTreeSet<String>,
    model_offline: bool,
}

pub(crate) struct OrganizerInner {
    /// rel path → enqueued-at. A HashMap so a hot note dedupes to one entry.
    queue: Mutex<HashMap<String, Instant>>,
    /// Wakes the worker when the queue gains work or run-now fires.
    cv: Condvar,
    /// In-memory trust — immediate on `organizer_set_trust`; the settings.json
    /// value (re-read each cycle) is the persisted backstop.
    trust: Mutex<Trust>,
    /// The trust value LAST SEEN in settings.json. `read_knobs` adopts the
    /// settings value only when it CHANGED since the last read — otherwise a
    /// debounced-stale settings.json would clobber a fresh `organizer_set_trust`
    /// (the user picks Off, the worker wakes, and the still-unflushed file says
    /// Organize — the downgrade race).
    settings_trust: Mutex<Option<Trust>>,
    status: Mutex<StatusSnapshot>,
    /// Whether the worker thread was spawned (false = no memex corpus).
    running: AtomicBool,
    /// The Settings "Run now" nudge — bypasses quiet/idle/AC/thermal, never chat.
    run_now: AtomicBool,
    /// Chat-yield semaphore: >0 while an interactive model call is in flight.
    interactive: AtomicUsize,
}

/// Cheap-clone handle (Arc). Created BEFORE the root loop so watcher closures
/// can capture it; the worker thread starts after CorpusState is managed.
#[derive(Clone)]
pub struct OrganizerHandle(pub(crate) Arc<OrganizerInner>);

/// The Tauri-managed wrapper.
pub struct OrganizerState(pub OrganizerHandle);

/// RAII chat-yield guard — chat.rs takes one per interactive model call; the
/// daemon's gate sees the counter and steps aside (doc §2: "the citizen").
pub struct InteractiveGuard(Arc<OrganizerInner>);

impl Drop for InteractiveGuard {
    fn drop(&mut self) {
        self.0.interactive.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Default for OrganizerHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl OrganizerHandle {
    pub fn new() -> Self {
        OrganizerHandle(Arc::new(OrganizerInner {
            queue: Mutex::new(HashMap::new()),
            cv: Condvar::new(),
            trust: Mutex::new(Trust::Suggest),
            settings_trust: Mutex::new(None),
            status: Mutex::new(StatusSnapshot::default()),
            running: AtomicBool::new(false),
            run_now: AtomicBool::new(false),
            interactive: AtomicUsize::new(0),
        }))
    }

    /// Watcher feed: keep `wiki/**/*.md`, drop `_index.md` / `wiki/README.md` /
    /// dot components (the candidate filter). Paths arrive absolute.
    pub fn enqueue(&self, root: &Path, paths: &[PathBuf]) {
        let mut added = false;
        {
            let mut q = self.0.queue.lock().unwrap();
            for p in paths {
                let Ok(rel) = p.strip_prefix(root) else { continue };
                let rel = rel.to_string_lossy().replace('\\', "/");
                if !candidate_rel(&rel) {
                    continue;
                }
                q.insert(rel, Instant::now());
                added = true;
            }
        }
        if added {
            self.0.cv.notify_all();
        }
    }

    pub fn set_trust(&self, t: Trust) {
        *self.0.trust.lock().unwrap() = t;
    }

    pub fn interactive_guard(&self) -> InteractiveGuard {
        self.0.interactive.fetch_add(1, Ordering::SeqCst);
        InteractiveGuard(self.0.clone())
    }
}

// ─── pure core: hashing, state, candidates, snapshots ────────────────────────

/// FNV-1a 64 as lowercase hex — a tiny local content hash, deterministic across
/// runs and platforms (std's DefaultHasher explicitly is not), which the
/// never-reprocess state file relies on.
fn fnv1a64(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// `.rotli/organizer.json` — the daemon's idempotency/convergence state
/// (doc §2: "a job runs only when current hash ≠ last-processed").
#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct ProposedState {
    /// Body hash at the time an outstanding file/classify proposal was made —
    /// don't re-propose for an unchanged note.
    file: String,
    /// Journal row id of the outstanding classify proposal — so a re-proposal
    /// for a CHANGED body can retire (dismiss) the stale pending row instead of
    /// letting contradictory filings pile up per edit (§4.8 supersede).
    file_row: String,
    /// Body hash at the last Enrich pass (proposal, apply, OR nothing-eligible)
    /// — one marker for all three, so an unchanged body is never re-modeled.
    enrich: String,
    /// Journal row ids of the outstanding enrich field proposals (same
    /// supersede rule as `file_row`).
    enrich_rows: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct NoteState {
    /// BODY hash at last processing (proposal OR apply). Body-only on purpose:
    /// the daemon's own frontmatter writes must not re-trigger processing.
    hash: String,
    /// Area the daemon last filed it into ("" while staged).
    area: String,
    /// The daemon's last written field values (the never-clobber baseline).
    last_fields: BTreeMap<String, String>,
    proposed: ProposedState,
    processed_at: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct AreaState {
    members_hash: String,
    built_at: String,
    proposed_hash: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct OrganizerFile {
    version: u32,
    notes: BTreeMap<String, NoteState>,
    areas: BTreeMap<String, AreaState>,
}

impl Default for OrganizerFile {
    fn default() -> Self {
        OrganizerFile { version: 1, notes: BTreeMap::new(), areas: BTreeMap::new() }
    }
}

/// Defensive parse — corrupt/foreign content resets to a fresh default (the
/// queue rebuilds from the sweep, doc §4.8); never an error, never a panic.
fn parse_state(json: &str) -> OrganizerFile {
    serde_json::from_str(json).unwrap_or_default()
}

/// The enqueue/sweep filter: only `wiki/**/*.md` notes are the daemon's input.
/// `_index.md` is the daemon's own OUTPUT (never an input candidate),
/// `wiki/README.md` is the pinned human trust artifact (§3.4 — never touched),
/// and dot components are sidecar/temp plumbing the watcher filters anyway.
fn candidate_rel(rel: &str) -> bool {
    rel.ends_with(".md")
        && rel.starts_with("wiki/")
        && rel != "wiki/README.md"
        && rel.rsplit('/').next() != Some("_index.md")
        && !rel.split('/').any(|c| c.starts_with('.'))
}

/// In-memory snapshot of one note read straight off disk. NEVER
/// `read_frontmatter` — that path WRITES on read (the auto-secure flag), and a
/// Suggest run must be provably write-free on corpus files.
struct NoteSnapshot {
    rel: String,
    id: Option<String>,
    title: String,
    body: String,
    body_hash: String,
    locked: bool,
    secure: bool,
    fields: BTreeMap<String, String>,
    mtime_age: Duration,
}

fn snapshot_note(root: &Path, rel: &str) -> Result<NoteSnapshot, String> {
    let abs = root.join(rel);
    let text = std::fs::read_to_string(&abs).map_err(|e| format!("read {rel}: {e}"))?;
    let mtime_age = std::fs::metadata(&abs)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .unwrap_or(Duration::ZERO);
    let (fm, body) = corpus::parse_document(&text);
    let fm = fm.unwrap_or_default();
    let mut fields = BTreeMap::new();
    let mut locked = false;
    let mut secure = false;
    for line in &fm.foreign {
        if corpus::locked_field(line) == Some(true) {
            locked = true;
        }
        if corpus::secure_field(line) == Some(true) {
            secure = true;
        }
        if let Some((k, v)) = line.split_once(':') {
            fields.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    // Detect on the WHOLE text (frontmatter too — a foreign `key: sk-…` line is
    // just as much a secret as one in the body). Stricter than `read_for_ai`.
    if !secure && crate::secret::looks_secure(&text) {
        secure = true;
    }
    Ok(NoteSnapshot {
        rel: rel.to_string(),
        id: fm.id.filter(|i| !i.is_empty()),
        title: corpus::title_of(body),
        body: body.to_string(),
        body_hash: fnv1a64(body.as_bytes()),
        locked,
        secure,
        fields,
        mtime_age,
    })
}

/// The state-file key for a note — its ULID when it has one (survives the
/// filing rename), else its rel path (a frontmatter-less external drop).
fn state_key(s: &NoteSnapshot) -> String {
    s.id.clone().unwrap_or_else(|| s.rel.clone())
}

/// Why a candidate is NOT processed this pass. Order matters: locked and secure
/// are absolute (never modeled at any rung), quiet is temporal (requeue), and
/// unchanged is the convergence rule (same input → never re-proposed).
#[derive(Debug, PartialEq)]
enum Skip {
    Locked,
    Secure,
    Quiet,
    Unchanged,
}

fn skip_reason(s: &NoteSnapshot, st: &OrganizerFile, quiet: Duration) -> Option<Skip> {
    if s.locked {
        return Some(Skip::Locked);
    }
    if s.secure {
        return Some(Skip::Secure);
    }
    if s.mtime_age < quiet {
        return Some(Skip::Quiet);
    }
    if classify_covered(s, st) && enrich_covered(s, st) {
        return Some(Skip::Unchanged);
    }
    None
}

/// Classify already handled this exact body (a recorded pass OR an outstanding
/// file proposal). Enrich records `hash` too, so a placed, enriched note counts.
fn classify_covered(s: &NoteSnapshot, st: &OrganizerFile) -> bool {
    st.notes
        .get(&state_key(s))
        .is_some_and(|n| n.hash == s.body_hash || n.proposed.file == s.body_hash)
}

/// Enrich already handled this exact body — proposal, apply, or "every target
/// field is user-owned" all record the same marker (a body edit re-evaluates).
fn enrich_covered(s: &NoteSnapshot, st: &OrganizerFile) -> bool {
    st.notes.get(&state_key(s)).is_some_and(|n| n.proposed.enrich == s.body_hash)
}

// ─── pure core: classify ─────────────────────────────────────────────────────

/// The Brain's area vocabulary: `wiki/<area>` directories (never `_inbox`,
/// never underscore/dot names), each with the first content line of its
/// `_index.md` as a one-line description ("" when none). Lock-free reads.
fn area_vocab(root: &Path) -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir(root.join("wiki")) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| !n.starts_with('_') && !n.starts_with('.'))
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let desc = std::fs::read_to_string(root.join("wiki").join(&name).join("_index.md"))
                .ok()
                .and_then(|t| {
                    let (_, body) = corpus::parse_document(&t);
                    // skip headings, the generated-file marker (`<!-- … -->`),
                    // and table rows — only human/model PROSE is a description
                    body.lines()
                        .map(str::trim)
                        .find(|l| {
                            !l.is_empty()
                                && !l.starts_with('#')
                                && !l.starts_with('<')
                                && !l.starts_with('|')
                        })
                        .map(str::to_string)
                })
                .unwrap_or_default();
            (name, desc)
        })
        .collect()
}

/// Job A prompt — single-shot, JSON-instructed, meant for temp 0. The body is
/// truncated to a budget; classify needs the gist, not the whole document.
fn classify_prompt(s: &NoteSnapshot, vocab: &[(String, String)]) -> String {
    let mut p = String::from(
        "You file notes in a personal knowledge base. Pick the ONE best area for this note.\n\nAreas:\n",
    );
    for (name, desc) in vocab {
        if desc.is_empty() {
            p.push_str(&format!("- {name}\n"));
        } else {
            p.push_str(&format!("- {name}: {desc}\n"));
        }
    }
    p.push_str(
        "\nAnswer with ONLY a JSON object, no prose:\n{\"area\": \"<one area name above, or none>\", \"confidence\": <number 0 to 1>}\n",
    );
    if let Some(tags) = s.fields.get("tags").filter(|t| !t.is_empty() && t.as_str() != "[]") {
        p.push_str(&format!("\nExisting tags: {tags}\n"));
    }
    let body: String = s.body.chars().take(BODY_BUDGET).collect();
    p.push_str(&format!("\nNote title: {}\n\nNote body:\n{}\n", s.title, body.trim()));
    p
}

struct ClassifyOut {
    area: String,
    confidence: f64,
}

/// Parse the model's classify reply. The area MUST be one of the vocabulary
/// (case-insensitive → canonical) and confidence is clamped to [0,1]. Anything
/// else — junk, "none", an invented area — is None: never file to a guess.
fn parse_classify(raw: &str, vocab: &[(String, String)]) -> Option<ClassifyOut> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    let v: serde_json::Value = serde_json::from_str(&raw[start..=end]).ok()?;
    let area_raw = v.get("area")?.as_str()?.trim();
    let canonical = vocab.iter().find(|(n, _)| n.eq_ignore_ascii_case(area_raw))?.0.clone();
    let confidence = v.get("confidence").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    let confidence = if confidence.is_finite() { confidence.clamp(0.0, 1.0) } else { 0.0 };
    Some(ClassifyOut { area: canonical, confidence })
}

// ─── pure core: enrich (Job B) ───────────────────────────────────────────────

/// Every OTHER note in the brain as a `(rel, stem)` pair — the link-candidate
/// haystack, off a lock-free walk. Stems (filename minus `.md`, which carry the
/// `<slug>-<id6>` shape) stand in for titles: unique, no body ever rides a
/// prompt. SECURE and LOCKED notes are dropped here: a secure note's slug is
/// derived from its title (often the secret itself for a quick capture), and
/// letting it into the candidate list would ship it to the model AND let the
/// model echo it into `links:` of committed notes (§4.2.2). The check costs one
/// read per wiki note, once per cycle — the price of the absolute rule.
fn list_peers(root: &Path) -> Vec<(String, String)> {
    let mut rels = Vec::new();
    collect_md(root, "wiki", &mut rels);
    let mut peers: Vec<(String, String)> = rels
        .into_iter()
        .filter(|rel| candidate_rel(rel))
        .filter(|rel| {
            snapshot_note(root, rel).is_ok_and(|s| !s.secure && !s.locked)
        })
        .map(|rel| {
            let stem = rel
                .rsplit('/')
                .next()
                .unwrap_or(&rel)
                .trim_end_matches(".md")
                .to_string();
            (rel, stem)
        })
        .collect();
    peers.sort();
    peers
}

/// Link candidates WITHOUT the model — the keyword scorer ported from
/// `rankNotes` (src/ai/tools.ts), inverted: the note is the query, the peers
/// are the haystack (stem ≈ title ×3, folder ×2 — no snippet, since peers are
/// never read). The model only confirms/orders from this closed list.
fn rank_note_candidates(
    title: &str,
    body: &str,
    others: &[(String, String)],
    n: usize,
) -> Vec<String> {
    let text: String = format!("{title} {body}").chars().take(BODY_BUDGET).collect();
    let tokens: std::collections::BTreeSet<String> = text
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() > 1)
        .map(str::to_string)
        .collect();
    if tokens.is_empty() {
        return Vec::new();
    }
    let mut scored: Vec<(i64, &String)> = Vec::new();
    for (rel, stem) in others {
        let stem_lc = stem.to_lowercase();
        let folder_lc = corpus::folder_of(rel).to_lowercase();
        let mut score = 0i64;
        for t in &tokens {
            if stem_lc.contains(t.as_str()) {
                score += 3;
            }
            if folder_lc.contains(t.as_str()) {
                score += 2;
            }
        }
        if score > 0 {
            scored.push((score, stem));
        }
    }
    // deterministic order: score desc, then stem — re-runs are byte-stable
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(b.1)));
    scored.into_iter().take(n).map(|(_, s)| s.clone()).collect()
}

/// Job B prompt — single-shot, JSON-instructed, temp 0. Links are constrained
/// to the pre-ranked candidate list (the model never invents a note).
fn enrich_prompt(s: &NoteSnapshot, candidates: &[String]) -> String {
    let mut p = String::from(
        "You annotate notes in a personal knowledge base. Write a one-line summary, \
         a few short lowercase topic tags, and pick genuinely related notes ONLY \
         from the candidate list (an empty list is fine).\n",
    );
    if candidates.is_empty() {
        p.push_str("\nRelated-note candidates: none.\n");
    } else {
        p.push_str("\nRelated-note candidates:\n");
        for c in candidates {
            p.push_str(&format!("- {c}\n"));
        }
    }
    p.push_str(
        "\nAnswer with ONLY a JSON object, no prose:\n{\"summary\": \"<one line>\", \"tags\": [\"<tag>\", ...], \"links\": [\"<candidate>\", ...]}\n",
    );
    let body: String = s.body.chars().take(BODY_BUDGET).collect();
    p.push_str(&format!("\nNote title: {}\n\nNote body:\n{}\n", s.title, body.trim()));
    p
}

struct EnrichOut {
    summary: String,
    tags: Vec<String>,
    links: Vec<String>,
}

/// Parse the model's enrich reply. Links must be ⊆ candidates (case-insensitive
/// → canonical); tags are lowercased; both are deduped + CANONICALLY SORTED so
/// re-runs on an unchanged note produce identical bytes (the no-op fixed point).
/// A reply without any enrich key (e.g. a stray classify object) is None.
fn parse_enrich(raw: &str, candidates: &[String]) -> Option<EnrichOut> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    let v: serde_json::Value = serde_json::from_str(&raw[start..=end]).ok()?;
    if v.get("summary").is_none() && v.get("tags").is_none() && v.get("links").is_none() {
        return None;
    }
    // one frontmatter line: collapse whitespace/newlines, clamp length
    let summary: String = v
        .get("summary")
        .and_then(|s| s.as_str())
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(SUMMARY_BUDGET)
        .collect();
    let mut tags: Vec<String> = v
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_lowercase())
                // a tag with list syntax would corrupt the `[…]` field format
                .filter(|s| !s.is_empty() && !s.contains([',', '[', ']']))
                .collect()
        })
        .unwrap_or_default();
    tags.sort();
    tags.dedup();
    let mut links: Vec<String> = v
        .get("links")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .filter_map(|s| {
                    let s = s.trim().trim_matches(|c| c == '[' || c == ']');
                    candidates.iter().find(|c| c.eq_ignore_ascii_case(s)).cloned()
                })
                .collect()
        })
        .unwrap_or_default();
    links.sort();
    links.dedup();
    Some(EnrichOut { summary, tags, links })
}

impl EnrichOut {
    /// The write plan: `(key, canonical frontmatter value)` per non-empty output
    /// — `tags: […]`, `links: [[…]], …` per the §3.1 schema. Enrich only ever
    /// ADDS; an empty output never proposes removing a field.
    fn fields(&self) -> Vec<(&'static str, String)> {
        let mut out = Vec::new();
        if !self.summary.is_empty() {
            out.push(("summary", self.summary.clone()));
        }
        if !self.tags.is_empty() {
            out.push(("tags", format!("[{}]", self.tags.join(", "))));
        }
        if !self.links.is_empty() {
            let links: Vec<String> = self.links.iter().map(|l| format!("[[{l}]]")).collect();
            out.push(("links", links.join(", ")));
        }
        out
    }
}

/// The never-clobber rule (§3.5): a field the daemon may touch is empty on
/// disk, or byte-equal to what the daemon itself last wrote. Anything else is
/// a user edit — untouched, not even proposed.
fn field_eligible(snap: &NoteSnapshot, ns: Option<&NoteState>, key: &str) -> bool {
    let current = snap.fields.get(key).map(String::as_str).unwrap_or("");
    current.is_empty()
        || ns.is_some_and(|n| n.last_fields.get(key).map(String::as_str) == Some(current))
}

// ─── pure core: refresh-index (Job C — deterministic, no model) ──────────────

/// One member row of an area overview. Secure and locked notes are OMITTED
/// entirely (the doc's §4.2.5 "or is omitted" arm): for a quick capture the
/// TITLE is the first body line — often the secret itself — so even a bare
/// title-only row would lift the quarantined content into a non-gitignored
/// `_index.md`. Locked notes are off-limits to the Filer wholesale (§3.1).
struct IndexRow {
    id: String,
    title: String,
    summary: String,
}

/// Enumerate an area's members lock-free (recursive; `_index.md` itself and
/// README are never members; secure/locked never listed) in canonical
/// title-then-id order.
fn area_members(root: &Path, area: &str) -> Vec<IndexRow> {
    let mut rels = Vec::new();
    collect_md(root, &format!("wiki/{area}"), &mut rels);
    let mut rows: Vec<IndexRow> = rels
        .iter()
        .filter(|rel| candidate_rel(rel))
        .filter_map(|rel| snapshot_note(root, rel).ok())
        .filter(|s| !s.secure && !s.locked)
        .map(|s| IndexRow {
            id: state_key(&s),
            summary: s.fields.get("summary").cloned().unwrap_or_default(),
            title: s.title,
        })
        .collect();
    rows.sort_by(|a, b| a.title.cmp(&b.title).then(a.id.cmp(&b.id)));
    rows
}

/// The membership fingerprint — `(id, title, summary)` tuples. Any filing,
/// rename, or summary change (including one a frontend approval made — those
/// writes are suppress-marked, so no watcher event arrives) shows up here.
fn members_hash(rows: &[IndexRow]) -> String {
    let mut buf = String::new();
    for r in rows {
        buf.push_str(&format!("{}\u{1f}{}\u{1f}{}\n", r.id, r.title, r.summary));
    }
    fnv1a64(buf.as_bytes())
}

/// A table cell must stay on one line and can't contain a bare `|`.
fn cell(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").replace('|', "\\|")
}

/// Render an area overview — fully deterministic (same members → same bytes →
/// guaranteed fixed point, no model call; prose intros are Phase 5). The marker
/// line tells a human why their edits vanish.
fn render_index(area: &str, members: &[IndexRow]) -> String {
    let mut out = format!(
        "# {area}\n\n<!-- Generated by the rotli Filer — edits are overwritten. -->\n\n| Note | Summary |\n| --- | --- |\n"
    );
    for r in members {
        out.push_str(&format!("| {} | {} |\n", cell(&r.title), cell(&r.summary)));
    }
    out
}

// ─── pure core: the journal shape ────────────────────────────────────────────

/// One journal row — the ONE shape both writers (the TS Phase-3 commands and
/// this daemon) speak. Same-id re-append is a status transition; last line wins.
struct JournalRow {
    action: &'static str, // "file" | "field" | "index"
    note_id: String,      // rel path (the Phase-3 grammar)
    note_title: String,
    /// The note's frontmatter ULID — the STABLE handle. The rel path in
    /// `note_id` is pinned at proposal time, so a sibling filing (or any rename)
    /// strands it; the frontend Approve/Undo resolve through this instead.
    /// None for index rows (an `_index.md` has no ULID) and external drops.
    note_ulid: Option<String>,
    area: Option<String>,  // file + index rows
    field: Option<String>, // field rows
    before: String,
    after: String,
    confidence: Option<f64>, // classify rows
    status: &'static str,    // "proposed" | "applied"
}

fn journal_line(row: &JournalRow, id_ulid: &str, ts_ms: i64, model: &str) -> String {
    let mut v = serde_json::json!({
        "id": id_ulid,
        "ts": ts_ms,
        "action": row.action,
        "noteId": row.note_id,
        "noteTitle": row.note_title,
        "before": row.before,
        "after": row.after,
        "model": model,
        "status": row.status,
    });
    if let Some(u) = &row.note_ulid {
        v["noteUlid"] = serde_json::Value::String(u.clone());
    }
    if let Some(a) = &row.area {
        v["area"] = serde_json::Value::String(a.clone());
    }
    if let Some(f) = &row.field {
        v["field"] = serde_json::Value::String(f.clone());
    }
    if let Some(c) = row.confidence {
        v["confidence"] = serde_json::json!(c);
    }
    v.to_string()
}

/// The latest journal line for a row id, parsed — `None` when it never appears.
fn journal_latest(journal: &str, id: &str) -> Option<serde_json::Value> {
    let mut last = None;
    for line in journal.lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if v.get("id").and_then(|i| i.as_str()) == Some(id) {
                last = Some(v);
            }
        }
    }
    last
}

/// Retire a STALE pending proposal (§4.8 supersede): when the daemon re-decides
/// for a changed body, the outstanding row must fold to `dismissed`, or pending
/// rows pile up per edit and approving the stale one applies an outdated
/// decision. A row the user already resolved (applied/dismissed/reverted) is
/// left alone — this only ever transitions "proposed". Returns whether a
/// transition was journaled.
fn supersede(s: &corpus::CorpusStore, old_id: &str) -> Result<bool, String> {
    if old_id.is_empty() {
        return Ok(false);
    }
    let journal = s.journal_read()?;
    let Some(mut row) = journal_latest(&journal, old_id) else { return Ok(false) };
    if row.get("status").and_then(|v| v.as_str()) != Some("proposed") {
        return Ok(false);
    }
    // re-append the row's own shape with the transition — last line wins
    row["status"] = serde_json::Value::String("dismissed".into());
    row["ts"] = serde_json::json!(now_ms());
    s.journal_append(&row.to_string())?;
    Ok(true)
}

// ─── pure core: gates ────────────────────────────────────────────────────────

/// One sampled view of the §2 gates. `run_now` (the manual nudge) bypasses
/// power/thermal/idle — but never barges in on an interactive chat.
#[derive(Clone, Copy, Debug)]
pub(crate) struct GateSnapshot {
    pub on_ac: bool,
    pub thermal_ok: bool,
    pub user_idle: bool,
    pub app_backgrounded: bool,
    pub interactive_busy: bool,
    pub run_now: bool,
}

fn gates_pass(g: &GateSnapshot) -> bool {
    if g.interactive_busy {
        return false; // yielding to chat is unconditional — even for run-now
    }
    if g.run_now {
        return true;
    }
    g.on_ac && g.thermal_ok && (g.user_idle || g.app_backgrounded)
}

// ─── knobs (settings.json — frontend-owned, Rust READS only) ─────────────────

struct Knobs {
    trust: Option<Trust>,
    threshold: f64,
    quiet: Duration,
}

fn parse_knobs(settings_json: &str) -> Knobs {
    let v: serde_json::Value = serde_json::from_str(settings_json).unwrap_or(serde_json::Value::Null);
    Knobs {
        trust: v.get("organizerTrust").and_then(|t| t.as_str()).map(Trust::parse),
        threshold: v
            .get("organizerThreshold")
            .and_then(serde_json::Value::as_f64)
            .filter(|t| (0.0..=1.0).contains(t))
            .unwrap_or(DEFAULT_THRESHOLD),
        quiet: v
            .get("organizerQuietSecs")
            .and_then(serde_json::Value::as_f64)
            .filter(|q| q.is_finite() && *q >= 0.0)
            .map(Duration::from_secs_f64)
            .unwrap_or(DEFAULT_QUIET),
    }
}

/// Re-read the knobs each cycle. Trust is adopted from settings.json only when
/// the FILE'S value changed since the last read (startup seed + external edits)
/// — never as a blind overwrite. `organizer_set_trust` flips the in-memory rung
/// immediately, and the frontend's settings save is debounced ~500ms: blindly
/// re-adopting the stale file here would clobber a fresh downgrade (Off →
/// wake → read old "organize" → keep applying). The flushed file converges to
/// the same value, so "unchanged file ⇒ in-memory wins" is always safe.
fn read_knobs(corpus_state: &CorpusState, root_id: &str, inner: &OrganizerInner) -> Knobs {
    let settings = corpus_state
        .route(root_id, |s| s.dot_read("settings"))
        .unwrap_or_else(|_| "{}".into());
    let knobs = parse_knobs(&settings);
    if let Some(t) = knobs.trust {
        let mut seen = inner.settings_trust.lock().unwrap();
        if *seen != Some(t) {
            *seen = Some(t);
            *inner.trust.lock().unwrap() = t;
        }
    }
    knobs
}

// ─── the cycle ───────────────────────────────────────────────────────────────

#[derive(Default, Debug)]
pub(crate) struct CycleReport {
    pub proposals: usize,
    pub applied: usize,
    pub secure_skipped: usize,
    pub locked_skipped: usize,
    pub requeued: usize,
    /// Per-candidate write refusals (e.g. locked between read and apply) —
    /// keeps the end-of-cycle status pass from wiping an error it just set.
    pub errors: usize,
    pub model_offline: bool,
    pub journal_written: bool,
}

/// What one classify candidate resolved to inside the write `route()`.
enum Outcome {
    /// The note changed between the classify read and the write — re-evaluate.
    Requeue,
    Proposed,
    /// `Some(new rel)` when a FileStaged apply moved the note out of `_inbox`.
    Applied(Option<String>),
}

/// What one enrich candidate resolved to inside the write `route()`.
enum EnrichOutcome {
    Requeue,
    Rows { proposed: usize, applied: usize, superseded: bool },
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

fn now_ms() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// One drain of the queue against the memex root. `gates` is re-checked per
/// candidate (a chat can start mid-cycle); `transport` is the model call —
/// injected so tests never touch a live server. Reads are lock-free off `root`;
/// every write rides a short `route()`; NO lock is held across `transport`.
pub(crate) fn run_cycle(
    corpus_state: &CorpusState,
    root_id: &str,
    root: &Path,
    inner: &OrganizerInner,
    gates: &dyn Fn() -> bool,
    transport: &dyn Fn(&str) -> Result<String, String>,
) -> Result<CycleReport, String> {
    let mut report = CycleReport::default();
    let knobs = read_knobs(corpus_state, root_id, inner);
    if *inner.trust.lock().unwrap() == Trust::Off {
        return Ok(report); // dormant: drain nothing, model nothing
    }

    let state_json = corpus_state.route(root_id, |s| s.dot_read("organizer"))?;
    let mut state = parse_state(&state_json);

    // a sorted snapshot of the queue — deterministic pass order
    let mut rels: Vec<String> = inner.queue.lock().unwrap().keys().cloned().collect();
    rels.sort();

    let mut vocab: Option<Vec<(String, String)>> = None;
    let mut peers: Option<Vec<(String, String)>> = None; // enrich link haystack, once per cycle
    'candidates: for rel in rels {
        // trust is LIVE per candidate — `organizer_set_trust` can downgrade the
        // rung mid-cycle (each model call is up to 45s; a long queue must not
        // keep applying at a rung the user just left). Off parks the rest.
        let trust = *inner.trust.lock().unwrap();
        if trust == Trust::Off {
            report.requeued += 1;
            continue; // stays queued — dormant until the rung comes back
        }
        if !gates() {
            report.requeued += 1;
            continue; // stays queued — the gate closed mid-cycle
        }
        inner.queue.lock().unwrap().remove(&rel);
        let Ok(snap) = snapshot_note(root, &rel) else {
            // deleted/unreadable: drop — and it can't be a pending secret anymore
            inner.status.lock().unwrap().secure_pending.remove(&rel);
            continue;
        };
        match skip_reason(&snap, &state, knobs.quiet) {
            Some(Skip::Secure) => {
                // counted + remembered for the §4.2.3 "review them yourself"
                // line — never modeled, never proposed with content, at any
                // rung. The durable set keeps the hint up across small cycles.
                report.secure_skipped += 1;
                inner.status.lock().unwrap().secure_pending.insert(rel);
                continue;
            }
            other => {
                // any non-secure outcome clears the note from the review hint
                inner.status.lock().unwrap().secure_pending.remove(&rel);
                match other {
                    Some(Skip::Locked) => {
                        report.locked_skipped += 1;
                        continue;
                    }
                    Some(Skip::Quiet) => {
                        // being actively typed — requeue, never file under the cursor
                        inner.queue.lock().unwrap().insert(rel, Instant::now());
                        report.requeued += 1;
                        continue;
                    }
                    Some(Skip::Unchanged) => continue,
                    Some(Skip::Secure) | None => {}
                }
            }
        }

        let mut rel = rel;
        let mut snap = snap;

        // ── Job A — Classify (`wiki/_inbox` staging only) ─────────────────────
        if rel.starts_with("wiki/_inbox/") && !classify_covered(&snap, &state) {
            let vocab = vocab.get_or_insert_with(|| area_vocab(root));
            // no areas yet ⇒ nothing to classify into — Enrich still runs below
            if !vocab.is_empty() {
                let prompt = classify_prompt(&snap, vocab);
                // the model call — NO lock held (chat must never wait on the daemon)
                let raw = match transport(&prompt) {
                    Ok(r) => r,
                    Err(e) => {
                        // model down: requeue this note, keep the rest for after
                        // backoff (doc §4.8 degradation — queue, never block).
                        report.model_offline = true;
                        inner.queue.lock().unwrap().insert(rel, Instant::now());
                        report.requeued += 1;
                        let mut st = inner.status.lock().unwrap();
                        st.model_offline = true;
                        st.last_error = Some(e);
                        break 'candidates;
                    }
                };

                let key = state_key(&snap);
                match parse_classify(&raw, vocab) {
                    // Unparseable/none output: record the hash so a temp-0 model
                    // that deterministically produces the same junk can't
                    // hot-loop us — then fall through to Enrich. An outstanding
                    // proposal from an OLDER body is stale now — retire it.
                    None => {
                        let old_row = {
                            let ns = state.notes.entry(key).or_default();
                            ns.hash = snap.body_hash.clone();
                            ns.processed_at = now_rfc3339();
                            ns.proposed.file.clear();
                            std::mem::take(&mut ns.proposed.file_row)
                        };
                        let dismissed = corpus_state.route(root_id, |s| {
                            let d = supersede(s, &old_row)?;
                            s.dot_write("organizer", &state_pretty(&state))?;
                            Ok(d)
                        })?;
                        if dismissed {
                            report.journal_written = true;
                        }
                    }
                    Some(c) => {
                        let (verb, area, conf) = if c.confidence >= knobs.threshold {
                            (Verb::FileStaged, c.area, c.confidence)
                        } else {
                            // Below threshold: ONE `suggested_area` proposal —
                            // never a filing guess (§6.4); the UI offers the
                            // one-click confirm.
                            (Verb::Annotate, c.area, c.confidence)
                        };

                        // FileStaged needs the note's own ULID for the index
                        // rewrite; a frontmatter-less external drop has none —
                        // downgrade to a proposal.
                        let apply = auto_applies(trust, verb, false)
                            && !(verb == Verb::FileStaged && snap.id.is_none());
                        let row_ulid = Ulid::new().to_string();
                        let ts = now_ms();
                        let stamp = now_rfc3339();

                        // the write window — one short route(); re-check the note first
                        let outcome = corpus_state.route(root_id, |s| {
                            let fresh = std::fs::read_to_string(root.join(&rel))
                                .map_err(|e| e.to_string())?;
                            let (_, fresh_body) = corpus::parse_document(&fresh);
                            if fnv1a64(fresh_body.as_bytes()) != snap.body_hash {
                                return Ok(Outcome::Requeue); // edited under us — re-evaluate (§4.8)
                            }
                            let mut row = JournalRow {
                                action: if verb == Verb::FileStaged { "file" } else { "field" },
                                note_id: rel.clone(),
                                note_title: snap.title.clone(),
                                note_ulid: snap.id.clone(),
                                area: (verb == Verb::FileStaged).then(|| area.clone()),
                                field: (verb == Verb::Annotate)
                                    .then(|| "suggested_area".to_string()),
                                before: match verb {
                                    Verb::FileStaged => corpus::folder_of(&rel),
                                    _ => snap
                                        .fields
                                        .get("suggested_area")
                                        .cloned()
                                        .unwrap_or_default(),
                                },
                                after: match verb {
                                    Verb::FileStaged => format!("wiki/{area}"),
                                    _ => area.clone(),
                                },
                                confidence: Some(conf),
                                status: "proposed",
                            };
                            let mut moved: Option<String> = None;
                            let old_row = {
                                // entry-mutate (never insert-clobber) so a prior
                                // Enrich's `lastFields` baseline survives
                                let ns = state.notes.entry(key.clone()).or_default();
                                ns.hash = snap.body_hash.clone();
                                ns.processed_at = stamp.clone();
                                let old = std::mem::take(&mut ns.proposed.file_row);
                                if apply {
                                    match verb {
                                        Verb::FileStaged => ns.area = area.clone(),
                                        Verb::Annotate => {
                                            ns.last_fields
                                                .insert("suggested_area".into(), area.clone());
                                            ns.last_fields.insert(
                                                "area_confidence".into(),
                                                format!("{conf:.2}"),
                                            );
                                        }
                                        Verb::Refile | Verb::Index => {
                                            unreachable!("classify never emits these")
                                        }
                                    }
                                    ns.proposed.file.clear();
                                } else {
                                    ns.proposed.file = snap.body_hash.clone();
                                    ns.proposed.file_row = row_ulid.clone();
                                }
                                old
                            };
                            // a proposal from an OLDER body is stale — retire it
                            // (only if still pending; a user-resolved row stays)
                            supersede(s, &old_row)?;
                            if apply {
                                match verb {
                                    Verb::FileStaged => {
                                        // the Filer gates re-read `locked` FRESH inside these
                                        s.set_ai_field(&rel, "area", &area)?;
                                        s.set_ai_field(&rel, "filed_by", chat::DEFAULT_MODEL)?;
                                        s.set_ai_field(&rel, "filed_at", &stamp)?;
                                        let meta = s.file_note(&rel)?;
                                        let new_rel = s.resolve_note_rel(&meta.id)?;
                                        row.note_id = new_rel.clone();
                                        moved = Some(new_rel);
                                    }
                                    Verb::Annotate => {
                                        s.set_ai_field(&rel, "suggested_area", &area)?;
                                        s.set_ai_field(
                                            &rel,
                                            "area_confidence",
                                            &format!("{conf:.2}"),
                                        )?;
                                    }
                                    Verb::Refile | Verb::Index => {
                                        unreachable!("classify never emits these")
                                    }
                                }
                                row.status = "applied";
                            }
                            s.journal_append(&journal_line(
                                &row,
                                &row_ulid,
                                ts,
                                chat::DEFAULT_MODEL,
                            ))?;
                            s.dot_write("organizer", &state_pretty(&state))?;
                            Ok(if row.status == "applied" {
                                Outcome::Applied(moved)
                            } else {
                                Outcome::Proposed
                            })
                        });
                        match outcome {
                            Ok(Outcome::Requeue) => {
                                inner.queue.lock().unwrap().insert(rel, Instant::now());
                                report.requeued += 1;
                                continue 'candidates; // being edited — skip Enrich too
                            }
                            Ok(Outcome::Proposed) => {
                                report.proposals += 1;
                                report.journal_written = true;
                            }
                            Ok(Outcome::Applied(new_rel)) => {
                                report.applied += 1;
                                report.journal_written = true;
                                if let Some(nr) = new_rel {
                                    // the filing moved the note — Enrich targets
                                    // its new home (same ULID, same body)
                                    rel = nr;
                                    snap = match snapshot_note(root, &rel) {
                                        Ok(s) => s,
                                        Err(_) => continue 'candidates,
                                    };
                                }
                            }
                            Err(e) => {
                                // a refused write (e.g. locked between read and
                                // apply) — drop; the next sweep re-evaluates
                                // from disk truth.
                                report.errors += 1;
                                inner.status.lock().unwrap().last_error = Some(e);
                                continue 'candidates;
                            }
                        }
                    }
                }
            }
        }

        // ── Job B — Enrich (any staged or placed note) ────────────────────────
        if enrich_covered(&snap, &state) {
            continue;
        }
        let key = state_key(&snap);
        let stamp = now_rfc3339();
        let eligible: Vec<&'static str> = ENRICH_FIELDS
            .iter()
            .copied()
            .filter(|k| field_eligible(&snap, state.notes.get(&key), k))
            .collect();
        if eligible.is_empty() {
            // every target field is user-owned — record coverage for THIS body
            // so the sweep stops re-offering it (a body edit re-evaluates).
            // Outstanding field proposals from an older body would clobber the
            // user's values on Approve — retire them.
            let dismissed = corpus_state.route(root_id, |s| {
                let old_rows = {
                    let ns = state.notes.entry(key.clone()).or_default();
                    ns.hash = snap.body_hash.clone();
                    ns.proposed.enrich = snap.body_hash.clone();
                    ns.processed_at = stamp.clone();
                    std::mem::take(&mut ns.proposed.enrich_rows)
                };
                let mut d = false;
                for old in &old_rows {
                    d |= supersede(s, old)?;
                }
                s.dot_write("organizer", &state_pretty(&state))?;
                Ok(d)
            })?;
            if dismissed {
                report.journal_written = true;
            }
            continue;
        }
        let peers = peers.get_or_insert_with(|| list_peers(root));
        let self_stem =
            rel.rsplit('/').next().unwrap_or(&rel).trim_end_matches(".md").to_string();
        let others: Vec<(String, String)> =
            peers.iter().filter(|(_, stem)| *stem != self_stem).cloned().collect();
        let candidates = rank_note_candidates(&snap.title, &snap.body, &others, LINK_CANDIDATES);
        let prompt = enrich_prompt(&snap, &candidates);
        // the model call — again NO lock held
        let raw = match transport(&prompt) {
            Ok(r) => r,
            Err(e) => {
                report.model_offline = true;
                inner.queue.lock().unwrap().insert(rel, Instant::now());
                report.requeued += 1;
                let mut st = inner.status.lock().unwrap();
                st.model_offline = true;
                st.last_error = Some(e);
                break 'candidates;
            }
        };
        // an unparseable reply still records coverage below — temp-0 junk
        // must not hot-loop, same rule as classify
        let out = parse_enrich(&raw, &candidates);
        let apply = auto_applies(trust, Verb::Annotate, false);

        // the write window — one short route(); re-check the note first
        let outcome = corpus_state.route(root_id, |s| {
            let fresh =
                std::fs::read_to_string(root.join(&rel)).map_err(|e| e.to_string())?;
            let (_, fresh_body) = corpus::parse_document(&fresh);
            if fnv1a64(fresh_body.as_bytes()) != snap.body_hash {
                return Ok(EnrichOutcome::Requeue); // edited under us — re-evaluate (§4.8)
            }
            // §4.8 supersede — this pass only runs for a CHANGED body, so any
            // still-pending field rows describe an older note. Retire them.
            let old_rows =
                std::mem::take(&mut state.notes.entry(key.clone()).or_default().proposed.enrich_rows);
            let mut superseded = false;
            for old in &old_rows {
                superseded |= supersede(s, old)?;
            }
            let mut proposed = 0usize;
            let mut applied = 0usize;
            let mut new_rows: Vec<String> = Vec::new();
            for (fkey, value) in out.iter().flat_map(EnrichOut::fields) {
                if !eligible.contains(&fkey) {
                    continue; // user-owned — never clobbered, never even proposed
                }
                let current = snap.fields.get(fkey).cloned().unwrap_or_default();
                if current == value {
                    continue; // compare-before-write: already on disk ⇒ no-op
                }
                let row = JournalRow {
                    action: "field",
                    note_id: rel.clone(),
                    note_title: snap.title.clone(),
                    note_ulid: snap.id.clone(),
                    area: None,
                    field: Some(fkey.to_string()),
                    before: current,
                    after: value.clone(),
                    confidence: None,
                    status: if apply { "applied" } else { "proposed" },
                };
                let row_ulid = Ulid::new().to_string();
                if apply {
                    // the Filer gate re-reads `locked` FRESH inside this
                    s.set_ai_field(&rel, fkey, &value)?;
                    state
                        .notes
                        .entry(key.clone())
                        .or_default()
                        .last_fields
                        .insert(fkey.to_string(), value);
                    applied += 1;
                } else {
                    proposed += 1;
                    new_rows.push(row_ulid.clone());
                }
                s.journal_append(&journal_line(&row, &row_ulid, now_ms(), chat::DEFAULT_MODEL))?;
            }
            let ns = state.notes.entry(key.clone()).or_default();
            ns.hash = snap.body_hash.clone();
            ns.proposed.enrich = snap.body_hash.clone();
            ns.proposed.enrich_rows = new_rows;
            ns.processed_at = stamp.clone();
            s.dot_write("organizer", &state_pretty(&state))?;
            Ok(EnrichOutcome::Rows { proposed, applied, superseded })
        });
        match outcome {
            Ok(EnrichOutcome::Requeue) => {
                inner.queue.lock().unwrap().insert(rel, Instant::now());
                report.requeued += 1;
            }
            Ok(EnrichOutcome::Rows { proposed, applied, superseded }) => {
                report.proposals += proposed;
                report.applied += applied;
                if proposed + applied > 0 || superseded {
                    report.journal_written = true;
                }
            }
            Err(e) => {
                report.errors += 1;
                inner.status.lock().unwrap().last_error = Some(e);
            }
        }
    }

    // ── Job C — RefreshIndex (deterministic; behind the same gates) ──────────
    // trust re-sampled: a mid-cycle Off must park the index job too
    let trust = *inner.trust.lock().unwrap();
    if trust != Trust::Off && gates() {
        refresh_indexes(corpus_state, root_id, root, trust, &mut state, &mut report)?;
    }

    // status for the UI (§4.8: show, don't nag)
    {
        let mut st = inner.status.lock().unwrap();
        st.last_run_at = Some(now_rfc3339());
        // secure_pending was maintained per candidate above; prune entries
        // whose file is gone (deleted / moved outside the daemon's sight)
        st.secure_pending.retain(|rel| root.join(rel).exists());
        st.model_offline = report.model_offline;
        if !report.model_offline && report.errors == 0 {
            st.last_error = None; // a clean cycle clears the last complaint
        }
    }
    Ok(report)
}

/// Job C — the per-area overview refresh. Deterministic end to end (render is
/// a pure function of membership), so it needs no model, no backoff, and its
/// rewrite is a guaranteed fixed point: regenerate → apply → regenerate = no-op.
/// Applies at Organize only (§4.3); Suggest/Tidy journal the full proposed body
/// (§4.5 side-by-side diff), guarded against re-proposal spam by `proposedHash`.
fn refresh_indexes(
    corpus_state: &CorpusState,
    root_id: &str,
    root: &Path,
    trust: Trust,
    state: &mut OrganizerFile,
    report: &mut CycleReport,
) -> Result<(), String> {
    for (area, _) in area_vocab(root) {
        let members = area_members(root, &area);
        if members.is_empty() {
            continue; // nothing to overview — never propose an empty table
        }
        let mh = members_hash(&members);
        if state.areas.get(&area).is_some_and(|a| a.members_hash == mh) {
            continue; // membership (incl. summaries) unchanged since last build
        }
        let body = render_index(&area, &members);
        let rel = format!("wiki/{area}/_index.md");
        let disk = std::fs::read_to_string(root.join(&rel)).unwrap_or_default();
        if body == disk {
            // fixed point — record it (this is also how a FRONTEND approval
            // settles: the approved body is already on disk, we just catch up)
            let a = state.areas.entry(area.clone()).or_default();
            a.members_hash = mh;
            a.built_at = now_rfc3339();
            a.proposed_hash.clear();
            corpus_state.route(root_id, |s| s.dot_write("organizer", &state_pretty(state)))?;
            continue;
        }
        let apply = auto_applies(trust, Verb::Index, false);
        if !apply
            && state
                .areas
                .get(&area)
                .is_some_and(|a| a.proposed_hash == fnv1a64(body.as_bytes()))
        {
            continue; // this exact body already sits in the journal — no spam
        }
        // No model ran (deterministic render) — the row's model field is empty.
        let mut row = JournalRow {
            action: "index",
            note_id: rel.clone(),
            note_title: area.clone(),
            note_ulid: None, // an _index.md is path-addressed, no frontmatter ULID
            area: Some(area.clone()),
            field: None,
            before: disk,
            after: body.clone(),
            confidence: None,
            status: "proposed",
        };
        let row_ulid = Ulid::new().to_string();
        let ts = now_ms();
        corpus_state.route(root_id, |s| {
            if apply {
                s.write_index(&area, &body)?; // filer_writable gates inside
                row.status = "applied";
            }
            s.journal_append(&journal_line(&row, &row_ulid, ts, ""))?;
            let a = state.areas.entry(area.clone()).or_default();
            if apply {
                a.members_hash = mh.clone();
                a.built_at = now_rfc3339();
                a.proposed_hash.clear();
            } else {
                a.proposed_hash = fnv1a64(body.as_bytes());
            }
            s.dot_write("organizer", &state_pretty(state))
        })?;
        if apply {
            report.applied += 1;
        } else {
            report.proposals += 1;
        }
        report.journal_written = true;
    }
    Ok(())
}

fn state_pretty(state: &OrganizerFile) -> String {
    serde_json::to_string_pretty(state).unwrap_or_else(|_| "{}".into())
}

/// The reconciliation sweep (doc §2 gate 3): walk `wiki/**/*.md` lock-free and
/// return every candidate some job still has work on (body hash differs from
/// the recorded classify AND enrich markers) — a DIFF sweep, not a re-process.
fn sweep(root: &Path, state: &OrganizerFile) -> Vec<String> {
    let mut rels = Vec::new();
    collect_md(root, "wiki", &mut rels);
    rels.into_iter()
        .filter(|rel| candidate_rel(rel))
        .filter(|rel| match snapshot_note(root, rel) {
            Ok(s) => !(classify_covered(&s, state) && enrich_covered(&s, state)),
            Err(_) => false,
        })
        .collect()
}

fn collect_md(root: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(root.join(prefix)) else { return };
    for entry in entries.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let rel = format!("{prefix}/{name}");
        match entry.file_type() {
            Ok(t) if t.is_dir() => collect_md(root, &rel, out),
            Ok(t) if t.is_file() && name.ends_with(".md") => out.push(rel),
            _ => {}
        }
    }
}

// ─── the worker thread ───────────────────────────────────────────────────────

/// Cached system probes — the `pmset`/`ioreg` shell-outs aren't free, so each
/// result lives ~60s. Fail-open: an unreadable probe never bricks the daemon
/// (the trust ladder, not the power gate, is the safety boundary).
struct GateProbes {
    at: Option<Instant>,
    on_ac: bool,
    thermal_ok: bool,
    user_idle: bool,
}

impl GateProbes {
    fn new() -> Self {
        GateProbes { at: None, on_ac: true, thermal_ok: true, user_idle: true }
    }

    /// `max_age` is the caller's staleness budget: ~60s between cycles, a much
    /// shorter leash for the per-candidate re-check INSIDE a cycle (each model
    /// call runs up to 45s — a user who returned or unplugged mid-queue must
    /// stop the next candidate, not the next cycle).
    fn refresh(&mut self, max_age: Duration) {
        if self.at.is_some_and(|t| t.elapsed() < max_age) {
            return;
        }
        self.on_ac = probe_on_ac();
        self.thermal_ok = probe_thermal_ok();
        self.user_idle = probe_user_idle();
        self.at = Some(Instant::now());
    }
}

#[cfg(target_os = "macos")]
fn probe_on_ac() -> bool {
    match std::process::Command::new("pmset").args(["-g", "batt"]).output() {
        Ok(o) => String::from_utf8_lossy(&o.stdout).contains("AC Power"),
        Err(_) => true,
    }
}

#[cfg(not(target_os = "macos"))]
fn probe_on_ac() -> bool {
    true
}

/// macOS throttling already? (`CPU_Speed_Limit` below 80 means the machine is
/// hot) — a 12B generation is a real thermal event on a laptop (doc §2 gate 2).
#[cfg(target_os = "macos")]
fn probe_thermal_ok() -> bool {
    let Ok(o) = std::process::Command::new("pmset").args(["-g", "therm"]).output() else {
        return true;
    };
    let text = String::from_utf8_lossy(&o.stdout);
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("CPU_Speed_Limit") {
            if let Some(v) = rest.split('=').nth(1).and_then(|v| v.trim().parse::<u32>().ok()) {
                return v >= 80;
            }
        }
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn probe_thermal_ok() -> bool {
    true
}

/// No keyboard/mouse for 60s ⇒ idle (HIDIdleTime is in nanoseconds).
#[cfg(target_os = "macos")]
fn probe_user_idle() -> bool {
    let Ok(o) = std::process::Command::new("ioreg").args(["-c", "IOHIDSystem"]).output() else {
        return true;
    };
    let text = String::from_utf8_lossy(&o.stdout);
    text.lines()
        .find(|l| l.contains("HIDIdleTime"))
        .and_then(|l| l.rsplit('=').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|ns| ns >= 60_000_000_000)
        .unwrap_or(true)
}

#[cfg(not(target_os = "macos"))]
fn probe_user_idle() -> bool {
    true
}

/// rotli hidden or behind another app counts as backgrounded — organizing while
/// the window isn't being looked at is exactly the intended moment.
fn app_backgrounded(app: &tauri::AppHandle) -> bool {
    match app.get_webview_window("main") {
        Some(w) => !(w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false)),
        None => true,
    }
}

/// Spawn the daemon worker (mirrors `spawn_watcher`: one std::thread, wakes on
/// the condvar or a 30s tick). `root_id`/`root` name the store whose layout is
/// Memex — the daemon's only territory; no memex ⇒ this is never called.
pub fn spawn_organizer(app: tauri::AppHandle, handle: OrganizerHandle, root_id: String, root: PathBuf) {
    handle.0.running.store(true, Ordering::SeqCst);
    std::thread::spawn(move || {
        let inner: &OrganizerInner = &handle.0;
        // RefCell: the per-candidate gates closure must be able to REFRESH the
        // probes (it only gets &self through &dyn Fn), while the cache lives
        // across cycles. Single worker thread — no contention.
        let probes = std::cell::RefCell::new(GateProbes::new());
        let mut last_sweep: Option<Instant> = None;
        let mut backoff = BACKOFF_MIN;
        let mut next_model_try = Instant::now();
        // status signature of the last cycle — a status-only change (secrets
        // skipped, model offline/back) must reach the UI even when no journal
        // line was written, or the §4.2.3 hint and the offline pause appear
        // late and clear later still.
        let mut last_status_sig: Option<(bool, usize)> = None;
        loop {
            // park until work arrives or the tick elapses (sweep/backoff timing)
            {
                let q = inner.queue.lock().unwrap();
                let _unused = inner.cv.wait_timeout(q, Duration::from_secs(30)).unwrap();
            }
            let corpus_state = app.state::<CorpusState>();
            let knobs = read_knobs(&corpus_state, &root_id, inner);
            let _ = knobs; // trust refreshed into `inner`; run_cycle re-reads its own copy
            if *inner.trust.lock().unwrap() == Trust::Off {
                inner.run_now.store(false, Ordering::SeqCst);
                continue; // dormant — don't even sweep
            }

            // startup + slow reconciliation sweep (diff-only)
            let mut swept = false;
            if last_sweep.map_or(true, |t| t.elapsed() >= SWEEP_EVERY) {
                let state_json = corpus_state
                    .route(&root_id, |s| s.dot_read("organizer"))
                    .unwrap_or_else(|_| "{}".into());
                let state = parse_state(&state_json);
                let abs: Vec<PathBuf> = sweep(&root, &state).into_iter().map(|r| root.join(r)).collect();
                handle.enqueue(&root, &abs);
                last_sweep = Some(Instant::now());
                swept = true;
            }

            let run_now = inner.run_now.swap(false, Ordering::SeqCst);
            // An empty queue still runs a cycle right after a sweep (or on the
            // manual nudge): the index membership diff must see changes made by
            // FRONTEND approvals, whose writes are suppress-marked — no watcher
            // event ever arrives for them.
            if inner.queue.lock().unwrap().is_empty() && !swept && !run_now {
                continue;
            }
            // model-offline backoff — run-now retries immediately
            if !run_now && Instant::now() < next_model_try {
                continue;
            }
            probes.borrow_mut().refresh(Duration::from_secs(60));
            let gates = || {
                // the LIVE re-check per candidate: a chat can start, the user
                // can return / unplug / heat the machine mid-cycle — so idle,
                // power, thermal, and focus are all re-sampled here (short
                // probe leash), not just interactive_busy. Only run_now stays
                // a cycle-start value (the user's explicit nudge).
                let mut p = probes.borrow_mut();
                p.refresh(Duration::from_secs(10));
                gates_pass(&GateSnapshot {
                    on_ac: p.on_ac,
                    thermal_ok: p.thermal_ok,
                    user_idle: p.user_idle,
                    app_backgrounded: app_backgrounded(&app),
                    interactive_busy: inner.interactive.load(Ordering::SeqCst) > 0,
                    run_now,
                })
            };
            if !gates() {
                continue; // leave the queue intact for the next wake
            }
            let transport = |prompt: &str| {
                let msgs = [WireMsg {
                    role: "user".to_string(),
                    content: prompt.to_string(),
                    images: Vec::new(),
                }];
                chat::complete_local(&msgs, true, 0.0, GEN_MAX_TOKENS, MODEL_TIMEOUT)
            };
            match run_cycle(&corpus_state, &root_id, &root, inner, &gates, &transport) {
                Ok(report) => {
                    let sig = {
                        let st = inner.status.lock().unwrap();
                        (st.model_offline, st.secure_pending.len())
                    };
                    // journal rows AND status-only changes both refetch the UI
                    // (the frontend invalidates journal + organizer together)
                    if report.journal_written || last_status_sig != Some(sig) {
                        let _ = app.emit_to("main", "rotli:brain-journal", ());
                    }
                    last_status_sig = Some(sig);
                    if report.applied > 0 {
                        // our writes are suppress-marked, so the watcher won't
                        // echo them — tell the frontend ourselves
                        let _ = app.emit_to("main", "rotli:corpus-changed", ());
                    }
                    if report.model_offline {
                        next_model_try = Instant::now() + backoff;
                        backoff = (backoff * 2).min(BACKOFF_MAX);
                    } else {
                        backoff = BACKOFF_MIN;
                    }
                }
                Err(e) => {
                    inner.status.lock().unwrap().last_error = Some(e);
                }
            }
        }
    });
}

// ─── commands ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerStatus {
    running: bool,
    trust: String,
    queued: usize,
    last_run_at: Option<String>,
    last_error: Option<String>,
    secure_skipped: usize,
    model_offline: bool,
}

#[tauri::command]
pub fn organizer_status(state: tauri::State<OrganizerState>) -> OrganizerStatus {
    let inner = &state.0 .0;
    let st = inner.status.lock().unwrap().clone();
    OrganizerStatus {
        running: inner.running.load(Ordering::SeqCst),
        trust: inner.trust.lock().unwrap().as_str().to_string(),
        queued: inner.queue.lock().unwrap().len(),
        last_run_at: st.last_run_at,
        last_error: st.last_error,
        // the DURABLE count — notes still sitting unreviewed with secret-looking
        // content, not the last cycle's tally (which zeroes on any small cycle)
        secure_skipped: st.secure_pending.len(),
        model_offline: st.model_offline,
    }
}

/// The manual nudge — bypasses quiet/idle/AC/thermal (never an in-flight chat).
#[tauri::command]
pub fn organizer_run_once(state: tauri::State<OrganizerState>) -> Result<(), String> {
    let inner = &state.0 .0;
    if !inner.running.load(Ordering::SeqCst) {
        return Err("the organizer isn't running — your notes folder isn't a memex".into());
    }
    inner.run_now.store(true, Ordering::SeqCst);
    inner.cv.notify_all();
    Ok(())
}

/// Immediate in-memory trust flip; the frontend persists the same value into
/// settings.json, which the daemon re-reads each cycle as the backstop.
#[tauri::command]
pub fn organizer_set_trust(state: tauri::State<OrganizerState>, level: String) -> Result<(), String> {
    let t = Trust::parse_strict(&level).ok_or_else(|| format!("unknown trust level: {level}"))?;
    state.0.set_trust(t);
    state.0 .0.cv.notify_all();
    Ok(())
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::AtomicUsize;
    use tempfile::TempDir;

    /// A memex brain with `_inbox` staging + two areas, registered as the
    /// default root of a CorpusState — the daemon's whole world, in a TempDir.
    fn seed_brain() -> (TempDir, PathBuf, CorpusState, OrganizerHandle) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("brain");
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        fs::create_dir_all(root.join("wiki/Projects")).unwrap();
        fs::create_dir_all(root.join("wiki/Research")).unwrap();
        fs::create_dir_all(root.join("chats")).unwrap();
        fs::write(root.join("memex.json"), "{\"id\":\"mx_test123\",\"contract\":\"3.4\"}").unwrap();
        fs::write(root.join("wiki/README.md"), "# This is your Brain\n").unwrap();
        let store = corpus::CorpusStore::open(root).unwrap();
        assert!(store.is_memex());
        let root = store.root().to_path_buf(); // canonicalized (/var → /private/var)
        let mut reg = corpus::CorpusRegistry::new("default".to_string());
        reg.insert("default".to_string(), store);
        (dir, root, CorpusState(Mutex::new(reg)), OrganizerHandle::new())
    }

    /// Create a real staged capture through the corpus (so it has a ULID) and
    /// return its rel path.
    fn stage_capture(state: &CorpusState, body: &str) -> String {
        state
            .route("default", |s| {
                let meta = s.create("wiki/_inbox", body)?;
                s.resolve_note_rel(&meta.id)
            })
            .unwrap()
    }

    fn write_settings(state: &CorpusState, json: &str) {
        state.route("default", |s| s.dot_write("settings", json)).unwrap();
    }

    /// Add a control frontmatter line (locked/secure) the way the UI would —
    /// preserving the codec shape — but via plain fs, like any external editor.
    fn add_flag(root: &Path, rel: &str, line: &str) {
        let text = fs::read_to_string(root.join(rel)).unwrap();
        let (fm, body) = corpus::parse_document(&text);
        let mut fm = fm.unwrap_or_default();
        fm.foreign.push(line.to_string());
        fs::write(root.join(rel), corpus::compose_document(&fm, body)).unwrap();
    }

    fn journal_rows(state: &CorpusState) -> Vec<serde_json::Value> {
        state
            .route("default", |s| s.journal_read())
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    /// Byte hash of the whole corpus tree EXCLUDING `.rotli/` — the write-free
    /// invariant's measuring stick.
    fn tree_hash(root: &Path) -> String {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
            let mut entries: Vec<_> =
                fs::read_dir(dir).unwrap().filter_map(|e| e.ok()).collect();
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                let name = e.file_name().to_string_lossy().into_owned();
                if name == ".rotli" {
                    continue; // the sidecars are the daemon's ONLY allowed sink
                }
                let p = e.path();
                if p.is_dir() {
                    walk(root, &p, out);
                } else {
                    let rel = p.strip_prefix(root).unwrap().to_string_lossy().into_owned();
                    out.push((rel, fnv1a64(&fs::read(&p).unwrap())));
                }
            }
        }
        let mut rows = Vec::new();
        walk(root, root, &mut rows);
        fnv1a64(format!("{rows:?}").as_bytes())
    }

    fn no_gates() -> impl Fn() -> bool {
        || true
    }

    // ── pure core ──

    #[test]
    fn fnv_hash_is_stable_and_distinct() {
        assert_eq!(fnv1a64(b"hello"), fnv1a64(b"hello"));
        assert_ne!(fnv1a64(b"hello"), fnv1a64(b"hellp"));
        assert_eq!(fnv1a64(b"").len(), 16);
        // the FNV-1a offset basis — pins the algorithm (not DefaultHasher)
        assert_eq!(fnv1a64(b""), "cbf29ce484222325");
    }

    #[test]
    fn candidate_filter_drops_index_readme_dots_nonwiki() {
        assert!(candidate_rel("wiki/_inbox/foo-a1b2c3.md"));
        assert!(candidate_rel("wiki/Projects/alazan-84-x1y2z3.md"));
        assert!(!candidate_rel("wiki/README.md"), "the pinned trust artifact");
        assert!(!candidate_rel("wiki/Projects/_index.md"), "the daemon's own output");
        assert!(!candidate_rel("chats/today.md"), "not the daemon's territory");
        assert!(!candidate_rel("inbox.md"));
        assert!(!candidate_rel("wiki/Projects/photo.png"));
        assert!(!candidate_rel("wiki/.hidden/x.md"));
        assert!(!candidate_rel(".rotli/settings.json"));
    }

    #[test]
    fn state_parse_roundtrip_and_corrupt_input_resets() {
        let mut f = OrganizerFile::default();
        f.notes.insert(
            "01JULID".into(),
            NoteState {
                hash: "abc".into(),
                area: "Projects".into(),
                last_fields: BTreeMap::from([("summary".to_string(), "one line".to_string())]),
                proposed: ProposedState { file: "abc".into(), ..Default::default() },
                processed_at: "2026-07-01T00:00:00Z".into(),
            },
        );
        f.areas.insert(
            "Projects".into(),
            AreaState { members_hash: "def".into(), built_at: "…".into(), proposed_hash: String::new() },
        );
        let json = serde_json::to_string_pretty(&f).unwrap();
        assert_eq!(parse_state(&json), f, "round-trip");
        // wire shape is the documented camelCase
        assert!(json.contains("\"lastFields\""));
        assert!(json.contains("\"membersHash\""));
        // corrupt / foreign / empty input → fresh default, never a panic
        assert_eq!(parse_state("{not json"), OrganizerFile::default());
        assert_eq!(parse_state("[1,2,3]"), OrganizerFile::default());
        // dot_read yields "{}" for a missing file — that's a valid fresh default
        assert_eq!(parse_state("{}"), OrganizerFile::default());
    }

    #[test]
    fn skip_rules_locked_secure_quiet_unchanged() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("wiki/_inbox")).unwrap();
        let fm = "---\nid: 01SKIP\ncreated: 2026-07-01\nupdated: 2026-07-01\npinned: false\n";

        fs::write(root.join("wiki/_inbox/locked.md"), format!("{fm}locked: true\n---\n\n# L\n")).unwrap();
        fs::write(root.join("wiki/_inbox/flagged.md"), format!("{fm}secure: true\n---\n\n# S\n")).unwrap();
        // NO secure flag — the body itself trips the in-memory detector
        fs::write(root.join("wiki/_inbox/ssn.md"), format!("{fm}---\n\n# T\n\nSSN: 078-05-1120\n")).unwrap();
        fs::write(root.join("wiki/_inbox/plain.md"), format!("{fm}---\n\n# P\n\ngroceries\n")).unwrap();

        let st = OrganizerFile::default();
        let quiet = Duration::ZERO;
        let snap = |name: &str| snapshot_note(&root, &format!("wiki/_inbox/{name}")).unwrap();

        assert_eq!(skip_reason(&snap("locked.md"), &st, quiet), Some(Skip::Locked));
        assert_eq!(skip_reason(&snap("flagged.md"), &st, quiet), Some(Skip::Secure));
        assert_eq!(
            skip_reason(&snap("ssn.md"), &st, quiet),
            Some(Skip::Secure),
            "looks_secure on the raw bytes must flag an unflagged secret note"
        );
        assert_eq!(skip_reason(&snap("plain.md"), &st, quiet), None);
        // quiet period: a just-written note is being typed — requeue, not model
        assert_eq!(
            skip_reason(&snap("plain.md"), &st, Duration::from_secs(45)),
            Some(Skip::Quiet)
        );
        // unchanged: state covers BOTH jobs for this exact body
        let s = snap("plain.md");
        let mut st2 = OrganizerFile::default();
        st2.notes.insert(
            state_key(&s),
            NoteState {
                hash: s.body_hash.clone(),
                proposed: ProposedState { enrich: s.body_hash.clone(), ..Default::default() },
                ..Default::default()
            },
        );
        assert_eq!(skip_reason(&s, &st2, quiet), Some(Skip::Unchanged));
        // classify covered but enrich NOT ⇒ still a candidate (Job B has work)
        let mut st2b = OrganizerFile::default();
        st2b.notes.insert(
            state_key(&s),
            NoteState { hash: s.body_hash.clone(), ..Default::default() },
        );
        assert_eq!(skip_reason(&s, &st2b, quiet), None);
        // outstanding proposals for this hash also block re-proposing
        let mut st3 = OrganizerFile::default();
        st3.notes.insert(
            state_key(&s),
            NoteState {
                proposed: ProposedState {
                    file: s.body_hash.clone(),
                    enrich: s.body_hash.clone(),
                    ..Default::default()
                },
                ..Default::default()
            },
        );
        assert_eq!(skip_reason(&s, &st3, quiet), Some(Skip::Unchanged));
    }

    #[test]
    fn classify_parse_constrains_area_to_vocab_and_clamps_confidence() {
        let vocab = vec![
            ("Projects".to_string(), "client work".to_string()),
            ("Research".to_string(), String::new()),
        ];
        // canonical pass-through + clamped confidence
        let out = parse_classify("{\"area\": \"projects\", \"confidence\": 1.7}", &vocab).unwrap();
        assert_eq!(out.area, "Projects", "case-insensitive → canonical");
        assert_eq!(out.confidence, 1.0, "clamped to [0,1]");
        let out = parse_classify("prose {\"area\":\"Research\",\"confidence\":-2} more", &vocab).unwrap();
        assert_eq!(out.area, "Research");
        assert_eq!(out.confidence, 0.0);
        // an invented area, "none", junk, or missing fields → None (never a guess)
        assert!(parse_classify("{\"area\": \"Cooking\", \"confidence\": 0.9}", &vocab).is_none());
        assert!(parse_classify("{\"area\": \"none\", \"confidence\": 0.9}", &vocab).is_none());
        assert!(parse_classify("total junk", &vocab).is_none());
        assert!(parse_classify("{\"confidence\": 0.9}", &vocab).is_none());
        // a missing confidence is 0, not a rejection (the area is still valid)
        assert_eq!(parse_classify("{\"area\": \"Projects\"}", &vocab).unwrap().confidence, 0.0);
    }

    #[test]
    fn proposal_json_matches_journal_shape() {
        let row = JournalRow {
            action: "file",
            note_id: "wiki/_inbox/foo-a1b2c3.md".into(),
            note_title: "Foo".into(),
            note_ulid: Some("01JNOTEULID000000000000000".into()),
            area: Some("Projects".into()),
            field: None,
            before: "wiki/_inbox".into(),
            after: "wiki/Projects".into(),
            confidence: Some(0.91),
            status: "proposed",
        };
        let line = journal_line(&row, "01JULIDULIDULIDULIDULIDULI", 1751370000000, "gemma-3-12b-it-qat-4bit");
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["id"], "01JULIDULIDULIDULIDULIDULI");
        assert_eq!(v["ts"], 1751370000000i64);
        assert_eq!(v["action"], "file");
        assert_eq!(v["noteId"], "wiki/_inbox/foo-a1b2c3.md");
        assert_eq!(v["noteTitle"], "Foo");
        assert_eq!(
            v["noteUlid"], "01JNOTEULID000000000000000",
            "the stable handle Approve/Undo resolve through"
        );
        assert_eq!(v["area"], "Projects");
        assert_eq!(v["before"], "wiki/_inbox");
        assert_eq!(v["after"], "wiki/Projects");
        assert_eq!(v["model"], "gemma-3-12b-it-qat-4bit");
        assert_eq!(v["confidence"], 0.91);
        assert_eq!(v["status"], "proposed");
        assert!(v.get("field").is_none(), "file rows carry no field key");
        assert!(!line.contains('\n'), "one journal row = one line");
        // a field row carries `field` and no `area`
        let frow = JournalRow {
            action: "field",
            note_id: "wiki/_inbox/foo-a1b2c3.md".into(),
            note_title: "Foo".into(),
            note_ulid: None,
            area: None,
            field: Some("suggested_area".into()),
            before: String::new(),
            after: "Projects".into(),
            confidence: Some(0.42),
            status: "proposed",
        };
        let v: serde_json::Value =
            serde_json::from_str(&journal_line(&frow, "01X", 1, "m")).unwrap();
        assert_eq!(v["field"], "suggested_area");
        assert!(v.get("area").is_none());
        assert!(v.get("noteUlid").is_none(), "no ULID (external drop / index) ⇒ no key");
    }

    #[test]
    fn apply_matrix_table() {
        use Trust::*;
        use Verb::*;
        // (trust, verb) → auto-applies, per the §4.3 table
        let table = [
            (Off, FileStaged, false),
            (Off, Annotate, false),
            (Off, Refile, false),
            (Off, Index, false),
            (Suggest, FileStaged, false),
            (Suggest, Annotate, false),
            (Suggest, Refile, false),
            (Suggest, Index, false),
            (Tidy, FileStaged, true),
            (Tidy, Annotate, true),
            (Tidy, Refile, false),
            (Tidy, Index, false),
            (Organize, FileStaged, true),
            (Organize, Annotate, true),
            (Organize, Refile, true),
            (Organize, Index, true),
        ];
        for (trust, verb, want) in table {
            assert_eq!(auto_applies(trust, verb, false), want, "{trust:?}/{verb:?}");
            // secure ⇒ NEVER, at every rung, for every verb (§4.2.4)
            assert!(!auto_applies(trust, verb, true), "secure must veto {trust:?}/{verb:?}");
        }
    }

    #[test]
    fn gates_pass_truth_table() {
        let base = GateSnapshot {
            on_ac: true,
            thermal_ok: true,
            user_idle: true,
            app_backgrounded: false,
            interactive_busy: false,
            run_now: false,
        };
        assert!(gates_pass(&base));
        assert!(!gates_pass(&GateSnapshot { on_ac: false, ..base }));
        assert!(!gates_pass(&GateSnapshot { thermal_ok: false, ..base }));
        // active user + foregrounded app → wait; either idle or backgrounded is enough
        assert!(!gates_pass(&GateSnapshot { user_idle: false, ..base }));
        assert!(gates_pass(&GateSnapshot { user_idle: false, app_backgrounded: true, ..base }));
        // run_now bypasses power/idle/thermal…
        assert!(gates_pass(&GateSnapshot {
            on_ac: false,
            thermal_ok: false,
            user_idle: false,
            run_now: true,
            ..base
        }));
        // …but NEVER an interactive chat
        assert!(!gates_pass(&GateSnapshot { interactive_busy: true, run_now: true, ..base }));
        assert!(!gates_pass(&GateSnapshot { interactive_busy: true, ..base }));
    }

    #[test]
    fn trust_parse_is_safe_and_strict_where_it_must_be() {
        assert_eq!(Trust::parse("tidy"), Trust::Tidy);
        assert_eq!(Trust::parse("garbage"), Trust::Suggest, "unknown → the safe default");
        assert_eq!(Trust::parse(""), Trust::Suggest);
        assert!(Trust::parse_strict("garbage").is_none(), "the command rejects junk");
        // knob parsing: bad values fall back, never explode
        let k = parse_knobs("{\"organizerTrust\":\"organize\",\"organizerThreshold\":0.6,\"organizerQuietSecs\":10}");
        assert_eq!(k.trust, Some(Trust::Organize));
        assert_eq!(k.threshold, 0.6);
        assert_eq!(k.quiet, Duration::from_secs(10));
        let k = parse_knobs("{\"organizerThreshold\":7}");
        assert_eq!(k.threshold, DEFAULT_THRESHOLD, "out-of-band threshold → default");
        assert_eq!(k.trust, None);
        let k = parse_knobs("not json");
        assert_eq!(k.threshold, DEFAULT_THRESHOLD);
        assert_eq!(k.quiet, DEFAULT_QUIET);
    }

    // ── the cycle ──

    #[test]
    fn secure_and_locked_never_reach_the_transport() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}");
        // a locked capture, a flagged-secure capture, and a raw-secret capture
        let locked = stage_capture(&state, "# Locked one\n\nplain");
        add_flag(&root, &locked, "locked: true");
        let flagged = stage_capture(&state, "# Flagged one\n\nplain");
        add_flag(&root, &flagged, "secure: true");
        let raw_secret = stage_capture(&state, "# Card\n\ncard 4242 4242 4242 4242\n");

        for rel in [&locked, &flagged, &raw_secret] {
            handle.enqueue(&root, &[root.join(rel)]);
        }
        let calls = AtomicUsize::new(0);
        let transport = |_: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("{\"area\":\"Projects\",\"confidence\":0.99}".to_string())
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0, "secure/locked must NEVER be modeled");
        assert_eq!(report.secure_skipped, 2);
        assert_eq!(report.locked_skipped, 1);
        assert_eq!(report.proposals, 0);
        assert!(journal_rows(&state).is_empty(), "no proposal may carry secure content");
    }

    /// The transport tests share: classify prompts get an area pick, enrich
    /// prompts a full annotation object. Branches on each prompt's fixed marker.
    fn dual_transport(prompt: &str) -> Result<String, String> {
        Ok(if prompt.contains("Pick the ONE best area") {
            if prompt.contains("Alazan") {
                "{\"area\":\"Projects\",\"confidence\":0.95}".to_string()
            } else {
                "{\"area\":\"Research\",\"confidence\":0.4}".to_string()
            }
        } else {
            "{\"summary\":\"one line\",\"tags\":[\"deal\",\"land\"],\"links\":[]}".to_string()
        })
    }

    /// A note already sitting in an area, written the way an external tool (or
    /// a past filing) would leave it — raw fs, own ULID, some frontmatter.
    fn seed_placed(root: &Path, area: &str, name: &str, id: &str, extra_fm: &str, body: &str) -> String {
        let rel = format!("wiki/{area}/{name}");
        fs::write(
            root.join(&rel),
            format!("---\nid: {id}\ncreated: 2026-07-01\nupdated: 2026-07-01\npinned: false\n{extra_fm}---\n\n{body}"),
        )
        .unwrap();
        rel
    }

    #[test]
    fn suggest_run_is_write_free_on_corpus_files() {
        // ALL THREE jobs fire: classify (two staged captures), enrich (the
        // captures + a placed note), and refresh-index (the placed member) —
        // and at Suggest not one byte outside `.rotli/` may change.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}"); // trust defaults to Suggest
        let high = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        let low = stage_capture(&state, "# Mystery\n\nunclear scribble");
        let placed = seed_placed(
            &root,
            "Projects",
            "old-note-p1a2b3.md",
            "01PLACED000000000000000000",
            "summary: my own words\n",
            "# Old note\n\nland archive\n",
        );
        handle.enqueue(&root, &[root.join(&high), root.join(&low), root.join(&placed)]);

        let before = tree_hash(&root);
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();

        assert_eq!(tree_hash(&root), before, "Suggest must be write-free outside .rotli/");
        assert_eq!(report.applied, 0);
        let rows = journal_rows(&state);
        assert!(rows.iter().all(|r| r["status"] == "proposed"), "Suggest proposes ONLY");
        let file_row = rows.iter().find(|r| r["action"] == "file").expect("a file proposal");
        assert_eq!(file_row["after"], "wiki/Projects");
        assert_eq!(file_row["before"], "wiki/_inbox");
        assert_eq!(file_row["confidence"], 0.95);
        let field_row = rows
            .iter()
            .find(|r| r["field"] == "suggested_area")
            .expect("an annotate proposal");
        assert_eq!(field_row["after"], "Research");
        // enrich proposed fields for the captures, but for the placed note the
        // user-owned summary is untouched — only its empty tags get an offer
        assert!(rows
            .iter()
            .any(|r| r["field"] == "summary" && r["noteId"].as_str().unwrap().contains("_inbox")));
        assert!(!rows
            .iter()
            .any(|r| r["field"] == "summary" && r["noteId"] == placed.as_str()));
        assert!(rows.iter().any(|r| r["field"] == "tags" && r["noteId"] == placed.as_str()));
        // the index proposal carries the FULL proposed body for the diff (§4.5)
        let idx = rows.iter().find(|r| r["action"] == "index").expect("an index proposal");
        assert_eq!(idx["area"], "Projects");
        assert!(idx["after"].as_str().unwrap().contains("| Old note | my own words |"));
        assert_eq!(idx["before"], "");
        // the daemon's own state landed in the sidecar
        let st = state.route("default", |s| s.dot_read("organizer")).unwrap();
        assert_eq!(parse_state(&st).notes.len(), 3);
    }

    #[test]
    fn second_run_same_corpus_is_a_noop() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        let calls = AtomicUsize::new(0);
        let transport = |p: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            dual_transport(p)
        };

        handle.enqueue(&root, &[root.join(&rel)]);
        let first =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2, "one classify + one enrich call");
        let rows_after_first = journal_rows(&state).len();
        assert!(first.proposals > 0);

        // re-enqueue the identical note (a watcher echo / restart) → no re-model,
        // no duplicate proposal (the hash-state idempotence rule)
        handle.enqueue(&root, &[root.join(&rel)]);
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2, "unchanged note re-modeled");
        assert_eq!(journal_rows(&state).len(), rows_after_first, "duplicate rows journaled");
        assert_eq!(report.proposals, 0);

        // and the sweep agrees: nothing to enqueue for an unchanged corpus
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        assert!(sweep(&root, &st).is_empty(), "sweep must be a diff, not a re-process");
    }

    #[test]
    fn tidy_files_staged_capture_and_journals_applied() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        let before_updated = {
            let text = fs::read_to_string(root.join(&rel)).unwrap();
            corpus::parse_document(&text).0.unwrap_or_default().updated
        };
        handle.enqueue(&root, &[root.join(&rel)]);
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();

        // filing + the enrich annotations auto-apply at Tidy
        assert!(report.applied >= 1);
        assert!(!root.join(&rel).exists(), "the staged capture left _inbox");
        let rows = journal_rows(&state);
        let file_row = rows.iter().find(|r| r["action"] == "file").expect("the filing row");
        assert_eq!(file_row["status"], "applied");
        let new_rel = file_row["noteId"].as_str().unwrap();
        assert!(new_rel.starts_with("wiki/Projects/"), "journal carries the new rel: {new_rel}");
        let filed = fs::read_to_string(root.join(new_rel)).unwrap();
        assert!(filed.contains("area: Projects"));
        assert!(filed.contains("filed_by: gemma-3-12b-it-qat-4bit"));
        assert!(filed.contains("filed_at: "));
        // the enrich pass followed the note to its NEW home in the same cycle
        assert!(filed.contains("summary: one line"));
        assert!(filed.contains("tags: [deal, land]"));
        // filing must NOT bump `updated` (§3.1)
        let after_updated = corpus::parse_document(&filed).0.unwrap_or_default().updated;
        assert_eq!(after_updated, before_updated);
        // an index REWRITE stays a proposal at Tidy (§4.3 — review until Organize)
        let idx = rows.iter().find(|r| r["action"] == "index").expect("an index row");
        assert_eq!(idx["status"], "proposed");
        assert!(!root.join("wiki/Projects/_index.md").exists());
        // state converged: area recorded, no outstanding file proposal
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        let ns = st.notes.values().next().unwrap();
        assert_eq!(ns.area, "Projects");
        assert!(ns.proposed.file.is_empty());
        assert_eq!(ns.last_fields.get("summary").map(String::as_str), Some("one line"));
    }

    #[test]
    fn tidy_sets_suggested_area_below_threshold() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Mystery\n\nunclear scribble");
        handle.enqueue(&root, &[root.join(&rel)]);
        let transport = |_: &str| Ok("{\"area\":\"Research\",\"confidence\":0.4}".to_string());
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();

        assert_eq!(report.applied, 1);
        // still in _inbox — a low-confidence guess is NEVER auto-filed (§6.4)…
        let staged = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(staged.contains("suggested_area: Research"));
        assert!(staged.contains("area_confidence: 0.40"));
        assert!(!staged.contains("\narea: "), "no area write below threshold:\n{staged}");
        // …and the journal row is the applied annotation
        let rows = journal_rows(&state);
        assert_eq!(rows[0]["action"], "field");
        assert_eq!(rows[0]["field"], "suggested_area");
        assert_eq!(rows[0]["status"], "applied");
    }

    #[test]
    fn trust_off_is_dormant_and_gate_failure_leaves_the_queue() {
        let (_dir, root, state, handle) = seed_brain();
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        let calls = AtomicUsize::new(0);
        let transport = |_: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("{\"area\":\"Projects\",\"confidence\":0.95}".to_string())
        };
        // Off: drain nothing, model nothing, queue intact
        write_settings(&state, "{\"organizerTrust\":\"off\",\"organizerQuietSecs\":0}");
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(handle.0.queue.lock().unwrap().len(), 1);
        // gates closed: candidate stays queued for the next wake
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        let closed = || false;
        let report = run_cycle(&state, "default", &root, &handle.0, &closed, &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(report.requeued, 1);
        assert_eq!(handle.0.queue.lock().unwrap().len(), 1);
    }

    #[test]
    fn model_offline_requeues_and_reports() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        let transport = |_: &str| Err("local model unreachable".to_string());
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert!(report.model_offline);
        assert_eq!(handle.0.queue.lock().unwrap().len(), 1, "queue survives an outage");
        assert!(journal_rows(&state).is_empty());
        // and a later successful run drains it (resume cleanly, §4.8)
        let transport = |_: &str| Ok("{\"area\":\"Projects\",\"confidence\":0.95}".to_string());
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert!(!report.model_offline);
        assert_eq!(report.proposals, 1);
    }

    #[test]
    fn read_knobs_does_not_clobber_a_fresh_trust_flip() {
        // The downgrade race: the user picks Off (organizer_set_trust flips the
        // in-memory rung immediately), but the frontend's settings save is
        // debounced — the file still says "organize" when the worker wakes.
        let (_dir, _root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"organize\"}");
        read_knobs(&state, "default", &handle.0);
        assert_eq!(*handle.0.trust.lock().unwrap(), Trust::Organize, "startup seed adopted");
        handle.set_trust(Trust::Off);
        read_knobs(&state, "default", &handle.0);
        assert_eq!(
            *handle.0.trust.lock().unwrap(),
            Trust::Off,
            "an UNCHANGED settings.json must never overwrite a fresh flip"
        );
        // the debounced flush lands with the same value — still Off
        write_settings(&state, "{\"organizerTrust\":\"off\"}");
        read_knobs(&state, "default", &handle.0);
        assert_eq!(*handle.0.trust.lock().unwrap(), Trust::Off);
        // an ACTUAL settings change (external edit) is adopted
        write_settings(&state, "{\"organizerTrust\":\"tidy\"}");
        read_knobs(&state, "default", &handle.0);
        assert_eq!(*handle.0.trust.lock().unwrap(), Trust::Tidy);
    }

    #[test]
    fn trust_off_mid_cycle_parks_the_remaining_queue() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}");
        let a = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        let b = stage_capture(&state, "# Beta capture\n\nmore land notes");
        handle.enqueue(&root, &[root.join(&a), root.join(&b)]);
        let calls = AtomicUsize::new(0);
        let inner = handle.0.clone();
        let transport = |p: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            // the user turns the daemon Off while a model call is in flight —
            // trust is re-sampled per candidate, so `b` must never be modeled
            *inner.trust.lock().unwrap() = Trust::Off;
            dual_transport(p)
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2, "only `a` (classify + enrich) was modeled");
        assert!(root.join(&b).exists(), "`b` untouched");
        assert!(report.requeued >= 1);
        assert_eq!(handle.0.queue.lock().unwrap().len(), 1, "`b` stays queued for later");
        assert!(
            !root.join("wiki/Projects/_index.md").exists(),
            "the index job parks too after a mid-cycle Off"
        );
    }

    #[test]
    fn reproposal_supersedes_the_stale_pending_rows() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}"); // Suggest
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        let old_ids: Vec<String> = journal_rows(&state)
            .iter()
            .filter(|r| r["status"] == "proposed")
            .map(|r| r["id"].as_str().unwrap().to_string())
            .collect();
        assert!(old_ids.len() >= 2, "a file + enrich proposals: {old_ids:?}");

        // the user rewrites the capture into something else (external edit)
        let text = fs::read_to_string(root.join(&rel)).unwrap();
        let (fm, _) = corpus::parse_document(&text);
        fs::write(
            root.join(&rel),
            corpus::compose_document(&fm.unwrap(), "# Mystery\n\nunclear scribble\n"),
        )
        .unwrap();
        handle.enqueue(&root, &[root.join(&rel)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();

        // fold like the frontend: last line per id wins
        let mut latest: HashMap<String, String> = HashMap::new();
        for r in journal_rows(&state) {
            latest.insert(
                r["id"].as_str().unwrap().to_string(),
                r["status"].as_str().unwrap().to_string(),
            );
        }
        for id in &old_ids {
            assert_eq!(latest[id], "dismissed", "stale row {id} must retire, not linger");
        }
        // no contradictory pending filings: the old file proposal is gone and
        // the new decision (low-confidence suggested_area) is the pending one
        let rows = journal_rows(&state);
        let pending: Vec<&serde_json::Value> = rows
            .iter()
            .filter(|r| latest[r["id"].as_str().unwrap()] == "proposed")
            .filter(|r| latest[r["id"].as_str().unwrap()] == r["status"].as_str().unwrap())
            .collect();
        assert!(pending.iter().all(|r| r["action"] != "file"));
        assert!(pending.iter().any(|r| r["field"] == "suggested_area"));
    }

    #[test]
    fn secure_hint_survives_small_cycles_and_clears_when_reviewed() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}");
        let secret = stage_capture(&state, "# Card\n\ncard 4242 4242 4242 4242\n");
        let plain = stage_capture(&state, "# Plain\n\ngroceries\n");
        handle.enqueue(&root, &[root.join(&secret), root.join(&plain)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        let pending = |h: &OrganizerHandle| h.0.status.lock().unwrap().secure_pending.len();
        assert_eq!(pending(&handle), 1, "the secret capture is remembered for review");

        // a small watcher cycle on an unrelated note must NOT zero the hint
        handle.enqueue(&root, &[root.join(&plain)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(pending(&handle), 1, "the review hint must not flicker off");

        // the user reviews it: the secret comes out → the hint clears
        let text = fs::read_to_string(root.join(&secret)).unwrap();
        let (fm, _) = corpus::parse_document(&text);
        fs::write(
            root.join(&secret),
            corpus::compose_document(&fm.unwrap(), "# Card\n\nnumber moved to the vault\n"),
        )
        .unwrap();
        handle.enqueue(&root, &[root.join(&secret)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(pending(&handle), 0, "a reviewed capture leaves the hint");
    }

    #[test]
    fn edited_under_us_requeues_without_journaling() {
        // §4.8 "don't apply a stale decision": the fresh body-hash re-check
        // inside the write route() — the user typed while the model ran.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        let calls = AtomicUsize::new(0);
        let root2 = root.clone();
        let rel2 = rel.clone();
        let transport = |p: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            // the note changes WHILE the model call is in flight
            let text = fs::read_to_string(root2.join(&rel2)).unwrap();
            fs::write(root2.join(&rel2), format!("{text}\nmore words typed meanwhile\n")).unwrap();
            dual_transport(p)
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1, "requeue skips Enrich for this pass");
        assert_eq!(report.proposals, 0);
        assert_eq!(report.applied, 0);
        assert!(report.requeued >= 1);
        assert!(journal_rows(&state).is_empty(), "a stale decision must never journal");
        assert!(root.join(&rel).exists(), "the note was NOT filed on the stale read");
        assert_eq!(handle.0.queue.lock().unwrap().len(), 1, "queued for re-evaluation");
    }

    #[test]
    fn locked_mid_flight_refuses_the_apply() {
        // TOCTOU: the user locks the note between the classify read and the
        // write — the Filer gate re-reads `locked` fresh and must refuse.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        let root2 = root.clone();
        let rel2 = rel.clone();
        let transport = |p: &str| {
            // frontmatter-only change: the BODY hash still matches, so only
            // the gate's own fresh `locked` read can stop the write
            add_flag(&root2, &rel2, "locked: true");
            dual_transport(p)
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 0);
        assert_eq!(report.errors, 1, "the refused write is reported, not swallowed");
        assert!(root.join(&rel).exists(), "a locked note must not move");
        assert!(journal_rows(&state).is_empty());
        let err = handle.0.status.lock().unwrap().last_error.clone().expect("error surfaced");
        assert!(err.contains("locked"), "{err}");
    }

    #[test]
    fn secure_and_locked_peers_never_ride_an_enrich_prompt() {
        // §4.2.2: a secure note must never reach ANY model — including its
        // FILENAME, whose slug is title-derived (for a quick capture the title
        // is often the secret itself).
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerQuietSecs\":0}");
        let note = place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");
        let peer = place_note(&state, "# Alazan history\n\nolder land papers", "Research");
        let peer_stem = peer.rsplit('/').next().unwrap().trim_end_matches(".md").to_string();
        seed_placed(
            &root,
            "Research",
            "alazan-key-sk-ant-s1e2c3.md",
            "01SECPEER00000000000000000",
            "secure: true\n",
            "# alazan key sk-ant\n\nthe key\n",
        );
        seed_placed(
            &root,
            "Research",
            "alazan-private-l1o2c3.md",
            "01LOCKPEER0000000000000000",
            "locked: true\n",
            "# alazan private\n\nplans\n",
        );
        // the haystack itself is already clean…
        let peers = list_peers(&root);
        assert!(peers.iter().any(|(_, s)| s == &peer_stem));
        assert!(
            peers.iter().all(|(_, s)| !s.contains("sk-ant") && !s.contains("private")),
            "secure/locked stems must be out of the candidate haystack: {peers:?}"
        );
        // …and no prompt carries the poisoned stems
        handle.enqueue(&root, &[root.join(&note)]);
        let stem = peer_stem.clone();
        let transport = move |p: &str| {
            assert!(!p.contains("sk-ant"), "a secure slug reached the model:\n{p}");
            assert!(!p.contains("alazan-private"), "a locked slug reached the model:\n{p}");
            assert!(p.contains(&stem), "the clean peer still rides");
            Ok("{\"summary\":\"one line\",\"tags\":[\"land\"],\"links\":[]}".to_string())
        };
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
    }

    // ── enrich (Job B) ──

    /// File a staged capture into an area through the Filer lane (the daemon's
    /// own primitives) and return the placed rel — a note with a real ULID.
    fn place_note(state: &CorpusState, body: &str, area: &str) -> String {
        let rel = stage_capture(state, body);
        state
            .route("default", |s| {
                s.set_ai_field(&rel, "area", area)?;
                let meta = s.file_note(&rel)?;
                s.resolve_note_rel(&meta.id)
            })
            .unwrap()
    }

    #[test]
    fn rank_candidates_orders_by_keyword_overlap() {
        let others = vec![
            ("wiki/Research/quokka-facts-z9y8x7.md".to_string(), "quokka-facts-z9y8x7".to_string()),
            (
                "wiki/Projects/alazan-history-a1b2c3.md".to_string(),
                "alazan-history-a1b2c3".to_string(),
            ),
            ("wiki/Projects/land-survey-m4n5o6.md".to_string(), "land-survey-m4n5o6".to_string()),
        ];
        // stem hits (×3) outrank folder hits (×2); ties break on stem;
        // zero-overlap peers are dropped entirely
        let out = rank_note_candidates("Alazan 84", "alazan land deal research", &others, 5);
        assert_eq!(out, ["alazan-history-a1b2c3", "land-survey-m4n5o6", "quokka-facts-z9y8x7"]);
        assert_eq!(rank_note_candidates("Alazan 84", "alazan land", &others, 1).len(), 1);
        assert!(rank_note_candidates("", "", &others, 5).is_empty(), "no tokens ⇒ no candidates");
        assert!(
            rank_note_candidates("totally unrelated", "words", &others, 5).is_empty(),
            "score 0 is not a candidate"
        );
    }

    #[test]
    fn parse_enrich_rejects_links_outside_candidates() {
        let cands = vec!["alazan-history-a1b2c3".to_string()];
        let out = parse_enrich(
            "{\"summary\":\"s\",\"tags\":[\"B\",\"a\",\"b\"],\"links\":[\"alazan-history-a1b2c3\",\"invented-note\",\"[[ALAZAN-history-A1B2C3]]\"]}",
            &cands,
        )
        .unwrap();
        assert_eq!(
            out.links,
            vec!["alazan-history-a1b2c3"],
            "outside links dropped; brackets/case normalize to the canonical stem, deduped"
        );
        assert_eq!(out.tags, vec!["a", "b"], "lowercased, deduped, sorted");
        // a classify-shaped or junk reply is NOT an enrich result
        assert!(parse_enrich("{\"area\":\"Projects\",\"confidence\":0.9}", &cands).is_none());
        assert!(parse_enrich("no json here", &cands).is_none());
        // list-syntax characters can't ride into the `[…]` field format, and a
        // multi-line summary collapses to the ONE line frontmatter allows
        let out = parse_enrich(
            "{\"summary\":\"two\\nlines  here \",\"tags\":[\"ok\",\"bad,tag\",\"[worse]\"]}",
            &cands,
        )
        .unwrap();
        assert_eq!(out.summary, "two lines here");
        assert_eq!(out.tags, vec!["ok"]);
        assert!(out.links.is_empty());
        // the write plan serializes the §3.1 shapes and never proposes removals
        let plan = EnrichOut {
            summary: "s".into(),
            tags: vec!["a".into(), "b".into()],
            links: vec!["x-1".into(), "y-2".into()],
        }
        .fields();
        assert_eq!(
            plan,
            vec![
                ("summary", "s".to_string()),
                ("tags", "[a, b]".to_string()),
                ("links", "[[x-1]], [[y-2]]".to_string()),
            ]
        );
        let empty = EnrichOut { summary: String::new(), tags: vec![], links: vec![] };
        assert!(empty.fields().is_empty());
    }

    #[test]
    fn enrich_never_clobbers_a_user_edited_field() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");
        // the user hand-wrote a summary (external editor) — NOT the daemon's
        add_flag(&root, &rel, "summary: my own words");
        handle.enqueue(&root, &[root.join(&rel)]);
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();

        let text = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(text.contains("summary: my own words"), "user edit clobbered:\n{text}");
        assert!(!text.contains("summary: one line"));
        assert!(text.contains("tags: [deal, land]"), "empty field not filled:\n{text}");
        // the user-owned field was never even PROPOSED
        assert!(journal_rows(&state).iter().all(|r| r["field"] != "summary"));
        assert!(report.applied >= 1);
    }

    #[test]
    fn enrich_fills_empty_fields_at_tidy_and_proposes_at_suggest() {
        let (_dir, root, state, handle) = seed_brain();
        let peer = place_note(&state, "# Alazan history\n\nolder land papers", "Research");
        let peer_stem =
            peer.rsplit('/').next().unwrap().trim_end_matches(".md").to_string();
        let note = place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");

        // Suggest: three field proposals, not a byte on the note
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        handle.enqueue(&root, &[root.join(&note)]);
        let stem = peer_stem.clone();
        let transport = move |p: &str| {
            assert!(p.contains(&stem), "the ranked link candidate must ride the prompt");
            Ok(format!(
                "{{\"summary\":\"one line\",\"tags\":[\"land\"],\"links\":[\"{stem}\"]}}"
            ))
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 0);
        let rows = journal_rows(&state);
        let fields: Vec<&str> = rows
            .iter()
            .filter(|r| r["action"] == "field" && r["status"] == "proposed")
            .filter_map(|r| r["field"].as_str())
            .collect();
        assert_eq!(fields, ["summary", "tags", "links"]);
        let links_row = rows.iter().find(|r| r["field"] == "links").unwrap();
        assert_eq!(links_row["after"], format!("[[{peer_stem}]]"));
        assert!(!fs::read_to_string(root.join(&note)).unwrap().contains("summary:"));

        // Tidy: the same pass on a fresh note APPLIES and records the baseline
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        handle.enqueue(&root, &[root.join(&peer)]);
        let transport = |_: &str| {
            Ok("{\"summary\":\"peer line\",\"tags\":[\"papers\"],\"links\":[]}".to_string())
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 2, "summary + tags applied");
        let text = fs::read_to_string(root.join(&peer)).unwrap();
        assert!(text.contains("summary: peer line"));
        assert!(text.contains("tags: [papers]"));
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        let ns = st
            .notes
            .values()
            .find(|n| n.last_fields.get("summary").map(String::as_str) == Some("peer line"))
            .expect("lastFields baseline recorded");
        assert_eq!(ns.proposed.enrich, ns.hash, "enrich coverage recorded for this body");
    }

    #[test]
    fn enrich_output_is_canonically_sorted_and_byte_stable() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");
        let calls = AtomicUsize::new(0);
        // messy model output: unsorted, duplicated, mixed-case, multi-line
        let transport = |_: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok("{\"summary\":\"A  deal\\nnote \",\"tags\":[\"Zeta\",\"alpha\",\"Zeta\"],\"links\":[]}"
                .to_string())
        };
        handle.enqueue(&root, &[root.join(&rel)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        let first = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(first.contains("summary: A deal note"), "collapsed to one line:\n{first}");
        assert!(first.contains("tags: [alpha, zeta]"), "canonical sort:\n{first}");
        // an unchanged body is never re-modeled and never rewritten
        handle.enqueue(&root, &[root.join(&rel)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1, "byte-stable output must be a no-op");
        assert_eq!(fs::read_to_string(root.join(&rel)).unwrap(), first);
    }

    // ── refresh-index (Job C) ──

    #[test]
    fn render_index_is_deterministic_fixed_point() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}");
        let a = place_note(&state, "# Beta\n\ntwo", "Projects");
        let b = place_note(&state, "# Alpha\n\none", "Projects");
        handle.enqueue(&root, &[root.join(&a), root.join(&b)]);
        // junk replies: enrich records coverage, adds nothing — the index is the star
        let transport = |_: &str| Ok("nope".to_string());
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 1, "Organize applies the index rewrite");
        let idx = fs::read_to_string(root.join("wiki/Projects/_index.md")).unwrap();
        assert!(idx.contains("Generated by the rotli Filer"));
        assert!(
            idx.find("| Alpha |").unwrap() < idx.find("| Beta |").unwrap(),
            "canonical member order:\n{idx}"
        );
        // the fixed point: a second cycle regenerates the same bytes ⇒ zero writes
        let rows_before = journal_rows(&state).len();
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 0);
        assert_eq!(journal_rows(&state).len(), rows_before);
        assert_eq!(fs::read_to_string(root.join("wiki/Projects/_index.md")).unwrap(), idx);
    }

    #[test]
    fn secure_and_locked_notes_are_omitted_from_index() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}");
        // a quick capture's TITLE is its first body line — for a secure note
        // that is often the secret itself, so even a title-only row would leak
        // it into the committed, non-gitignored _index.md. Omit entirely.
        seed_placed(
            &root,
            "Projects",
            "ssn-078-05-1120-s3c9r1.md",
            "01SECURE000000000000000000",
            "secure: true\nsummary: full of secrets\n",
            "# SSN 078-05-1120 for the mortgage\n\nSSN: 078-05-1120\n",
        );
        seed_placed(
            &root,
            "Projects",
            "vault-l0c4k1.md",
            "01LOCKED000000000000000000",
            "locked: true\nsummary: private plans\n",
            "# Vault\n\nplans\n",
        );
        seed_placed(
            &root,
            "Projects",
            "open-o1p2e3.md",
            "01OPEN00000000000000000000",
            "summary: visible line\n",
            "# Open\n\nfine\n",
        );
        // nothing queued: the index pass enumerates membership on its own —
        // and it must NEVER need the model
        let transport =
            |_: &str| -> Result<String, String> { panic!("the index job never calls the model") };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 1);
        let idx = fs::read_to_string(root.join("wiki/Projects/_index.md")).unwrap();
        assert!(idx.contains("| Open | visible line |"));
        assert!(!idx.contains("850-40"), "secure ⇒ OMITTED, title included (§4.2.5):\n{idx}");
        assert!(!idx.contains("SSN"));
        assert!(!idx.contains("Vault"), "locked notes are off-limits wholesale (§3.1):\n{idx}");
        assert!(!idx.contains("full of secrets") && !idx.contains("private plans"));
        // the proposed body in the journal is the same redaction-free render
        let rows = journal_rows(&state);
        let after = rows.last().unwrap()["after"].as_str().unwrap();
        assert!(!after.contains("850-40") && !after.contains("Vault"));
    }

    #[test]
    fn index_proposes_at_suggest_and_tidy_applies_only_at_organize() {
        let (_dir, root, state, handle) = seed_brain();
        seed_placed(
            &root,
            "Projects",
            "open-o1p2e3.md",
            "01OPEN00000000000000000000",
            "summary: visible line\n",
            "# Open\n\nfine\n",
        );
        let transport =
            |_: &str| -> Result<String, String> { panic!("the index job never calls the model") };

        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.proposals, 1);
        assert!(!root.join("wiki/Projects/_index.md").exists());
        let rows = journal_rows(&state);
        assert_eq!(rows[0]["action"], "index");
        assert_eq!(rows[0]["status"], "proposed");
        assert_eq!(rows[0]["area"], "Projects");
        assert!(rows[0]["after"].as_str().unwrap().contains("| Open | visible line |"));

        // a second cycle must NOT spam the same proposal (the proposedHash guard)
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.proposals, 0);
        assert_eq!(journal_rows(&state).len(), 1);

        // Tidy still reviews index rewrites (§4.3 — jarring actions wait)
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert!(!root.join("wiki/Projects/_index.md").exists());
        assert_eq!(journal_rows(&state).len(), 1);

        // Organize applies — and journals the apply
        write_settings(&state, "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}");
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 1);
        let rows = journal_rows(&state);
        assert_eq!(rows.last().unwrap()["status"], "applied");
        let disk = fs::read_to_string(root.join("wiki/Projects/_index.md")).unwrap();
        assert_eq!(disk, rows.last().unwrap()["after"].as_str().unwrap());
    }

    #[test]
    fn members_hash_change_detection() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}");
        seed_placed(
            &root,
            "Projects",
            "one-a1b2c3.md",
            "01ONE000000000000000000000",
            "summary: first\n",
            "# One\n\nx\n",
        );
        seed_placed(
            &root,
            "Research",
            "two-d4e5f6.md",
            "01TWO000000000000000000000",
            "summary: second\n",
            "# Two\n\ny\n",
        );
        let transport = |_: &str| -> Result<String, String> { Err("unused".into()) };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 2, "both areas build their first overview");

        // add a member to ONE area — exactly that area regenerates
        seed_placed(
            &root,
            "Projects",
            "three-g7h8i9.md",
            "01THREE0000000000000000000",
            "summary: third\n",
            "# Three\n\nz\n",
        );
        let before_rows = journal_rows(&state).len();
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(report.applied, 1);
        let rows = journal_rows(&state);
        assert_eq!(rows.len(), before_rows + 1);
        assert_eq!(rows.last().unwrap()["area"], "Projects");
        assert!(fs::read_to_string(root.join("wiki/Projects/_index.md"))
            .unwrap()
            .contains("| Three | third |"));
    }

    #[test]
    fn enqueue_filters_to_candidates_and_dedupes() {
        let (_dir, root, _state, handle) = seed_brain();
        handle.enqueue(
            &root,
            &[
                root.join("wiki/_inbox/a.md"),
                root.join("wiki/_inbox/a.md"), // duplicate
                root.join("wiki/README.md"),
                root.join("wiki/Projects/_index.md"),
                root.join("chats/today.md"),
                root.join("wiki/Projects/b.md"),
                PathBuf::from("/somewhere/else/outside.md"), // not under the root
            ],
        );
        let q = handle.0.queue.lock().unwrap();
        let mut keys: Vec<&String> = q.keys().collect();
        keys.sort();
        assert_eq!(keys, ["wiki/Projects/b.md", "wiki/_inbox/a.md"]);
    }
}
