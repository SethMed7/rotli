//! organizer.rs — the Brain filer daemon (Phase 4 of memex-vault wiki/projects/rotli/main-brain-daemon.md).
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
/// The Claude lane's timeout — a remote `claude -p` round-trip (spawn, network,
/// Sonnet) is slower than the local server, so it gets a longer leash than the
/// local MODEL_TIMEOUT. Still bounded so a hung CLI never camps the thread.
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(120);
/// The authenticated Gemini/Antigravity CLI has the same remote latency class.
const GEMINI_TIMEOUT: Duration = Duration::from_secs(120);
/// Daemon replies are one small JSON object (classify: an area + confidence;
/// enrich: a summary line + short tag/link arrays) — cap generation accordingly.
const GEN_MAX_TOKENS: u32 = 512;
/// How long a reconciliation-sweep NUDGE settles before the sweep runs — an
/// approval spree (or app launch) folds to one disk walk, not one per click.
const SWEEP_SETTLE: Duration = Duration::from_secs(3);
/// Startup grace before the boot reconciliation sweep may be consumed — keeps
/// its corpus-mutex traffic off the first paint after a (re)launch, which is
/// exactly when every root walks cold (Seth, 2026-07-31: vault-switch
/// beachballs). See `OrganizerInner::sweep_hold`.
const STARTUP_SWEEP_HOLD: Duration = Duration::from_secs(45);
/// How long to sleep between gate re-checks WHILE work is pending (the gates —
/// idle/AC/thermal — have no event source; this is the only timed retry, and it
/// exists only while something is actually staged). An idle corpus never ticks.
const GATE_RECHECK: Duration = Duration::from_secs(60);
/// Model-offline backoff band (doc §4.8: queue, never block; resume cleanly).
const BACKOFF_MIN: Duration = Duration::from_secs(30);
const BACKOFF_MAX: Duration = Duration::from_secs(15 * 60);
/// Knob defaults — knob-not-constant per §6.4; the settings.json keys
/// (`organizerThreshold` / `organizerQuietSecs`) override per cycle.
const DEFAULT_THRESHOLD: f64 = 0.8;
/// Default quiet window: organize a note only after it's sat UNTOUCHED this long
/// (Seth, 2026-07-03: "watch the file, wait 5 minutes, then organize"). The
/// `organizerQuietSecs` knob overrides it per cycle.
const DEFAULT_QUIET: Duration = Duration::from_secs(300);
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
    /// Settings-read parse: unknown/missing input falls to the DEFAULT rung —
    /// Organize (Seth, 2026-07-02): the daemon only ever changes a note's
    /// location + metadata, journaled and undoable, never the note's words,
    /// so full auto-organize is the intended out-of-box behavior. An explicit
    /// user choice (any valid rung in settings.json) always wins over this.
    pub fn parse(s: &str) -> Trust {
        Self::parse_strict(s).unwrap_or(Trust::Organize)
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
    /// The Brain master switch, LIVE (vault-vs-brain, 2026-07-26): true = this
    /// vault is RAW. `organizer_set_brain` flips it immediately — the same
    /// in-memory channel trust has, so turning the Brain off stops an
    /// IN-FLIGHT cycle at the next candidate instead of after the debounced
    /// settings write (pressure-test: the mid-cycle model leak). settings.json
    /// re-adopts via `settings_brain` each cycle as the durable backstop.
    brain_off: AtomicBool,
    /// The brainEnabled value LAST SEEN in settings.json — same changed-only
    /// adoption rule as `settings_trust`, for the same debounce race.
    settings_brain: Mutex<Option<bool>>,
    status: Mutex<StatusSnapshot>,
    /// Whether the worker thread was spawned (false = no memex corpus).
    running: AtomicBool,
    /// The Settings "Run now" nudge — bypasses quiet/idle/AC/thermal, never chat.
    run_now: AtomicBool,
    /// The Activity Stop button (2026-07-31): finish the current note, requeue
    /// the rest. Cleared when the next cycle starts; it cannot abort an
    /// in-flight model call, only the next boundary.
    stop_now: AtomicBool,
    /// A cycle is executing right now — drives the Activity live band.
    cycle_busy: AtomicBool,
    /// The journal/filed_by label for the lane that ACTUALLY ran this cycle —
    /// set by the worker per cycle (2026-07-31: a Claude-organized run used to
    /// be stamped as the local model). Tests leave the default.
    model_label: Mutex<String>,
    /// Live progress sink for the Activity surface — installed once by
    /// spawn_organizer (a Tauri event emitter); None in tests. Called outside
    /// every corpus lock.
    progress: Mutex<Option<Box<dyn Fn(serde_json::Value) + Send>>>,
    /// A reconciliation sweep is owed (Some = when it was last nudged, for the
    /// settle debounce). Event-driven only: set at startup, on Run-now, when a
    /// frontend approval lands (its writes are suppress-marked — no watcher
    /// event ever arrives), and when trust turns back on. NEVER on a timer.
    sweep_at: Mutex<Option<Instant>>,
    /// Don't CONSUME the owed startup sweep before this instant (one-shot,
    /// 2026-07-31): right after a vault switch every root walks cold, and the
    /// boot sweep's corpus-mutex traffic contended first paint into visible
    /// beachballs. A real planner input — the sweep stays owed and the worker
    /// sleeps the remainder; queue runs during the grace don't drag it along.
    /// Run-now bypasses (an explicit click is the user's own timing).
    sweep_hold: Mutex<Option<Instant>>,
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

impl OrganizerInner {
    /// Fire one live-progress event at the Activity surface; a no-op in tests
    /// (no sink installed). Never called while holding a corpus lock.
    fn emit_progress(&self, v: serde_json::Value) {
        if let Some(f) = self.progress.lock().unwrap().as_ref() {
            f(v);
        }
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
            trust: Mutex::new(Trust::Organize), // the default rung; settings.json overrides each cycle
            settings_trust: Mutex::new(None),
            brain_off: AtomicBool::new(false),
            settings_brain: Mutex::new(None),
            status: Mutex::new(StatusSnapshot::default()),
            running: AtomicBool::new(false),
            run_now: AtomicBool::new(false),
            stop_now: AtomicBool::new(false),
            cycle_busy: AtomicBool::new(false),
            model_label: Mutex::new(chat::DEFAULT_MODEL.to_string()),
            progress: Mutex::new(None),
            sweep_at: Mutex::new(None),
            sweep_hold: Mutex::new(None),
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
        if t != Trust::Off {
            // waking (or re-tuning) the daemon owes one reconciliation: edits
            // made while it was dormant never reached the queue
            self.nudge_sweep();
        }
    }

    /// Owe one reconciliation sweep (event-driven — an approval landed, the
    /// daemon just woke, Run-now). The settle window folds a burst to one walk.
    /// Notifies UNDER the queue mutex: the parked worker re-checks `sweep_at`
    /// while holding it, so the flag can never slip between check and wait.
    pub fn nudge_sweep(&self) {
        *self.0.sweep_at.lock().unwrap() = Some(Instant::now());
        let _q = self.0.queue.lock().unwrap();
        self.0.cv.notify_all();
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
    /// WHOLE-file hash at the user's "Not sensitive" answer (feature B,
    /// decision 2026-07-22): a detector-only note with this exact content stays
    /// out of the review hint. Any change the detector could see re-arms it.
    /// "" = never dismissed. Explicitly flagged notes never consult this.
    secure_dismissed: String,
}

#[derive(serde::Serialize, serde::Deserialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct AreaState {
    members_hash: String,
    built_at: String,
    proposed_hash: String,
    /// Journal row id of the outstanding index proposal — the supersede handle
    /// (#26, audit 2026-07): a re-proposal for CHANGED membership retires the
    /// stale pending row, and reaching the fixed point (the user approved it,
    /// or membership reverted) retires it too, instead of zombies piling up.
    proposed_row: String,
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
    /// WHOLE-file hash — the secret detector's input domain (frontmatter too),
    /// so a "Not sensitive" dismissal re-arms on ANY change the detector sees.
    text_hash: String,
    locked: bool,
    secure: bool,
    /// The EXPLICIT `secure: true` frontmatter flag alone (already protected —
    /// the repair/passive lanes own it). `secure` also merges the detector.
    secure_flagged: bool,
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
    let secure_flagged = secure;
    if !secure && crate::secret::looks_secure(&text) {
        secure = true;
    }
    Ok(NoteSnapshot {
        rel: rel.to_string(),
        id: fm.id.filter(|i| !i.is_empty()),
        title: corpus::title_of(body),
        body: body.to_string(),
        body_hash: fnv1a64(body.as_bytes()),
        text_hash: fnv1a64(text.as_bytes()),
        locked,
        secure,
        secure_flagged,
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
/// readable filename stem (including a duplicate suffix when present) stands
/// in for titles: unique, no body ever rides a
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
fn field_value_is_empty(value: &str) -> bool {
    matches!(value.trim(), "" | "[]")
}

fn field_eligible(snap: &NoteSnapshot, ns: Option<&NoteState>, key: &str) -> bool {
    let current = snap.fields.get(key).map(String::as_str).unwrap_or("");
    field_value_is_empty(current)
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

// ─── the wait planner (the energy law) ───────────────────────────────────────

/// What the worker does next. The invariant this type carries: **an idle corpus
/// parks forever** — no queue, no owed sweep, no Run-now ⇒ `Park` (a plain
/// `Condvar::wait`, zero wakeups, zero disk reads, zero shell-outs) until an
/// event (watcher enqueue / Run-now / approval nudge / trust flip) notifies.
/// Timed waits exist ONLY while real work is pending.
#[derive(Debug, PartialEq)]
pub(crate) enum Wait {
    /// Nothing staged, nothing owed — sleep until an event arrives.
    Park,
    /// Work is ready right now.
    Run,
    /// Work is pending but not ripe (quiet window / settle / backoff / closed
    /// gates) — sleep at most this long, then re-plan.
    For(Duration),
}

/// The one scheduling decision, pure so it's table-testable. Inputs are ages /
/// remainders sampled by the worker:
///   `sweep_age`   — Some(time since the last sweep nudge) when a sweep is owed
///   `sweep_hold_left` — Some(remaining startup grace) while the owed BOOT
///                   sweep is held (sweep_hold); stretches only the SWEEP's
///                   wait — queue work keeps its own schedule
///   `newest_age`  — Some(age of the NEWEST queue entry) when the queue holds work
///   `cycle_owed`  — a sweep ran but its follow-up cycle hasn't (index diff pending)
///   `backoff_left`— Some(remaining) while the model-offline backoff runs
///   `gate_left`   — Some(remaining GATE_RECHECK leash) after a gate-blocked
///                   attempt. A REMAINDER, not a flag: it must reach zero so a
///                   later re-plan actually returns Run and re-probes the gates
///                   (a bare boolean floor starved the pipeline forever — every
///                   re-plan re-waited the full leash and the flag only cleared
///                   after a Run that could never come).
#[allow(clippy::too_many_arguments)] // pure planner over every gate input — tested as one table
pub(crate) fn plan_wait(
    trust_off: bool,
    run_now: bool,
    sweep_age: Option<Duration>,
    sweep_hold_left: Option<Duration>,
    newest_age: Option<Duration>,
    cycle_owed: bool,
    quiet: Duration,
    backoff_left: Option<Duration>,
    gate_left: Option<Duration>,
) -> Wait {
    if trust_off {
        return Wait::Park; // fully dormant — Off means zero wakeups too
    }
    if run_now {
        // The user's explicit nudge — no debounce, no backoff. But QUEUED, not
        // consumed (#29, audit 2026-07): a gate-blocked attempt (an interactive
        // chat) keeps the nudge pending and retries on the leash remainder —
        // an unconditional Run here would busy-spin against the closed gate.
        return match gate_left {
            Some(d) if !d.is_zero() => Wait::For(d),
            _ => Wait::Run,
        };
    }
    let mut waits: Vec<Duration> = Vec::new();
    if let Some(age) = sweep_age {
        // the startup hold stretches only the sweep's own wait (queue work
        // below keeps its schedule) — one wakeup at expiry, not a 3s poll
        let settle = SWEEP_SETTLE.saturating_sub(age);
        waits.push(settle.max(sweep_hold_left.unwrap_or(Duration::ZERO)));
    }
    if newest_age.is_some() || cycle_owed {
        // burst debounce: wait until the NEWEST enqueue is quiet-old, so a
        // typing burst schedules ONE run after the last keystroke settles —
        // never a run per save. Backoff and closed gates stretch the wait.
        let quiet_left = newest_age.map_or(Duration::ZERO, |a| quiet.saturating_sub(a));
        let w = quiet_left
            .max(backoff_left.unwrap_or(Duration::ZERO))
            .max(gate_left.unwrap_or(Duration::ZERO));
        waits.push(w);
    }
    match waits.into_iter().min() {
        None => Wait::Park,
        Some(d) if d.is_zero() => Wait::Run,
        Some(d) => Wait::For(d),
    }
}

// ─── knobs (settings.json — frontend-owned, Rust READS only) ─────────────────

/// Which model the organizer runs (settings.json `organizerModel`). `Local` is
/// the on-device MLX server (default — organizing never leaves the Mac); `Claude`
/// routes to `claude -p` Sonnet (Seth's choice — non-secure notes go remote,
/// secure/locked never do). Copy so the per-cycle transport can close over it.
#[derive(Clone, Copy, PartialEq, Debug)]
enum OrgModel {
    Local,
    Claude,
    Gemini35,
}

impl OrgModel {
    fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "claude" => OrgModel::Claude,
            "gemini35" => OrgModel::Gemini35,
            _ => OrgModel::Local,
        }
    }
}

struct Knobs {
    /// The vault's Brain master switch (decision 2026-07-26, vault-vs-brain):
    /// false = a RAW vault — no cycles, no sweeps, no model calls, ever.
    /// Missing from settings ⇒ true (existing vaults keep today's behavior
    /// byte-for-byte; the field is additive and no migration writes it).
    brain_enabled: bool,
    trust: Option<Trust>,
    threshold: f64,
    quiet: Duration,
    model: OrgModel,
}

fn parse_knobs(settings_json: &str) -> Knobs {
    let v: serde_json::Value = serde_json::from_str(settings_json).unwrap_or(serde_json::Value::Null);
    Knobs {
        brain_enabled: v.get("brainEnabled").and_then(serde_json::Value::as_bool).unwrap_or(true),
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
        model: v
            .get("organizerModel")
            .and_then(|m| m.as_str())
            .map(OrgModel::parse)
            .unwrap_or(OrgModel::Local),
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
    {
        // same changed-only adoption for the Brain switch — the live atomic
        // (organizer_set_brain) wins over a debounced-stale file
        let mut seen = inner.settings_brain.lock().unwrap();
        if *seen != Some(knobs.brain_enabled) {
            *seen = Some(knobs.brain_enabled);
            inner.brain_off.store(!knobs.brain_enabled, Ordering::SeqCst);
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
    /// The user pressed Stop mid-cycle — the rest of the queue was left intact.
    pub stopped: bool,
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
    let model_label = inner.model_label.lock().unwrap().clone();
    let knobs = read_knobs(corpus_state, root_id, inner);
    if inner.brain_off.load(Ordering::SeqCst) {
        // a RAW vault has no Brain at all (vault-vs-brain, 2026-07-26) —
        // harder off than Trust::Off: the queue and review hints drain so
        // nothing accumulates or nags while the vault stays untouched.
        inner.queue.lock().unwrap().clear();
        inner.status.lock().unwrap().secure_pending.clear();
        return Ok(report);
    }
    if *inner.trust.lock().unwrap() == Trust::Off {
        return Ok(report); // dormant: drain nothing, model nothing
    }

    let state_json = corpus_state.route(root_id, |s| s.dot_read("organizer"))?;
    let mut state = parse_state(&state_json);

    // a sorted snapshot of the queue — deterministic pass order
    let mut rels: Vec<String> = inner.queue.lock().unwrap().keys().cloned().collect();
    rels.sort();
    inner.emit_progress(serde_json::json!({ "phase": "start", "total": rels.len() }));

    let mut vocab: Option<Vec<(String, String)>> = None;
    let mut peers: Option<Vec<(String, String)>> = None; // enrich link haystack, once per cycle
    'candidates: for rel in rels {
        // the Brain switch is LIVE per candidate too (pressure-test 2026-07-26:
        // a vault turned raw mid-cycle must stop MODELING now, not after the
        // in-flight queue drains — each model call can run minutes)
        if inner.brain_off.load(Ordering::SeqCst) {
            inner.queue.lock().unwrap().clear();
            inner.status.lock().unwrap().secure_pending.clear();
            return Ok(report);
        }
        // the Activity Stop button — nothing more is processed; the remaining
        // candidates stay queued for the next run, exactly like a closed gate
        if inner.stop_now.load(Ordering::SeqCst) {
            report.stopped = true;
            report.requeued += 1;
            continue;
        }
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
                // Feature B (decision 2026-07-22): a detector-only note the
                // user answered "Not sensitive" for stays out of the hint
                // while its content is unchanged; flagged notes never consult
                // the dismissal (they are already protected).
                let dismissed = !snap.secure_flagged
                    && state
                        .notes
                        .get(&state_key(&snap))
                        .is_some_and(|n| !n.secure_dismissed.is_empty() && n.secure_dismissed == snap.text_hash);
                if dismissed {
                    inner.status.lock().unwrap().secure_pending.remove(&rel);
                } else {
                    report.secure_skipped += 1;
                    inner.status.lock().unwrap().secure_pending.insert(rel);
                }
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
        // the live feed's "what it's looking at right now" line — titles only,
        // never body content (the same boundary every surface keeps)
        inner.emit_progress(
            serde_json::json!({ "phase": "note", "title": snap.title, "rel": rel }),
        );

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
                            // The FALLIBLE writes run FIRST; NoteState learns this
                            // pass only after every one of them lands (#25, audit
                            // 2026-07). Mutating state up front poisoned it on a
                            // failed apply (a note locked between read and write),
                            // and any LATER dot_write in the same cycle persisted
                            // the note as "classify-covered" with no journal row —
                            // stranded until its body changed.
                            let mut moved: Option<String> = None;
                            if apply {
                                match verb {
                                    Verb::FileStaged => {
                                        // the Filer gates re-read `locked` FRESH inside these
                                        s.set_ai_field(&rel, "area", &area)?;
                                        s.set_ai_field(&rel, "filed_by", &model_label)?;
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
                            // a proposal from an OLDER body is stale — retire it
                            // (only if still pending; a user-resolved row stays).
                            // PEEK, never take: supersede is fallible too, and a
                            // failure must leave the pending handle tracked.
                            let old_row = state
                                .notes
                                .get(&key)
                                .map(|n| n.proposed.file_row.clone())
                                .unwrap_or_default();
                            supersede(s, &old_row)?;
                            s.journal_append(&journal_line(&row, &row_ulid, ts, &model_label))?;
                            {
                                // every fallible write landed — NOW record the pass.
                                // Entry-mutate (never insert-clobber) so a prior
                                // Enrich's `lastFields` baseline survives.
                                let ns = state.notes.entry(key.clone()).or_default();
                                ns.hash = snap.body_hash.clone();
                                ns.processed_at = stamp.clone();
                                ns.proposed.file_row.clear();
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
                            }
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
        // the Brain switch is re-checked between the SAME candidate's classify
        // and enrich calls too — a mid-flight raw flip stops before the next
        // model call, not merely the next candidate (pressure-test 2026-07-26)
        if inner.brain_off.load(Ordering::SeqCst) {
            inner.queue.lock().unwrap().clear();
            inner.status.lock().unwrap().secure_pending.clear();
            return Ok(report);
        }
        // Stop lands mid-candidate too — enrich is one more model call away
        if inner.stop_now.load(Ordering::SeqCst) {
            inner.queue.lock().unwrap().insert(rel, Instant::now());
            report.stopped = true;
            report.requeued += 1;
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
            let (fresh_fm, fresh_body) = corpus::parse_document(&fresh);
            if fnv1a64(fresh_body.as_bytes()) != snap.body_hash {
                return Ok(EnrichOutcome::Requeue); // edited under us — re-evaluate (§4.8)
            }
            // #27 (audit 2026-07): the body hash above is blind to a FRONTMATTER-
            // only edit made during the (up to 45s) model call — re-derive the
            // field values from the `fresh` text in hand and re-check the
            // never-clobber rule against THEM, so a field the user just set is
            // skipped instead of overwritten.
            let fresh_fields: BTreeMap<String, String> = fresh_fm
                .unwrap_or_default()
                .foreign
                .iter()
                .filter_map(|l| {
                    l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
                })
                .collect();
            // §4.8 supersede — this pass only runs for a CHANGED body, so any
            // still-pending field rows describe an older note. Retire them.
            // PEEK, never take (#25's rule): the closing block below re-writes
            // `enrich_rows` on success; a mid-closure failure must leave the
            // pending handles tracked in memory.
            let old_rows: Vec<String> = state
                .notes
                .get(&key)
                .map(|n| n.proposed.enrich_rows.clone())
                .unwrap_or_default();
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
                let current = fresh_fields.get(fkey).cloned().unwrap_or_default();
                // never-clobber, re-checked FRESH: `eligible` was sampled before
                // the model call — an edit inside that window makes the field the
                // user's (empty or daemon-authored stays fair game).
                let still_ours = field_value_is_empty(&current)
                    || state.notes.get(&key).is_some_and(|n| {
                        n.last_fields.get(fkey).map(String::as_str) == Some(current.as_str())
                    });
                if !still_ours {
                    continue;
                }
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
                s.journal_append(&journal_line(&row, &row_ulid, now_ms(), &model_label))?;
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
    // trust re-sampled: a mid-cycle Off must park the index job too; a Stop
    // parks it outright — the user asked for hands off NOW
    let trust = *inner.trust.lock().unwrap();
    if trust != Trust::Off && !report.stopped && gates() {
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
            // settles: the approved body is already on disk, we just catch up).
            // An OUTSTANDING proposal describes a settled overview now — retire
            // it (#26), or it inflates the pending badge forever and a late
            // Approve would roll the file back.
            let old_row = state
                .areas
                .get(&area)
                .map(|a| a.proposed_row.clone())
                .unwrap_or_default();
            let dismissed = corpus_state.route(root_id, |s| {
                let d = supersede(s, &old_row)?;
                let a = state.areas.entry(area.clone()).or_default();
                a.members_hash = mh;
                a.built_at = now_rfc3339();
                a.proposed_hash.clear();
                a.proposed_row.clear();
                s.dot_write("organizer", &state_pretty(state))?;
                Ok(d)
            })?;
            if dismissed {
                report.journal_written = true;
            }
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
        // a pending proposal for an OLDER membership is stale — retire it (#26)
        let old_row = state
            .areas
            .get(&area)
            .map(|a| a.proposed_row.clone())
            .unwrap_or_default();
        corpus_state.route(root_id, |s| {
            if apply {
                s.write_index(&area, &body)?; // filer_writable gates inside
                row.status = "applied";
            }
            supersede(s, &old_row)?;
            s.journal_append(&journal_line(&row, &row_ulid, ts, ""))?;
            let a = state.areas.entry(area.clone()).or_default();
            if apply {
                a.members_hash = mh.clone();
                a.built_at = now_rfc3339();
                a.proposed_hash.clear();
                a.proposed_row.clear();
            } else {
                a.proposed_hash = fnv1a64(body.as_bytes());
                a.proposed_row = row_ulid.clone();
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

/// Run-now's AUDIT half (Seth, 2026-07-31: "run now is an audit to make sure
/// nothing was left or missed"). The hash diff answers "did I process this
/// body once?" — an audit asks the different question "is anything MISSING?":
/// a note whose enrich metadata never landed (the model returned nothing, or
/// a field was removed later without a body edit) stays invisible to the
/// diff forever. Returns rels whose coverage should be re-opened so the next
/// cycle re-models them; secure and locked notes are excluded exactly like
/// the cycle itself would exclude them. The never-clobber baseline
/// (`last_fields`) is untouched — user-owned values stay theirs.
fn audit_gaps(root: &Path, state: &OrganizerFile) -> Vec<String> {
    let mut rels = Vec::new();
    collect_md(root, "wiki", &mut rels);
    rels.into_iter()
        .filter(|rel| candidate_rel(rel))
        .filter(|rel| match snapshot_note(root, rel) {
            Ok(s) => {
                if s.locked || s.secure {
                    return false;
                }
                // already queued for a normal reason? the sweep has it
                if !(classify_covered(&s, state) && enrich_covered(&s, state)) {
                    return false;
                }
                ENRICH_FIELDS
                    .iter()
                    .any(|k| s.fields.get(*k).is_none_or(|v| v.trim().is_empty()))
            }
            Err(_) => false,
        })
        .collect()
}

/// Re-open the audit gaps' coverage in `state` so `skip_reason` and
/// `enrich_covered` let the next cycle model them again.
fn reopen_coverage(root: &Path, state: &mut OrganizerFile, gaps: &[String]) {
    for rel in gaps {
        let Ok(snap) = snapshot_note(root, rel) else { continue };
        if let Some(ns) = state.notes.get_mut(&state_key(&snap)) {
            ns.hash.clear();
            ns.proposed.enrich.clear();
        }
    }
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

/// Spawn the daemon worker (mirrors `spawn_watcher`: one std::thread). Fully
/// EVENT-DRIVEN — it parks on the condvar and wakes only when the watcher
/// enqueues a settled edit, a Run-now/approval nudge lands, or the trust rung
/// flips; timed waits exist only while real work is pending (`plan_wait` is
/// the law). An idle corpus costs literally nothing: no tick, no settings
/// read, no `pmset` shell-out — and the model is never touched, let alone kept
/// warm (no keep-alive/warm-up calls exist; the server's own idle-unload
/// rules). `root_id`/`root` name the store whose layout is Memex — the
/// daemon's only territory; no memex ⇒ this is never called.
pub fn spawn_organizer(app: tauri::AppHandle, handle: OrganizerHandle, root_id: String, root: PathBuf) {
    handle.0.running.store(true, Ordering::SeqCst);
    // install the live-progress sink — run_cycle narrates through it and the
    // Activity surface listens ("rotli:organizer-progress"); titles only
    {
        let progress_app = app.clone();
        *handle.0.progress.lock().unwrap() = Some(Box::new(move |v: serde_json::Value| {
            let _ = progress_app.emit_to("main", "rotli:organizer-progress", v);
        }));
    }
    // startup owes ONE reconciliation sweep (edits made while rotli was closed
    // never reached the queue) — after that, events only. The hold keeps the
    // sweep's corpus-mutex traffic off the FIRST paint (see sweep_hold's doc).
    *handle.0.sweep_at.lock().unwrap() = Some(Instant::now());
    *handle.0.sweep_hold.lock().unwrap() = Some(Instant::now() + STARTUP_SWEEP_HOLD);
    std::thread::spawn(move || {
        let inner: &OrganizerInner = &handle.0;
        // RefCell: the per-candidate gates closure must be able to REFRESH the
        // probes (it only gets &self through &dyn Fn), while the cache lives
        // across cycles. Single worker thread — no contention.
        let probes = std::cell::RefCell::new(GateProbes::new());
        let mut backoff = BACKOFF_MIN;
        let mut next_model_try: Option<Instant> = None;
        // a sweep ran but its follow-up cycle hasn't: the index membership diff
        // must still see changes made by FRONTEND approvals, whose writes are
        // suppress-marked — no watcher event ever arrives for them.
        let mut cycle_owed = false;
        // the last attempt was blocked by the idle/AC/thermal gates — retry on
        // the GATE_RECHECK leash (only while work is pending; see plan_wait).
        // An INSTANT, not a flag: the planner gets the leash REMAINDER, which
        // decays to zero so the blocked attempt is actually retried (gates
        // re-probed) instead of re-waiting the full leash forever.
        let mut gate_closed_at: Option<Instant> = None;
        // last-known quiet knob — refreshed from settings on every RUN (never
        // read while parked; an idle daemon touches no disk)
        let mut quiet = DEFAULT_QUIET;
        // status signature of the last cycle — a status-only change (secrets
        // skipped, model offline/back) must reach the UI even when no journal
        // line was written, or the §4.2.3 hint and the offline pause appear
        // late and clear later still.
        let mut last_status_sig: Option<(bool, usize)> = None;
        loop {
            // ── plan: park, sleep a bounded remainder, or run ────────────────
            if *inner.trust.lock().unwrap() == Trust::Off {
                inner.run_now.store(false, Ordering::SeqCst); // Off parks a stored nudge
            }
            let wait = plan_wait(
                *inner.trust.lock().unwrap() == Trust::Off,
                inner.run_now.load(Ordering::SeqCst),
                inner.sweep_at.lock().unwrap().map(|t| t.elapsed()),
                inner
                    .sweep_hold
                    .lock()
                    .unwrap()
                    .map(|t| t.saturating_duration_since(Instant::now())),
                inner.queue.lock().unwrap().values().map(|t| t.elapsed()).min(),
                cycle_owed,
                quiet,
                next_model_try.map(|t| t.saturating_duration_since(Instant::now())),
                gate_closed_at.map(|t| GATE_RECHECK.saturating_sub(t.elapsed())),
            );
            match wait {
                Wait::Park => {
                    let q = inner.queue.lock().unwrap();
                    // re-check under the condvar mutex: an event that landed
                    // between planning and locking must not be lost to a
                    // missed notify (the nudgers notify under this same lock)
                    if !q.is_empty()
                        || inner.run_now.load(Ordering::SeqCst)
                        || inner.sweep_at.lock().unwrap().is_some()
                    {
                        continue;
                    }
                    let _unused = inner.cv.wait(q).unwrap();
                    continue; // an event arrived (or spurious) — re-plan
                }
                Wait::For(d) => {
                    let q = inner.queue.lock().unwrap();
                    let _unused = inner.cv.wait_timeout(q, d).unwrap();
                    continue; // ripe or a fresh event — re-plan either way
                }
                Wait::Run => {}
            }

            let corpus_state = app.state::<CorpusState>();
            let knobs = read_knobs(&corpus_state, &root_id, inner);
            quiet = knobs.quiet; // run_cycle re-reads its own copy; keep the planner's fresh
            if inner.brain_off.load(Ordering::SeqCst) {
                // RAW vault: consume every wake signal and park — no sweep, no
                // cycle, and nothing left queued to act on if the Brain later
                // returns (re-enabling starts fresh from its own sweep).
                inner.run_now.store(false, Ordering::SeqCst);
                inner.sweep_at.lock().unwrap().take();
                inner.queue.lock().unwrap().clear();
                inner.status.lock().unwrap().secure_pending.clear();
                continue;
            }
            if *inner.trust.lock().unwrap() == Trust::Off {
                inner.run_now.store(false, Ordering::SeqCst);
                continue; // dormant — don't even sweep (the planner parks next)
            }

            // LOAD, don't swap (#29): the nudge is consumed only once its cycle
            // actually starts — a closed gate below leaves it queued for the
            // leash retry instead of silently eating the user's explicit click.
            let run_now = inner.run_now.load(Ordering::SeqCst);
            // the owed reconciliation sweep (diff-only, disk-local, no model) —
            // startup / Run-now / an approval nudge / trust turned back on.
            // The one-shot startup hold gates the take: while held, a queue
            // run proceeds WITHOUT dragging the boot sweep along; an explicit
            // Run-now bypasses (the user's own timing).
            let hold_over = {
                let mut hold = inner.sweep_hold.lock().unwrap();
                match *hold {
                    Some(t) if !run_now && Instant::now() < t => false,
                    _ => {
                        *hold = None;
                        true
                    }
                }
            };
            if (hold_over && inner.sweep_at.lock().unwrap().take().is_some()) || run_now {
                let state_json = corpus_state
                    .route(&root_id, |s| s.dot_read("organizer"))
                    .unwrap_or_else(|_| "{}".into());
                let mut state = parse_state(&state_json);
                let mut targets = sweep(&root, &state);
                if run_now {
                    // the explicit nudge is an AUDIT (Seth, 2026-07-31): also
                    // re-open coverage for covered notes whose metadata is
                    // missing, so "processed once" can never hide a gap
                    let gaps = audit_gaps(&root, &state);
                    if !gaps.is_empty() {
                        reopen_coverage(&root, &mut state, &gaps);
                        let _ = corpus_state
                            .route(&root_id, |s| s.dot_write("organizer", &state_pretty(&state)));
                        targets.extend(gaps);
                    }
                }
                let abs: Vec<PathBuf> = targets.into_iter().map(|r| root.join(r)).collect();
                handle.enqueue(&root, &abs);
                cycle_owed = true;
            }

            if inner.queue.lock().unwrap().is_empty() && !cycle_owed && !run_now {
                gate_closed_at = None;
                continue; // nothing staged — the planner parks
            }
            // model-offline backoff — run-now retries immediately
            if !run_now && next_model_try.is_some_and(|t| Instant::now() < t) {
                continue; // the planner sleeps out the remainder
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
                gate_closed_at = Some(Instant::now()); // retry on the GATE_RECHECK leash
                continue; // leave the queue (and a pending run-now) intact for the next wake
            }
            gate_closed_at = None;
            if run_now {
                // the gates passed — the nudge's cycle is really starting (#29)
                inner.run_now.store(false, Ordering::SeqCst);
            }
            // which model organizes — re-read each cycle so a Settings change
            // takes effect on the next wake (Seth, 2026-07-03). Default Local
            // (on-device); Claude routes to `claude -p` Sonnet.
            let org_model = {
                let s = corpus_state
                    .route(&root_id, |s| s.dot_read("settings"))
                    .unwrap_or_else(|_| "{}".into());
                parse_knobs(&s).model
            };
            let transport = |prompt: &str| match org_model {
                OrgModel::Claude => crate::provider::organizer_claude_complete(prompt, CLAUDE_TIMEOUT),
                OrgModel::Gemini35 => crate::provider::organizer_gemini_complete(prompt, GEMINI_TIMEOUT),
                OrgModel::Local => {
                    let msgs = [WireMsg {
                        role: "user".to_string(),
                        content: prompt.to_string(),
                        images: Vec::new(),
                    }];
                    chat::complete_local(&msgs, true, 0.0, GEN_MAX_TOKENS, MODEL_TIMEOUT)
                }
            };
            // journal/filed_by must name the lane that ACTUALLY runs — a
            // Claude-organized cycle used to be stamped as the local model
            *inner.model_label.lock().unwrap() = match org_model {
                OrgModel::Claude => "claude-sonnet".to_string(),
                OrgModel::Gemini35 => "gemini-3.5-flash".to_string(),
                OrgModel::Local => chat::DEFAULT_MODEL.to_string(),
            };
            // a Stop belongs to the cycle it interrupted, never to the next
            // one — cleared BEFORE busy goes up, so no press can slip into the
            // gap and be silently eaten while the UI shows busy (review F5)
            inner.stop_now.store(false, Ordering::SeqCst);
            inner.cycle_busy.store(true, Ordering::SeqCst);
            let cycle = run_cycle(&corpus_state, &root_id, &root, inner, &gates, &transport);
            inner.cycle_busy.store(false, Ordering::SeqCst);
            match cycle {
                Ok(report) => {
                    inner.emit_progress(serde_json::json!({
                        "phase": "end",
                        "applied": report.applied,
                        "proposals": report.proposals,
                        "requeued": report.requeued,
                        "secureSkipped": report.secure_skipped,
                        "stopped": report.stopped,
                    }));
                    cycle_owed = false; // the owed post-sweep cycle ran
                    // gate-blocked candidates were left queued with their OLD
                    // enqueue stamps (quiet already elapsed) — without the flag
                    // the planner would spin Run/park-nothing back-to-back
                    if report.requeued > 0 {
                        gate_closed_at = Some(Instant::now());
                    }
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
                        next_model_try = Some(Instant::now() + backoff);
                        backoff = (backoff * 2).min(BACKOFF_MAX);
                    } else {
                        backoff = BACKOFF_MIN;
                        next_model_try = None;
                    }
                }
                Err(e) => {
                    // the live band must close on a failed cycle too
                    inner.emit_progress(serde_json::json!({ "phase": "end", "error": true }));
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
    /// A cycle is executing right now (the Activity live band's anchor).
    busy: bool,
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
        busy: inner.cycle_busy.load(Ordering::SeqCst),
    }
}

/// The Activity Stop button — finish the current note, requeue the rest.
/// Cannot abort an in-flight model call (45–120 s worst case); the flag is
/// honored at every candidate boundary and mid-candidate before enrich.
#[tauri::command]
pub fn organizer_stop(state: tauri::State<OrganizerState>) -> Result<(), String> {
    let inner = &state.0 .0;
    if !inner.running.load(Ordering::SeqCst) {
        return Err("the organizer isn't running — your notes folder isn't a memex".into());
    }
    inner.stop_now.store(true, Ordering::SeqCst);
    // an unstarted queued nudge dies with the stop — the user said hands off
    inner.run_now.store(false, Ordering::SeqCst);
    Ok(())
}

/// The manual nudge — bypasses quiet/idle/AC/thermal (never an in-flight chat).
#[tauri::command]
pub fn organizer_run_once(state: tauri::State<OrganizerState>) -> Result<(), String> {
    let inner = &state.0 .0;
    if !inner.running.load(Ordering::SeqCst) {
        return Err("the organizer isn't running — your notes folder isn't a memex".into());
    }
    inner.run_now.store(true, Ordering::SeqCst);
    // notify UNDER the queue mutex (same reason as nudge_sweep: the parked
    // worker re-checks run_now while holding it — no lost wakeup)
    let _q = inner.queue.lock().unwrap();
    inner.cv.notify_all();
    Ok(())
}

/// Immediate in-memory Brain flip (vault-vs-brain, 2026-07-26) — the same
/// live channel trust has. OFF stops an in-flight cycle at the next candidate;
/// ON un-parks the worker and owes it a reconciliation sweep, so re-enabling
/// is felt now instead of racing the debounced settings write. settings.json
/// remains the durable backstop the daemon re-adopts each cycle.
#[tauri::command]
pub fn organizer_set_brain(state: tauri::State<OrganizerState>, enabled: bool) -> Result<(), String> {
    let inner = &state.0 .0;
    inner.brain_off.store(!enabled, Ordering::SeqCst);
    if enabled {
        *inner.sweep_at.lock().unwrap() = Some(Instant::now());
    }
    // notify under the queue mutex — the parked worker re-checks while holding it
    let _q = inner.queue.lock().unwrap();
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

/// The daemon LEARNS a field value the user just APPROVED (#28, audit 2026-07).
/// A frontend Approve writes through the same Filer lane the daemon uses, but
/// without recording it here the approved value reads as a USER edit to
/// `field_eligible`'s never-clobber baseline — the field freezes forever, the
/// trust ladder inverted (cooperating with the daemon would REDUCE its
/// maintenance). This marks the value daemon-owned in `.rotli/organizer.json`.
/// `note` is the note's state key: its frontmatter ULID when it has one, else
/// its rel path (exactly `state_key`'s rule; the journal row carries both).
///
/// Raciness: a cycle already mid-flight holds its own parsed state and may
/// re-persist over this write. The failure mode is the pre-#28 status quo (the
/// field stays user-owned until the next Approve re-teaches) — never corruption.
pub(crate) fn learn_field(
    corpus_state: &CorpusState,
    note: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let root_id = corpus_state.default_root_id()?;
    corpus_state.route(&root_id, |s| {
        let mut st = parse_state(&s.dot_read("organizer")?);
        st.notes
            .entry(note.to_string())
            .or_default()
            .last_fields
            .insert(key.to_string(), value.to_string());
        s.dot_write("organizer", &state_pretty(&st))
    })
}

#[tauri::command]
pub fn organizer_learn_field(
    state: tauri::State<CorpusState>,
    note: String,
    key: String,
    value: String,
) -> Result<(), String> {
    learn_field(&state, &note, &key, &value)
}

// ─── the secure review lane (feature B, decision 2026-07-22) ─────────────────

/// One "review this" row for the Activity pane — a note the daemon skipped as
/// secure. `flagged` = the explicit frontmatter flag (already protected; the
/// repair/passive lanes own those) vs detector-only (the confirm lane: the
/// detector proposes, the user disposes — nothing is ever auto-marked here).
/// `title` is for the user's own local UI, exactly like the sidebar shows it;
/// nothing from this payload is journaled or sent anywhere.
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SecureHint {
    pub rel: String,
    pub title: String,
    pub flagged: bool,
}

/// The current review rows, RE-VALIDATED fresh per call: each pending rel is
/// re-snapshotted, entries that stopped looking secure (or vanished) drop out.
pub(crate) fn secure_hints(
    corpus_state: &CorpusState,
    handle: &OrganizerHandle,
) -> Result<Vec<SecureHint>, String> {
    let pending: Vec<String> =
        handle.0.status.lock().unwrap().secure_pending.iter().cloned().collect();
    if pending.is_empty() {
        return Ok(Vec::new());
    }
    let root_id = corpus_state.default_root_id()?;
    corpus_state.route(&root_id, |s| {
        let root = s.root().to_path_buf();
        let mut out = Vec::new();
        for rel in &pending {
            // the set only ever holds our own sweep rels, but the IPC boundary
            // re-checks anyway — dot components (../) never touch the fs
            if !candidate_rel(rel) {
                continue;
            }
            let Ok(snap) = snapshot_note(&root, rel) else { continue };
            if !snap.secure {
                continue; // cleaned since the last cycle — not review material
            }
            out.push(SecureHint {
                rel: rel.clone(),
                title: snap.title,
                flagged: snap.secure_flagged,
            });
        }
        Ok(out)
    })
}

/// The user's "Not sensitive" answer for a detector-only note: persist the
/// whole-file hash so this exact content is never re-nagged, and clear the row
/// immediately. Refuses explicitly flagged notes (they are protected, not
/// pending) and non-candidate rels. Same benign raciness as `learn_field`
/// (#28): a mid-flight cycle may re-persist over this write — the failure mode
/// is one extra nag next cycle, never corruption.
pub(crate) fn dismiss_secure(
    corpus_state: &CorpusState,
    handle: &OrganizerHandle,
    rel: &str,
) -> Result<(), String> {
    if !candidate_rel(rel) {
        return Err(format!("not a reviewable note: {rel}"));
    }
    let root_id = corpus_state.default_root_id()?;
    corpus_state.route(&root_id, |s| {
        let root = s.root().to_path_buf();
        let snap = snapshot_note(&root, rel)?;
        if snap.secure_flagged {
            return Err("This note is marked secure — unmark it from its own menu instead.".into());
        }
        let mut st = parse_state(&s.dot_read("organizer")?);
        st.notes.entry(state_key(&snap)).or_default().secure_dismissed = snap.text_hash.clone();
        s.dot_write("organizer", &state_pretty(&st))
    })?;
    handle.0.status.lock().unwrap().secure_pending.remove(rel);
    Ok(())
}

#[tauri::command]
pub fn organizer_secure_hints(
    corpus: tauri::State<CorpusState>,
    state: tauri::State<OrganizerState>,
) -> Result<Vec<SecureHint>, String> {
    secure_hints(&corpus, &state.0)
}

#[tauri::command]
pub fn organizer_dismiss_secure(
    corpus: tauri::State<CorpusState>,
    state: tauri::State<OrganizerState>,
    rel: String,
) -> Result<(), String> {
    dismiss_secure(&corpus, &state.0, &rel)
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
                secure_dismissed: String::new(),
            },
        );
        f.areas.insert(
            "Projects".into(),
            AreaState {
                members_hash: "def".into(),
                built_at: "…".into(),
                proposed_hash: String::new(),
                proposed_row: String::new(),
            },
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
    fn audit_gaps_reopens_only_covered_notes_missing_metadata() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("wiki/Projects")).unwrap();
        let write = |name: &str, text: &str| fs::write(root.join("wiki/Projects").join(name), text).unwrap();
        write(
            "complete.md",
            "---\nsummary: done\ntags: a, b\nlinks: \"[[x]]\"\n---\n# Complete\nbody\n",
        );
        write("gap.md", "---\ntags: a\n---\n# Gap\nbody without summary or links\n");
        write("secret-gap.md", "---\nsecure: true\n---\n# Secret\nno fields either\n");

        // mark every note COVERED (hash + enrich recorded) — the diff sweep
        // would find nothing; only the audit sees the missing metadata
        let mut state = OrganizerFile::default();
        for name in ["complete.md", "gap.md", "secret-gap.md"] {
            let rel = format!("wiki/Projects/{name}");
            let snap = snapshot_note(&root, &rel).unwrap();
            let mut ns = NoteState::default();
            ns.hash = snap.body_hash.clone();
            ns.proposed.enrich = snap.body_hash.clone();
            state.notes.insert(state_key(&snap), ns);
        }
        assert!(sweep(&root, &state).is_empty(), "the plain diff sweep sees nothing");

        let gaps = audit_gaps(&root, &state);
        assert_eq!(gaps, vec!["wiki/Projects/gap.md".to_string()], "complete + secure excluded");

        reopen_coverage(&root, &mut state, &gaps);
        let snap = snapshot_note(&root, "wiki/Projects/gap.md").unwrap();
        let ns = state.notes.get(&state_key(&snap)).unwrap();
        assert!(ns.hash.is_empty() && ns.proposed.enrich.is_empty(), "coverage re-opened");
        // and the next sweep now picks it up like any unprocessed note
        assert_eq!(sweep(&root, &state), vec!["wiki/Projects/gap.md".to_string()]);
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
    fn plan_wait_idle_parks_and_off_parks() {
        // NOTHING staged: no queue, no owed sweep, no run-now → Park. This is
        // the energy law: an idle corpus schedules ZERO wakeups (no tick, no
        // timer, no settings read, no pmset shell-out) until an event arrives.
        assert_eq!(
            plan_wait(false, false, None, None, None, false, DEFAULT_QUIET, None, None),
            Wait::Park
        );
        // closed gates alone (no pending work) must not schedule a retry tick
        assert_eq!(
            plan_wait(false, false, None, None, None, false, DEFAULT_QUIET, None, Some(GATE_RECHECK)),
            Wait::Park
        );
        // a lingering backoff alone (queue drained meanwhile) parks too
        assert_eq!(
            plan_wait(false, false, None, None, None, false, DEFAULT_QUIET, Some(BACKOFF_MAX), None),
            Wait::Park
        );
        // Off parks EVERYTHING — a full queue, an owed sweep, a stored nudge
        assert_eq!(
            plan_wait(
                true,
                true,
                Some(Duration::ZERO),
                None,
                Some(Duration::from_secs(999)),
                true,
                DEFAULT_QUIET,
                None,
                None
            ),
            Wait::Park
        );
    }

    #[test]
    fn plan_wait_debounces_a_burst_to_one_run() {
        let quiet = Duration::from_secs(45);
        // newest enqueue 1s old → one timed wake when the burst settles; every
        // further edit re-news the age, so a typing spree = ONE run at the end
        assert_eq!(
            plan_wait(false, false, None, None, Some(Duration::from_secs(1)), false, quiet, None, None),
            Wait::For(Duration::from_secs(44))
        );
        // quiet elapsed → ripe
        assert_eq!(
            plan_wait(false, false, None, None, Some(quiet), false, quiet, None, None),
            Wait::Run
        );
        // Run-now bypasses quiet, settle, AND the model backoff (never chat —
        // that veto lives in gates_pass)
        assert_eq!(
            plan_wait(
                false,
                true,
                Some(Duration::ZERO),
                None,
                Some(Duration::ZERO),
                false,
                quiet,
                Some(Duration::from_secs(600)),
                None
            ),
            Wait::Run
        );
        // …but a nudge blocked by a closed gate is QUEUED, not consumed (#29):
        // the leash remainder times the retry (no busy-spin against a chat)…
        assert_eq!(
            plan_wait(false, true, None, None, None, false, quiet, None, Some(GATE_RECHECK)),
            Wait::For(GATE_RECHECK)
        );
        // …and once the leash decays the pending nudge actually runs
        assert_eq!(
            plan_wait(false, true, None, None, None, false, quiet, None, Some(Duration::ZERO)),
            Wait::Run
        );
    }

    #[test]
    fn plan_wait_sweep_settle_backoff_and_gate_leash() {
        let quiet = Duration::from_secs(45);
        // an owed sweep settles SWEEP_SETTLE from the nudge (approval sprees
        // fold to one disk walk), then runs
        assert_eq!(
            plan_wait(false, false, Some(Duration::from_secs(1)), None, None, false, quiet, None, None),
            Wait::For(SWEEP_SETTLE - Duration::from_secs(1))
        );
        // the startup hold stretches the owed sweep's wait to the remainder —
        // ONE wakeup at expiry, never a 3s settle poll (2026-07-31)
        assert_eq!(
            plan_wait(
                false,
                false,
                Some(Duration::ZERO),
                Some(Duration::from_secs(45)),
                None,
                false,
                quiet,
                None,
                None
            ),
            Wait::For(Duration::from_secs(45))
        );
        // an expired hold (saturated to zero) falls back to plain settle math
        assert_eq!(
            plan_wait(
                false,
                false,
                Some(SWEEP_SETTLE),
                Some(Duration::ZERO),
                None,
                false,
                quiet,
                None,
                None
            ),
            Wait::Run
        );
        // a held sweep must NOT delay queue work — the queue's own wait wins
        assert_eq!(
            plan_wait(
                false,
                false,
                Some(Duration::ZERO),
                Some(Duration::from_secs(45)),
                Some(quiet),
                false,
                quiet,
                None,
                None
            ),
            Wait::Run
        );
        assert_eq!(
            plan_wait(false, false, Some(SWEEP_SETTLE), None, None, false, quiet, None, None),
            Wait::Run
        );
        // model offline: the backoff stretches a ripe queue's wait — no retry
        // storm against a dead server
        assert_eq!(
            plan_wait(false, false, None, None, Some(quiet), false, quiet, Some(Duration::from_secs(30)), None),
            Wait::For(Duration::from_secs(30))
        );
        // gates closed with work pending → the bounded GATE_RECHECK leash
        // (the ONLY timed retry that exists, and only while work is staged)
        assert_eq!(
            plan_wait(false, false, None, None, Some(quiet), false, quiet, None, Some(GATE_RECHECK)),
            Wait::For(GATE_RECHECK)
        );
        // the leash is a REMAINDER: mid-leash re-plans wait only what's left…
        assert_eq!(
            plan_wait(false, false, None, None, Some(quiet), false, quiet, None, Some(Duration::from_secs(30))),
            Wait::For(Duration::from_secs(30))
        );
        // …and an EXPIRED leash runs — the gates get re-probed instead of the
        // blocked attempt re-waiting the full leash forever (the starvation bug)
        assert_eq!(
            plan_wait(false, false, None, None, Some(quiet), false, quiet, None, Some(Duration::ZERO)),
            Wait::Run
        );
        // an owed post-sweep cycle alone (empty queue) still runs — frontend
        // approvals are suppress-marked, the index diff must catch up
        assert_eq!(plan_wait(false, false, None, None, None, true, quiet, None, None), Wait::Run);
    }

    #[test]
    fn nudges_owe_exactly_one_sweep() {
        let handle = OrganizerHandle::new();
        assert!(handle.0.sweep_at.lock().unwrap().is_none(), "born owing nothing");
        handle.nudge_sweep();
        assert!(handle.0.sweep_at.lock().unwrap().is_some());
        *handle.0.sweep_at.lock().unwrap() = None;
        handle.set_trust(Trust::Off);
        assert!(handle.0.sweep_at.lock().unwrap().is_none(), "Off never wakes anything");
        handle.set_trust(Trust::Suggest);
        assert!(
            handle.0.sweep_at.lock().unwrap().is_some(),
            "waking the daemon owes one reconciliation (edits made while Off never queued)"
        );
    }

    #[test]
    fn trust_parse_is_safe_and_strict_where_it_must_be() {
        assert_eq!(Trust::parse("tidy"), Trust::Tidy);
        // Organize is the default rung (2026-07-02) — location+metadata only,
        // journaled+undoable; an explicit settings choice always wins
        assert_eq!(Trust::parse("garbage"), Trust::Organize, "unknown → the default rung");
        assert_eq!(Trust::parse(""), Trust::Organize);
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
        assert_eq!(k.model, OrgModel::Local, "absent/garbage organizerModel → on-device");
        // recognized remote lanes are explicit; everything else stays local
        assert_eq!(parse_knobs("{\"organizerModel\":\"claude\"}").model, OrgModel::Claude);
        assert_eq!(parse_knobs("{\"organizerModel\":\"Claude\"}").model, OrgModel::Claude);
        assert_eq!(parse_knobs("{\"organizerModel\":\"gemini35\"}").model, OrgModel::Gemini35);
        assert_eq!(parse_knobs("{\"organizerModel\":\"local\"}").model, OrgModel::Local);
        assert_eq!(parse_knobs("{\"organizerModel\":\"gpt\"}").model, OrgModel::Local);
    }

    // ── the cycle ──

    #[test]
    fn secure_and_locked_never_reach_the_transport() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
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
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // EXPLICIT: this test proves Suggest is write-free (Organize is the default now)
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
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
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
    fn idle_corpus_schedules_zero_work() {
        // Converge a corpus, then verify the daemon would do NOTHING for it:
        // the sweep finds no candidates, the queue is empty, and the planner
        // PARKS — a plain condvar wait, no tick, no timer, no model call —
        // until a real event (watcher / Run-now / approval nudge) arrives.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
        let rel = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        handle.enqueue(&root, &[root.join(&rel)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();

        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        assert!(sweep(&root, &st).is_empty(), "a converged corpus has no sweep candidates");
        assert!(handle.0.queue.lock().unwrap().is_empty(), "nothing left staged");
        assert_eq!(
            plan_wait(false, false, None, None, None, false, DEFAULT_QUIET, None, None),
            Wait::Park,
            "idle corpus ⇒ Park: zero scheduled wakeups"
        );
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
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
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
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit Suggest (Organize is the default now)
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
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
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

    /// Every user file under the root, byte-for-byte, EXCLUDING `.rotli/`
    /// (state is a rebuildable projection; the vault-vs-brain acceptance is
    /// about the user's files).
    fn user_tree(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
            for e in fs::read_dir(dir).unwrap().flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name == ".rotli" {
                    continue;
                }
                let p = e.path();
                if p.is_dir() {
                    walk(&p, root, out);
                } else if p.is_file() {
                    let rel = p.strip_prefix(root).unwrap().to_string_lossy().into_owned();
                    out.insert(rel, fs::read(&p).unwrap());
                }
            }
        }
        let mut out = std::collections::BTreeMap::new();
        walk(root, root, &mut out);
        out
    }

    /// THE vault-vs-brain acceptance test (decision 2026-07-26): a raw vault
    /// never reaches a model and never changes a file — and toggling the Brain
    /// off → on (Suggest) → off leaves every user file byte-identical.
    #[test]
    fn raw_vault_never_models_and_toggling_never_changes_files() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(
            &state,
            "{\"brainEnabled\":false,\"organizerTrust\":\"organize\",\"organizerQuietSecs\":0}",
        );
        let plain = stage_capture(&state, "# Alazan 84\n\nland deal notes\n");
        let secret = stage_capture(&state, "# Card\n\ncard 4242 4242 4242 4242\n");
        let before = user_tree(&root);

        // RAW: the transport must never fire, even at trust=organize
        let calls = AtomicUsize::new(0);
        let counting = |p: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            dual_transport(p)
        };
        handle.enqueue(&root, &[root.join(&plain), root.join(&secret)]);
        let report = run_cycle(&state, "default", &root, &handle.0, &no_gates(), &counting).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0, "a raw vault must NEVER be modeled");
        assert_eq!((report.proposals, report.applied), (0, 0));
        assert!(handle.0.queue.lock().unwrap().is_empty(), "the queue drains without acting");
        assert_eq!(handle.0.status.lock().unwrap().secure_pending.len(), 0, "no review nags");
        assert!(journal_rows(&state).is_empty(), "a raw vault journals nothing");
        assert_eq!(user_tree(&root), before, "raw cycles leave every user file byte-identical");

        // Brain back ON at Suggest — resumes proposing, still never rewrites files
        write_settings(
            &state,
            "{\"brainEnabled\":true,\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}",
        );
        handle.0.settings_trust.lock().unwrap().take(); // fresh adoption of the file's rung
        handle.enqueue(&root, &[root.join(&plain), root.join(&secret)]);
        let report = run_cycle(&state, "default", &root, &handle.0, &no_gates(), &counting).unwrap();
        assert!(calls.load(Ordering::SeqCst) > 0, "re-enabling resumes the Brain");
        assert!(report.proposals > 0, "Suggest proposes on re-entry");
        assert_eq!(report.applied, 0, "never auto-apply on re-entry");
        assert_eq!(user_tree(&root), before, "Suggest proposals never touch user files");

        // and OFF again: inert once more
        write_settings(&state, "{\"brainEnabled\":false,\"organizerQuietSecs\":0}");
        let at_reenter = calls.load(Ordering::SeqCst);
        handle.enqueue(&root, &[root.join(&plain)]);
        let report = run_cycle(&state, "default", &root, &handle.0, &no_gates(), &counting).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), at_reenter, "off means off, immediately");
        assert_eq!((report.proposals, report.applied), (0, 0));
        assert_eq!(user_tree(&root), before, "the full off→on→off round trip changed nothing");
    }

    /// The LIVE off signal (pressure-test 2026-07-26): flipping the Brain off
    /// MID-CYCLE stops at the next candidate — the in-flight queue must not
    /// keep reaching a model for minutes after the user's raw choice.
    #[test]
    fn brain_off_mid_cycle_stops_at_the_next_candidate() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        let a = stage_capture(&state, "# Alazan 84\n\nland deal notes\n");
        let b = stage_capture(&state, "# Trip plan\n\nflights and hotels\n");
        handle.enqueue(&root, &[root.join(&a), root.join(&b)]);
        let calls = AtomicUsize::new(0);
        let inner = handle.0.clone();
        let transport = |p: &str| {
            calls.fetch_add(1, Ordering::SeqCst);
            // the user flips raw WHILE the first model call is in flight —
            // exactly what organizer_set_brain's atomic does
            inner.brain_off.store(true, Ordering::SeqCst);
            dual_transport(p)
        };
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the SECOND candidate must never be modeled after the off flip"
        );
        assert!(handle.0.queue.lock().unwrap().is_empty(), "the rest drains without acting");
    }

    /// The missing-field default IS the compatibility promise: an untouched
    /// settings file behaves exactly like today (brain on).
    #[test]
    fn missing_brain_field_means_on() {
        assert!(parse_knobs("{}").brain_enabled);
        assert!(parse_knobs("not json at all").brain_enabled);
        assert!(parse_knobs("{\"brainEnabled\":true}").brain_enabled);
        assert!(!parse_knobs("{\"brainEnabled\":false}").brain_enabled);
        // garbage value → the safe default (on = today's behavior)
        assert!(parse_knobs("{\"brainEnabled\":\"nope\"}").brain_enabled);
    }

    /// Feature B (decision 2026-07-22): "Not sensitive" is durable for that
    /// exact content — immediate row clear, survives later cycles, and any
    /// change the detector could see re-arms the review. Never auto-marks.
    #[test]
    fn not_sensitive_dismissal_persists_and_rearms_on_change() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        let secret = stage_capture(&state, "# Card\n\ncard 4242 4242 4242 4242\n");
        handle.enqueue(&root, &[root.join(&secret)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        let pending = |h: &OrganizerHandle| h.0.status.lock().unwrap().secure_pending.len();
        assert_eq!(pending(&handle), 1);

        // the review row: detector-only, real title, NOT flagged
        let hints = secure_hints(&state, &handle).unwrap();
        assert_eq!(hints.len(), 1, "{hints:?}");
        assert_eq!(hints[0].title, "Card");
        assert!(!hints[0].flagged, "the explicit flag was never set");

        dismiss_secure(&state, &handle, &secret).unwrap();
        assert_eq!(pending(&handle), 0, "the answer clears the row immediately");
        assert!(
            !fs::read_to_string(root.join(&secret)).unwrap().contains("secure"),
            "Not sensitive must never write into the note"
        );

        handle.enqueue(&root, &[root.join(&secret)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(pending(&handle), 0, "the dismissal is durable across cycles");

        // a content change the detector sees re-arms the review
        let text = fs::read_to_string(root.join(&secret)).unwrap();
        fs::write(root.join(&secret), format!("{text}\nsk-ant-abcdefghijklmnop123\n")).unwrap();
        handle.enqueue(&root, &[root.join(&secret)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(pending(&handle), 1, "changed content re-arms the hint");
    }

    /// The dismissal lane fails closed: flagged notes refuse (they are
    /// protected, not pending), and rels outside the daemon's own candidate
    /// grammar (dot components, non-wiki paths) never touch the filesystem.
    #[test]
    fn dismissal_refuses_flagged_notes_and_alien_rels() {
        let (_dir, root, state, handle) = seed_brain();
        let flagged = stage_capture(&state, "# Private\n\nowner notes\n");
        add_flag(&root, &flagged, "secure: true");
        let err = dismiss_secure(&state, &handle, &flagged).unwrap_err();
        assert!(err.contains("marked secure"), "{err}");
        assert!(dismiss_secure(&state, &handle, "wiki/../self/identity.md").is_err());
        assert!(dismiss_secure(&state, &handle, "self/identity.md").is_err());
        assert!(dismiss_secure(&state, &handle, "wiki/README.md").is_err());
    }

    /// Hints re-validate per call: flagged and detector-only rows split, a
    /// vanished file drops out, and a cleaned note is no longer review material.
    #[test]
    fn secure_hints_split_flagged_from_detector_only_and_prune_stale() {
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}");
        let detector = stage_capture(&state, "# Api key\n\nsk-ant-abcdefghijklmnop123\n");
        let flagged = stage_capture(&state, "# Private\n\nowner notes\n");
        add_flag(&root, &flagged, "secure: true");
        let gone = stage_capture(&state, "# Card\n\ncard 4242 4242 4242 4242\n");
        handle.enqueue(&root, &[root.join(&detector), root.join(&flagged), root.join(&gone)]);
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(handle.0.status.lock().unwrap().secure_pending.len(), 3);

        fs::remove_file(root.join(&gone)).unwrap();
        let hints = secure_hints(&state, &handle).unwrap();
        assert_eq!(hints.len(), 2, "{hints:?}");
        let by_title = |t: &str| hints.iter().find(|h| h.title == t).unwrap();
        assert!(!by_title("Api key").flagged);
        assert!(by_title("Private").flagged);
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
    fn failed_apply_never_strands_a_capture_as_covered() {
        // #25 (audit 2026-07): note A's classify apply fails mid-write (locked
        // between read and apply), then note B's SUCCESSFUL pass dot_writes the
        // shared in-memory state. A must NOT ride out persisted as
        // "classify-covered" — that stranded it: no journal row, invisible in
        // Activity, unrescuable by the sweep until its body changed.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let a = stage_capture(&state, "# Alazan 84\n\nland deal notes");
        let b = stage_capture(&state, "# Mystery\n\nunclear scribble");
        handle.enqueue(&root, &[root.join(&a), root.join(&b)]);
        let root2 = root.clone();
        let a2 = a.clone();
        let transport = |p: &str| {
            if p.contains("Alazan") {
                // lock A while its classify call is "in flight" — frontmatter
                // only, so the body-hash re-check passes and only the Filer
                // gate's own fresh `locked` read stops the apply
                add_flag(&root2, &a2, "locked: true");
            }
            dual_transport(p)
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        assert!(report.errors >= 1, "A's refused write is reported");
        assert!(report.applied >= 1, "B still processed — the cycle went on");
        // the PERSISTED state (B's dot_write carried the whole map) must not cover A
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        let a_snap = snapshot_note(&root, &a).unwrap();
        assert!(
            !classify_covered(&a_snap, &st),
            "a failed apply must never persist as classify-covered (#25)"
        );
        // and no journal row claims anything happened to A
        assert!(
            journal_rows(&state).iter().all(|r| r["noteId"].as_str().unwrap() != a),
            "no row may claim A was touched"
        );
    }

    #[test]
    fn enrich_apply_rechecks_field_values_fresh() {
        // #27 (audit 2026-07): a FRONTMATTER-only user edit during the enrich
        // model call (the body hash still matches) — the write window must
        // re-derive the field values from the fresh file and skip the
        // now-user-owned field instead of clobbering it.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"tidy\",\"organizerQuietSecs\":0}");
        let rel = place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");
        handle.enqueue(&root, &[root.join(&rel)]);
        let root2 = root.clone();
        let rel2 = rel.clone();
        let transport = |_: &str| {
            // the user sets a summary WHILE the model call is in flight
            add_flag(&root2, &rel2, "summary: my own words");
            Ok("{\"summary\":\"model line\",\"tags\":[\"land\"],\"links\":[]}".to_string())
        };
        let report =
            run_cycle(&state, "default", &root, &handle.0, &no_gates(), &transport).unwrap();
        let text = fs::read_to_string(root.join(&rel)).unwrap();
        assert!(
            text.contains("summary: my own words"),
            "the user's mid-flight summary survives:\n{text}"
        );
        assert!(!text.contains("model line"), "the stale model summary must not land:\n{text}");
        assert!(text.contains("tags: [land]"), "untouched fields still enrich:\n{text}");
        assert_eq!(report.applied, 1, "tags applied; summary skipped, not errored");
        assert!(
            journal_rows(&state).iter().all(|r| r["field"] != "summary"),
            "no row may claim the summary write"
        );
    }

    #[test]
    fn index_reproposal_and_fixed_point_supersede_the_stale_pending_row() {
        // #26 (audit 2026-07): index proposals need the same supersede grammar
        // files/fields have — a membership change retires the pending row, and
        // reaching the fixed point (approved / reverted) retires it too.
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit Suggest (Organize is the default now)
        place_note(&state, "# Alazan 84\n\nland deal notes", "Projects");
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        let p1 = journal_rows(&state)
            .iter()
            .find(|r| r["action"] == "index" && r["status"] == "proposed")
            .map(|r| r["id"].as_str().unwrap().to_string())
            .expect("cycle 1 proposes the Projects overview");

        // membership changes while P1 is pending → the re-proposal retires it
        place_note(&state, "# Land survey\n\nsurvey notes", "Projects");
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        let latest = |id: &str| {
            journal_rows(&state)
                .iter()
                .rfind(|r| r["id"].as_str().unwrap() == id)
                .map(|r| r["status"].as_str().unwrap().to_string())
                .unwrap()
        };
        assert_eq!(latest(&p1), "dismissed", "the stale index proposal retires (#26)");
        let p2 = journal_rows(&state)
            .iter()
            .rfind(|r| r["action"] == "index")
            .map(|r| r["id"].as_str().unwrap().to_string())
            .expect("a fresh proposal replaced it");
        assert_ne!(p2, p1);
        assert_eq!(latest(&p2), "proposed");

        // the user approves P2 (the frontend writes the proposed body verbatim)
        // → the daemon catches up at the fixed point and P2 settles, not zombies
        let after = journal_rows(&state)
            .iter()
            .rfind(|r| r["id"].as_str().unwrap() == p2)
            .map(|r| r["after"].as_str().unwrap().to_string())
            .unwrap();
        fs::write(root.join("wiki/Projects/_index.md"), &after).unwrap();
        run_cycle(&state, "default", &root, &handle.0, &no_gates(), &dual_transport).unwrap();
        assert_eq!(latest(&p2), "dismissed", "the settled proposal leaves pending (#26)");
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        assert!(st.areas["Projects"].proposed_row.is_empty(), "the handle cleared");
    }

    #[test]
    fn learn_field_teaches_the_never_clobber_baseline() {
        // #28 (audit 2026-07): a frontend Approve writes the field through the
        // Filer lane, then teaches the daemon — the approved value must read as
        // daemon-owned to `field_eligible`, never as a freezing user edit.
        let (_dir, root, state, _handle) = seed_brain();
        let rel = stage_capture(&state, "# Alazan 84\n\nnotes");
        state.route("default", |s| s.set_ai_field(&rel, "summary", "approved line")).unwrap();
        let snap = snapshot_note(&root, &rel).unwrap();
        let key = state_key(&snap);
        learn_field(&state, &key, "summary", "approved line").unwrap();
        let st = parse_state(&state.route("default", |s| s.dot_read("organizer")).unwrap());
        assert_eq!(
            st.notes[&key].last_fields.get("summary").map(String::as_str),
            Some("approved line")
        );
        assert!(
            field_eligible(&snap, st.notes.get(&key), "summary"),
            "the approved value is daemon-owned — maintenance continues (#28)"
        );
    }

    #[test]
    fn secure_and_locked_peers_never_ride_an_enrich_prompt() {
        // §4.2.2: a secure note must never reach ANY model — including its
        // FILENAME, whose slug is title-derived (for a quick capture the title
        // is often the secret itself).
        let (_dir, root, state, handle) = seed_brain();
        write_settings(&state, "{\"organizerTrust\":\"suggest\",\"organizerQuietSecs\":0}"); // explicit: these assertions encode propose-only (Suggest) semantics
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
        let unchanged = fs::read_to_string(root.join(&note)).unwrap();
        assert!(unchanged.contains("\nsummary:\n"));
        assert!(!unchanged.contains("summary: one line"));

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
