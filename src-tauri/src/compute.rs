//! Local-model compute guardrails — measured admission, a FIFO queue, and a
//! user-driven prioritize. Design: `docs/design/local-compute-guardrails.md`.
//!
//! Concurrent local chats stay allowed. What this module gates is each local
//! INFERENCE REQUEST, and the gate is measured headroom on this Mac — never a
//! chat count. A request that doesn't fit is QUEUED (never silently refused),
//! the chat says so honestly, and the user can jump it to the front.
//!
//! Two facts do the work:
//! - macOS tells us how much memory is actually available
//!   (`kern.memorystatus_level`, the kernel's own availability percentage) and
//!   what it thinks of the situation (`kern.memorystatus_vm_pressure_level`).
//!   `vm.page_free_count` is NOT that signal — it reads ~6% on a totally idle
//!   64 GB Mac because macOS deliberately keeps RAM working.
//! - mlx-server 0.3 holds ONE loaded model slot and swaps it per request (see
//!   `localmodel.rs`). So two requests for the SAME model share resident
//!   weights, and a request for a DIFFERENT model would evict a running
//!   generation mid-stream — it waits for the slot no matter how free memory
//!   is. That's a property of the server, not a threshold we picked.
//!
//! Remote lanes (Claude/Codex/Gemini) never enter here — they have
//! provider-side capacity.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

// ── the honest copy the chat surface shows ───────────────────────────────────

pub(crate) const REASON_QUEUED: &str = "queued — checking this Mac's compute headroom";
pub(crate) const REASON_AHEAD: &str = "queued — another local message is ahead of this one";
pub(crate) const REASON_OTHER_MODEL: &str = "queued — another local model is still generating";
pub(crate) const REASON_UNMEASURED: &str =
    "queued — can't measure this Mac's memory, so local messages run one at a time";
pub(crate) const REASON_PRESSURE: &str = "queued — this Mac is low on memory right now";
pub(crate) const REASON_HEADROOM: &str = "queued — not enough compute headroom right now";
const CANCELLED: &str = "This local message was cancelled while it waited for compute.";

// ── knobs (settings.json — frontend-owned file, Rust READS only) ─────────────
//
// §6.4 knob-not-constant: every threshold below is a knob with a safe default,
// not a magic number. They follow the `organizerThreshold` precedent — no
// PersistedSettings field and no Settings control, so `unknownSettingsKeys`
// round-trips them untouched.

const DEFAULT_MIN_FREE_PCT: f64 = 20.0;
const DEFAULT_WARN_MULTIPLIER: f64 = 2.0;
const DEFAULT_OVERHEAD_MB: u64 = 768;
const DEFAULT_FOOTPRINT_MB: u64 = 8192;
const DEFAULT_QUEUE_MAX: usize = 8;
const DEFAULT_WAIT_SECS: f64 = 600.0;
const DEFAULT_POLL_MS: u64 = 1500;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Knobs {
    /// Master switch (`localComputeGuardrails`). Off ⇒ admit everything.
    pub enabled: bool,
    /// Percent of this Mac's memory that must remain available AFTER admitting.
    pub min_free_pct: f64,
    /// Reserve multiplier while macOS reports `warn` pressure.
    pub warn_multiplier: f64,
    /// Marginal cost of one more concurrent request on an already-resident
    /// model (KV cache + activations) — the weights are not paid twice.
    pub overhead_mb: u64,
    /// Fallback weights footprint when the registry has no `approxMB`.
    pub fallback_footprint_mb: u64,
    /// Queue depth before an honest refusal (rather than an unbounded wait).
    pub queue_max: usize,
    /// Ceiling on one wait.
    pub wait: Duration,
    /// Re-check cadence — memory changes on its own (another app quits), so
    /// waiting has to poll, not only listen.
    pub poll: Duration,
}

impl Default for Knobs {
    fn default() -> Self {
        Self {
            enabled: true,
            min_free_pct: DEFAULT_MIN_FREE_PCT,
            warn_multiplier: DEFAULT_WARN_MULTIPLIER,
            overhead_mb: DEFAULT_OVERHEAD_MB,
            fallback_footprint_mb: DEFAULT_FOOTPRINT_MB,
            queue_max: DEFAULT_QUEUE_MAX,
            wait: Duration::from_secs_f64(DEFAULT_WAIT_SECS),
            poll: Duration::from_millis(DEFAULT_POLL_MS),
        }
    }
}

/// A finite, in-range number or the default — a nonsense value in the file is
/// never adopted.
fn num(v: &serde_json::Value, key: &str, lo: f64, hi: f64, fallback: f64) -> f64 {
    v.get(key)
        .and_then(serde_json::Value::as_f64)
        .filter(|n| n.is_finite() && *n >= lo && *n <= hi)
        .unwrap_or(fallback)
}

pub(crate) fn parse_knobs(settings: &str) -> Knobs {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(settings) else {
        return Knobs::default();
    };
    let d = Knobs::default();
    Knobs {
        enabled: v
            .get("localComputeGuardrails")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(d.enabled),
        min_free_pct: num(&v, "localMinFreePercent", 0.0, 95.0, d.min_free_pct),
        warn_multiplier: num(&v, "localWarnReserveMultiplier", 1.0, 10.0, d.warn_multiplier),
        overhead_mb: num(&v, "localRequestOverheadMB", 0.0, 262_144.0, d.overhead_mb as f64) as u64,
        fallback_footprint_mb: num(
            &v,
            "localModelFootprintMB",
            0.0,
            1_048_576.0,
            d.fallback_footprint_mb as f64,
        ) as u64,
        queue_max: num(&v, "localQueueMax", 1.0, 256.0, d.queue_max as f64) as usize,
        wait: Duration::from_secs_f64(num(&v, "localQueueWaitSecs", 1.0, 86_400.0, DEFAULT_WAIT_SECS)),
        poll: Duration::from_millis(num(&v, "localQueuePollMs", 50.0, 60_000.0, DEFAULT_POLL_MS as f64) as u64),
    }
}

/// Read the knobs off the ACTIVE vault's `.rotli/settings.json` — the same file
/// and the same read-only contract as the organizer daemon's knobs. Called from
/// a blocking worker (the corpus mutex can be held by a daemon apply).
pub(crate) fn knobs_from(app: &tauri::AppHandle) -> Knobs {
    use tauri::Manager;
    let Some(corpus) = app.try_state::<crate::corpus::CorpusState>() else {
        return Knobs::default();
    };
    let Ok(root_id) = corpus.default_root_id() else {
        return Knobs::default();
    };
    let raw = corpus
        .route(&root_id, |s| s.dot_read("settings"))
        .unwrap_or_else(|_| "{}".to_string());
    parse_knobs(&raw)
}

// ── what this Mac reports ────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Pressure {
    Normal,
    Warn,
    Critical,
}

/// One measurement of this Mac's memory situation. `available_pct` is the
/// KERNEL's own availability percentage, not a page count we interpreted.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Memory {
    pub total_mb: f64,
    pub available_pct: f64,
    pub pressure: Pressure,
}

/// The real reading. `None` ⇒ unmeasurable, which SERIALIZES rather than
/// failing open (design §5): failing open recreates the exact thrash this
/// module exists to prevent, and a single-slot sidecar's true concurrency
/// guarantee is one anyway — so the degrade costs latency and nothing else.
pub(crate) fn read_memory() -> Option<Memory> {
    let total_bytes: f64 = crate::localmodel::sysctl("hw.memsize")?.parse().ok()?;
    let available_pct: f64 = crate::localmodel::sysctl("kern.memorystatus_level")?.parse().ok()?;
    if !total_bytes.is_finite() || total_bytes <= 0.0 || !available_pct.is_finite() {
        return None;
    }
    // 1 normal · 2 warn · 4 critical. Unreadable ⇒ assume normal: the headroom
    // arithmetic above still binds, and `kern.memorystatus_level` is the signal
    // we actually can't do without.
    let pressure = match crate::localmodel::sysctl("kern.memorystatus_vm_pressure_level")
        .and_then(|s| s.parse::<i64>().ok())
    {
        Some(n) if n >= 4 => Pressure::Critical,
        Some(2 | 3) => Pressure::Warn,
        _ => Pressure::Normal,
    };
    Some(Memory {
        total_mb: total_bytes / 1_048_576.0,
        available_pct: available_pct.clamp(0.0, 100.0),
        pressure,
    })
}

// ── the admission rule (pure — every test drives it directly) ────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Admit,
    Wait(&'static str),
}

/// One local request the sidecar is currently generating.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Running {
    pub id: String,
    pub model: String,
}

/// Should `model` start RIGHT NOW, given what's in flight and what this Mac
/// reports? Pure: no clock, no I/O, no state. Design §3.
pub(crate) fn decide(
    model: &str,
    footprint_mb: u64,
    running: &[Running],
    mem: Option<Memory>,
    k: &Knobs,
) -> Decision {
    if !k.enabled {
        return Decision::Admit;
    }
    // §2 — one loaded slot: a different model would evict a live generation.
    if running.iter().any(|r| r.model != model) {
        return Decision::Wait(REASON_OTHER_MODEL);
    }
    let Some(mem) = mem else {
        return if running.is_empty() {
            Decision::Admit
        } else {
            Decision::Wait(REASON_UNMEASURED)
        };
    };
    if mem.pressure == Pressure::Critical {
        return Decision::Wait(REASON_PRESSURE);
    }
    // weights are already resident iff this exact model is generating
    let resident = running.iter().any(|r| r.model == model);
    let marginal = (if resident { 0 } else { footprint_mb }) + k.overhead_mb;
    let cost_pct = if mem.total_mb > 0.0 {
        marginal as f64 / mem.total_mb * 100.0
    } else {
        100.0
    };
    let reserve = k.min_free_pct
        * if mem.pressure == Pressure::Warn {
            k.warn_multiplier
        } else {
            1.0
        };
    // `>=` — landing exactly on the reserve line admits (design §3.6).
    if mem.available_pct - cost_pct >= reserve {
        Decision::Admit
    } else {
        Decision::Wait(REASON_HEADROOM)
    }
}

// ── the queue ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Waiting {
    id: String,
    model: String,
    footprint_mb: u64,
    reason: &'static str,
    cancelled: bool,
}

#[derive(Default)]
struct Inner {
    waiting: Vec<Waiting>,
    running: Vec<Running>,
}

/// One row of the snapshot the chat surface renders.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub request_id: String,
    pub model: String,
    /// User-facing copy. Empty for a running entry.
    pub reason: String,
    /// 0-based place in line. Always 0 for a running entry.
    pub position: usize,
}

#[derive(serde::Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub waiting: Vec<QueueEntry>,
    pub running: Vec<QueueEntry>,
}

impl Inner {
    fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            waiting: self
                .waiting
                .iter()
                .enumerate()
                .map(|(i, w)| QueueEntry {
                    request_id: w.id.clone(),
                    model: w.model.clone(),
                    reason: w.reason.to_string(),
                    position: i,
                })
                .collect(),
            running: self
                .running
                .iter()
                .map(|r| QueueEntry {
                    request_id: r.id.clone(),
                    model: r.model.clone(),
                    reason: String::new(),
                    position: 0,
                })
                .collect(),
        }
    }

    /// Move one waiting entry to the head. Most recent intent wins — no
    /// priority classes, just the user's hand.
    fn prioritize(&mut self, id: &str) -> bool {
        let Some(pos) = self.waiting.iter().position(|w| w.id == id) else {
            return false;
        };
        if pos == 0 {
            return true;
        }
        let entry = self.waiting.remove(pos);
        self.waiting.insert(0, entry);
        true
    }

    /// Mark a waiting entry cancelled; its waiter wakes and returns an error.
    /// A RUNNING id is a no-op: the local POST can't be aborted mid-generation
    /// (the frontend's run-orphaning is still the honest cancel there).
    fn cancel(&mut self, id: &str) -> bool {
        match self.waiting.iter_mut().find(|w| w.id == id) {
            Some(w) => {
                w.cancelled = true;
                true
            }
            None => false,
        }
    }
}

type Sink = Box<dyn Fn(serde_json::Value) + Send>;

/// The shared guardrail state. Held behind an `Arc` so a blocking chat worker
/// can own a clone for the whole generation.
#[derive(Default)]
pub struct Shared {
    inner: Mutex<Inner>,
    cv: Condvar,
    /// Installed once at app setup; `None` in tests so nothing is emitted.
    sink: Mutex<Option<Sink>>,
    /// Request ids asked to abort mid-flight. A streaming generation polls this
    /// between tokens and stops (dropping the connection frees the model slot);
    /// a plain buffered call can't be interrupted, so this is a no-op for it.
    /// Populated by `cancel` (Stop), cleared when the streamer finishes.
    aborts: Mutex<std::collections::HashSet<String>>,
}

/// Tauri-managed handle (`Clone` so commands and workers share one queue).
#[derive(Clone, Default)]
pub struct ComputeState(pub Arc<Shared>);

/// Held for the life of one admitted local request; releasing it on drop is
/// what makes an early return, an error, or a panic all free the slot.
pub(crate) struct Ticket {
    shared: Arc<Shared>,
    id: String,
}

/// Hand-written (the shared state holds a boxed event sink, which isn't
/// `Debug`) so `acquire(..).unwrap_err()` reads well in tests and logs.
impl std::fmt::Debug for Ticket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Ticket").field("id", &self.id).finish()
    }
}

impl Drop for Ticket {
    fn drop(&mut self) {
        self.shared.release(&self.id);
    }
}

impl Shared {
    pub(crate) fn install_sink(&self, sink: Sink) {
        if let Ok(mut slot) = self.sink.lock() {
            *slot = Some(sink);
        }
    }

    pub fn snapshot(&self) -> QueueSnapshot {
        self.inner.lock().map(|g| g.snapshot()).unwrap_or_default()
    }

    /// Emit while holding `inner` — the sink only forwards to the webview and
    /// never re-enters this module, so there is no lock cycle.
    fn emit(&self, snap: &QueueSnapshot) {
        let Ok(slot) = self.sink.lock() else { return };
        if let Some(f) = slot.as_ref() {
            if let Ok(v) = serde_json::to_value(snap) {
                f(v);
            }
        }
    }

    fn release(&self, id: &str) {
        if let Ok(mut g) = self.inner.lock() {
            g.running.retain(|r| r.id != id);
            let snap = g.snapshot();
            self.emit(&snap);
        }
        self.cv.notify_all();
    }

    pub(crate) fn prioritize(&self, id: &str) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|_| "compute queue lock poisoned".to_string())?;
        if !g.prioritize(id) {
            return Err("that message isn't waiting for compute anymore.".into());
        }
        let snap = g.snapshot();
        self.emit(&snap);
        drop(g);
        self.cv.notify_all();
        Ok(())
    }

    pub(crate) fn cancel(&self, id: &str) -> Result<(), String> {
        // Also flag a RUNNING streamer to abort: `Inner::cancel` only marks a
        // WAITING entry, but a streaming generation is already running — it
        // polls the abort set and stops (Stop, mid-stream).
        self.request_abort(id);
        let mut g = self.inner.lock().map_err(|_| "compute queue lock poisoned".to_string())?;
        g.cancel(id); // unknown / already-running id = no-op, never an error
        let snap = g.snapshot();
        self.emit(&snap);
        drop(g);
        self.cv.notify_all();
        Ok(())
    }

    /// Flag a request for mid-stream abort (see `aborts`). Idempotent.
    pub(crate) fn request_abort(&self, id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.insert(id.to_string());
        }
    }

    /// Has this request been asked to abort? Polled between streamed tokens.
    pub(crate) fn is_aborted(&self, id: &str) -> bool {
        self.aborts.lock().map(|set| set.contains(id)).unwrap_or(false)
    }

    /// Clear a request's abort flag — the streamer calls this when it finishes
    /// (naturally or aborted) so the set never grows without bound.
    pub(crate) fn clear_abort(&self, id: &str) {
        if let Ok(mut set) = self.aborts.lock() {
            set.remove(id);
        }
    }

    /// Wait until this request may run, then hand back a `Ticket`. `read_mem`
    /// is injected so tests drive the Mac's answer instead of reading one; it
    /// is always called with the queue lock RELEASED (it shells out to sysctl).
    pub(crate) fn acquire(
        self: &Arc<Self>,
        id: &str,
        model: &str,
        footprint_mb: u64,
        knobs: &Knobs,
        read_mem: &dyn Fn() -> Option<Memory>,
    ) -> Result<Ticket, String> {
        {
            let mut g = self.inner.lock().map_err(|_| "compute queue lock poisoned".to_string())?;
            if g.waiting.iter().any(|w| w.id == id) || g.running.iter().any(|r| r.id == id) {
                return Err("that local request is already in flight.".into());
            }
            if g.waiting.len() >= knobs.queue_max {
                return Err(format!(
                    "{} local messages are already waiting for compute — let one finish or cancel one first.",
                    g.waiting.len()
                ));
            }
            g.waiting.push(Waiting {
                id: id.to_string(),
                model: model.to_string(),
                footprint_mb,
                reason: REASON_QUEUED,
                cancelled: false,
            });
            let snap = g.snapshot();
            self.emit(&snap);
        }

        let deadline = Instant::now() + knobs.wait;
        let mut mem = read_mem();
        let mut g = self.inner.lock().map_err(|_| "compute queue lock poisoned".to_string())?;
        loop {
            let Some(pos) = g.waiting.iter().position(|w| w.id == id) else {
                // dropped out from under us (a hard cancel) — treat as cancelled
                return Err(CANCELLED.into());
            };
            if g.waiting[pos].cancelled {
                g.waiting.remove(pos);
                let snap = g.snapshot();
                self.emit(&snap);
                return Err(CANCELLED.into());
            }
            // FIFO fairness: only the head is ever evaluated, so a cheap late
            // arrival can never jump a waiting one. Prioritize is the only
            // reorder, and it's the user's hand.
            let decision = if pos == 0 {
                decide(model, g.waiting[pos].footprint_mb, &g.running, mem, knobs)
            } else {
                Decision::Wait(REASON_AHEAD)
            };
            match decision {
                Decision::Admit => {
                    g.waiting.remove(pos);
                    g.running.push(Running { id: id.to_string(), model: model.to_string() });
                    let snap = g.snapshot();
                    self.emit(&snap);
                    return Ok(Ticket { shared: Arc::clone(self), id: id.to_string() });
                }
                Decision::Wait(reason) => {
                    if g.waiting[pos].reason != reason {
                        g.waiting[pos].reason = reason;
                        let snap = g.snapshot();
                        self.emit(&snap);
                    }
                }
            }
            let now = Instant::now();
            if now >= deadline {
                if let Some(p) = g.waiting.iter().position(|w| w.id == id) {
                    g.waiting.remove(p);
                }
                let snap = g.snapshot();
                self.emit(&snap);
                return Err(
                    "This local message waited for compute longer than expected and was let go — try again, or prioritize it next time.".into(),
                );
            }
            let slice = knobs.poll.min(deadline - now);
            let (next, _) = self
                .cv
                .wait_timeout(g, slice)
                .map_err(|_| "compute queue lock poisoned".to_string())?;
            drop(next);
            mem = read_mem();
            g = self.inner.lock().map_err(|_| "compute queue lock poisoned".to_string())?;
        }
    }
}

/// Admit one local request and hold the slot for the closure. Non-local
/// callers never reach here — remote lanes have provider-side capacity.
pub(crate) fn with_slot<T>(
    state: &ComputeState,
    id: &str,
    model: &str,
    knobs: &Knobs,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    // switched off ⇒ no queue, no registry read, no sysctl spawns at all: the
    // opt-out has to cost nothing, or it isn't really an opt-out
    if !knobs.enabled {
        return run();
    }
    let footprint = crate::localmodel::model_footprint_mb(model).unwrap_or(knobs.fallback_footprint_mb);
    let _ticket = state.0.acquire(id, model, footprint, knobs, &read_memory)?;
    run()
}

// ── commands ─────────────────────────────────────────────────────────────────

/// The live queue — the chat surface hydrates from this on mount, then follows
/// `rotli:local-queue`.
#[tauri::command]
pub fn local_queue_status(state: tauri::State<'_, ComputeState>) -> QueueSnapshot {
    state.0.snapshot()
}

/// Jump a queued local message to the front of the line (Seth's "but I can
/// prioritize it").
#[tauri::command]
pub fn local_queue_prioritize(
    state: tauri::State<'_, ComputeState>,
    request_id: String,
) -> Result<(), String> {
    state.0.prioritize(&request_id)
}

/// Take a queued local message back (Stop, or closing the chat). A message
/// that's already generating is unaffected — the frontend orphans that run.
#[tauri::command]
pub fn local_queue_cancel(
    state: tauri::State<'_, ComputeState>,
    request_id: String,
) -> Result<(), String> {
    state.0.cancel(&request_id)
}

// ─── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mem(total_gb: f64, pct: f64, pressure: Pressure) -> Memory {
        Memory { total_mb: total_gb * 1024.0, available_pct: pct, pressure }
    }
    fn running(model: &str) -> Running {
        Running { id: format!("r-{model}"), model: model.to_string() }
    }

    // ── the admission rule ───────────────────────────────────────────────────

    #[test]
    fn an_idle_mac_with_room_admits() {
        let k = Knobs::default();
        // 64 GB at 52% available, an 8 GB model: cost ≈ 13.4 pts, leaves ≈ 38.6
        let d = decide("gemma", 8192, &[], Some(mem(64.0, 52.0, Pressure::Normal)), &k);
        assert_eq!(d, Decision::Admit);
    }

    #[test]
    fn a_small_mac_queues_the_same_model_instead_of_thrashing() {
        let k = Knobs::default();
        // 16 GB at 45%: an 8 GB model costs ≈ 55 pts — nowhere near 20% reserve
        let d = decide("gemma", 8192, &[], Some(mem(16.0, 45.0, Pressure::Normal)), &k);
        assert_eq!(d, Decision::Wait(REASON_HEADROOM));
    }

    #[test]
    fn a_second_turn_on_a_resident_model_pays_only_the_overhead() {
        let k = Knobs::default();
        let m = mem(16.0, 30.0, Pressure::Normal);
        // cold: 8 GB + 768 MB on 16 GB = ~55 pts ⇒ no
        assert_eq!(decide("gemma", 8192, &[], Some(m), &k), Decision::Wait(REASON_HEADROOM));
        // warm: the weights are already loaded, so only 768 MB ⇒ ~4.7 pts ⇒ yes
        assert_eq!(decide("gemma", 8192, &[running("gemma")], Some(m), &k), Decision::Admit);
    }

    #[test]
    fn a_different_model_waits_for_the_single_slot_however_free_the_mac_is() {
        let k = Knobs::default();
        let roomy = mem(512.0, 99.0, Pressure::Normal);
        assert_eq!(
            decide("qwen", 1, &[running("gemma")], Some(roomy), &k),
            Decision::Wait(REASON_OTHER_MODEL)
        );
    }

    #[test]
    fn exactly_at_the_reserve_line_admits_and_one_mb_more_does_not() {
        let k = Knobs::default(); // reserve 20%, overhead 768 MB
        // 100 GB total ⇒ 1 pt = 1024 MB. Pick availability so the sums are exact.
        let total_mb = 102_400.0;
        let footprint = 10_240 - DEFAULT_OVERHEAD_MB; // marginal = exactly 10 GB = 10 pts
        let at = Memory { total_mb, available_pct: 30.0, pressure: Pressure::Normal };
        assert_eq!(decide("m", footprint, &[], Some(at), &k), Decision::Admit);

        let below = Memory { available_pct: 30.0 - 0.001, ..at };
        assert_eq!(decide("m", footprint, &[], Some(below), &k), Decision::Wait(REASON_HEADROOM));
    }

    #[test]
    fn warn_pressure_doubles_the_reserve_and_critical_always_waits() {
        let k = Knobs::default();
        // 35% available, ~5 pt cost: clears 20% but not the doubled 40%
        let m = |p| mem(100.0, 35.0, p);
        assert_eq!(decide("m", 4096, &[], Some(m(Pressure::Normal)), &k), Decision::Admit);
        assert_eq!(
            decide("m", 4096, &[], Some(m(Pressure::Warn)), &k),
            Decision::Wait(REASON_HEADROOM)
        );
        // critical refuses even a free machine
        assert_eq!(
            decide("m", 1, &[], Some(mem(512.0, 99.0, Pressure::Critical)), &k),
            Decision::Wait(REASON_PRESSURE)
        );
    }

    #[test]
    fn an_unmeasurable_mac_serializes_rather_than_failing_open() {
        let k = Knobs::default();
        assert_eq!(decide("m", 8192, &[], None, &k), Decision::Admit); // nothing running
        assert_eq!(
            decide("m", 8192, &[running("m")], None, &k),
            Decision::Wait(REASON_UNMEASURED) // one at a time, and it says why
        );
    }

    #[test]
    fn the_master_switch_admits_everything() {
        let k = Knobs { enabled: false, ..Knobs::default() };
        let starved = mem(8.0, 1.0, Pressure::Critical);
        assert_eq!(decide("m", 64_000, &[running("other")], Some(starved), &k), Decision::Admit);
    }

    // ── knobs ────────────────────────────────────────────────────────────────

    #[test]
    fn knobs_default_when_absent_and_when_nonsense() {
        assert_eq!(parse_knobs("{}"), Knobs::default());
        assert_eq!(parse_knobs("not json"), Knobs::default());
        // out of range / wrong type / non-finite are all refused
        let junk = r#"{"localMinFreePercent":-5,"localQueueMax":0,"localRequestOverheadMB":"lots","localQueuePollMs":1}"#;
        assert_eq!(parse_knobs(junk), Knobs::default());
    }

    #[test]
    fn knobs_are_adopted_when_sane() {
        let k = parse_knobs(
            r#"{"localComputeGuardrails":false,"localMinFreePercent":35,"localQueueMax":3,
                "localRequestOverheadMB":1024,"localModelFootprintMB":4096,
                "localWarnReserveMultiplier":1.5,"localQueueWaitSecs":30,"localQueuePollMs":200}"#,
        );
        assert!(!k.enabled);
        assert_eq!(k.min_free_pct, 35.0);
        assert_eq!(k.queue_max, 3);
        assert_eq!(k.overhead_mb, 1024);
        assert_eq!(k.fallback_footprint_mb, 4096);
        assert_eq!(k.warn_multiplier, 1.5);
        assert_eq!(k.wait, Duration::from_secs(30));
        assert_eq!(k.poll, Duration::from_millis(200));
    }

    // ── queue ordering ───────────────────────────────────────────────────────

    fn seed(ids: &[&str]) -> Inner {
        Inner {
            waiting: ids
                .iter()
                .map(|id| Waiting {
                    id: (*id).to_string(),
                    model: "m".into(),
                    footprint_mb: 1,
                    reason: REASON_QUEUED,
                    cancelled: false,
                })
                .collect(),
            running: Vec::new(),
        }
    }
    fn order(inner: &Inner) -> Vec<String> {
        inner.waiting.iter().map(|w| w.id.clone()).collect()
    }

    #[test]
    fn the_queue_is_fifo_and_positions_are_reported() {
        let inner = seed(&["a", "b", "c"]);
        assert_eq!(order(&inner), ["a", "b", "c"]);
        let snap = inner.snapshot();
        assert_eq!(snap.waiting.iter().map(|e| e.position).collect::<Vec<_>>(), [0, 1, 2]);
        assert_eq!(snap.waiting[0].reason, REASON_QUEUED);
        assert!(snap.running.is_empty());
    }

    #[test]
    fn prioritize_jumps_to_the_front_and_the_most_recent_intent_wins() {
        let mut inner = seed(&["a", "b", "c"]);
        assert!(inner.prioritize("c"));
        assert_eq!(order(&inner), ["c", "a", "b"]);
        // the rest keep their relative order; prioritizing again re-heads
        assert!(inner.prioritize("b"));
        assert_eq!(order(&inner), ["b", "c", "a"]);
        // already at the head is a no-op success
        assert!(inner.prioritize("b"));
        assert_eq!(order(&inner), ["b", "c", "a"]);
        // an unknown id is refused, order untouched
        assert!(!inner.prioritize("zzz"));
        assert_eq!(order(&inner), ["b", "c", "a"]);
    }

    #[test]
    fn cancel_marks_a_waiter_and_leaves_a_running_request_alone() {
        let mut inner = seed(&["a", "b"]);
        inner.running.push(running("m"));
        assert!(inner.cancel("b"));
        assert!(inner.waiting.iter().find(|w| w.id == "b").unwrap().cancelled);
        assert!(!inner.waiting.iter().find(|w| w.id == "a").unwrap().cancelled);
        // a running id (and an unknown one) is a no-op, never an error
        assert!(!inner.cancel("r-m"));
        assert!(!inner.cancel("nope"));
        assert_eq!(inner.running.len(), 1);
    }

    // ── acquire / release / cancel end to end ────────────────────────────────

    fn fast_knobs() -> Knobs {
        Knobs { poll: Duration::from_millis(5), wait: Duration::from_secs(5), ..Knobs::default() }
    }
    fn roomy() -> Option<Memory> {
        Some(mem(512.0, 90.0, Pressure::Normal))
    }
    /// Wait (bounded) until `f` holds — the only synchronization the threaded
    /// tests need; nothing here reads a real memory stat.
    fn until(shared: &Arc<Shared>, f: impl Fn(&QueueSnapshot) -> bool) -> QueueSnapshot {
        for _ in 0..400 {
            let snap = shared.snapshot();
            if f(&snap) {
                return snap;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        panic!("queue never reached the expected state: {:?}", shared.snapshot());
    }

    #[test]
    fn a_free_mac_admits_immediately_and_the_ticket_frees_the_slot() {
        let shared = Arc::new(Shared::default());
        let k = fast_knobs();
        let ticket = shared.acquire("one", "gemma", 8192, &k, &roomy).unwrap();
        assert_eq!(shared.snapshot().running.len(), 1);
        assert!(shared.snapshot().waiting.is_empty());
        drop(ticket);
        assert!(shared.snapshot().running.is_empty());
    }

    #[test]
    fn a_queue_full_arrival_is_refused_honestly_instead_of_waiting_forever() {
        let shared = Arc::new(Shared::default());
        let k = Knobs { queue_max: 1, ..fast_knobs() };
        // park one waiter (a different model is generating ⇒ it can never admit)
        let held = shared.acquire("run", "gemma", 1, &k, &roomy).unwrap();
        let bg = {
            let s = Arc::clone(&shared);
            std::thread::spawn(move || s.acquire("wait", "qwen", 1, &k, &roomy).map(|_| ()))
        };
        until(&shared, |s| s.waiting.len() == 1);
        let err = shared.acquire("third", "qwen", 1, &k, &roomy).unwrap_err();
        assert!(err.contains("already waiting for compute"), "{err}");

        shared.cancel("wait").unwrap();
        assert!(bg.join().unwrap().is_err());
        drop(held);
    }

    #[test]
    fn a_queued_request_can_be_cancelled_and_says_so() {
        let shared = Arc::new(Shared::default());
        let k = fast_knobs();
        let held = shared.acquire("run", "gemma", 1, &k, &roomy).unwrap();
        let bg = {
            let s = Arc::clone(&shared);
            std::thread::spawn(move || s.acquire("wait", "qwen", 1, &k, &roomy).map(|_| ()))
        };
        let snap = until(&shared, |s| s.waiting.len() == 1);
        assert_eq!(snap.waiting[0].reason, REASON_OTHER_MODEL);

        shared.cancel("wait").unwrap();
        let err = bg.join().unwrap().unwrap_err();
        assert!(err.contains("cancelled"), "{err}");
        assert!(shared.snapshot().waiting.is_empty());
        drop(held);
    }

    #[test]
    fn releasing_the_slot_lets_the_queued_request_through() {
        let shared = Arc::new(Shared::default());
        let k = fast_knobs();
        let held = shared.acquire("run", "gemma", 1, &k, &roomy).unwrap();
        let bg = {
            let s = Arc::clone(&shared);
            std::thread::spawn(move || {
                let t = s.acquire("wait", "qwen", 1, &k, &roomy)?;
                Ok::<_, String>(t)
            })
        };
        until(&shared, |s| s.waiting.len() == 1);
        drop(held); // the slot frees ⇒ the waiter re-evaluates and admits
        let ticket = bg.join().unwrap().unwrap();
        assert_eq!(shared.snapshot().running[0].request_id, "wait");
        drop(ticket);
    }

    #[test]
    fn prioritize_reorders_who_gets_the_freed_slot() {
        let shared = Arc::new(Shared::default());
        let k = fast_knobs();
        let held = shared.acquire("run", "gemma", 1, &k, &roomy).unwrap();
        let spawn_wait = |id: &'static str| {
            let s = Arc::clone(&shared);
            std::thread::spawn(move || s.acquire(id, "qwen", 1, &k, &roomy))
        };
        let first = spawn_wait("first");
        until(&shared, |s| s.waiting.len() == 1);
        let second = spawn_wait("second");
        let snap = until(&shared, |s| s.waiting.len() == 2);
        assert_eq!(snap.waiting[0].request_id, "first"); // FIFO by arrival
        assert_eq!(snap.waiting[1].reason, REASON_AHEAD); // and it knows why

        shared.prioritize("second").unwrap();
        let snap = until(&shared, |s| s.waiting.first().is_some_and(|w| w.request_id == "second"));
        assert_eq!(snap.waiting[1].request_id, "first");

        drop(held);
        let ticket = second.join().unwrap().unwrap();
        assert_eq!(shared.snapshot().running[0].request_id, "second");
        drop(ticket);
        assert!(first.join().unwrap().is_ok()); // and the other still runs, after
    }

    #[test]
    fn a_duplicate_request_id_is_refused() {
        let shared = Arc::new(Shared::default());
        let k = fast_knobs();
        let _t = shared.acquire("dup", "gemma", 1, &k, &roomy).unwrap();
        let err = shared.acquire("dup", "gemma", 1, &k, &roomy).unwrap_err();
        assert!(err.contains("already in flight"), "{err}");
    }

    #[test]
    fn a_waiter_that_never_fits_gives_up_honestly() {
        let shared = Arc::new(Shared::default());
        let k = Knobs { wait: Duration::from_millis(40), ..fast_knobs() };
        let held = shared.acquire("run", "gemma", 1, &k, &roomy).unwrap();
        let err = shared.acquire("wait", "qwen", 1, &k, &roomy).unwrap_err();
        assert!(err.contains("waited for compute longer than expected"), "{err}");
        assert!(shared.snapshot().waiting.is_empty()); // and it left no ghost
        drop(held);
    }
}
