//! What each connected client offers RIGHT NOW — the model list the user would
//! see in that client's own model picker, read from the client itself so Rotli
//! never has to ship a release when a provider adds a model.
//!
//! Sources, none of which sends a prompt or spends a token:
//! - Claude Code: the Agent SDK `initialize` control request, spawned with the
//!   chat lane's own isolation (`-p --safe-mode --tools ""`, no session
//!   persistence) — its reply carries the signed-in account's `/model` list.
//! - Codex: the client's own `models_cache.json` (read, never spawned).
//! - Cursor: `agent models`.
//! - Antigravity: the ACP `session/new` result's `model` config option — the
//!   same list a chat turn re-validates against, without a `session/prompt`.
//!
//! Everything a client reports is UNTRUSTED data: ids must match a strict
//! shape (no leading dash → never a flag, no spaces, bounded length), reasoning
//! efforts are intersected with a fixed vocabulary (codex splices one into a
//! quoted `-c` value), labels lose control/format characters and are capped.
//! The allowlist stays fail-closed: an id reaches argv only when it is in the
//! static `CliSpec.models` or was reported by the client itself — the webview
//! can name an id, never add one.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::provider::{self, acp};

/// How long a successful discovery is reused before the next ask re-reads.
const FRESH_FOR: Duration = Duration::from_secs(5 * 60);
/// How long a failed discovery is remembered, so a lane that can't list
/// models is not re-spawned on every allowlist miss.
const FAILED_FOR: Duration = Duration::from_secs(60);
/// A spawned client gets this long to answer before it is killed.
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(20);
/// Output read from a client (or its cache file) is capped here.
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024;
const MAX_CODEX_CACHE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_MODELS: usize = 500;
const MAX_LABEL_CHARS: usize = 80;

/// Every reasoning effort Rotli can express. A client-reported effort outside
/// this set is dropped, so no reported string ever becomes argv verbatim.
pub(crate) const EFFORTS: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/// Claude's "use the account's default" entry — like `cursor-auto`, it runs
/// with no `--model` flag at all.
pub(crate) const CLAUDE_DEFAULT_ID: &str = "default";
pub(crate) const CURSOR_AUTO_ID: &str = "cursor-auto";

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    pub id: String,
    pub label: String,
    /// The reasoning efforts the client reported for this model (vocabulary-
    /// filtered). Empty = the model takes no effort control.
    pub efforts: Vec<String>,
    /// Codex: the model offers the Fast service tier.
    pub fast_tier: bool,
    pub vision: bool,
    /// The client's own default entry.
    pub is_default: bool,
}

/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,95}(\[1m\])?$` — the only id shape that may
/// reach argv, whatever reported it.
pub(crate) fn valid_model_id(id: &str) -> bool {
    let base = id.strip_suffix("[1m]").unwrap_or(id);
    let mut chars = base.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
        && base.len() <= 96
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// May a client-reported id run on this lane: the strict shape, and not an id
/// another lane owns. Cursor also lists vendor models (`gpt-5.5`,
/// `gemini-3.8-flash-high`); those stay with the vendor's own lane, so a saved
/// Codex or Antigravity chat can never be routed through Cursor.
pub(crate) fn reportable_id(provider: &str, id: &str) -> bool {
    valid_model_id(id) && !provider::CLIS.iter().any(|other| other.id != provider && other.models.contains(&id))
}

/// The reasoning-effort policy for one model: what the client reported for
/// it, else the reviewed rules for the static ids. Never outside `EFFORTS`.
pub(crate) fn effort_allowed(provider: &str, model: &str, effort: &str, found: Option<&DiscoveredModel>) -> bool {
    if !EFFORTS.contains(&effort) {
        return false;
    }
    if let Some(entry) = found {
        return entry.efforts.iter().any(|e| e == effort);
    }
    let upto_max = matches!(effort, "low" | "medium" | "high" | "xhigh" | "max");
    match (provider, model) {
        ("claude", "haiku") => false,
        ("claude", _) => upto_max,
        ("codex", "gpt-6-astra" | "gpt-6-sol" | "gpt-5.6-sol" | "gpt-5.6-terra") => upto_max || effort == "ultra",
        ("codex", "gpt-6-luna" | "gpt-5.6-luna") => upto_max,
        ("codex", _) => matches!(effort, "low" | "medium" | "high" | "xhigh"),
        _ => false,
    }
}

/// Codex's Fast tier: as the client reported it, else the static families.
pub(crate) fn fast_tier_allowed(provider: &str, model: &str, found: Option<&DiscoveredModel>) -> bool {
    provider == "codex"
        && found.map_or(model.starts_with("gpt-5.6-") || model.starts_with("gpt-6-"), |m| m.fast_tier)
}

/// A label fit for a picker row: no control or invisible format characters
/// (cursor pads some with U+200B), single spaces, bounded length.
pub(crate) fn clean_label(raw: &str, fallback: &str) -> String {
    let visible: String = raw
        .chars()
        .filter(|c| !c.is_control() && !is_format_char(*c))
        .collect();
    let words = visible.split_whitespace().collect::<Vec<_>>().join(" ");
    let label: String = words.chars().take(MAX_LABEL_CHARS).collect();
    if label.is_empty() {
        fallback.to_string()
    } else {
        label
    }
}

fn is_format_char(c: char) -> bool {
    matches!(c as u32, 0x00AD | 0x200B..=0x200F | 0x2028..=0x202E | 0x2060..=0x206F | 0xFEFF)
}

fn known_efforts<'a>(reported: impl Iterator<Item = &'a str>) -> Vec<String> {
    let reported: Vec<&str> = reported.collect();
    EFFORTS
        .iter()
        .filter(|effort| reported.contains(effort))
        .map(|effort| effort.to_string())
        .collect()
}

/// Keep the first entry per id, drop malformed ids, cap the list.
fn finish(models: Vec<DiscoveredModel>) -> Result<Vec<DiscoveredModel>, String> {
    let mut seen = std::collections::HashSet::new();
    let out: Vec<DiscoveredModel> = models
        .into_iter()
        .filter(|m| valid_model_id(&m.id) && seen.insert(m.id.clone()))
        .take(MAX_MODELS)
        .collect();
    if out.is_empty() {
        Err("the client reported no models".into())
    } else {
        Ok(out)
    }
}

// ── parsers (pure) ────────────────────────────────────────────────────────────

/// "Opus 5.5 with 1M context · Best for…" → "Claude Opus 5.5 (1M context)";
/// the default entry reads "Claude Default · Opus 5.5 (1M context)".
pub(crate) fn claude_label(value: &str, display_name: &str, description: &str) -> String {
    let head = description.split(" · ").next().unwrap_or_default().trim();
    let head = if head.is_empty() { display_name.trim() } else { head };
    let head = match head.split_once(" with ") {
        Some((name, extra)) => format!("{name} ({extra})"),
        None => head.to_string(),
    };
    let named = if head.starts_with("Claude") { head } else { format!("Claude {head}") };
    let label = if value == CLAUDE_DEFAULT_ID {
        format!("Claude Default · {}", named.trim_start_matches("Claude ").trim())
    } else {
        named
    };
    clean_label(&label, value)
}

/// One stdout line from the claude discovery spawn. `Some` once the line is
/// the `control_response` to `request_id`; `None` for anything else.
pub(crate) fn parse_claude_initialize(
    line: &str,
    request_id: &str,
) -> Option<Result<Vec<DiscoveredModel>, String>> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("control_response") {
        return None;
    }
    let response = v.get("response")?;
    if response.get("request_id").and_then(|id| id.as_str()) != Some(request_id) {
        return None;
    }
    if response.get("subtype").and_then(|s| s.as_str()) == Some("error") {
        let message = response.get("error").and_then(|e| e.as_str()).unwrap_or("claude refused");
        return Some(Err(clean_label(message, "claude refused")));
    }
    let Some(list) = response.pointer("/response/models").and_then(|m| m.as_array()) else {
        return Some(Err("claude reported no model list".into()));
    };
    let text = |m: &serde_json::Value, key: &str| m.get(key).and_then(|s| s.as_str()).unwrap_or("").to_string();
    let models = list
        .iter()
        .map(|m| {
            let id = text(m, "value");
            let efforts = m
                .get("supportedEffortLevels")
                .and_then(|e| e.as_array())
                .map(|levels| known_efforts(levels.iter().filter_map(|l| l.as_str())))
                .unwrap_or_default();
            DiscoveredModel {
                label: claude_label(&id, &text(m, "displayName"), &text(m, "description")),
                is_default: id == CLAUDE_DEFAULT_ID,
                id,
                efforts,
                fast_tier: false,
                vision: true,
            }
        })
        .collect();
    Some(finish(models))
}

/// "GPT-6-Astra" → "GPT-6 Astra"; other names pass through cleaned.
pub(crate) fn codex_label(display_name: &str, slug: &str) -> String {
    let name = clean_label(display_name, slug);
    match name.strip_prefix("GPT-") {
        Some(rest) => {
            let mut parts = rest.split('-');
            let version = parts.next().unwrap_or_default();
            let tail: Vec<&str> = parts.filter(|p| !p.is_empty()).collect();
            if tail.is_empty() {
                name.clone()
            } else {
                format!("GPT-{version} {}", tail.join(" "))
            }
        }
        None => name,
    }
}

/// Codex's `models_cache.json`: the `visibility: "list"` entries (what its
/// own picker lists), in its `priority` order.
pub(crate) fn parse_codex_cache(json: &str) -> Result<Vec<DiscoveredModel>, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("codex model cache isn't JSON: {e}"))?;
    let list = v
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or("codex model cache has no model list")?;
    let mut listed: Vec<(i64, DiscoveredModel)> = list
        .iter()
        .filter(|m| m.get("visibility").and_then(|s| s.as_str()) == Some("list"))
        .filter_map(|m| {
            let slug = m.get("slug")?.as_str()?.to_string();
            let efforts = m
                .get("supported_reasoning_levels")
                .and_then(|l| l.as_array())
                .map(|levels| {
                    known_efforts(levels.iter().filter_map(|l| l.get("effort").and_then(|e| e.as_str())))
                })
                .unwrap_or_default();
            let has = |key: &str, want: &str| {
                m.get(key)
                    .and_then(|a| a.as_array())
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(want)))
            };
            let vision = m.get("input_modalities").is_none() || has("input_modalities", "image");
            let label = codex_label(m.get("display_name").and_then(|s| s.as_str()).unwrap_or(""), &slug);
            let priority = m.get("priority").and_then(|p| p.as_i64()).unwrap_or(i64::MAX);
            Some((
                priority,
                DiscoveredModel {
                    id: slug,
                    label,
                    efforts,
                    fast_tier: has("additional_speed_tiers", "fast"),
                    vision,
                    is_default: false,
                },
            ))
        })
        .collect();
    listed.sort_by_key(|(priority, _)| *priority);
    finish(listed.into_iter().map(|(_, m)| m).collect())
}

/// Strip ANSI escape sequences a terminal-minded CLI might still print.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// `agent models`: `<id> - <Label>` rows under "Available models". `auto` is
/// Rotli's stable `cursor-auto` (whose argv omits `--model`).
pub(crate) fn parse_cursor_models(text: &str) -> Result<Vec<DiscoveredModel>, String> {
    let models = text
        .lines()
        .map(strip_ansi)
        .filter_map(|line| {
            let (id, label) = line.trim().split_once(" - ")?;
            let id = id.trim();
            if !valid_model_id(id) {
                return None;
            }
            let (id, is_default) = if id == "auto" { (CURSOR_AUTO_ID, true) } else { (id, false) };
            Some(DiscoveredModel {
                id: id.to_string(),
                label: clean_label(label, id),
                efforts: Vec::new(),
                fast_tier: false,
                vision: false,
                is_default,
            })
        })
        .collect();
    finish(models)
}

/// The `model` config option of an ACP `session/new` result, with names.
pub(crate) fn parse_acp_session_models(session: &serde_json::Value) -> Result<Vec<DiscoveredModel>, String> {
    let (current, values) = acp::session_model_options(session);
    let mut names = HashMap::new();
    fn collect(entries: &serde_json::Value, names: &mut HashMap<String, String>) {
        for entry in entries.as_array().into_iter().flatten() {
            match (entry.get("value").and_then(|v| v.as_str()), entry.get("options")) {
                (Some(value), _) => {
                    let name = entry.get("name").and_then(|n| n.as_str()).unwrap_or(value);
                    names.insert(value.to_string(), name.to_string());
                }
                (None, Some(nested)) => collect(nested, names),
                _ => {}
            }
        }
    }
    if let Some(option) = session
        .get("configOptions")
        .and_then(|o| o.as_array())
        .and_then(|o| o.iter().find(|o| o.get("id").and_then(|i| i.as_str()) == Some("model")))
    {
        collect(option.get("options").unwrap_or(&serde_json::Value::Null), &mut names);
    }
    let models = values
        .into_iter()
        .map(|id| DiscoveredModel {
            label: clean_label(names.get(&id).map(String::as_str).unwrap_or(&id), &id),
            is_default: current.as_deref() == Some(id.as_str()),
            id,
            efforts: Vec::new(),
            fast_tier: false,
            vision: true,
        })
        .collect();
    finish(models)
}

// ── the cache ─────────────────────────────────────────────────────────────────

#[derive(Default)]
struct Lane {
    /// The last list the client reported. A failed refresh keeps it.
    models: Vec<DiscoveredModel>,
    fetched: Option<Instant>,
    failed: Option<(Instant, String)>,
}

/// One cache per process (the app, or `rotli-helper`), keyed by provider.
/// TTLs govern REFRESH only — a reported id is never evicted, so a chat turn
/// on a discovered model keeps working while the list is being re-read.
#[derive(Default)]
pub(crate) struct ModelCache {
    lanes: Mutex<HashMap<String, Lane>>,
    /// One discovery per provider at a time; a second asker waits and reuses.
    fetching: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

pub(crate) enum Freshness {
    Fresh(Vec<DiscoveredModel>),
    RecentlyFailed(Vec<DiscoveredModel>, String),
    Stale,
}

impl ModelCache {
    pub(crate) fn lookup(&self, provider: &str, id: &str) -> Option<DiscoveredModel> {
        let lanes = self.lanes.lock().unwrap();
        lanes.get(provider)?.models.iter().find(|m| m.id == id).cloned()
    }

    pub(crate) fn freshness(&self, provider: &str, now: Instant) -> Freshness {
        let lanes = self.lanes.lock().unwrap();
        let Some(lane) = lanes.get(provider) else { return Freshness::Stale };
        if let Some((at, error)) = &lane.failed {
            if now.duration_since(*at) < FAILED_FOR {
                return Freshness::RecentlyFailed(lane.models.clone(), error.clone());
            }
        }
        match lane.fetched {
            Some(at) if now.duration_since(at) < FRESH_FOR && lane.failed.is_none() => {
                Freshness::Fresh(lane.models.clone())
            }
            _ => Freshness::Stale,
        }
    }

    pub(crate) fn record(
        &self,
        provider: &str,
        result: Result<Vec<DiscoveredModel>, String>,
        now: Instant,
    ) -> Result<Vec<DiscoveredModel>, String> {
        let mut lanes = self.lanes.lock().unwrap();
        let lane = lanes.entry(provider.to_string()).or_default();
        match result {
            Ok(models) => {
                *lane = Lane { models: models.clone(), fetched: Some(now), failed: None };
                Ok(models)
            }
            Err(error) => {
                lane.failed = Some((now, error.clone()));
                if lane.models.is_empty() {
                    Err(error)
                } else {
                    Ok(lane.models.clone())
                }
            }
        }
    }

    /// The cached list when fresh (or recently failed), else `fetch` — once per
    /// provider at a time. `refresh` skips both TTLs, but a fetch that finished
    /// while this caller waited for the lock is reused rather than repeated.
    pub(crate) fn get_or_fetch(
        &self,
        provider: &str,
        refresh: bool,
        fetch: impl FnOnce() -> Result<Vec<DiscoveredModel>, String>,
    ) -> Result<Vec<DiscoveredModel>, String> {
        let lock = Arc::clone(self.fetching.lock().unwrap().entry(provider.to_string()).or_default());
        let asked = Instant::now();
        let _held = lock.lock().unwrap();
        if let Some(models) = self.fetched_since(provider, asked) {
            return Ok(models);
        }
        if !refresh {
            match self.freshness(provider, Instant::now()) {
                Freshness::Fresh(models) => return Ok(models),
                Freshness::RecentlyFailed(models, error) => {
                    return if models.is_empty() { Err(error) } else { Ok(models) };
                }
                Freshness::Stale => {}
            }
        }
        self.record(provider, fetch(), Instant::now())
    }

    fn fetched_since(&self, provider: &str, asked: Instant) -> Option<Vec<DiscoveredModel>> {
        let lanes = self.lanes.lock().unwrap();
        let lane = lanes.get(provider)?;
        (lane.failed.is_none() && lane.fetched.is_some_and(|at| at >= asked)).then(|| lane.models.clone())
    }
}

fn cache() -> &'static ModelCache {
    static CACHE: OnceLock<ModelCache> = OnceLock::new();
    CACHE.get_or_init(ModelCache::default)
}

/// The client-reported entry for `id`, from the cache only (no spawn).
pub(crate) fn lookup(provider: &str, id: &str) -> Option<DiscoveredModel> {
    cache().lookup(provider, id)
}

/// The client's current list (cached per the TTLs above).
pub(crate) fn discover(provider: &str, refresh: bool) -> Result<Vec<DiscoveredModel>, String> {
    provider::connected_provider_execution_allowed(provider)?;
    cache().get_or_fetch(provider, refresh, || fetch_models(provider))
}

/// Is `id` runnable on this lane: a static allowlist id, or a well-formed id
/// the client itself reported. A miss on a well-formed id asks the client
/// once (bounded, failure-cached) — so a relaunch or a helper restart does not
/// strand a chat whose model came from discovery.
pub(crate) fn ensure_allowed(provider: &str, id: &str) -> bool {
    let Ok(spec) = provider::spec(provider) else { return false };
    if spec.models.contains(&id) {
        return true;
    }
    if !reportable_id(provider, id) {
        return false;
    }
    if lookup(provider, id).is_some() {
        return true;
    }
    if cfg!(test) {
        return false; // unit tests never spawn a real client
    }
    discover(provider, false).is_ok_and(|models| models.iter().any(|m| m.id == id))
}

// ── the fetchers (effects) ────────────────────────────────────────────────────

#[path = "provider_models_fetch.rs"]
mod fetch;
use fetch::fetch_models;
#[cfg(test)]
pub(crate) use fetch::{read_codex_cache, CLAUDE_DISCOVERY_ARGS};

// ── the command ───────────────────────────────────────────────────────────────

/// Chat picker / Settings: the models this client offers right now. Blocking
/// discovery rides `spawn_blocking`; `rotli-helper` serves the same function.
#[tauri::command]
pub async fn cli_models(provider: String, refresh: Option<bool>) -> Result<Vec<DiscoveredModel>, String> {
    tauri::async_runtime::spawn_blocking(move || discover(&provider, refresh.unwrap_or(false)))
        .await
        .map_err(|e| format!("model discovery failed: {e}"))?
}

#[cfg(test)]
#[path = "provider_models_tests.rs"]
mod tests;
