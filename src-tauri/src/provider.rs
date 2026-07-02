//! Connected-model bridge — the subscription CLIs installed on this Mac
//! (Claude Code · Codex · Antigravity) driven as pure chat COMPLETION backends
//! under the TS agent loop (one subprocess per loop step, stateless transcript
//! replay — exactly how the local models are driven).
//!
//! Security shape:
//! - A hardcoded ALLOWLIST of binaries (absolute candidate paths — a GUI app
//!   doesn't inherit the login-shell PATH) and model ids. Nothing from the
//!   webview reaches argv except the prompt itself, as one argument or stdin.
//! - Every CLI is invoked TOOL-LESS / sandboxed (claude `--tools ""`, codex
//!   `--sandbox read-only` + `features.shell_tool=false`, agy `--sandbox`) —
//!   a chat turn must never edit files or run commands.
//! - CLI models are REMOTE by definition: the secret egress backstop mirrors
//!   chat.rs `egress_allowed` (secret-shaped transcripts are refused), and the
//!   TS side already blocks `secure: true` note reads for them (`endpoint: ""`
//!   fails the locality check — fail closed).
//! - Kill-on-cancel: children are registered under the caller's request id;
//!   `cli_cancel` (or the per-request watchdog at the deadline) kills them.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Default per-step deadline. Frontier models think long; the watchdog is the
/// backstop, not the norm. The caller may pass a longer one (image jobs).
const DEFAULT_TIMEOUT_MS: u64 = 180_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

struct Running {
    token: u64,
    child: Child,
}

#[derive(Default)]
pub struct ProviderState {
    /// request_id → the live child, so cancel/watchdog can kill it. The token
    /// disambiguates sequential steps that reuse one request id — a stale
    /// watchdog must never kill a newer child under the same id.
    children: Arc<Mutex<HashMap<String, Running>>>,
    /// agy allows NO concurrent invocations (parallel `-p` runs hang) — every
    /// agy child, chat or image, runs under this gate.
    agy_gate: Arc<Mutex<()>>,
}

/// Process-global run token — unique across every spawn, so a finished step's
/// watchdog can never shoot a successor that reused its request id.
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

// ── the allowlist ─────────────────────────────────────────────────────────────

struct CliSpec {
    id: &'static str,
    /// Absolute candidate paths; "~/" expands to $HOME. First hit wins.
    bins: &'static [&'static str],
    models: &'static [&'static str],
}

const CLIS: &[CliSpec] = &[
    CliSpec {
        id: "claude",
        bins: &["~/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"],
        models: &["sonnet", "opus", "haiku", "fable"],
    },
    CliSpec {
        id: "codex",
        bins: &["/opt/homebrew/bin/codex", "~/.local/bin/codex", "/usr/local/bin/codex"],
        models: &["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    },
    CliSpec {
        id: "agy",
        bins: &["~/.local/bin/agy", "/opt/homebrew/bin/agy"],
        models: &[
            "Gemini 3.5 Flash (Medium)",
            "Gemini 3.1 Pro (High)",
            "Claude Sonnet 4.6 (Thinking)",
            "Claude Opus 4.6 (Thinking)",
        ],
    },
];

fn spec(provider: &str) -> Result<&'static CliSpec, String> {
    CLIS.iter()
        .find(|s| s.id == provider)
        .ok_or_else(|| format!("unknown provider \"{provider}\""))
}

fn expand_home(path: &str) -> Option<PathBuf> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(rest))
    } else {
        Some(PathBuf::from(path))
    }
}

fn resolve_bin(s: &CliSpec) -> Option<PathBuf> {
    s.bins
        .iter()
        .filter_map(|p| expand_home(p))
        .find(|p| p.is_file())
}

/// Where the prompt rides.
#[derive(Debug, PartialEq)]
enum PromptVia {
    Stdin,
    /// Already embedded in the argv (agy's `-p <prompt>`).
    Args,
}

/// The full argv for one completion step — pure, so the exact argument shape
/// (the security surface) unit-tests. The prompt is the ONLY caller-shaped
/// value; everything else is literal.
fn build_args(provider: &str, model: &str, prompt: &str, timeout_secs: u64) -> Result<(Vec<String>, PromptVia), String> {
    let s = spec(provider)?;
    if !s.models.contains(&model) {
        return Err(format!("model \"{model}\" isn't in the {provider} allowlist"));
    }
    let own = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match provider {
        // print mode, ALL tools off, JSON result envelope, no session litter —
        // the loop replays the transcript, so there is nothing to resume.
        "claude" => Ok((
            own(&[
                "-p",
                "--tools",
                "",
                "--model",
                model,
                "--output-format",
                "json",
                "--no-session-persistence",
            ]),
            PromptVia::Stdin,
        )),
        // exec mode (non-interactive — it never prompts, so there is NO
        // --ask-for-approval flag here; verified against 0.137.0), read-only
        // sandbox, shell tool off, JSONL out, no session litter (--ephemeral);
        // "-" = prompt from stdin. --cd pins it to a scratch dir OUTSIDE any repo.
        "codex" => {
            let scratch = codex_scratch_dir()?;
            Ok((
                vec![
                    "exec".into(),
                    "--json".into(),
                    "--sandbox".into(),
                    "read-only".into(),
                    "--skip-git-repo-check".into(),
                    "--ephemeral".into(),
                    "--color".into(),
                    "never".into(),
                    "--cd".into(),
                    scratch,
                    "-c".into(),
                    "features.shell_tool=false".into(),
                    "--model".into(),
                    model.into(),
                    "-".into(),
                ],
                PromptVia::Stdin,
            ))
        }
        // agy has no stdin lane — the prompt is the `-p` value. `--sandbox`
        // keeps it inert; `--print-timeout` mirrors our own deadline.
        "agy" => Ok((
            vec![
                "-p".into(),
                prompt.into(),
                "--model".into(),
                model.into(),
                "--sandbox".into(),
                "--print-timeout".into(),
                format!("{}s", timeout_secs.max(30)),
            ],
            PromptVia::Args,
        )),
        _ => Err(format!("unknown provider \"{provider}\"")),
    }
}

fn codex_scratch_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join("rotli-codex");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create the codex scratch dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

// ── output parsers (pure) ─────────────────────────────────────────────────────

/// `claude -p --output-format json` → one JSON document with `result` (+
/// `is_error`). Some paths prepend plain-text warnings, so fall back to
/// scanning lines from the end for the envelope.
fn parse_claude_json(stdout: &str) -> Result<String, String> {
    let envelope = |v: &serde_json::Value| -> Option<Result<String, String>> {
        let result = v.get("result")?.as_str()?.trim().to_string();
        if v.get("is_error").and_then(|b| b.as_bool()) == Some(true) {
            return Some(Err(if result.is_empty() { "claude returned an error".into() } else { result }));
        }
        Some(Ok(result))
    };
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        if let Some(r) = envelope(&v) {
            return r;
        }
    }
    for line in stdout.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(r) = envelope(&v) {
                return r;
            }
        }
    }
    Err("claude returned no parsable result".into())
}

/// `codex exec --json` → JSONL; the reply is the LAST completed `agent_message`
/// item. `turn.failed` / `error` events surface as errors.
fn parse_codex_jsonl(stdout: &str) -> Result<String, String> {
    let mut last: Option<String> = None;
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        match v.get("type").and_then(|s| s.as_str()).unwrap_or("") {
            "item.completed" => {
                if v.pointer("/item/type").and_then(|s| s.as_str()) == Some("agent_message") {
                    if let Some(text) = v.pointer("/item/text").and_then(|s| s.as_str()) {
                        last = Some(text.to_string());
                    }
                }
            }
            "turn.failed" => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(|s| s.as_str())
                    .unwrap_or("codex turn failed");
                return Err(msg.to_string());
            }
            "error" => {
                let msg = v.get("message").and_then(|s| s.as_str()).unwrap_or("codex error");
                return Err(msg.to_string());
            }
            _ => {}
        }
    }
    match last.map(|s| s.trim().to_string()) {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err("codex returned no assistant message".into()),
    }
}

/// agy prints plain text. Empty stdout is a KNOWN failure mode under non-TTY —
/// surface the stderr tail instead of a silent blank reply.
fn parse_agy_text(stdout: &str, stderr: &str) -> Result<String, String> {
    let out = stdout.trim();
    if out.is_empty() {
        let tail: String = stderr.lines().rev().take(3).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" · ");
        Err(format!("agy returned nothing{}", if tail.is_empty() { String::new() } else { format!(" ({tail})") }))
    } else {
        Ok(out.to_string())
    }
}

// ── the runner ────────────────────────────────────────────────────────────────

/// Spawn + register + read to EOF + reap. The watchdog thread kills the child
/// at the deadline (matching token only — a finished step's watchdog must not
/// shoot a successor reusing the request id); `cli_cancel` kills it early.
fn run_registered(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    mut cmd: Command,
    stdin_payload: Option<&str>,
    timeout: Duration,
) -> Result<(String, String, bool), String> {
    cmd.stdin(if stdin_payload.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("couldn't launch the CLI: {e}"))?;

    if let Some(payload) = stdin_payload {
        if let Some(mut stdin) = child.stdin.take() {
            // a dead child mid-write is reported by the read below, not here
            let _ = stdin.write_all(payload.as_bytes());
        }
    }
    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    children
        .lock()
        .unwrap()
        .insert(request_id.to_string(), Running { token, child });

    // deadline watchdog — wakes once; kills only if THIS run is still live
    let map = Arc::clone(children);
    let id_for_watchdog = request_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(timeout);
        if let Some(r) = map.lock().unwrap().get_mut(&id_for_watchdog) {
            if r.token == token {
                let _ = r.child.kill();
            }
        }
    });

    // stderr on its own thread so a chatty CLI can't deadlock the stdout pipe
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = stderr_pipe.as_mut() {
            let _ = p.read_to_string(&mut s);
        }
        s
    });
    let mut stdout = String::new();
    if let Some(p) = stdout_pipe.as_mut() {
        let _ = p.read_to_string(&mut stdout); // EOF on exit or kill
    }
    let stderr = err_thread.join().unwrap_or_default();

    // reap: remove ONLY this run's entry (cancel may have raced a new insert)
    let reaped = {
        let mut map = children.lock().unwrap();
        match map.get(request_id) {
            Some(r) if r.token == token => map.remove(request_id),
            _ => None,
        }
    };
    let ok = match reaped {
        Some(mut r) => r.child.wait().map(|s| s.success()).unwrap_or(false),
        None => false, // cancelled out from under us
    };
    Ok((stdout, stderr, ok))
}

// ── commands ──────────────────────────────────────────────────────────────────

/// One tool-less completion step on a connected CLI. Blocking work rides
/// `spawn_blocking` so `cli_cancel` can interleave on the IPC lane.
#[tauri::command]
pub async fn cli_complete(
    state: tauri::State<'_, ProviderState>,
    request_id: String,
    provider: String,
    model: String,
    prompt: String,
    timeout_ms: Option<u64>,
) -> Result<String, String> {
    // the CLI lane is remote by definition — same egress law as chat.rs
    if crate::secret::looks_secure(&prompt) {
        return Err(
            "This conversation carries secret-shaped content and can't be sent to a connected model — switch to a local model to continue."
                .into(),
        );
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));
    let (args, via) = build_args(&provider, &model, &prompt, timeout.as_secs())?;
    let bin = resolve_bin(spec(&provider)?)
        .ok_or_else(|| format!("{provider} isn't installed (checked its usual homes)"))?;

    let children = Arc::clone(&state.children);
    let agy_gate = Arc::clone(&state.agy_gate);
    tauri::async_runtime::spawn_blocking(move || {
        // agy: strictly one at a time (parallel runs hang) — hold the gate
        let _agy = (provider == "agy").then(|| agy_gate.lock().unwrap());
        let mut cmd = Command::new(&bin);
        cmd.args(&args);
        let payload = matches!(via, PromptVia::Stdin).then_some(prompt.as_str());
        let (stdout, stderr, ok) = run_registered(&children, &request_id, cmd, payload, timeout)?;
        let parsed = match provider.as_str() {
            "claude" => parse_claude_json(&stdout),
            "codex" => parse_codex_jsonl(&stdout),
            _ => parse_agy_text(&stdout, &stderr),
        };
        match parsed {
            Ok(text) => Ok(text),
            Err(e) if !ok => {
                let tail: String = stderr.lines().rev().take(3).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" · ");
                Err(format!("{e}{}", if tail.is_empty() { String::new() } else { format!(" — {tail}") }))
            }
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("provider task failed: {e}"))?
}

/// Kill a live completion (the composer's stop). Unknown ids are a no-op.
#[tauri::command]
pub fn cli_cancel(state: tauri::State<'_, ProviderState>, request_id: String) -> Result<(), String> {
    if let Some(r) = state.children.lock().unwrap().get_mut(&request_id) {
        let _ = r.child.kill();
    }
    Ok(())
}

/// Deadline for an image job — generation + save runs minutes, not seconds.
const IMAGE_TIMEOUT: Duration = Duration::from_secs(300);

/// Generate an image into the CHAT'S assets — `<root>/storage/chats/<slug>/`
/// — via the chosen connected engine (the proven /imagegen recipes). The
/// destination is pinned by Rust from a REGISTERED root + a safe slug; the
/// model and prompt never contribute to the path. Returns the corpus-relative
/// path of the saved PNG.
#[tauri::command]
pub async fn generate_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProviderState>,
    request_id: String,
    root: String,
    slug: String,
    prompt: String,
    engine: String,
) -> Result<String, String> {
    if crate::secret::looks_secure(&prompt) {
        return Err("That prompt carries secret-shaped content — it won't be sent to an image engine.".into());
    }
    if engine != "codex" && engine != "agy" {
        return Err(format!("unknown image engine \"{engine}\""));
    }
    let root = crate::memex::registered_root(&app, &root)?;
    let slug = crate::memex::safe_slug(&slug)?;
    let bin = resolve_bin(spec(&engine)?)
        .ok_or_else(|| format!("{engine} isn't installed (checked its usual homes)"))?;

    let dir = root.join("storage").join("chats").join(&slug);
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't create the chat's assets dir: {e}"))?;
    let file = format!("img-{}.png", ulid::Ulid::new().to_string().to_lowercase());
    let abs = dir.join(&file);
    let abs_str = abs.to_string_lossy().to_string();
    let dir_str = dir.to_string_lossy().to_string();

    let instruction = format!(
        "Generate an image: {prompt}\n\nUse your image generation tool. Save the FINAL image as a PNG to exactly this absolute path: {abs_str}\nCreate no other files. When the file is saved, reply with just: saved"
    );
    // per-engine argv — image jobs NEED write access to the pinned dir, so the
    // chat lane's read-only flags don't apply here (still sandboxed to the dir)
    let (args, payload): (Vec<String>, Option<String>) = if engine == "codex" {
        (
            vec![
                "exec".into(),
                "--json".into(),
                "--sandbox".into(),
                "workspace-write".into(),
                "--skip-git-repo-check".into(),
                "--ephemeral".into(),
                "--color".into(),
                "never".into(),
                "--cd".into(),
                dir_str,
                "-".into(),
            ],
            Some(instruction),
        )
    } else {
        (
            vec![
                "-p".into(),
                instruction,
                "--add-dir".into(),
                dir_str,
                "--dangerously-skip-permissions".into(),
                "--print-timeout".into(),
                "5m".into(),
            ],
            None,
        )
    };

    let children = Arc::clone(&state.children);
    let agy_gate = Arc::clone(&state.agy_gate);
    tauri::async_runtime::spawn_blocking(move || {
        let _agy = (engine == "agy").then(|| agy_gate.lock().unwrap());
        let mut cmd = Command::new(&bin);
        cmd.args(&args);
        let (_stdout, stderr, _ok) =
            run_registered(&children, &request_id, cmd, payload.as_deref(), IMAGE_TIMEOUT)?;
        // the POSTCONDITION is the contract: the PNG exists and is non-empty
        let size = std::fs::metadata(&abs).map(|m| m.len()).unwrap_or(0);
        if size == 0 {
            let _ = std::fs::remove_file(&abs);
            let tail: String = stderr.lines().rev().take(3).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" · ");
            return Err(format!(
                "the {engine} engine didn't produce the image{}",
                if tail.is_empty() { String::new() } else { format!(" — {tail}") }
            ));
        }
        Ok(format!("storage/chats/{slug}/{file}"))
    })
    .await
    .map_err(|e| format!("image task failed: {e}"))?
}

/// Settings → AI Models: is this lane usable? Cheap local probes only — a
/// version exec and an auth-artifact check, never a model call.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDetect {
    pub installed: bool,
    pub version: Option<String>,
    pub authenticated: bool,
}

#[tauri::command]
pub async fn cli_detect(provider: String) -> Result<CliDetect, String> {
    tauri::async_runtime::spawn_blocking(move || detect(&provider))
        .await
        .map_err(|e| format!("detect task failed: {e}"))?
}

fn detect(provider: &str) -> Result<CliDetect, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let home = std::path::Path::new(&home);
    match provider {
        // the Gemini lane is HTTP — "installed" is always true; usable = key saved
        "gemini" => Ok(CliDetect {
            installed: true,
            version: None,
            authenticated: crate::keychain::get_secret("gemini-api-key").is_some(),
        }),
        "claude" => {
            let bin = resolve_bin(spec("claude")?);
            let version = bin.as_ref().and_then(|b| version_of(b, &["--version"]));
            // subscription OAuth: Keychain item (macOS default), or the
            // credentials file some setups keep
            let keychain = std::process::Command::new("/usr/bin/security")
                .args(["find-generic-password", "-s", "Claude Code-credentials"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            let file = home.join(".claude/.credentials.json").is_file();
            Ok(CliDetect { installed: bin.is_some(), version, authenticated: keychain || file })
        }
        "codex" => {
            let bin = resolve_bin(spec("codex")?);
            let version = bin.as_ref().and_then(|b| version_of(b, &["--version"]));
            let authenticated = bin
                .as_ref()
                .and_then(|b| {
                    std::process::Command::new(b)
                        .args(["login", "status"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .ok()
                })
                .map(|s| s.success())
                .unwrap_or(false);
            Ok(CliDetect { installed: bin.is_some(), version, authenticated })
        }
        "agy" => {
            let bin = resolve_bin(spec("agy")?);
            let version = bin.as_ref().and_then(|b| version_of(b, &["--version"]));
            // agy stores its OAuth state under ~/.gemini/antigravity-cli
            let authenticated = home.join(".gemini/antigravity-cli").is_dir();
            Ok(CliDetect { installed: bin.is_some(), version, authenticated })
        }
        other => Err(format!("unknown provider \"{other}\"")),
    }
}

fn version_of(bin: &PathBuf, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(bin).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout).lines().next()?.trim().to_string();
    (!line.is_empty()).then_some(line)
}

// ─── tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_refuses_unknown_provider_and_model() {
        assert!(build_args("ollama", "x", "p", 60).is_err());
        assert!(build_args("claude", "gpt-5.5", "p", 60).is_err());
        assert!(build_args("codex", "sonnet", "p", 60).is_err());
    }

    #[test]
    fn claude_args_are_toolless_json_print_mode() {
        let (args, via) = build_args("claude", "sonnet", "ignored", 60).unwrap();
        assert_eq!(
            args,
            vec!["-p", "--tools", "", "--model", "sonnet", "--output-format", "json", "--no-session-persistence"]
        );
        assert_eq!(via, PromptVia::Stdin);
    }

    #[test]
    fn codex_args_are_sandboxed_jsonl_with_stdin_prompt() {
        let (args, via) = build_args("codex", "gpt-5.5", "ignored", 60).unwrap();
        assert_eq!(via, PromptVia::Stdin);
        assert_eq!(args[0], "exec");
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"read-only".to_string()));
        assert!(args.contains(&"--skip-git-repo-check".to_string()));
        assert!(args.contains(&"--ephemeral".to_string()));
        assert!(args.contains(&"features.shell_tool=false".to_string()));
        // exec is non-interactive — this flag DOESN'T EXIST on `codex exec`
        // (0.137.0 rejects it; caught live 2026-07-02) — never reintroduce it
        assert!(!args.contains(&"--ask-for-approval".to_string()));
        assert_eq!(args.last().unwrap(), "-");
    }

    #[test]
    fn agy_args_embed_the_prompt_and_sandbox() {
        let (args, via) = build_args("agy", "Gemini 3.5 Flash (Medium)", "hello there", 240).unwrap();
        assert_eq!(via, PromptVia::Args);
        assert_eq!(args[0], "-p");
        assert_eq!(args[1], "hello there");
        assert!(args.contains(&"--sandbox".to_string()));
        assert!(args.contains(&"240s".to_string()));
    }

    #[test]
    fn parse_claude_json_reads_the_result_envelope() {
        let ok = r#"{"type":"result","subtype":"success","is_error":false,"result":"Hi there.","session_id":"abc","total_cost_usd":0.003}"#;
        assert_eq!(parse_claude_json(ok).unwrap(), "Hi there.");
        let err = r#"{"type":"result","is_error":true,"result":"rate limited"}"#;
        assert_eq!(parse_claude_json(err).unwrap_err(), "rate limited");
        // a warning line before the envelope still parses
        let noisy = format!("some warning\n{ok}");
        assert_eq!(parse_claude_json(&noisy).unwrap(), "Hi there.");
        assert!(parse_claude_json("garbage").is_err());
    }

    #[test]
    fn parse_codex_jsonl_takes_the_last_agent_message() {
        let sample = concat!(
            r#"{"type":"thread.started","thread_id":"t1"}"#, "\n",
            r#"{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}"#, "\n",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"first"}}"#, "\n",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}"#, "\n",
            r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}"#, "\n",
        );
        assert_eq!(parse_codex_jsonl(sample).unwrap(), "final answer");
        let failed = r#"{"type":"turn.failed","error":{"message":"quota exhausted"}}"#;
        assert_eq!(parse_codex_jsonl(failed).unwrap_err(), "quota exhausted");
        assert!(parse_codex_jsonl("").is_err());
    }

    #[test]
    fn parse_agy_text_refuses_empty_stdout() {
        assert_eq!(parse_agy_text("  an answer \n", "").unwrap(), "an answer");
        let err = parse_agy_text("", "line1\nboom: quota\n").unwrap_err();
        assert!(err.contains("agy returned nothing"));
        assert!(err.contains("boom: quota"));
    }

    #[test]
    fn home_expansion_only_touches_tilde_prefix() {
        assert_eq!(expand_home("/opt/homebrew/bin/codex").unwrap(), PathBuf::from("/opt/homebrew/bin/codex"));
        let home = std::env::var("HOME").unwrap();
        assert_eq!(expand_home("~/.local/bin/claude").unwrap(), PathBuf::from(home).join(".local/bin/claude"));
    }
}
