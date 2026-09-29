//! Claude chat over Claude Code's native agent protocol — the stream-json
//! control protocol the official Agent SDK speaks (and T3 Code drives), instead
//! of one tool-less `claude -p` per loop step with a JSON action protocol
//! written into the prompt.
//!
//! Rotli's tools reach the model as an in-process MCP server named `rotli`
//! (claude_protocol.rs). Claude Code's own tools stay OFF (`--tools ""`,
//! `--safe-mode`, `--strict-mcp-config`), and every tool call passes three
//! gates before the webview runs it or the model sees its result:
//!   1. `can_use_tool` — allow only `mcp__rotli__<name>` for a name this turn
//!      offered; deny everything else.
//!   2. the call's arguments — `blocked_for_remote` (secret shapes + the
//!      secure-prose ledger), exactly as the whole-prompt scan saw them before.
//!   3. the call's RESULT — the same scan, because a result no longer rides
//!      back inside a rescanned prompt; a hit is withheld from the model.
//!
//! The webview executes the tool itself (src/ai/nativeLoop.ts, with the loop's
//! own egress guards) and answers through `claude_session_tool_result`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::claude_protocol::{Protocol, Step, ToolSpec, Wire};
use crate::provider::{self, ProviderState, Running};

const MAX_TOOLS: usize = 32;
/// How long one tool may take in the webview before the model hears it failed.
const TOOL_WAIT: Duration = Duration::from_secs(300);
/// The whole turn's hard ceiling, whatever the per-step timeout × turns says.
const SESSION_CEILING: Duration = Duration::from_secs(30 * 60);

/// Tool calls waiting on the webview, keyed `<request_id>:<call_id>`.
#[derive(Default)]
pub struct SessionState {
    pending: Arc<Mutex<HashMap<String, Sender<String>>>>,
}

/// One chat turn on Claude's native protocol. Resolves with the final answer.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn claude_session_run(
    providers: tauri::State<'_, ProviderState>,
    sessions: tauri::State<'_, SessionState>,
    request_id: String,
    model: String,
    system_prompt: String,
    user_text: String,
    tools: Vec<ToolSpec>,
    max_turns: u32,
    timeout_ms: Option<u64>,
    reasoning_effort: Option<String>,
    on_event: Channel<String>,
) -> Result<String, String> {
    provider::connected_provider_execution_allowed("claude")?;
    // the lane is remote by definition — the same egress law as cli_complete
    if crate::secret::blocked_for_remote(&system_prompt) || crate::secret::blocked_for_remote(&user_text) {
        return Err(crate::provider_lane::SECRET_MESSAGE.into());
    }
    check_tools(&tools)?;
    let turns = max_turns.clamp(1, 24);
    let step = Duration::from_millis(timeout_ms.unwrap_or(provider::DEFAULT_TIMEOUT_MS).min(provider::MAX_TIMEOUT_MS));
    let deadline = (step * turns).min(SESSION_CEILING);
    let children = Arc::clone(&providers.children);
    let pending = Arc::clone(&sessions.pending);
    tauri::async_runtime::spawn_blocking(move || {
        // a discovered id the cache has not seen since launch is re-read from the
        // client before the argv builder (which reads the cache only) decides —
        // the same refresh complete_blocking does; it may spawn the CLI briefly
        let _ = crate::provider_lane::model_allowed("claude", &model);
        let args = session_args(&model, reasoning_effort.as_deref(), turns)?;
        let proto = Protocol::new(system_prompt, user_text, tools);
        run_session(&children, &pending, &request_id, &args, proto, deadline, on_event)
    })
    .await
    .map_err(|e| format!("claude session task failed: {e}"))?
}

/// The webview's answer to one `tool_call` event. Unknown ids are a no-op
/// (the turn was stopped, or the wait already timed out).
#[tauri::command]
pub fn claude_session_tool_result(
    sessions: tauri::State<'_, SessionState>,
    request_id: String,
    call_id: String,
    result: String,
) -> Result<(), String> {
    if let Some(tx) = sessions.pending.lock().unwrap().remove(&format!("{request_id}:{call_id}")) {
        let _ = tx.send(result);
    }
    Ok(())
}

fn check_tools(tools: &[ToolSpec]) -> Result<(), String> {
    if tools.len() > MAX_TOOLS {
        return Err("too many tools for one chat turn".into());
    }
    for t in tools {
        let shaped = !t.name.is_empty() && t.name.len() <= 40 && t.name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
        if !shaped || !t.input_schema.is_object() || t.description.len() > 4000 {
            return Err(format!("tool \"{}\" isn't a valid Rotli tool", t.name));
        }
    }
    Ok(())
}

/// The argv: Claude Code's own tools, ambient MCP servers, hooks, and session
/// files all off; every permission question comes to this process. The model
/// and effort flags come from the one-shot lane's allowlisted builder, so both
/// lanes accept exactly the same models and efforts.
pub(crate) fn session_args(model: &str, effort: Option<&str>, max_turns: u32) -> Result<Vec<String>, String> {
    let (checked, _) = provider::build_args_tuned("claude", model, "", 0, effort, None, None)?;
    let mut args: Vec<String> = [
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--tools", "", "--safe-mode", "--strict-mcp-config",
        "--permission-prompt-tool", "stdio", "--no-session-persistence",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.extend(["--max-turns".to_string(), max_turns.to_string()]);
    for flag in ["--model", "--effort"] {
        if let Some(i) = checked.iter().position(|a| a == flag) {
            args.extend([flag.to_string(), checked[i + 1].clone()]);
        }
    }
    Ok(args)
}

struct LiveWire<'a> {
    stdin: Option<ChildStdin>,
    events: Channel<String>,
    pending: &'a Arc<Mutex<HashMap<String, Sender<String>>>>,
    children: &'a Arc<Mutex<HashMap<String, Running>>>,
    request_id: &'a str,
    token: u64,
}

impl LiveWire<'_> {
    /// The CLI is still ours and still running (a stop or the deadline kills it).
    fn alive(&self) -> bool {
        match self.children.lock().unwrap().get_mut(self.request_id) {
            Some(r) if r.token == self.token => matches!(r.child.try_wait(), Ok(None)),
            _ => false,
        }
    }
}

impl Wire for LiveWire<'_> {
    fn send(&mut self, msg: &Value) {
        if let Some(stdin) = self.stdin.as_mut() {
            // a dead child is noticed by the stdout reader, not here
            let _ = writeln!(stdin, "{msg}").and_then(|_| stdin.flush());
        }
    }

    fn call_tool(&mut self, call_id: &str, name: &str, args: &Value) -> Option<String> {
        let key = format!("{}:{call_id}", self.request_id);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(key.clone(), tx);
        let event = json!({"type": "tool_call", "callId": call_id, "name": name, "args": args});
        let started = Instant::now();
        let mut answer = None;
        if self.events.send(event.to_string()).is_ok() {
            while started.elapsed() < TOOL_WAIT {
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(text) => {
                        answer = Some(text);
                        break;
                    }
                    Err(RecvTimeoutError::Timeout) if self.alive() => {}
                    Err(_) => break,
                }
            }
        }
        self.pending.lock().unwrap().remove(&key);
        answer
    }
}

fn run_session(
    children: &Arc<Mutex<HashMap<String, Running>>>,
    pending: &Arc<Mutex<HashMap<String, Sender<String>>>>,
    request_id: &str,
    args: &[String],
    mut proto: Protocol,
    deadline: Duration,
    events: Channel<String>,
) -> Result<String, String> {
    let bin = provider::resolve_bin(provider::spec("claude")?).ok_or("claude isn't installed (checked its usual homes)")?;
    // a scratch cwd: no project CLAUDE.md or hooks from wherever Rotli launched
    let scratch = tempfile::Builder::new()
        .prefix("rotli-claude-")
        .tempdir()
        .map_err(|e| format!("couldn't create the claude scratch dir: {e}"))?;
    let mut child = Command::new(&bin)
        .args(args)
        .current_dir(scratch.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't launch the CLI: {e}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("the CLI has no stdout")?;
    let err_thread = crate::child_run::collect_stderr(child.stderr.take());
    let token = crate::child_run::register(children, request_id, child, deadline);

    let mut wire = LiveWire { stdin, events, pending, children, request_id, token };
    wire.send(&proto.initialize());
    let mut outcome = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Step::Done(result) = proto.on_line(&line, &mut wire) {
            outcome = Some(result);
            break;
        }
    }
    drop(wire.stdin.take()); // end of input: the CLI exits on its own
    if let Some(mut running) = crate::child_run::reap(children, request_id, token) {
        let exited = (0..40).any(|_| {
            let done = matches!(running.child.try_wait(), Ok(Some(_)));
            if !done {
                std::thread::sleep(Duration::from_millis(50));
            }
            done
        });
        if !exited {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
    let stderr = err_thread.join().unwrap_or_default();
    outcome.unwrap_or_else(|| Err(provider::with_stderr_tail("claude ended without an answer", &stderr, " — ", "")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(name: &str) -> ToolSpec {
        ToolSpec { name: name.into(), description: "d".into(), input_schema: json!({"type": "object"}) }
    }

    #[test]
    fn the_argv_keeps_claude_codes_own_tools_and_ambient_config_off() {
        let args = session_args("opus[1m]", None, 9).unwrap();
        let has = |pair: [&str; 2]| args.windows(2).any(|w| w[0] == pair[0] && w[1] == pair[1]);
        assert!(has(["--tools", ""]) && has(["--permission-prompt-tool", "stdio"]));
        assert!(has(["--input-format", "stream-json"]) && has(["--max-turns", "9"]) && has(["--model", "opus[1m]"]));
        for flag in ["--safe-mode", "--strict-mcp-config", "--no-session-persistence"] {
            assert!(args.iter().any(|a| a == flag), "missing {flag}");
        }
        assert!(!args.iter().any(|a| a == "--allowedTools" || a == "-p"), "every call must reach can_use_tool");
        // the account default passes no --model, and both lanes share one allowlist
        assert!(!session_args("default", None, 3).unwrap().iter().any(|a| a == "--model"));
        assert!(session_args("not-a-model", None, 3).is_err());
        assert!(session_args("opus[1m]", Some("ludicrous"), 3).is_err());
    }

    /// The real CLI end to end: handshake, the in-process server, a permitted
    /// tool call answered through the pending map, and the final answer.
    /// `cargo test --lib live_round_trip -- --ignored` (spends one haiku turn).
    #[test]
    #[ignore = "spawns the installed claude CLI"]
    fn live_round_trip_with_the_real_cli() {
        let children = Arc::new(Mutex::new(HashMap::new()));
        let pending: Arc<Mutex<HashMap<String, Sender<String>>>> = Arc::default();
        let answers = Arc::clone(&pending);
        let events = Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(raw) = body else { return Ok(()) };
            // Channel<String> sends a JSON string holding the event's JSON
            let inner: String = serde_json::from_str(&raw).unwrap();
            let ev: Value = serde_json::from_str(&inner).unwrap();
            let key = format!("live:{}", ev["callId"].as_str().unwrap());
            if let Some(tx) = answers.lock().unwrap().remove(&key) {
                let _ = tx.send(format!("ECHO:{}", ev["args"]["query"].as_str().unwrap_or("")));
            }
            Ok(())
        });
        let tool = ToolSpec {
            name: "search_notes".into(),
            description: "Search the user's notes.".into(),
            input_schema: json!({"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}),
        };
        let proto = Protocol::new(
            "You are a terse test agent.".into(),
            "Call search_notes once with the query kiwi, then reply with exactly the text it returned.".into(),
            vec![tool],
        );
        let args = session_args("haiku", None, 4).unwrap();
        let answer = run_session(&children, &pending, "live", &args, proto, Duration::from_secs(120), events).unwrap();
        assert!(answer.contains("ECHO:kiwi"), "got: {answer}");
        assert!(children.lock().unwrap().is_empty() && pending.lock().unwrap().is_empty());
    }

    #[test]
    fn tool_specs_must_look_like_rotli_tools() {
        assert!(check_tools(&[spec("web_fetch")]).is_ok());
        assert!(check_tools(&[spec("Bash")]).is_err());
        assert!(check_tools(&[spec("mcp__x__y-z")]).is_err());
        let mut bad = spec("read_note");
        bad.input_schema = json!("nope");
        assert!(check_tools(&[bad]).is_err());
        assert!(check_tools(&vec![spec("a"); MAX_TOOLS + 1]).is_err());
    }
}
