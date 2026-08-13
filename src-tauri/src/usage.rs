//! Read-only model usage aggregation from provider-owned local transcripts.
//!
//! This is deliberately a narrow capability: the webview chooses one fixed
//! time window, while Rust owns the only directories that may be scanned. Raw
//! transcript text, file names, working directories, prompts, and responses
//! never cross IPC.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

const HOUR_MS: u64 = 60 * 60 * 1_000;
const DAY_MS: u64 = 24 * HOUR_MS;
const MTIME_SLACK_MS: u64 = 36 * HOUR_MS;
const MAX_JSONL_LINE_BYTES: usize = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_FILES: usize = 20_000;
const MAX_WALK_DEPTH: usize = 12;
const FORK_COPY_MAX_GAP_MS: u64 = 1_000;
const CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Clone, Copy)]
struct RangeConfig {
    id: &'static str,
    bucket_ms: u64,
    bucket_count: u64,
}

fn range_config(value: &str) -> Result<RangeConfig, String> {
    match value {
        "24h" => Ok(RangeConfig {
            id: "24h",
            bucket_ms: HOUR_MS,
            bucket_count: 24,
        }),
        "7d" => Ok(RangeConfig {
            id: "7d",
            bucket_ms: DAY_MS,
            bucket_count: 7,
        }),
        "30d" => Ok(RangeConfig {
            id: "30d",
            bucket_ms: DAY_MS,
            bucket_count: 30,
        }),
        "90d" => Ok(RangeConfig {
            id: "90d",
            bucket_ms: DAY_MS,
            bucket_count: 90,
        }),
        _ => Err("model usage range must be one of 24h, 7d, 30d, or 90d".into()),
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTokens {
    pub uncached_input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_creation_tokens: u64,
    pub output_tokens: u64,
    /// A subset of output tokens; never add it to `total_tokens`.
    pub reasoning_tokens: u64,
}

impl UsageTokens {
    fn total(&self) -> u64 {
        self.uncached_input_tokens
            .saturating_add(self.cached_input_tokens)
            .saturating_add(self.cache_creation_tokens)
            .saturating_add(self.output_tokens)
    }

    fn add(&mut self, other: &Self) {
        self.uncached_input_tokens = self
            .uncached_input_tokens
            .saturating_add(other.uncached_input_tokens);
        self.cached_input_tokens = self
            .cached_input_tokens
            .saturating_add(other.cached_input_tokens);
        self.cache_creation_tokens = self
            .cache_creation_tokens
            .saturating_add(other.cache_creation_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.reasoning_tokens = self.reasoning_tokens.saturating_add(other.reasoning_tokens);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageBucket {
    pub bucket_start_ms: u64,
    pub provider: String,
    pub model: String,
    pub tokens: UsageTokens,
    pub responses: u64,
    pub sessions: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageTotal {
    pub provider: String,
    pub model: String,
    pub tokens: UsageTokens,
    pub responses: u64,
    pub sessions: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageSource {
    pub provider: String,
    pub status: String,
    pub scanned_files: u64,
    pub skipped_files: u64,
    pub malformed_records: u64,
    pub message: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageSummary {
    pub range: String,
    pub read_at_ms: u64,
    pub since_ms: u64,
    pub until_ms: u64,
    pub bucket_ms: u64,
    pub total_sessions: u64,
    pub buckets: Vec<ModelUsageBucket>,
    pub models: Vec<ModelUsageTotal>,
    pub sources: Vec<ModelUsageSource>,
}

#[derive(Clone)]
struct UsageRecord {
    provider: &'static str,
    timestamp_ms: u64,
    model: String,
    session_id: String,
    tokens: UsageTokens,
    dedupe_key: Option<String>,
}

#[derive(Default)]
struct MutableBucket {
    tokens: UsageTokens,
    responses: u64,
    sessions: HashSet<String>,
}

#[derive(Default)]
struct SourceCounters {
    scanned_files: u64,
    skipped_files: u64,
    malformed_records: u64,
    read_failures: u64,
    capped: bool,
}

#[derive(Clone, Default)]
struct CodexState {
    model: String,
    session_id: String,
    last_usage_signature: Option<String>,
    saw_session_meta: bool,
    suppressing_fork_copies: bool,
    fork_copy_anchor_ms: u64,
}

#[derive(Clone)]
struct CacheEntry {
    read_at: Instant,
    summary: ModelUsageSummary,
}

#[derive(Clone)]
struct UsageFile {
    path: PathBuf,
    modified_at: Option<SystemTime>,
    len: u64,
}

#[derive(Clone)]
struct ParsedFileEntry {
    provider: &'static str,
    modified_at: Option<SystemTime>,
    len: u64,
    ended_with_newline: bool,
    malformed_records: u64,
    codex_state: CodexState,
    records: Arc<Vec<UsageRecord>>,
}

static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
static FILE_CACHE: OnceLock<Mutex<HashMap<PathBuf, ParsedFileEntry>>> = OnceLock::new();
static SCAN_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

fn provider_roots(home: &Path) -> [(&'static str, PathBuf); 2] {
    [
        ("claude", home.join(".claude/projects")),
        ("codex", home.join(".codex/sessions")),
    ]
}

#[tauri::command]
pub async fn model_usage(
    range: String,
    refresh: Option<bool>,
) -> Result<ModelUsageSummary, String> {
    let cfg = range_config(&range)?;
    if refresh != Some(true) {
        if let Some(entry) = CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "model usage cache is unavailable".to_string())?
            .get(cfg.id)
            .filter(|entry| entry.read_at.elapsed() < CACHE_TTL)
            .cloned()
        {
            return Ok(entry.summary);
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        // Range changes can arrive while a scan is still running. Serialize
        // them so the second request can reuse parsed, unchanged files rather
        // than putting two multi-gigabyte transcript reads on disk at once.
        let _scan = SCAN_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "model usage scanner is unavailable".to_string())?;

        if refresh != Some(true) {
            if let Some(entry) = CACHE
                .get_or_init(|| Mutex::new(HashMap::new()))
                .lock()
                .map_err(|_| "model usage cache is unavailable".to_string())?
                .get(cfg.id)
                .filter(|entry| entry.read_at.elapsed() < CACHE_TTL)
                .cloned()
            {
                return Ok(entry.summary);
            }
        }

        let home = std::env::var_os("HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .ok_or_else(|| "the local account home could not be resolved".to_string())?;
        let summary = scan_usage(&provider_roots(&home), cfg, now_ms())?;
        CACHE
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "model usage cache is unavailable".to_string())?
            .insert(
                cfg.id.to_string(),
                CacheEntry {
                    read_at: Instant::now(),
                    summary: summary.clone(),
                },
            );
        Ok(summary)
    })
    .await
    .map_err(|error| format!("model usage scan failed: {error}"))?
}

fn scan_usage(
    roots: &[(&'static str, PathBuf)],
    cfg: RangeConfig,
    read_at_ms: u64,
) -> Result<ModelUsageSummary, String> {
    let until_ms = read_at_ms;
    let since_ms = until_ms.saturating_sub(cfg.bucket_ms.saturating_mul(cfg.bucket_count));
    let mtime_floor_ms = since_ms.saturating_sub(MTIME_SLACK_MS);
    let mut buckets: BTreeMap<(u64, String, String), MutableBucket> = BTreeMap::new();
    let mut models: BTreeMap<(String, String), MutableBucket> = BTreeMap::new();
    let mut seen_claude = HashSet::new();
    let mut all_sessions = HashSet::new();
    let mut sources = Vec::with_capacity(roots.len());

    for (provider, root) in roots {
        if !root.is_dir() {
            sources.push(ModelUsageSource {
                provider: (*provider).into(),
                status: "missing".into(),
                scanned_files: 0,
                skipped_files: 0,
                malformed_records: 0,
                message: Some("No local session history was found for this provider.".into()),
            });
            continue;
        }

        let mut counters = SourceCounters::default();
        let mut files = Vec::new();
        collect_jsonl(root, 0, mtime_floor_ms, &mut files, &mut counters);
        for file in files {
            let records = match cached_file_records(&file, provider, &mut counters) {
                Ok((records, _)) => records,
                Err(()) => {
                    counters.read_failures = counters.read_failures.saturating_add(1);
                    continue;
                }
            };
            counters.scanned_files = counters.scanned_files.saturating_add(1);
            for record in records.iter() {
                if record.timestamp_ms < since_ms || record.timestamp_ms >= until_ms {
                    continue;
                }
                if let Some(key) = &record.dedupe_key {
                    if !seen_claude.insert(key.clone()) {
                        continue;
                    }
                }
                let bucket_start_ms =
                    since_ms + ((record.timestamp_ms - since_ms) / cfg.bucket_ms) * cfg.bucket_ms;
                let key = (
                    bucket_start_ms,
                    record.provider.into(),
                    record.model.clone(),
                );
                let bucket = buckets.entry(key).or_default();
                bucket.tokens.add(&record.tokens);
                bucket.responses = bucket.responses.saturating_add(1);
                if !record.session_id.is_empty() {
                    all_sessions.insert(format!("{}:{}", record.provider, record.session_id));
                    bucket.sessions.insert(record.session_id.clone());
                }
                let total = models
                    .entry((record.provider.into(), record.model.clone()))
                    .or_default();
                total.tokens.add(&record.tokens);
                total.responses = total.responses.saturating_add(1);
                if !record.session_id.is_empty() {
                    total.sessions.insert(record.session_id.clone());
                }
            }
        }

        let partial =
            counters.read_failures > 0 || counters.malformed_records > 0 || counters.capped;
        sources.push(ModelUsageSource {
            provider: (*provider).into(),
            status: if partial { "partial" } else { "ok" }.into(),
            scanned_files: counters.scanned_files,
            skipped_files: counters.skipped_files,
            malformed_records: counters.malformed_records,
            message: if counters.capped {
                Some("The safety file limit was reached; totals are partial.".into())
            } else if counters.read_failures > 0 {
                Some("Some changing or unreadable session files were skipped.".into())
            } else if counters.malformed_records > 0 {
                Some("Some incomplete or malformed session records were skipped.".into())
            } else {
                None
            },
        });
    }

    let buckets = buckets
        .into_iter()
        .map(
            |((bucket_start_ms, provider, model), bucket)| ModelUsageBucket {
                bucket_start_ms,
                provider,
                model,
                tokens: bucket.tokens,
                responses: bucket.responses,
                sessions: bucket.sessions.len() as u64,
            },
        )
        .collect();
    let models = models
        .into_iter()
        .map(|((provider, model), total)| ModelUsageTotal {
            provider,
            model,
            tokens: total.tokens,
            responses: total.responses,
            sessions: total.sessions.len() as u64,
        })
        .collect();

    Ok(ModelUsageSummary {
        range: cfg.id.into(),
        read_at_ms,
        since_ms,
        until_ms,
        bucket_ms: cfg.bucket_ms,
        total_sessions: all_sessions.len() as u64,
        buckets,
        models,
        sources,
    })
}

fn collect_jsonl(
    dir: &Path,
    depth: usize,
    mtime_floor_ms: u64,
    out: &mut Vec<UsageFile>,
    counters: &mut SourceCounters,
) {
    if depth > MAX_WALK_DEPTH || counters.capped {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        counters.read_failures = counters.read_failures.saturating_add(1);
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= MAX_TRANSCRIPT_FILES {
            counters.capped = true;
            return;
        }
        let Ok(file_type) = entry.file_type() else {
            counters.skipped_files = counters.skipped_files.saturating_add(1);
            continue;
        };
        if file_type.is_dir() {
            collect_jsonl(&entry.path(), depth + 1, mtime_floor_ms, out, counters);
            continue;
        }
        if !file_type.is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("jsonl")
        {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            counters.skipped_files = counters.skipped_files.saturating_add(1);
            continue;
        };
        let modified_at = metadata.modified().ok();
        let modified_ms = modified_at
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or(0);
        if modified_ms >= mtime_floor_ms {
            out.push(UsageFile {
                path: entry.path(),
                modified_at,
                len: metadata.len(),
            });
        } else {
            counters.skipped_files = counters.skipped_files.saturating_add(1);
        }
    }
}

fn cached_file_records(
    file: &UsageFile,
    provider: &'static str,
    counters: &mut SourceCounters,
) -> Result<(Arc<Vec<UsageRecord>>, u64), ()> {
    let cached = FILE_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| ())?
        .get(&file.path)
        .filter(|entry| entry.provider == provider)
        .cloned();

    if let Some(entry) = &cached {
        if file.modified_at.is_some()
            && entry.len == file.len
            && entry.modified_at == file.modified_at
        {
            counters.malformed_records = counters
                .malformed_records
                .saturating_add(entry.malformed_records);
            return Ok((entry.records.clone(), 0));
        }
    }

    // Provider histories are append-only. Preserve the parser state and read
    // only the appended tail when the cached prefix ended at a complete JSONL
    // record. Truncation, same-length rewrites, and partial final lines fail
    // safely into a full reparse.
    let append_base = cached.filter(|entry| {
        let monotonic_mtime = matches!(
            (entry.modified_at, file.modified_at),
            (Some(previous), Some(current)) if previous <= current
        );
        entry.ended_with_newline && monotonic_mtime && entry.len < file.len
    });
    let (offset, mut records, mut codex_state, prior_malformed) = append_base
        .map(|entry| {
            (
                entry.len,
                entry.records.as_ref().clone(),
                entry.codex_state,
                entry.malformed_records,
            )
        })
        .unwrap_or_else(|| (0, Vec::new(), CodexState::default(), 0));
    let mut parsed = SourceCounters::default();
    let ended_with_newline = scan_file_segment(
        &file.path,
        provider,
        offset,
        file.len.saturating_sub(offset),
        &mut codex_state,
        &mut parsed,
        |record| records.push(record),
    )?;
    let malformed_records = prior_malformed.saturating_add(parsed.malformed_records);
    counters.malformed_records = counters.malformed_records.saturating_add(malformed_records);

    let records = Arc::new(records);
    FILE_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| ())?
        .insert(
            file.path.clone(),
            ParsedFileEntry {
                provider,
                modified_at: file.modified_at,
                len: file.len,
                ended_with_newline,
                malformed_records,
                codex_state,
                records: Arc::clone(&records),
            },
        );
    Ok((records, file.len.saturating_sub(offset)))
}

fn scan_file_segment(
    path: &Path,
    provider: &str,
    offset: u64,
    byte_count: u64,
    codex: &mut CodexState,
    counters: &mut SourceCounters,
    mut accept: impl FnMut(UsageRecord),
) -> Result<bool, ()> {
    let mut file = File::open(path).map_err(|_| ())?;
    file.seek(SeekFrom::Start(offset)).map_err(|_| ())?;
    let mut reader = BufReader::new(file.take(byte_count));
    let mut line = Vec::with_capacity(8 * 1024);
    let mut oversized = false;
    let mut ended_with_newline = true;

    loop {
        let buffer = reader.fill_buf().map_err(|_| ())?;
        if buffer.is_empty() {
            if !line.is_empty() && !oversized {
                parse_line(provider, &line, codex, counters, &mut accept);
            }
            return Ok(ended_with_newline);
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(buffer.len(), |index| index + 1);
        ended_with_newline = newline.is_some();
        if !oversized {
            if line.len().saturating_add(take) <= MAX_JSONL_LINE_BYTES {
                line.extend_from_slice(&buffer[..take]);
            } else {
                oversized = true;
                line.clear();
                counters.malformed_records = counters.malformed_records.saturating_add(1);
            }
        }
        reader.consume(take);
        if newline.is_some() {
            if !oversized {
                while line
                    .last()
                    .is_some_and(|byte| *byte == b'\n' || *byte == b'\r')
                {
                    line.pop();
                }
                parse_line(provider, &line, codex, counters, &mut accept);
            }
            line.clear();
            oversized = false;
        }
    }
}

fn parse_line(
    provider: &str,
    line: &[u8],
    codex: &mut CodexState,
    counters: &mut SourceCounters,
    accept: &mut impl FnMut(UsageRecord),
) {
    let relevant = if provider == "claude" {
        contains_bytes(line, b"\"usage\"")
    } else {
        contains_bytes(line, b"\"token_count\"")
            || contains_bytes(line, b"\"turn_context\"")
            || contains_bytes(line, b"\"session_meta\"")
    };
    if !relevant {
        return;
    }
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        counters.malformed_records = counters.malformed_records.saturating_add(1);
        return;
    };
    let record = if provider == "claude" {
        parse_claude(&value)
    } else {
        parse_codex(&value, codex)
    };
    if let Some(record) = record {
        accept(record);
    }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn parse_timestamp_ms(value: &Value) -> Option<u64> {
    let text = value.as_str()?;
    let parsed = OffsetDateTime::parse(text, &Rfc3339).ok()?;
    let nanos = parsed.unix_timestamp_nanos();
    (nanos >= 0).then_some((nanos / 1_000_000).min(i128::from(u64::MAX)) as u64)
}

fn positive_int(value: Option<&Value>) -> u64 {
    value
        .and_then(Value::as_u64)
        .or_else(|| {
            value
                .and_then(Value::as_f64)
                .filter(|number| *number > 0.0)
                .map(|number| number as u64)
        })
        .unwrap_or(0)
}

fn bounded_string(value: Option<&Value>, max: usize) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= max)
        .unwrap_or_default()
        .to_string()
}

fn parse_claude(value: &Value) -> Option<UsageRecord> {
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    let model = bounded_string(message.get("model"), 160);
    if model.is_empty() {
        return None;
    }
    let tokens = UsageTokens {
        uncached_input_tokens: positive_int(usage.get("input_tokens")),
        cached_input_tokens: positive_int(usage.get("cache_read_input_tokens")),
        cache_creation_tokens: positive_int(usage.get("cache_creation_input_tokens")),
        output_tokens: positive_int(usage.get("output_tokens")),
        reasoning_tokens: 0,
    };
    if tokens.total() == 0 {
        return None;
    }
    let message_id = bounded_string(message.get("id"), 256);
    let request_id = bounded_string(value.get("requestId"), 256);
    let dedupe_key = (!message_id.is_empty() || !request_id.is_empty())
        .then(|| format!("{message_id}:{request_id}"));
    Some(UsageRecord {
        provider: "claude",
        timestamp_ms: parse_timestamp_ms(value.get("timestamp")?)?,
        model,
        session_id: bounded_string(value.get("sessionId"), 256),
        tokens,
        dedupe_key,
    })
}

fn parse_codex(value: &Value, state: &mut CodexState) -> Option<UsageRecord> {
    let record_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let payload = value.get("payload")?;
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if record_type == "session_meta" {
        if state.saw_session_meta {
            return None;
        }
        state.saw_session_meta = true;
        state.session_id =
            bounded_string(payload.get("id").or_else(|| payload.get("session_id")), 256);
        let forked = payload
            .get("forked_from_id")
            .and_then(Value::as_str)
            .is_some()
            || payload
                .pointer("/source/subagent/thread_spawn/parent_thread_id")
                .and_then(Value::as_str)
                .is_some();
        if forked {
            if let Some(timestamp) = value.get("timestamp").and_then(parse_timestamp_ms) {
                state.suppressing_fork_copies = true;
                state.fork_copy_anchor_ms = timestamp;
            }
        }
        return None;
    }

    if record_type == "turn_context" {
        state.model = bounded_string(payload.get("model"), 160);
        return None;
    }

    if payload_type != "token_count" || state.model.is_empty() {
        return None;
    }
    let timestamp_ms = value.get("timestamp").and_then(parse_timestamp_ms)?;
    let last = payload.get("info")?.get("last_token_usage")?;
    let signature = [
        positive_int(last.get("input_tokens")),
        positive_int(last.get("cached_input_tokens")),
        positive_int(last.get("cache_write_input_tokens")),
        positive_int(last.get("output_tokens")),
        positive_int(last.get("reasoning_output_tokens")),
    ]
    .map(|value| value.to_string())
    .join(":");
    if state.last_usage_signature.as_deref() == Some(&signature) {
        return None;
    }
    state.last_usage_signature = Some(signature);

    if state.suppressing_fork_copies {
        if timestamp_ms.saturating_sub(state.fork_copy_anchor_ms) < FORK_COPY_MAX_GAP_MS {
            state.fork_copy_anchor_ms = timestamp_ms;
            return None;
        }
        state.suppressing_fork_copies = false;
    }

    let input = positive_int(last.get("input_tokens"));
    let cached = positive_int(last.get("cached_input_tokens"));
    let creation = positive_int(last.get("cache_write_input_tokens"));
    let output = positive_int(last.get("output_tokens"));
    let tokens = UsageTokens {
        uncached_input_tokens: input.saturating_sub(cached.saturating_add(creation)),
        cached_input_tokens: cached,
        cache_creation_tokens: creation,
        output_tokens: output,
        reasoning_tokens: positive_int(last.get("reasoning_output_tokens")).min(output),
    };
    if tokens.total() == 0 {
        return None;
    }
    Some(UsageRecord {
        provider: "codex",
        timestamp_ms,
        model: state.model.clone(),
        session_id: state.session_id.clone(),
        tokens,
        dedupe_key: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::io::Write;

    fn write(path: &Path, lines: &[Value]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = File::create(path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    fn stamp(ms: u64) -> String {
        OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
            .unwrap()
            .format(&Rfc3339)
            .unwrap()
    }

    fn usage_file(path: &Path) -> UsageFile {
        let metadata = fs::metadata(path).unwrap();
        UsageFile {
            path: path.to_path_buf(),
            modified_at: metadata.modified().ok(),
            len: metadata.len(),
        }
    }

    #[test]
    fn rejects_caller_shaped_ranges() {
        assert!(range_config("365d").is_err());
        assert!(range_config("../sessions").is_err());
    }

    #[test]
    fn aggregates_without_returning_transcript_content_or_paths() {
        let temp = tempfile::tempdir().unwrap();
        let now = now_ms();
        let claude = temp.path().join("claude");
        let codex = temp.path().join("codex");
        let assistant = serde_json::json!({
            "type": "assistant",
            "timestamp": stamp(now - HOUR_MS),
            "sessionId": "private-session",
            "cwd": "/Users/person/secret-project",
            "message": {
                "id": "msg-1",
                "model": "claude-sonnet-test",
                "content": [{"type":"text", "text":"private prompt and response"}],
                "usage": {"input_tokens": 10, "cache_read_input_tokens": 20, "output_tokens": 5}
            }
        });
        write(
            &claude.join("private-name.jsonl"),
            &[assistant.clone(), assistant],
        );
        write(
            &codex.join("rollout.jsonl"),
            &[
                serde_json::json!({"type":"session_meta","timestamp":stamp(now - HOUR_MS),"payload":{"type":"session_meta","id":"codex-session"}}),
                serde_json::json!({"type":"turn_context","timestamp":stamp(now - HOUR_MS),"payload":{"type":"turn_context","model":"gpt-test"}}),
                serde_json::json!({"type":"event_msg","timestamp":stamp(now - HOUR_MS + 1),"payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":8}}}}),
            ],
        );

        let summary = scan_usage(
            &[("claude", claude), ("codex", codex)],
            range_config("24h").unwrap(),
            now,
        )
        .unwrap();
        assert_eq!(summary.buckets.len(), 2);
        let claude_bucket = summary
            .buckets
            .iter()
            .find(|bucket| bucket.provider == "claude")
            .unwrap();
        assert_eq!(
            claude_bucket.responses, 1,
            "duplicate Claude content blocks count once"
        );
        assert_eq!(claude_bucket.tokens.total(), 35);
        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains("private prompt"));
        assert!(!json.contains("secret-project"));
        assert!(!json.contains("private-name"));
        assert!(!json.contains("private-session"));
    }

    #[test]
    fn drops_repeated_codex_usage_events() {
        let turn = serde_json::json!({"type":"turn_context","payload":{"type":"turn_context","model":"gpt-test"}});
        let usage = serde_json::json!({
            "type":"event_msg",
            "timestamp":"2026-08-12T20:00:00Z",
            "payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":10}}}
        });
        let mut state = CodexState::default();
        assert!(parse_codex(&turn, &mut state).is_none());
        assert!(parse_codex(&usage, &mut state).is_some());
        assert!(parse_codex(&usage, &mut state).is_none());
    }

    #[test]
    fn reuses_unchanged_histories_and_reads_only_appended_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("claude/session.jsonl");
        let now = now_ms();
        let assistant = |id: &str, timestamp: u64| {
            serde_json::json!({
                "type": "assistant",
                "timestamp": stamp(timestamp),
                "sessionId": "session",
                "requestId": id,
                "message": {
                    "id": id,
                    "model": "claude-sonnet-test",
                    "usage": {"input_tokens": 10, "output_tokens": 5}
                }
            })
        };
        write(&path, &[assistant("first", now - HOUR_MS)]);

        let first_file = usage_file(&path);
        let mut first_counters = SourceCounters::default();
        let (first_records, first_bytes) =
            cached_file_records(&first_file, "claude", &mut first_counters).unwrap();
        assert_eq!(first_records.len(), 1);
        assert_eq!(first_bytes, first_file.len);

        let mut unchanged_counters = SourceCounters::default();
        let (unchanged_records, unchanged_bytes) =
            cached_file_records(&first_file, "claude", &mut unchanged_counters).unwrap();
        assert_eq!(unchanged_records.len(), 1);
        assert_eq!(unchanged_bytes, 0);

        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{}", assistant("second", now)).unwrap();
        file.sync_all().unwrap();
        let appended_file = usage_file(&path);
        let appended_len = appended_file.len - first_file.len;
        let mut appended_counters = SourceCounters::default();
        let (appended_records, appended_bytes) =
            cached_file_records(&appended_file, "claude", &mut appended_counters).unwrap();

        assert_eq!(appended_records.len(), 2);
        assert_eq!(appended_bytes, appended_len);
        assert!(appended_bytes < appended_file.len);
    }
}
