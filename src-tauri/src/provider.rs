//! Connected-model bridge. Interactive chat may drive the user's locally
//! authenticated official Claude Code, Codex, and Cursor clients. Cursor uses
//! the vendor-documented ACP custom-client protocol in read-only Ask mode.
//! Unsupported subscription integrations, remote organizer, and provider-backed
//! image paths are unavailable. Native fail-closed gates keep stale settings or
//! a compromised webview from reactivating them.
//!
//! Security shape:
//! - A hardcoded ALLOWLIST of binaries (absolute candidate paths — a GUI app
//!   doesn't inherit the login-shell PATH) and model ids. Nothing from the
//!   webview reaches argv. Prompts ride stdin or ACP JSON-RPC only.
//! - Every client is invoked TOOL-LESS / sandboxed: Claude has no tools, Codex
//!   has a read-only sandbox plus no shell tool, and Cursor runs Ask mode from
//!   an empty scratch workspace while every permission request is rejected.
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

#[path = "acp.rs"]
pub(crate) mod acp;
#[path = "antigravity.rs"]
pub(crate) mod antigravity;

pub(crate) const CONNECTED_PROVIDER_POLICY_MESSAGE: &str =
    "This provider lane is unavailable. Rotli supports only the user's locally authenticated official Claude Code, Codex, Cursor, and Antigravity clients; choose one of those or an on-device model.";
pub(crate) const CLOUD_IMAGE_POLICY_MESSAGE: &str =
    "Provider-backed image generation is unavailable; no provider account was used.";

pub(crate) fn connected_provider_execution_allowed(provider: &str) -> Result<(), String> {
    match provider {
        "claude" | "codex" | "cursor" | "antigravity" => Ok(()),
        other => Err(format!("unknown provider \"{other}\"")),
    }
}

fn refuse_cloud_image_generation<T>() -> Result<T, String> {
    Err(CLOUD_IMAGE_POLICY_MESSAGE.into())
}

/// Default per-step deadline. Frontier models think long; the watchdog is the
/// backstop, not the norm. The caller may pass a longer one (image jobs).
const DEFAULT_TIMEOUT_MS: u64 = 180_000;
const MAX_TIMEOUT_MS: u64 = 600_000;

pub(crate) struct Running {
    pub(crate) token: u64,
    pub(crate) child: Child,
}

#[derive(Default)]
pub struct ProviderState {
    /// request_id → the live child, so cancel/watchdog can kill it. The token
    /// disambiguates sequential steps that reuse one request id — a stale
    /// watchdog must never kill a newer child under the same id.
    pub(crate) children: Arc<Mutex<HashMap<String, Running>>>,
}

/// Process-global run token — unique across every spawn, so a finished step's
/// watchdog can never shoot a successor that reused its request id.
pub(crate) static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

// ── the allowlist ─────────────────────────────────────────────────────────────

pub(crate) struct CliSpec {
    pub(crate) id: &'static str,
    /// Absolute candidate paths; "~/" expands to $HOME. First hit wins.
    pub(crate) bins: &'static [&'static str],
    pub(crate) models: &'static [&'static str],
}

// `bins` lists are byte-identical to breve-runtime/scripts/cli-paths.ts (F10) —
// guarded by scripts/fixtures/parity.json via parity_tests.rs; change both sides.
pub(crate) const CLIS: &[CliSpec] = &[
    CliSpec {
        id: "claude",
        bins: &[
            "~/.local/bin/claude",
            "/opt/homebrew/bin/claude",
            "/usr/local/bin/claude",
        ],
        models: &["sonnet", "opus", "haiku", "fable"],
    },
    CliSpec {
        id: "codex",
        bins: &[
            "/opt/homebrew/bin/codex",
            "~/.local/bin/codex",
            "/usr/local/bin/codex",
        ],
        models: &[
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
            "gpt-5.5",
            "gpt-5.3-codex-spark",
        ],
    },
    CliSpec {
        id: "cursor",
        bins: &[
            "~/.local/bin/agent",
            "~/.local/bin/cursor-agent",
            "/opt/homebrew/bin/agent",
            "/usr/local/bin/agent",
        ],
        models: &["grok-4.6", "cursor-auto"],
    },
    // Google's official ACP agent, managed by Rotli at a fixed path (ADR
    // 2026-09-03). The roster is the agent's current offering as observed on
    // 2026-09-02; a turn re-validates the id against the account's own list.
    CliSpec {
        id: "antigravity",
        bins: &[antigravity::BIN_CANDIDATE],
        models: &[
            "gemini-3.8-flash-high",
            "gemini-3.8-flash-medium",
            "gemini-3.8-flash-low",
            "gemini-3.7-flash-high",
            "gemini-3.7-flash-medium",
            "gemini-3.7-flash-low",
        ],
    },
];

pub(crate) fn spec(provider: &str) -> Result<&'static CliSpec, String> {
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

pub(crate) fn resolve_bin(s: &CliSpec) -> Option<PathBuf> {
    s.bins
        .iter()
        .filter_map(|p| expand_home(p))
        .find(|p| p.is_file())
}

/// Where the prompt rides.
#[derive(Debug, PartialEq)]
pub(crate) enum PromptVia {
    Stdin,
    Acp,
}

/// The full argv for one completion step — pure, so the exact argument shape
/// (the security surface) unit-tests. The prompt is the ONLY caller-shaped
/// value; everything else is literal.
/// `imgs` = the attachments staged for THIS turn, or None for an ordinary text
/// turn. Every image concession below is scoped to `Some` on purpose: a turn
/// with no picture keeps the tightest posture the lane has always had (the maintainer,
/// 2026-08-04 — "all frontier models should be able to see images", without
/// making every unrelated turn looser).
#[cfg(test)]
fn build_args(
    provider: &str,
    model: &str,
    prompt: &str,
    timeout_secs: u64,
    imgs: Option<&ImageFiles>,
) -> Result<(Vec<String>, PromptVia), String> {
    build_args_tuned(provider, model, prompt, timeout_secs, None, None, imgs)
}

/// The webview may request quality/cost controls, but the trusted native side
/// owns the allowlists and translates them into provider-native argv. Unknown
/// values fail closed before any process is started.
pub(crate) fn build_args_tuned(
    provider: &str,
    model: &str,
    _prompt: &str,
    _timeout_secs: u64,
    reasoning_effort: Option<&str>,
    service_tier: Option<&str>,
    imgs: Option<&ImageFiles>,
) -> Result<(Vec<String>, PromptVia), String> {
    let s = spec(provider)?;
    if !s.models.contains(&model) {
        return Err(format!(
            "model \"{model}\" isn't in the {provider} allowlist"
        ));
    }
    let own = |xs: &[&str]| xs.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    match provider {
        // print mode, safe mode (no ambient hooks/MCP/plugins/instructions),
        // ALL tools off, JSON result envelope, no session litter — the loop
        // replays the transcript, so there is nothing to resume.
        // WITH images: the one concession is `--tools Read` + `--add-dir` scoped
        // to the staged image dir — the narrowest allowlist that can open a PNG,
        // and it reverts to `--tools ""` the moment there is no attachment.
        "claude" => {
            if let Some(tier) = service_tier {
                return Err(format!("service tier \"{tier}\" isn't supported by claude"));
            }
            if let Some(effort) = reasoning_effort {
                if model == "haiku"
                    || !matches!(effort, "low" | "medium" | "high" | "xhigh" | "max")
                {
                    return Err(format!(
                        "reasoning effort \"{effort}\" isn't allowed for claude model \"{model}\""
                    ));
                }
            }
            let mut args = own(&["-p", "--safe-mode", "--tools"]);
            args.push(if imgs.is_some() {
                "Read".into()
            } else {
                String::new()
            });
            args.extend(own(&[
                "--model",
                model,
                "--output-format",
                "json",
                "--no-session-persistence",
            ]));
            if let Some(effort) = reasoning_effort {
                args.push("--effort".into());
                args.push(effort.into());
            }
            if let Some(staged) = imgs {
                args.push("--add-dir".into());
                args.push(staged.dir.to_string_lossy().to_string());
            }
            Ok((args, PromptVia::Stdin))
        }
        // exec mode (non-interactive — it never prompts, so there is NO
        // --ask-for-approval flag here; verified against 0.137.0), read-only
        // sandbox, shell tool off, JSONL out, no session litter (--ephemeral);
        // "-" = prompt from stdin. --cd pins it to a scratch dir OUTSIDE any repo.
        "codex" => {
            if let Some(effort) = reasoning_effort {
                let allowed = match model {
                    "gpt-5.6-sol" | "gpt-5.6-terra" => {
                        matches!(
                            effort,
                            "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
                        )
                    }
                    "gpt-5.6-luna" => {
                        matches!(effort, "low" | "medium" | "high" | "xhigh" | "max")
                    }
                    _ => matches!(effort, "low" | "medium" | "high" | "xhigh"),
                };
                if !allowed {
                    return Err(format!(
                        "reasoning effort \"{effort}\" isn't allowed for codex model \"{model}\""
                    ));
                }
            }
            if let Some(tier) = service_tier {
                if !model.starts_with("gpt-5.6-") || !matches!(tier, "standard" | "fast") {
                    return Err(format!(
                        "service tier \"{tier}\" isn't allowed for codex model \"{model}\""
                    ));
                }
            }
            let scratch = codex_scratch_dir()?;
            let mut args = vec![
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
            ];
            if let Some(effort) = reasoning_effort {
                args.push("-c".into());
                args.push(format!("model_reasoning_effort=\"{effort}\""));
            }
            // `standard` means the account/configured default. Only Fast needs
            // an override, keeping existing installations byte-for-byte stable.
            if service_tier == Some("fast") {
                args.push("-c".into());
                args.push("service_tier=\"fast\"".into());
            }
            Ok((args, PromptVia::Stdin)).map(|(mut args, via): (Vec<String>, PromptVia)| {
                // codex takes image FILES natively — no tool or permission
                // concession needed at all. `-` (stdin) must stay last.
                for path in imgs.map(|s| s.paths.as_slice()).unwrap_or(&[]) {
                    args.push("-i".into());
                    args.push(path.clone());
                }
                args.push("-".into());
                (args, via)
            })
        }
        // ACP is Cursor's documented boundary for custom clients. `ask` is
        // read-only, the process starts in a fresh empty directory, the ACP
        // client advertises no filesystem/terminal capability, and the runner
        // rejects every permission request. Cursor owns the changing model
        // roster. `cursor-auto` intentionally emits no override; reviewed ids
        // use Cursor's documented global `--model` parameter.
        "cursor" => {
            if let Some(effort) = reasoning_effort {
                return Err(format!(
                    "reasoning effort \"{effort}\" isn't supported by cursor auto"
                ));
            }
            if let Some(tier) = service_tier {
                return Err(format!(
                    "service tier \"{tier}\" isn't supported by cursor auto"
                ));
            }
            if imgs.is_some() {
                return Err("Cursor code chat does not accept image attachments in Rotli".into());
            }
            let mut args = Vec::new();
            if model != "cursor-auto" {
                args.extend(own(&["--model", model]));
            }
            args.extend(own(&["--mode", "ask", "acp"]));
            Ok((args, PromptVia::Acp))
        }
        // Google's ACP agent takes no argv: the model is a session config
        // option selected after session/new (acp.rs), the profile rides env.
        "antigravity" => {
            if let Some(effort) = reasoning_effort {
                return Err(format!("reasoning effort \"{effort}\" isn't supported by antigravity"));
            }
            if let Some(tier) = service_tier {
                return Err(format!("service tier \"{tier}\" isn't supported by antigravity"));
            }
            Ok((Vec::new(), PromptVia::Acp)) // images ride the ACP prompt as blocks (acp_images.rs)
        }
        _ => Err(format!("unknown provider \"{provider}\"")),
    }
}

fn codex_scratch_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join("rotli-codex");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("couldn't create the codex scratch dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// Attached images, written to disk for a lane whose CLI takes image FILES.
/// Held as a value so the temp dir is removed when the turn ends, whatever
/// happens — an attachment must not linger in /tmp after the answer.
pub(crate) struct ImageFiles {
    dir: std::path::PathBuf,
    pub(crate) paths: Vec<String>,
}

impl Drop for ImageFiles {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Decode the composer's base64 (raw, or a `data:image/…;base64,` URL) into
/// real PNG files. Returns None when there is nothing to write.
fn write_image_files(images: &[String]) -> Result<Option<ImageFiles>, String> {
    if images.is_empty() {
        return Ok(None);
    }
    use base64::Engine as _;
    let dir = std::env::temp_dir().join(format!(
        "rotli-img-{}",
        ulid::Ulid::new().to_string().to_lowercase()
    ));
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("couldn't stage the attached images: {e}"))?;
    // own the dir from here on, so ANY early return below still cleans it up
    let mut staged = ImageFiles {
        dir: dir.clone(),
        paths: Vec::new(),
    };
    for (i, raw) in images.iter().enumerate() {
        // a data URL carries its own header — take what follows the comma
        let payload = raw
            .split_once(',')
            .map(|(_, rest)| rest)
            .unwrap_or(raw.as_str());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.trim())
            .map_err(|_| "an attached image wasn't valid base64".to_string())?;
        let path = dir.join(format!("image-{}.png", i + 1));
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("couldn't stage an attached image: {e}"))?;
        staged.paths.push(path.to_string_lossy().to_string());
    }
    Ok(Some(staged))
}

/// Lanes that read an attached image from a PATH rather than a native flag, so
/// the prompt has to name the files. codex takes `-i <FILE>` instead.
fn reads_images_from_path(provider: &str) -> bool {
    provider == "claude"
}

/// The line prepended to a turn that carries attachments, for the path-reading
/// lanes. It ties the files to the `[Image #N]` tokens the composer already put
/// in the message, so "what's in image 2?" resolves.
fn image_preamble(paths: &[String]) -> String {
    let list = paths
        .iter()
        .enumerate()
        .map(|(i, p)| format!("[Image #{}] = {p}", i + 1))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "The user attached {} image(s). Read these files to see them — they are what the [Image #N] references in the message mean:\n{list}\n",
        paths.len()
    )
}

// ── output parsers (pure) ─────────────────────────────────────────────────────

/// `claude -p --output-format json` → one JSON document with `result` (+
/// `is_error`). Some paths prepend plain-text warnings, so fall back to
/// scanning lines from the end for the envelope.
pub(crate) fn parse_claude_json(stdout: &str) -> Result<String, String> {
    let envelope = |v: &serde_json::Value| -> Option<Result<String, String>> {
        let result = v.get("result")?.as_str()?.trim().to_string();
        if v.get("is_error").and_then(|b| b.as_bool()) == Some(true) {
            return Some(Err(if result.is_empty() {
                "claude returned an error".into()
            } else {
                result
            }));
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
pub(crate) fn parse_codex_jsonl(stdout: &str) -> Result<String, String> {
    let mut last: Option<String> = None;
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        match v.get("type").and_then(|s| s.as_str()).unwrap_or("") {
            "item.completed"
                if v.pointer("/item/type").and_then(|s| s.as_str()) == Some("agent_message") =>
            {
                last = v
                    .pointer("/item/text")
                    .and_then(|s| s.as_str())
                    .map(String::from)
                    .or(last);
            }
            "turn.failed" => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(|s| s.as_str())
                    .unwrap_or("codex turn failed");
                return Err(msg.to_string());
            }
            "error" => {
                let msg = v
                    .get("message")
                    .and_then(|s| s.as_str())
                    .unwrap_or("codex error");
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

/// Add a small diagnostic tail exactly once.
pub(crate) fn with_stderr_tail(message: &str, stderr: &str, open: &str, close: &str) -> String {
    let tail = stderr
        .lines()
        .rev()
        .take(3)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" · ");
    let tail = tail.chars().take(480).collect::<String>();
    if tail.is_empty() || message.contains(&tail) {
        message.to_string()
    } else {
        format!("{message}{open}{tail}{close}")
    }
}

// ── the runner ────────────────────────────────────────────────────────────────

/// Spawn + register + read to EOF + reap. The watchdog thread kills the child
/// at the deadline (matching token only — a finished step's watchdog must not
/// shoot a successor reusing the request id); `cli_cancel` kills it early.
pub(crate) fn run_registered(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    mut cmd: Command,
    stdin_payload: Option<&str>,
    timeout: Duration,
) -> Result<(String, String, bool), String> {
    cmd.stdin(if stdin_payload.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("couldn't launch the CLI: {e}"))?;

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

/// Historical organizer-egress predicate retained for deterministic security
/// evals. The live organizer is local-only and has no remote transport function.
#[cfg(test)]
pub(crate) fn organizer_egress_allowed(prompt: &str) -> Result<(), String> {
    if crate::secret::blocked_for_remote(prompt) {
        return Err("organizer prompt carries protected content — refusing the remote lane".into());
    }
    Ok(())
}

// ── commands ──────────────────────────────────────────────────────────────────

/// One constrained completion step on a connected client. Blocking work rides
/// `spawn_blocking` so `cli_cancel` can interleave on the IPC lane.
// Keep the IPC parameters flat: Tauri derives the command contract from these
// names, and wrapping them would be a breaking frontend/native API change.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn cli_complete(
    state: tauri::State<'_, ProviderState>,
    request_id: String,
    provider: String,
    model: String,
    prompt: String,
    timeout_ms: Option<u64>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    // `images`: base64 payloads (raw or data: URL) the composer attached. Only
    // lanes with a NATIVE image flag carry them — see `image_args`.
    images: Option<Vec<String>>,
) -> Result<String, String> {
    // defence in depth: refuse before a task is even scheduled (and
    // `complete_connected` asks again, for every caller that is not this one)
    if crate::secret::blocked_for_remote(&prompt) {
        return Err(crate::provider_lane::SECRET_MESSAGE.into());
    }
    let children = Arc::clone(&state.children);
    tauri::async_runtime::spawn_blocking(move || {
        complete_connected(
            &children,
            &request_id,
            &provider,
            &model,
            &prompt,
            timeout_ms,
            reasoning_effort.as_deref(),
            service_tier.as_deref(),
            images.as_deref().unwrap_or(&[]),
        )
    })
    .await
    .map_err(|e| format!("provider task failed: {e}"))?
}

/// One connected-client completion with every gate a chat turn gets, as a plain
/// blocking function — so the `rotli-helper` bridge (helper.rs) and the IPC
/// command above share one sequence: provider policy, the secret-egress
/// refusal, the timeout clamp, image staging, then the lane.
#[allow(clippy::too_many_arguments)]
pub(crate) fn complete_connected(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    request_id: &str,
    provider: &str,
    model: &str,
    prompt: &str,
    timeout_ms: Option<u64>,
    reasoning_effort: Option<&str>,
    service_tier: Option<&str>,
    images: &[String],
) -> Result<String, String> {
    connected_provider_execution_allowed(provider)?;
    // the CLI lane is remote by definition — same egress law as chat.rs; the
    // lane seam checks again, and here it refuses before an image hits disk
    if crate::secret::blocked_for_remote(prompt) {
        return Err(crate::provider_lane::SECRET_MESSAGE.into());
    }
    let millis = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS);
    let timeout = Duration::from_millis(millis);
    // a local that outlives the run below — what keeps the temp dir alive until
    // the child has READ the files, and removes it on the way out regardless
    let staged = write_image_files(images)?;
    // path-reading lanes need the files NAMED in the prompt; codex gets argv
    let prompt = match &staged {
        Some(s) if reads_images_from_path(provider) => format!("{}\n{prompt}", image_preamble(&s.paths)),
        _ => prompt.to_string(),
    };
    crate::provider_lane::complete_blocking(
        children,
        request_id,
        provider,
        model,
        &prompt,
        timeout,
        reasoning_effort,
        service_tier,
        staged.as_ref(),
    )
}

/// Kill a live completion (the composer's stop). Unknown ids are a no-op.
#[tauri::command]
pub fn cli_cancel(
    state: tauri::State<'_, ProviderState>,
    request_id: String,
) -> Result<(), String> {
    if let Some(r) = state.children.lock().unwrap().get_mut(&request_id) {
        let _ = r.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod organizer_egress_tests {
    use super::*;

    /// AUDIT 2026-08-01, GAP 5 — the organizer was the ONE remote seam with a
    /// single line of defense. `skip_reason` drops secure and locked notes
    /// before a prompt is built, but two content paths never pass it: an area
    /// `_index.md` description (excluded from snapshotting) and the enrich
    /// prompt built after a filing move without a fresh secure re-read.
    #[test]
    fn the_organizer_lane_refuses_a_protected_prompt() {
        assert!(organizer_egress_allowed("Classify this note about oats").is_ok());
        // secret-shaped, e.g. leaked through an _index.md description line
        assert!(organizer_egress_allowed("summary: sk-ant-abcdefghijklmnop").is_err());
        // a marker that survived into the prompt
        assert!(organizer_egress_allowed("---\nsecure: true\n---\nfile this").is_err());
        // and ordinary prose the vault knows is secure
        crate::secret::remember_secure_text(
            "The Ravensworth trust distribution pauses until probate concludes.",
        );
        assert!(organizer_egress_allowed(
            "Classify: the ravensworth trust distribution pauses until probate"
        )
        .is_err());
    }
}

/// Retained as a stable IPC boundary for old webviews. Provider-backed image
/// generation is disabled before any path resolution, credential lookup, or
/// process spawn.
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
    // Keep the Tauri argument names stable while the old IPC surface migrates.
    let _ = (app, state, request_id, root, slug, engine);
    if crate::secret::blocked_for_remote(&prompt) {
        return Err(
            "That prompt carries protected content; provider-backed image generation is unavailable."
                .into(),
        );
    }
    refuse_cloud_image_generation()
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

pub(crate) fn detect(provider: &str) -> Result<CliDetect, String> {
    if provider == "antigravity" {
        // no CLI to probe: installed = the managed runtime is present,
        // authenticated = the agent's own credential file exists
        let status = antigravity::status();
        return Ok(CliDetect {
            installed: status.installed,
            version: status.version,
            authenticated: status.signed_in,
        });
    }
    if matches!(provider, "claude" | "codex" | "cursor") {
        let bin = resolve_bin(spec(provider)?);
        let version = bin.as_ref().and_then(|b| version_of(b, &["--version"]));
        let auth_args: &[&str] = match provider {
            "claude" => &["auth", "status"],
            "codex" => &["login", "status"],
            "cursor" => &["status"],
            _ => unreachable!(),
        };
        let authenticated = bin
            .as_ref()
            .and_then(|b| {
                Command::new(b)
                    .args(auth_args)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .ok()
            })
            .map(|status| status.success())
            .unwrap_or(false);
        return Ok(CliDetect {
            installed: bin.is_some(),
            version,
            authenticated,
        });
    }
    Err(format!("unknown provider \"{provider}\""))
}

fn version_of(bin: &PathBuf, args: &[&str]) -> Option<String> {
    let out = Command::new(bin).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    (!line.is_empty()).then_some(line)
}

// ─── tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_policy_allows_only_official_claude_codex_cursor_and_antigravity_clients() {
        assert!(connected_provider_execution_allowed("claude").is_ok());
        assert!(connected_provider_execution_allowed("codex").is_ok());
        assert!(connected_provider_execution_allowed("cursor").is_ok());
        assert!(connected_provider_execution_allowed("antigravity").is_ok());
        assert!(connected_provider_execution_allowed("gemini").is_err()); // never a raw Gemini CLI
    }

    #[test]
    fn antigravity_takes_no_argv_refuses_effort_and_tier_and_takes_images_as_blocks() {
        let m = "gemini-3.8-flash-high";
        let (args, via) = build_args("antigravity", m, "ignored", 60, None).unwrap();
        assert!(args.is_empty(), "the model is a session config option, never argv");
        assert_eq!(via, PromptVia::Acp);
        assert!(build_args_tuned("antigravity", m, "p", 60, Some("high"), None, None).is_err());
        assert!(build_args_tuned("antigravity", m, "p", 60, None, Some("fast"), None).is_err());
        // 2026-09-17: images become ACP prompt blocks (acp_images.rs), still no argv
        let imgs = ImageFiles { dir: std::env::temp_dir().join("rotli-no-such-dir"), paths: Vec::new() };
        let (args, via) = build_args("antigravity", m, "p", 60, Some(&imgs)).unwrap();
        assert!(args.is_empty());
        assert_eq!(via, PromptVia::Acp);
    }

    #[test]
    fn provider_backed_image_generation_is_disabled() {
        let refusal: Result<(), String> = refuse_cloud_image_generation();
        assert_eq!(refusal.unwrap_err(), CLOUD_IMAGE_POLICY_MESSAGE);
    }

    #[test]
    fn allowlist_refuses_unknown_provider_and_model() {
        assert!(build_args("ollama", "x", "p", 60, None).is_err());
        assert!(build_args("claude", "gpt-5.5", "p", 60, None).is_err());
        assert!(build_args("codex", "sonnet", "p", 60, None).is_err());
        assert!(build_args("cursor", "sonnet", "p", 60, None).is_err());
        // model ids never leak across lanes, newest lane included
        assert!(build_args("antigravity", "grok-4.6", "p", 60, None).is_err());
        assert!(build_args("cursor", "gemini-3.8-flash-high", "p", 60, None).is_err());
        assert!(build_args("claude", "gemini-3.8-flash-high", "p", 60, None).is_err());
        assert!(spec("unknown").is_err());
    }

    #[test]
    fn claude_args_are_toolless_json_print_mode() {
        let (args, via) = build_args("claude", "sonnet", "ignored", 60, None).unwrap();
        let expected = ["-p", "--safe-mode", "--tools", "", "--model", "sonnet", "--output-format", "json"];
        assert_eq!(&args[..expected.len()], expected);
        assert_eq!(args.last().unwrap(), "--no-session-persistence");
        assert_eq!(args.len(), expected.len() + 1);
        assert_eq!(via, PromptVia::Stdin);
    }

    #[test]
    fn codex_args_are_sandboxed_jsonl_with_stdin_prompt() {
        let (args, via) = build_args("codex", "gpt-5.6-sol", "ignored", 60, None).unwrap();
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
    fn cursor_args_use_documented_read_only_acp_ask_mode() {
        let (args, via) = build_args("cursor", "grok-4.6", "ignored", 60, None).unwrap();
        assert_eq!(args, vec!["--model", "grok-4.6", "--mode", "ask", "acp"]);
        assert_eq!(via, PromptVia::Acp);
        assert!(!args.iter().any(|arg| arg == "--force" || arg == "--yolo"));
        let (auto, _) = build_args("cursor", "cursor-auto", "ignored", 60, None).unwrap();
        assert_eq!(auto, vec!["--mode", "ask", "acp"]);
        assert!(
            build_args_tuned("cursor", "cursor-auto", "p", 60, Some("high"), None, None,).is_err()
        );
    }

    #[test]
    fn frontier_tuning_is_provider_scoped_and_allowlisted() {
        let (claude, _) =
            build_args_tuned("claude", "sonnet", "ignored", 60, Some("max"), None, None).unwrap();
        let effort = claude.iter().position(|arg| arg == "--effort").unwrap();
        assert_eq!(claude[effort + 1], "max");

        let (codex, _) =
            build_args_tuned("codex", "gpt-5.6-sol", "ignored", 60, Some("ultra"), Some("fast"), None).unwrap();
        assert!(codex.contains(&"model_reasoning_effort=\"ultra\"".to_string()));
        assert!(codex.contains(&"service_tier=\"fast\"".to_string()));
        assert_eq!(codex.last().unwrap(), "-");

        assert!(
            build_args_tuned("codex", "gpt-5.5", "p", 60, Some("max"), None, None)
                .unwrap_err()
                .contains("reasoning effort")
        );
        assert!(
            build_args_tuned("codex", "gpt-5.6-luna", "p", 60, Some("ultra"), None, None)
                .unwrap_err()
                .contains("reasoning effort")
        );
        assert!(
            build_args_tuned("codex", "gpt-5.5", "p", 60, None, Some("fast"), None)
                .unwrap_err()
                .contains("service tier")
        );
        assert!(
            build_args_tuned("claude", "haiku", "p", 60, Some("high"), None, None)
                .unwrap_err()
                .contains("reasoning effort")
        );
        assert!(build_args_tuned("codex", "gpt-5.6-luna", "p", 60, Some("max"), Some("fast"), None).is_ok());
        assert!(
            build_args_tuned("claude", "sonnet", "p", 60, None, Some("fast"), None)
                .unwrap_err()
                .contains("service tier")
        );
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
            r#"{"type":"thread.started","thread_id":"t1"}"#,
            "\n",
            r#"{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}"#,
            "\n",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"first"}}"#,
            "\n",
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}"#,
            "\n",
            r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}"#,
            "\n",
        );
        assert_eq!(parse_codex_jsonl(sample).unwrap(), "final answer");
        let failed = r#"{"type":"turn.failed","error":{"message":"quota exhausted"}}"#;
        assert_eq!(parse_codex_jsonl(failed).unwrap_err(), "quota exhausted");
        assert!(parse_codex_jsonl("").is_err());
    }

    #[test]
    fn home_expansion_only_touches_tilde_prefix() {
        assert_eq!(
            expand_home("/opt/homebrew/bin/codex").unwrap(),
            PathBuf::from("/opt/homebrew/bin/codex")
        );
        let home = std::env::var("HOME").unwrap();
        assert_eq!(
            expand_home("~/.local/bin/claude").unwrap(),
            PathBuf::from(home).join(".local/bin/claude")
        );
    }

    /// Every frontier lane can see an image (the maintainer, 2026-08-04) — but the
    /// concessions that allow it are scoped to a turn that ACTUALLY carries
    /// one. A text turn must keep the byte-identical tight posture it always
    /// had; this is the test that keeps that true.
    #[test]
    fn image_concessions_apply_only_to_a_turn_that_carries_an_image() {
        let dir = std::env::temp_dir().join("rotli-img-test");
        let _ = std::fs::create_dir_all(&dir);
        let staged = ImageFiles {
            dir: dir.clone(),
            paths: vec![dir.join("image-1.png").to_string_lossy().to_string()],
        };

        // — claude: tools OFF without an image, a READ-ONLY allowlist with one —
        let (plain, _) = build_args("claude", "sonnet", "p", 60, None).unwrap();
        let at = plain.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(plain[at + 1], "", "a text turn keeps ALL tools off");
        assert!(!plain.iter().any(|a| a == "--add-dir"));

        let (withimg, _) = build_args("claude", "sonnet", "p", 60, Some(&staged)).unwrap();
        let at = withimg.iter().position(|a| a == "--tools").unwrap();
        assert_eq!(
            withimg[at + 1],
            "Read",
            "the narrowest allowlist that opens a PNG"
        );
        let at = withimg.iter().position(|a| a == "--add-dir").unwrap();
        assert_eq!(
            withimg[at + 1],
            dir.to_string_lossy(),
            "scoped to the staged dir only"
        );

        // — codex: native image args, and "-" must stay LAST (it is stdin) —
        let (plain, _) = build_args("codex", "gpt-5.6-sol", "p", 60, None).unwrap();
        assert!(!plain.iter().any(|a| a == "-i"));
        assert_eq!(plain.last().unwrap(), "-");
        let (withimg, _) = build_args("codex", "gpt-5.6-sol", "p", 60, Some(&staged)).unwrap();
        assert_eq!(withimg.last().unwrap(), "-", "stdin marker stays last");
        let at = withimg.iter().position(|a| a == "-i").unwrap();
        assert_eq!(withimg[at + 1], staged.paths[0]);
        // codex needs NO tool/permission concession at all
        assert!(!withimg
            .iter()
            .any(|a| a == "--dangerously-skip-permissions"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The preamble ties each staged file to the `[Image #N]` token the composer
    /// puts in the message, so "what's in image 2?" resolves for a path lane.
    #[test]
    fn the_image_preamble_numbers_files_from_one() {
        let text = image_preamble(&["/tmp/a.png".into(), "/tmp/b.png".into()]);
        assert!(text.contains("[Image #1] = /tmp/a.png"));
        assert!(text.contains("[Image #2] = /tmp/b.png"));
        assert!(text.contains("2 image(s)"));
        assert!(reads_images_from_path("claude"));
        assert!(!reads_images_from_path("cursor"));
        assert!(
            !reads_images_from_path("codex"),
            "codex takes files as argv"
        );
    }
}
