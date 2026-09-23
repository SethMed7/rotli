//! The effects half of provider_models.rs: asking each client for its model
//! list. Every spawn reuses its chat lane's isolation, sends no prompt, runs
//! from an empty scratch directory, and is killed at a deadline; every read is
//! byte-capped. The pure parsers these feed live in provider_models.rs.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use super::{
    parse_acp_session_models, parse_claude_initialize, parse_codex_cache, parse_cursor_models, DiscoveredModel,
    DISCOVERY_TIMEOUT, MAX_CODEX_CACHE_BYTES, MAX_OUTPUT_BYTES,
};
use crate::provider::{self, acp, antigravity};

pub(super) fn fetch_models(provider: &str) -> Result<Vec<DiscoveredModel>, String> {
    match provider {
        "claude" => discover_claude(&installed_bin("claude")?),
        "codex" => {
            installed_bin("codex")?;
            read_codex_cache(&codex_home()?.join("models_cache.json"))
        }
        "cursor" => discover_cursor(&installed_bin("cursor")?),
        "antigravity" => discover_antigravity(),
        other => Err(format!("unknown provider \"{other}\"")),
    }
}

fn installed_bin(provider: &str) -> Result<PathBuf, String> {
    provider::resolve_bin(provider::spec(provider)?)
        .ok_or_else(|| format!("{provider} isn't installed (checked its usual homes)"))
}

fn codex_home() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("CODEX_HOME").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").ok_or("HOME isn't set")?;
    Ok(PathBuf::from(home).join(".codex"))
}

pub(crate) fn read_codex_cache(path: &Path) -> Result<Vec<DiscoveredModel>, String> {
    let size = std::fs::metadata(path)
        .map_err(|_| "Codex hasn't written its model list yet — open Codex once, then refresh".to_string())?
        .len();
    if size > MAX_CODEX_CACHE_BYTES {
        return Err("codex model cache is unexpectedly large".into());
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("couldn't read codex model cache: {e}"))?;
    parse_codex_cache(&text)
}

/// A spawned discovery child with a deadline: the watchdog kills it at
/// `DISCOVERY_TIMEOUT`, which ends any blocked read with EOF.
struct Deadline {
    child: Arc<Mutex<Child>>,
}

impl Deadline {
    fn start(child: Child) -> Self {
        let child = Arc::new(Mutex::new(child));
        let watched = Arc::clone(&child);
        std::thread::spawn(move || {
            std::thread::sleep(DISCOVERY_TIMEOUT);
            let _ = watched.lock().unwrap().kill();
        });
        Self { child }
    }
}

impl Drop for Deadline {
    fn drop(&mut self) {
        let mut child = self.child.lock().unwrap();
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn scratch_dir() -> Result<tempfile::TempDir, String> {
    tempfile::Builder::new()
        .prefix("rotli-models-")
        .tempdir()
        .map_err(|e| format!("couldn't create a scratch directory: {e}"))
}

/// The chat lane's isolation (provider.rs `build_args_tuned` "claude" arm) —
/// safe mode, every tool off, nothing persisted — in stream-json mode so the
/// `initialize` control request can be asked. No user message is ever sent.
pub(crate) const CLAUDE_DISCOVERY_ARGS: &[&str] = &[
    "-p",
    "--safe-mode",
    "--tools",
    "",
    "--no-session-persistence",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
];

fn discover_claude(bin: &Path) -> Result<Vec<DiscoveredModel>, String> {
    let scratch = scratch_dir()?;
    let mut child = Command::new(bin)
        .args(CLAUDE_DISCOVERY_ARGS)
        .current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't launch claude: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("claude did not open stdin")?;
    let stdout = child.stdout.take().ok_or("claude did not open stdout")?;
    let _deadline = Deadline::start(child);
    let request_id = format!("rotli-models-{}", ulid::Ulid::new().to_string().to_lowercase());
    let request = serde_json::json!({
        "type": "control_request",
        "request_id": request_id,
        "request": { "subtype": "initialize" }
    });
    acp::write_json_line(&mut stdin, &request)?;
    // stdin stays open until the answer: closing it would end the session
    let mut reader = BufReader::new(stdout.take(MAX_OUTPUT_BYTES));
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| format!("couldn't read claude: {e}"))? == 0 {
            return Err("claude closed before listing its models".into());
        }
        if let Some(result) = parse_claude_initialize(&line, &request_id) {
            drop(stdin);
            return result;
        }
    }
}

fn discover_cursor(bin: &Path) -> Result<Vec<DiscoveredModel>, String> {
    let scratch = scratch_dir()?;
    let mut child = Command::new(bin)
        .arg("models")
        .current_dir(scratch.path())
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't launch cursor: {e}"))?;
    let stdout = child.stdout.take().ok_or("cursor did not open stdout")?;
    let _deadline = Deadline::start(child);
    let mut text = String::new();
    stdout
        .take(MAX_OUTPUT_BYTES)
        .read_to_string(&mut text)
        .map_err(|e| format!("couldn't read cursor: {e}"))?;
    parse_cursor_models(&text)
}

/// `initialize` + `authenticate` + `session/new` — the first three requests
/// of every chat turn, stopping short of `session/prompt`.
fn discover_antigravity() -> Result<Vec<DiscoveredModel>, String> {
    if !antigravity::signed_in() {
        return Err(acp::ANTIGRAVITY_SIGN_IN_REQUIRED.into());
    }
    let bin = installed_bin("antigravity")?;
    let scratch = scratch_dir()?;
    let mut cmd = Command::new(&bin);
    cmd.current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in antigravity::env_remove_keys() {
        cmd.env_remove(key);
    }
    cmd.envs(antigravity::runtime_env(&bin)?);
    let mut child = cmd.spawn().map_err(|e| format!("couldn't launch antigravity: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("antigravity did not open stdin")?;
    let stdout = child.stdout.take().ok_or("antigravity did not open stdout")?;
    let _deadline = Deadline::start(child);
    let mut reader = BufReader::new(stdout.take(MAX_OUTPUT_BYTES));
    let mut assistant = String::new();
    let mut refuse_sign_in = |line: &str| -> Result<(), String> {
        if line.starts_with(acp::ANTIGRAVITY_AUTH_PREFIX) {
            Err(acp::ANTIGRAVITY_SIGN_IN_REQUIRED.into())
        } else {
            Ok(())
        }
    };
    let mut conn = acp::AcpConn {
        lane: acp::AcpLane::Antigravity,
        writer: &mut stdin,
        reader: &mut reader,
        assistant: &mut assistant,
        on_plain_line: &mut refuse_sign_in,
    };
    acp::handshake(&mut conn)?;
    let session = acp::new_session(&mut conn, scratch.path())?;
    parse_acp_session_models(&session)
}
